import { Controller, Post, Body, Get, Param, Patch, UseGuards, ForbiddenException } from '@nestjs/common';
import { CareService } from './services/care.service';
import { CareProfileService } from './services/care-profile.service';
import { CreateConcernDto, CreateRoutineDto, CreateRoutineStepDto, CreateCustomerCareProfileDto, UpdateCustomerCareProfileDto } from './dto/care.dto';
import { AuthGuard } from '../accounts/guards/auth.guard';
import { RolesGuard } from '../accounts/guards/roles.guard';
import { Roles } from '../accounts/decorators/roles.decorator';
import { CurrentUser } from '../accounts/decorators/current-user.decorator';

@Controller('care')
@UseGuards(AuthGuard, RolesGuard)
export class CareController {
  constructor(
    private readonly careService: CareService,
    private readonly profileService: CareProfileService,
  ) {}

  @Post('concerns')
  @Roles('ADMIN')
  async createConcern(@Body() dto: CreateConcernDto) {
    return this.careService.createConcern(dto);
  }

  @Get('concerns')
  async getConcerns() {
    return this.careService.getConcerns();
  }

  @Post('routines')
  @Roles('ADMIN')
  async createRoutine(@Body() dto: CreateRoutineDto) {
    return this.careService.createRoutine(dto);
  }

  @Get('routines/:id')
  async getRoutine(@Param('id') id: string) {
    return this.careService.getRoutine(id);
  }

  @Post('routines/:id/steps')
  @Roles('ADMIN')
  async addRoutineStep(@Param('id') id: string, @Body() dto: CreateRoutineStepDto) {
    return this.careService.addRoutineStep(id, dto);
  }

  // Profile Endpoints
  @Post('profiles')
  async createProfile(@CurrentUser() customer: any, @Body() dto: CreateCustomerCareProfileDto) {
    if (dto.customerId && dto.customerId !== customer.id) {
      throw new ForbiddenException('Cannot create profile for another customer');
    }
    return this.profileService.createProfile({ ...dto, customerId: customer.id });
  }

  @Get('profiles')
  async getProfile(@CurrentUser() customer: any) {
    return this.profileService.getProfile(customer.id);
  }

  @Patch('profiles')
  async updateProfile(@CurrentUser() customer: any, @Body() dto: UpdateCustomerCareProfileDto) {
    return this.profileService.updateProfile(customer.id, dto);
  }
}
