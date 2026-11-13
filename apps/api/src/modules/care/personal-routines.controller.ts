import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../accounts/guards/auth.guard';
import { CurrentUser } from '../accounts/decorators/current-user.decorator';
import { PersonalRoutineDto, SaveAiRoutineDto } from './dto/routine-content.dto';
import { PersonalRoutinesService, ReadyRoutinesService } from './services/personal-routines.service';

type Customer = { id: string };

/** Published Ready Routines for the storefront (public read). */
@Controller('care/ready-routines')
export class ReadyRoutinesController {
  constructor(private readonly ready: ReadyRoutinesService) {}

  @Get()
  list(@Query('concern') concern?: string) { return this.ready.list(concern && /^[a-z0-9][a-z0-9-]{0,59}$/.test(concern) ? concern : undefined); }

  @Get(':id')
  get(@Param('id') id: string) { return this.ready.get(id); }
}

/** «My Routine»: the signed-in customer's own routines. Every operation is scoped to the caller. */
@Controller('care/personal-routines')
@UseGuards(AuthGuard)
export class PersonalRoutinesController {
  constructor(private readonly personal: PersonalRoutinesService) {}

  @Get()
  list(@CurrentUser() customer: Customer) { return this.personal.list(customer.id); }

  @Post()
  create(@CurrentUser() customer: Customer, @Body() dto: PersonalRoutineDto) { return this.personal.create(customer.id, dto); }

  /** A personal copy of a published Ready Routine; the template is unchanged. */
  @Post('from-template/:templateId')
  fromTemplate(@CurrentUser() customer: Customer, @Param('templateId') templateId: string) { return this.personal.copyFromTemplate(customer.id, templateId); }

  /** Saves an assistant proposal the customer reviewed and explicitly confirmed. */
  @Post('from-proposal')
  fromProposal(@CurrentUser() customer: Customer, @Body() dto: SaveAiRoutineDto) { return this.personal.saveFromAiProposal(customer.id, dto); }

  @Get(':id')
  get(@CurrentUser() customer: Customer, @Param('id') id: string) { return this.personal.get(customer.id, id); }

  @Put(':id')
  replace(@CurrentUser() customer: Customer, @Param('id') id: string, @Body() dto: PersonalRoutineDto) { return this.personal.replace(customer.id, id, dto); }

  @Delete(':id')
  remove(@CurrentUser() customer: Customer, @Param('id') id: string) { return this.personal.remove(customer.id, id); }
}
