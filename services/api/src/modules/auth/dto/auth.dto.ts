import { IsEmail, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Request DTOs for `/api/v1/auth`.
 *
 * Validation happens here and again in the service: the pipe protects the
 * process from malformed input, the service protects the data from anything a
 * client can change (AGENTS.md sections 37, 42).
 */

const MAX_EMAIL_LENGTH = 255;
const MAX_PASSWORD_LENGTH = 512;

export class RegisterDto {
  @ApiProperty({ example: 'person@example.com', maxLength: MAX_EMAIL_LENGTH })
  @IsString()
  @IsEmail()
  @MaxLength(MAX_EMAIL_LENGTH)
  public email!: string;

  @ApiProperty({ minLength: 10, writeOnly: true })
  @IsString()
  @IsNotEmpty()
  @MinLength(10)
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

  @ApiProperty({ minLength: 10, writeOnly: true })
  @IsString()
  @IsNotEmpty()
  @MinLength(10)
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
