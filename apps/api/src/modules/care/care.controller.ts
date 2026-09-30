import { Controller, Post, Body, Get, Param, Patch } from '@nestjs/common';
import { CareService } from './services/care.service';
import { CareProfileService } from './services/care-profile.service';
import { CreateConcernDto, CreateRoutineDto, CreateRoutineStepDto, CreateCustomerCareProfileDto, UpdateCustomerCareProfileDto } from './dto/care.dto';

@Controller('care')
export class CareController {
  constructor(
    private readonly careService: CareService,
    private readonly profileService: CareProfileService,
  ) {}

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

  // Profile Endpoints
  @Post('profiles')
  async createProfile(@Body() dto: CreateCustomerCareProfileDto) {
    return this.profileService.createProfile(dto);
  }

  @Get('profiles/:customerId')
  async getProfile(@Param('customerId') customerId: string) {
    return this.profileService.getProfile(customerId);
  }

  @Patch('profiles/:customerId')
  async updateProfile(@Param('customerId') customerId: string, @Body() dto: UpdateCustomerCareProfileDto) {
    return this.profileService.updateProfile(customerId, dto);
  }
}
