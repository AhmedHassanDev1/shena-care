import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../accounts/guards/auth.guard';
import { CurrentUser } from '../accounts/decorators/current-user.decorator';
import { ActivateRoutineDto, RoutineStatusDto, SwapRoutineItemDto } from './dto/routine-workspace.dto';
import { MyRoutinesService } from './services/my-routines.service';

type Customer = { id: string };

/** «روتيناتي» (ROUTINE_SYSTEM.md §5.6): the signed-in customer's saved routines. */
@Controller('care/me/routines')
@UseGuards(AuthGuard)
export class MyRoutinesController {
  constructor(private readonly routines: MyRoutinesService) {}

  @Get()
  list(@CurrentUser() customer: Customer) {
    return this.routines.listRoutines(customer.id);
  }

  @Get(':id')
  get(@CurrentUser() customer: Customer, @Param('id', ParseUUIDPipe) id: string) {
    return this.routines.getRoutine(id, customer.id);
  }

  @Post(':id/activate')
  activate(@CurrentUser() customer: Customer, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ActivateRoutineDto) {
    return this.routines.activate(id, customer.id, dto.shareRoleKeys ?? []);
  }

  @Post(':id/start')
  start(@CurrentUser() customer: Customer, @Param('id', ParseUUIDPipe) id: string) {
    return this.routines.start(id, customer.id);
  }

  @Patch(':id/status')
  status(@CurrentUser() customer: Customer, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RoutineStatusDto) {
    return this.routines.changeStatus(id, customer.id, dto.action, dto.reason);
  }

  @Post(':id/items/:roleKey/swap')
  swap(@CurrentUser() customer: Customer, @Param('id', ParseUUIDPipe) id: string, @Param('roleKey') roleKey: string, @Body() dto: SwapRoutineItemDto) {
    return this.routines.swapItem(id, customer.id, roleKey, dto.productId, dto.version);
  }
}
