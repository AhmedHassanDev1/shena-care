import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../accounts/guards/auth.guard';
import { OptionalAuthGuard } from '../accounts/guards/optional-auth.guard';
import { ProposalActionDto, SaveProposalDto, StartRoutineDraftDto, UpdateRoutineDraftDto } from './dto/routine-workspace.dto';
import { RoutineProposalService } from './services/routine-proposal.service';
import { DraftOwner, RoutineWorkspaceService } from './services/routine-workspace.service';

type AuthedRequest = { user?: { id: string }; headers: Record<string, string | string[] | undefined> };

/** The routine builder (ROUTINE_SYSTEM.md §5.2–§5.4). Guests work with x-guest-token; saving needs sign-in. */
@Controller('care/workspace')
export class RoutineWorkspaceController {
  constructor(
    private readonly workspaceService: RoutineWorkspaceService,
    private readonly proposalService: RoutineProposalService,
  ) {}

  @Post('drafts')
  @UseGuards(OptionalAuthGuard)
  startDraft(@Body() dto: StartRoutineDraftDto, @Headers('x-guest-token') guestToken?: string, @Req() req?: AuthedRequest) {
    return this.workspaceService.startDraft(dto, owner(req, guestToken));
  }

  @Get('drafts/:id')
  @UseGuards(OptionalAuthGuard)
  getDraft(@Param('id', ParseUUIDPipe) id: string, @Headers('x-guest-token') guestToken?: string, @Req() req?: AuthedRequest) {
    return this.workspaceService.getDraft(id, owner(req, guestToken));
  }

  @Patch('drafts/:id')
  @UseGuards(OptionalAuthGuard)
  updateDraft(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRoutineDraftDto, @Headers('x-guest-token') guestToken?: string, @Req() req?: AuthedRequest) {
    return this.workspaceService.updateDraft(id, dto, owner(req, guestToken));
  }

  @Post('drafts/:id/link')
  @UseGuards(AuthGuard)
  linkDraft(@Param('id', ParseUUIDPipe) id: string, @Headers('x-guest-token') guestToken: string, @Req() req: AuthedRequest & { user: { id: string } }) {
    return this.workspaceService.linkGuestDraft(id, guestToken, req.user.id);
  }

  @Post('drafts/:id/proposals')
  @UseGuards(OptionalAuthGuard)
  generateProposal(@Param('id', ParseUUIDPipe) id: string, @Headers('x-guest-token') guestToken?: string, @Req() req?: AuthedRequest) {
    return this.proposalService.generateProposal(id, owner(req, guestToken));
  }

  /** One edit (swap, owned, remove optional, tier, budget, accept upgrade); the server recomputes the proposal. */
  @Post('drafts/:id/actions')
  @UseGuards(OptionalAuthGuard)
  applyAction(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ProposalActionDto, @Headers('x-guest-token') guestToken?: string, @Req() req?: AuthedRequest) {
    return this.proposalService.applyAction(id, dto, owner(req, guestToken));
  }

  @Post('proposals/:id/save')
  @UseGuards(AuthGuard)
  saveProposal(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveProposalDto, @Req() req: AuthedRequest & { user: { id: string } }) {
    return this.proposalService.saveProposal(id, req.user.id, dto);
  }
}

function owner(req: AuthedRequest | undefined, guestToken?: string): DraftOwner {
  return { customerId: req?.user?.id, guestToken: guestToken || undefined };
}
