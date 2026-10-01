import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import type { Plugin } from 'vite';

/**
 * Vite plugin that compiles NestJS sources with the TypeScript compiler instead
 * of esbuild.
 *
 * WHY THIS EXISTS: NestJS dependency injection reads the `design:paramtypes`
 * decorator metadata that only `emitDecoratorMetadata` produces. Vite's esbuild
 * transform strips types without emitting decorator metadata, so controllers are
 * instantiated with no constructor arguments and fail at request time with an
 * `undefined` dereference that points at the wrong line.
 *
 * The plugin therefore mirrors the real build: the compiler options are read
 * from the service tsconfig so the test transform can never drift from
 * `tsc -b`. Only the API service needs it, because it is the only workspace that
 * uses decorators; `packages/*` keep the faster esbuild transform.
 */
const API_TSCONFIG = path.resolve(__dirname, '../services/api/tsconfig.json');
const API_SOURCE_PATTERN = /[\\/]services[\\/]api[\\/]src[\\/].*\.ts$/;

/** Loads the API compiler options once per process. */
function loadApiCompilerOptions(): ts.CompilerOptions {
  const configFile = ts.readConfigFile(API_TSCONFIG, (fileName) => readFileSync(fileName, 'utf8'));

  if (configFile.error !== undefined) {
    const message = ts.flattenDiagnosticMessageText(configFile.error.messageText, ' ');
    throw new Error(`Cannot read ${API_TSCONFIG}: ${message}`);
  }

  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    path.dirname(API_TSCONFIG),
  );

  if (parsed.errors.length > 0) {
    const message = parsed.errors
      .map((error) => ts.flattenDiagnosticMessageText(error.messageText, ' '))
      .join('; ');
    throw new Error(`Invalid ${API_TSCONFIG}: ${message}`);
  }

  return {
    ...parsed.options,
    // Vite consumes ES modules and needs a source map; the build-only options
    // from the project references must not leak into the transform.
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    declaration: false,
    declarationMap: false,
    composite: false,
    incremental: false,
    emitDeclarationOnly: false,
    noEmit: false,
    outDir: undefined,
    outFile: undefined,
    tsBuildInfoFile: undefined,
    sourceMap: true,
    inlineSourceMap: false,
    inlineSources: true,
  };
}

export function decoratorMetadataPlugin(): Plugin {
  const compilerOptions = loadApiCompilerOptions();

  return {
    name: 'deliveryuy:tsc-decorator-metadata',
    enforce: 'pre',

    transform(code, id) {
      if (!API_SOURCE_PATTERN.test(id)) {
        return null;
      }

      const result = ts.transpileModule(code, {
        fileName: id,
        compilerOptions,
        reportDiagnostics: true,
      });

      const fatal = (result.diagnostics ?? []).filter(
        (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
      );

      if (fatal.length > 0) {
        const message = fatal
          .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '))
          .join('; ');
        throw new Error(`TypeScript transform failed for ${id}: ${message}`);
      }

      return {
        code: result.outputText,
        map:
          result.sourceMapText === undefined ? null : (JSON.parse(result.sourceMapText) as never),
      };
    },
  };
}
