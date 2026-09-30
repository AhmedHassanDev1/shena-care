import { Controller, Post, Body, Get, Param, Patch, UseGuards, ForbiddenException } from '@nestjs/common';
import { CareService } from './services/care.service';
import { CareProfileService } from './services/care-profile.service';
import { CreateConcernDto, CreateRoutineDto, CreateRoutineStepDto, CreateCustomerCareProfileDto, UpdateCustomerCareProfileDto } from './dto/care.dto';
import { CustomerAuthGuard, CurrentCustomer } from '../../platform/auth';

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
  @UseGuards(CustomerAuthGuard)
  async createProfile(@CurrentCustomer() customerId: string, @Body() dto: CreateCustomerCareProfileDto) {
    if (dto.customerId && dto.customerId !== customerId) {
      throw new ForbiddenException('Cannot create profile for another customer');
    }
    return this.profileService.createProfile({ ...dto, customerId });
  }

  @Get('profiles')
  @UseGuards(CustomerAuthGuard)
  async getProfile(@CurrentCustomer() customerId: string) {
    return this.profileService.getProfile(customerId);
  }

  @Patch('profiles')
  @UseGuards(CustomerAuthGuard)
  async updateProfile(@CurrentCustomer() customerId: string, @Body() dto: UpdateCustomerCareProfileDto) {
    return this.profileService.updateProfile(customerId, dto);
  }
}
