import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * Request DTOs for `/api/v1/admin`.
 *
 * Validation here protects the process from malformed input; the service
 * revalidates anything that matters (AGENTS.md sections 37, 42). `limit` is
 * bounded in the DTO so a caller cannot ask for the whole table, and each list
 * endpoint has its own query type so a filter that does not apply is rejected
 * rather than silently ignored (`forbidNonWhitelisted`).
 */

export const ADMIN_LIST_DEFAULT_LIMIT = 20;
export const ADMIN_LIST_MAX_LIMIT = 100;

/** Query shared by every paginated admin list. */
export class AdminPaginationQueryDto {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: ADMIN_LIST_MAX_LIMIT,
    default: ADMIN_LIST_DEFAULT_LIMIT,
    description: 'Rows per page.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(ADMIN_LIST_MAX_LIMIT)
  public limit: number = ADMIN_LIST_DEFAULT_LIMIT;

  @ApiPropertyOptional({
    description: 'Opaque cursor from `pagination.nextCursor` of the previous page.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  public cursor?: string;
}

export class AdminAuditLogQueryDto extends AdminPaginationQueryDto {
  @ApiPropertyOptional({ description: 'Restrict to a single recorded action.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  public action?: string;
}

export class AdminRiskEventQueryDto extends AdminPaginationQueryDto {
  @ApiPropertyOptional({ description: 'Restrict to a single risk event type.' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  public type?: string;
}

export class SetFeatureFlagDto {
  @ApiProperty({ description: 'Global on/off state of the flag.' })
  @IsBoolean()
  public enabled!: boolean;
}

/** Path parameter for the flag endpoints. */
export class AdminFeatureFlagKeyDto {
  @ApiProperty({ maxLength: 120 })
  @IsString()
  @MaxLength(120)
  public key!: string;
}
