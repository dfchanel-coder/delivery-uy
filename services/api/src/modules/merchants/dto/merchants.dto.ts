import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { MerchantStatus } from '@deliveryuy/database';

/**
 * Request DTOs for the merchant surface (docs/API_RULES.md "Validation").
 *
 * Everything is revalidated here even though the client validates too: the
 * frontend is never authoritative (AGENTS.md section 42). `whitelist` and
 * `forbidNonWhitelisted` are on globally, so a field a DTO does not declare is
 * rejected rather than ignored.
 */

/** E.164: a leading `+`, a non-zero country code, then the subscriber number. */
const E164_PHONE = /^\+[1-9]\d{6,14}$/;

const MERCHANT_STATUSES = Object.values(MerchantStatus);

export class RegisterMerchantDto {
  @ApiProperty({ format: 'uuid', description: 'City the business operates in.' })
  @IsUUID()
  public cityId!: string;

  @ApiProperty({ maxLength: 160, description: 'Name shown to customers.' })
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  public tradeName!: string;

  @ApiProperty({ maxLength: 200, description: 'Registered legal name.' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  public legalName!: string;

  @ApiProperty({
    maxLength: 32,
    description: 'Uruguayan RUT. Separators are accepted and ignored.',
    example: '21.317.103.001-4',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  public rut!: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  public description?: string;

  @ApiProperty({ example: '+59891234567', description: 'Contact phone in E.164 format.' })
  @Matches(E164_PHONE, { message: 'phoneE164 must be a valid E.164 phone number' })
  public phoneE164!: string;

  @ApiProperty({ format: 'email', maxLength: 255 })
  @IsEmail()
  @MaxLength(255)
  public email!: string;

  @ApiProperty({ maxLength: 255 })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  public addressLine!: string;

  @ApiProperty({ example: -30.905417, description: 'WGS84 latitude.' })
  @IsNumber()
  @Min(-90)
  @Max(90)
  public latitude!: number;

  @ApiProperty({ example: -55.550278, description: 'WGS84 longitude.' })
  @IsNumber()
  @Min(-180)
  @Max(180)
  public longitude!: number;
}

export class UpdateMerchantProfileDto {
  @ApiPropertyOptional({ maxLength: 160 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  public tradeName?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  public legalName?: string;

  @ApiPropertyOptional({ maxLength: 2000, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  public description?: string;

  @ApiPropertyOptional({ example: '+59891234567' })
  @IsOptional()
  @Matches(E164_PHONE, { message: 'phoneE164 must be a valid E.164 phone number' })
  public phoneE164?: string;

  @ApiPropertyOptional({ format: 'email', maxLength: 255 })
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  public email?: string;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  public addressLine?: string;

  @ApiPropertyOptional({ example: -30.905417 })
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  public latitude?: number;

  @ApiPropertyOptional({ example: -55.550278 })
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  public longitude?: number;
}

export class AdminMerchantListQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  public page: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  public limit: number = 20;

  @ApiPropertyOptional({ enum: MERCHANT_STATUSES, description: 'Filter by lifecycle status.' })
  @IsOptional()
  @IsIn(MERCHANT_STATUSES)
  public status?: MerchantStatus;
}

export class RejectMerchantDto {
  @ApiProperty({ maxLength: 500, description: 'Why the business was rejected.' })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  public reason!: string;
}
