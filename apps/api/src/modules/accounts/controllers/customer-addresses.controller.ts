import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { AuthGuard } from '../guards/auth.guard';
import { CurrentUser } from '../decorators/current-user.decorator';
import { CustomerAddressesService } from '../services/customer-addresses.service';
import { CreateCustomerAddressDto, UpdateCustomerAddressDto } from '../dto/address.dto';

@Controller('accounts/addresses')
@UseGuards(AuthGuard)
export class CustomerAddressesController {
  constructor(private readonly addressesService: CustomerAddressesService) {}

  @Get()
  list(@CurrentUser() user: any) {
    return this.addressesService.listAddresses(user.id);
  }

  @Get(':id')
  get(@CurrentUser() user: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.addressesService.getAddress(user.id, id);
  }

  @Post()
  create(@CurrentUser() user: any, @Body() dto: CreateCustomerAddressDto) {
    return this.addressesService.createAddress(user.id, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomerAddressDto,
  ) {
    return this.addressesService.updateAddress(user.id, id, dto);
  }

  @Delete(':id')
  delete(@CurrentUser() user: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.addressesService.deleteAddress(user.id, id);
  }

  @Post(':id/default')
  setDefault(@CurrentUser() user: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.addressesService.setDefaultAddress(user.id, id);
  }
}
