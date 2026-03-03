import { IsString, IsNumber, IsBoolean, IsOptional, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateProductBonusRuleDto {
    @IsNumber()
    minSellPrice: number;

    @IsNumber()
    bonusAmount: number;

    @IsNumber()
    @IsOptional()
    salePercent?: number;

    @IsNumber()
    @IsOptional()
    managerPercent?: number;
}

export class CreateProductDto {
    @IsString()
    name: string;

    @IsNumber()
    minPrice: number;

    @IsBoolean()
    @IsOptional()
    isHighEnd?: boolean;

    @IsNumber()
    @IsOptional()
    hotBonus?: number;

    @IsArray()
    @IsOptional()
    @ValidateNested({ each: true })
    @Type(() => CreateProductBonusRuleDto)
    bonusRules?: CreateProductBonusRuleDto[];
}
