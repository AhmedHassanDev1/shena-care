import { Controller, Post, Body, Get, UseGuards, Req } from '@nestjs/common';
import { AccountsService } from './accounts.service';
import { RegisterDto, LoginDto } from './dto/accounts.dto';
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
}
