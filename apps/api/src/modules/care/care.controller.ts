import { Controller, Post, Body, Get, Param } from '@nestjs/common';
import { CareService } from './services/care.service';
import { CreateConcernDto, CreateRoutineDto, CreateRoutineStepDto } from './dto/care.dto';

@Controller('care')
export class CareController {
  constructor(private readonly careService: CareService) {}

  @Post('concerns')
  async createConcern(@Body() dto: CreateConcernDto) {
    return this.careService.createConcern(dto);
  }

  @Get('concerns')
  async getConcerns() {
    return this.careService.getConcerns();
  }

  @Post('routines')
  async createRoutine(@Body() dto: CreateRoutineDto) {
    return this.careService.createRoutine(dto);
  }

  @Get('routines/:id')
  async getRoutine(@Param('id') id: string) {
    return this.careService.getRoutine(id);
  }

  @Post('routines/:id/steps')
  async addRoutineStep(@Param('id') id: string, @Body() dto: CreateRoutineStepDto) {
    return this.careService.addRoutineStep(id, dto);
  }
}
