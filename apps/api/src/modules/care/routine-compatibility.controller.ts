import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsOptional, IsUUID, ValidateNested } from 'class-validator';
import { OptionalAuthGuard } from '../accounts/guards/optional-auth.guard';
import { CurrentUser } from '../accounts/decorators/current-user.decorator';
import { RoutineCompatibilityService } from './services/routine-compatibility.service';

const TRI = ['YES', 'NO', 'UNKNOWN'] as const;
type Tri = (typeof TRI)[number];

class CheckStepDto {
  @IsUUID() skuId: string;
  @IsIn(['AM', 'PM', 'AS_NEEDED']) timing: 'AM' | 'PM' | 'AS_NEEDED';
}

class CheckSafetyDto {
  @IsOptional() @IsIn(TRI) pregnant?: Tri;
  @IsOptional() @IsIn(TRI) breastfeeding?: Tri;
  @IsOptional() @IsIn(TRI) prescriptionTopical?: Tri;
  @IsOptional() @IsIn(TRI) oralRetinoid?: Tri;
}

class CheckRoutineDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => CheckStepDto) steps: CheckStepDto[];
  @IsOptional() @ValidateNested() @Type(() => CheckSafetyDto) safety?: CheckSafetyDto;
}

/**
 * The one compatibility check every routine surface calls (Make Your Routine, My Routine, an AI proposal after each edit).
 * Read-only and open to guests building a routine; a signed-in customer's saved safety answers apply automatically.
 */
@Controller('care/routines')
export class RoutineCompatibilityController {
  constructor(private readonly compatibility: RoutineCompatibilityService) {}

  @Post('check')
  @UseGuards(OptionalAuthGuard)
  async check(@CurrentUser() customer: { id: string } | undefined, @Body() dto: CheckRoutineDto) {
    const saved = await this.compatibility.savedSafety(customer?.id);
    return this.compatibility.check(dto.steps.map(step => ({ skuId: step.skuId, slot: step.timing })), { ...saved, ...(dto.safety ?? {}) });
  }

  /** The rules themselves, with their sources, so a surface can show why an issue exists. */
  @Get('compatibility-rules')
  rules() {
    return this.compatibility.rules();
  }
}
