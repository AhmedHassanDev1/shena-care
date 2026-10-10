import { Controller, Post, Body, Get, Param, Patch, UseGuards, Headers, Req } from '@nestjs/common';
import { RoutineWorkspaceService, StartDraftDto, UpdateDraftDto } from './services/routine-workspace.service';
import { RoutineProposalService } from './services/routine-proposal.service';
import { AuthGuard } from '../accounts/guards/auth.guard';
import { OptionalAuthGuard } from '../accounts/guards/optional-auth.guard';

@Controller('care/workspace')
export class RoutineWorkspaceController {
  constructor(
    private readonly workspaceService: RoutineWorkspaceService,
    private readonly proposalService: RoutineProposalService,
  ) {}

  @Post('drafts')
  @UseGuards(OptionalAuthGuard)
  async startDraft(
    @Body() dto: StartDraftDto,
    @Headers('x-guest-token') guestToken?: string,
    @Req() req?: any,
  ) {
    const customerId = req.user?.id;
    return this.workspaceService.startDraft({ ...dto, customerId }, guestToken);
  }

  @Get('drafts/:id')
  @UseGuards(OptionalAuthGuard)
  async getDraft(
    @Param('id') id: string,
    @Headers('x-guest-token') guestToken?: string,
    @Req() req?: any,
  ) {
    const customerId = req.user?.id;
    return this.workspaceService.getDraft(id, customerId, guestToken);
  }

  @Patch('drafts/:id')
  @UseGuards(OptionalAuthGuard)
  async updateDraft(
    @Param('id') id: string,
    @Body() dto: UpdateDraftDto,
    @Headers('x-guest-token') guestToken?: string,
    @Req() req?: any,
  ) {
    const customerId = req.user?.id;
    return this.workspaceService.updateDraft(id, dto, customerId, guestToken);
  }

  @Post('drafts/:id/link')
  @UseGuards(AuthGuard)
  async linkDraft(
    @Param('id') id: string,
    @Headers('x-guest-token') guestToken: string,
    @Req() req: any,
  ) {
    return this.workspaceService.linkGuestDraft(id, guestToken, req.user.id);
  }

  @Post('drafts/:id/proposals')
  @UseGuards(OptionalAuthGuard)
  async generateProposal(
    @Param('id') id: string,
    @Headers('x-guest-token') guestToken?: string,
    @Req() req?: any,
  ) {
    const customerId = req.user?.id;
    return this.proposalService.generateProposal(id, customerId, guestToken);
  }

  @Post('drafts/:id/proposals/modify')
  @UseGuards(OptionalAuthGuard)
  async modifyProposal(
    @Param('id') id: string,
    @Body() body: { action: string; payload: any },
    @Headers('x-guest-token') guestToken?: string,
    @Req() req?: any,
  ) {
    const customerId = req.user?.id;
    return this.workspaceService.modifyProposal(id, body.action, body.payload, customerId, guestToken);
  }

  @Post('proposals/:id/accept')
  @UseGuards(OptionalAuthGuard)
  async acceptProposal(
    @Param('id') proposalId: string,
    @Headers('x-guest-token') guestToken?: string,
    @Req() req?: any,
  ) {
    const customerId = req.user?.id;
    return this.proposalService.acceptProposal(proposalId, customerId, guestToken);
  }
}
