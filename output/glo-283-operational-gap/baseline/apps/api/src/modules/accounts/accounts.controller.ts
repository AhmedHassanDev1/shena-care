import { Controller, Post, Body, Get, UseGuards, Req, Delete } from '@nestjs/common';
import { AccountsService } from './accounts.service';
import { RegisterDto, LoginDto, SendOtpDto, VerifyOtpDto } from './dto/accounts.dto';
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
    return this.accountsService.verifyOtp(dto.phoneNumber, dto.code, dto.guestId);
  }

  @Post('logout')
  @UseGuards(AuthGuard)
  logout(@Req() request: any) {
    return this.accountsService.logout(request.sessionToken);
  }

  @Get('me')
  @UseGuards(AuthGuard)
  getMe(@CurrentUser() user: any) {
    return this.accountsService.getMe(user.id);
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
