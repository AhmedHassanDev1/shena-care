import { Controller, Get, Patch, Post, Param, Body, UseGuards, Query } from '@nestjs/common';
import { StaffManagementService } from '../services/staff-management.service';
import { CreateStaffDto, ResetStaffPasswordDto, SetStaffStatusDto, UpdateStaffProfileDto, UpdateStaffRolesDto } from '../dto/staff-management.dto';
import { AuthGuard } from '../guards/auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { Roles } from '../decorators/roles.decorator';
import { CurrentUser } from '../decorators/current-user.decorator';
import { Role } from '@prisma/client';

@Controller('operations/staff')
@UseGuards(AuthGuard, RolesGuard)
@Roles('ADMIN')
export class StaffManagementController {
  constructor(private readonly staffManagementService: StaffManagementService) {}

  @Get()
  listStaff(@Query('role') role?: Role, @Query('isActive') isActive?: string) {
    const activeFilter = isActive !== undefined ? isActive === 'true' : undefined;
    return this.staffManagementService.listStaff({ role, isActive: activeFilter });
  }

  @Post()
  createStaff(@Body() dto: CreateStaffDto, @CurrentUser() user: { id: string }) {
    return this.staffManagementService.createStaff(dto, user.id);
  }

  @Get(':id')
  getStaffById(@Param('id') id: string) {
    return this.staffManagementService.getStaffById(id);
  }

  @Patch(':id')
  updateProfile(@Param('id') id: string, @Body() dto: UpdateStaffProfileDto, @CurrentUser() user: { id: string }) {
    return this.staffManagementService.updateProfile(id, dto, user.id);
  }

  @Post(':id/reset-password')
  resetPassword(@Param('id') id: string, @Body() dto: ResetStaffPasswordDto, @CurrentUser() user: { id: string }) {
    return this.staffManagementService.resetPassword(id, dto.password, user.id);
  }

  @Patch(':id/status')
  setStaffStatus(
    @Param('id') id: string,
    @Body() dto: SetStaffStatusDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.staffManagementService.setStaffStatus(id, dto.isActive, user.id);
  }

  @Patch(':id/roles')
  updateStaffRoles(
    @Param('id') id: string,
    @Body() dto: UpdateStaffRolesDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.staffManagementService.updateStaffRoles(id, dto.roles, user.id);
  }

  @Post(':id/revoke-sessions')
  revokeSessions(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.staffManagementService.revokeSessions(id, user.id);
  }
}
