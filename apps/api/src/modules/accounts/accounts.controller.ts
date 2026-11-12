import { Controller, Post, Body, Get, Patch, UseGuards, Req, Delete } from '@nestjs/common';
import { AccountsService } from './accounts.service';
import { RegisterDto, LoginDto, SendOtpDto, VerifyOtpDto, UpdateProfileDto, ChangePasswordDto } from './dto/accounts.dto';
import { AuthGuard } from './guards/auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';

@Controller('accounts')
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.accountsService.register(dto);
  }

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.accountsService.login(dto);
  }

  @Post('otp/send')
  sendOtp(@Body() dto: SendOtpDto) {
    return this.accountsService.sendOtp(dto.phoneNumber, dto.pendingIntent);
  }

  @Post('otp/verify')
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.accountsService.verifyOtp(dto.phoneNumber, dto.code, dto.guestId, dto.name);
  }

  @Post('logout')
  @UseGuards(AuthGuard)
  logout(@Req() request: any) {
    return this.accountsService.logout(request.sessionToken);
  }

  @Post('me/password')
  @UseGuards(AuthGuard)
  changePassword(@CurrentUser() user: { id: string }, @Req() request: any, @Body() dto: ChangePasswordDto) {
    return this.accountsService.changePassword(user.id, request.sessionToken, dto.currentPassword, dto.newPassword);
  }

  @Post('me/sessions/revoke-others')
  @UseGuards(AuthGuard)
  revokeOtherSessions(@CurrentUser() user: { id: string }, @Req() request: any) {
    return this.accountsService.revokeOtherSessions(user.id, request.sessionToken);
  }

  @Get('me')
  @UseGuards(AuthGuard)
  getMe(@CurrentUser() user: any) {
    return this.accountsService.getMe(user.id);
  }

  @Patch('me')
  @UseGuards(AuthGuard)
  updateMe(@CurrentUser() user: { id: string }, @Body() dto: UpdateProfileDto) {
    return this.accountsService.updateMe(user.id, dto);
  }

  @Get('me/export')
  @UseGuards(AuthGuard)
  exportData(@CurrentUser() user: any) {
    return this.accountsService.exportCustomerData(user.id);
  }

  @Delete('me')
  @UseGuards(AuthGuard)
  deleteAccount(@CurrentUser() user: any) {
    return this.accountsService.deleteCustomerAccount(user.id);
  }
}
