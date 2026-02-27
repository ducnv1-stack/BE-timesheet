import { IsBoolean } from 'class-validator';

export class ToggleAccountDto {
    @IsBoolean()
    isActive: boolean;
}
