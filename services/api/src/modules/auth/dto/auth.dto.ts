import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty, type ApiPropertyOptions } from '@nestjs/swagger';

/**
 * Request DTOs for `/api/v1/auth`.
 *
 * Validation happens here and again in the service: the pipe protects the
 * process from malformed input, the service protects the data from anything a
 * client can change (AGENTS.md sections 37, 42).
 *
 * The split is also why **no password length rule appears below**. Length is
 * policy rather than shape, and the policy is `PASSWORD_MIN_LENGTH`, which is
 * configurable. A `@MinLength` here would be a second, frozen copy of it: it
 * fired first, so raising the setting below 10 did nothing and raising it above
 * 10 left the client with class-validator's message instead of the
 * `details.reasons` `AuthService.assertPasswordPolicy` returns. Both password
 * endpoints are covered by the service check, which is the single authority.
 */

const MAX_EMAIL_LENGTH = 255;
const MAX_PASSWORD_LENGTH = 512;

/**
 * Describes a password for the OpenAPI document.
 *
 * `minLength` cannot state the real minimum, because the real minimum is a
 * deployment setting. Naming the default keeps the document honest without
 * pretending the value is fixed.
 */
function passwordProperty(): ApiPropertyOptions {
  return {
    writeOnly: true,
    minLength: 10,
    description: 'Minimum length comes from PASSWORD_MIN_LENGTH (default 10).',
  };
}

export class RegisterDto {
  @ApiProperty({ example: 'person@example.com', maxLength: MAX_EMAIL_LENGTH })
  @IsString()
  @IsEmail()
  @MaxLength(MAX_EMAIL_LENGTH)
  public email!: string;

  @ApiProperty(passwordProperty())
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_PASSWORD_LENGTH)
  public password!: string;
}

export class LoginDto {
  @ApiProperty({ example: 'person@example.com' })
  @IsString()
  @IsEmail()
  @MaxLength(MAX_EMAIL_LENGTH)
  public email!: string;

  @ApiProperty({ writeOnly: true })
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_PASSWORD_LENGTH)
  public password!: string;
}

export class RefreshTokenDto {
  @ApiProperty({ description: 'Opaque refresh token returned by login.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  public refreshToken!: string;
}

export class PasswordRecoveryRequestDto {
  @ApiProperty({ example: 'person@example.com' })
  @IsString()
  @IsEmail()
  @MaxLength(MAX_EMAIL_LENGTH)
  public email!: string;
}

export class PasswordRecoveryCompleteDto {
  @ApiProperty({ description: 'Token from the recovery message.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  public token!: string;

  @ApiProperty(passwordProperty())
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_PASSWORD_LENGTH)
  public password!: string;
}

export class VerifyEmailDto {
  @ApiProperty({ description: 'Code from the address verification message.', writeOnly: true })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  public token!: string;
}
