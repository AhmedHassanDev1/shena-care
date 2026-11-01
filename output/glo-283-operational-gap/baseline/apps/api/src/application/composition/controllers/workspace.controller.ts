import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../../modules/accounts/guards/auth.guard';
import { RolesGuard } from '../../../modules/accounts/guards/roles.guard';
import { Roles } from '../../../modules/accounts/decorators/roles.decorator';
import { CurrentUser } from '../../../modules/accounts/decorators/current-user.decorator';
import { PermissionsGuard, RequirePermissions } from '../../../platform/auth';
import { AccountsService } from '../../../modules/accounts/public';
import { FulfillmentActor, FulfillmentService } from '../../../modules/fulfillment/public';

/**
 * Business Workspace session context (C0): who is signed in, which roles, and the supplier / hub
 * scope the API will enforce anyway. The UI uses it for navigation only — guards stay the boundary.
 */
@Controller('workspace')
@UseGuards(AuthGuard, RolesGuard, PermissionsGuard)
export class WorkspaceController {
  constructor(private readonly accounts: AccountsService, private readonly fulfillment: FulfillmentService) {}

  @Get('me')
  async me(@CurrentUser() user: FulfillmentActor) {
    const identity = await this.accounts.getWorkspaceIdentity(user.id);
    const hubLocations = identity.roles.some(role => role === 'ADMIN' || role === 'HUB_OPERATOR')
      ? await this.fulfillment.listOperatorLocations({ id: user.id, roles: identity.roles })
      : [];
    return { ...identity, hubLocations };
  }

  /** Driver picker for run assignment: id and name only. */
  @Get('drivers')
  @Roles('ADMIN', 'HUB_OPERATOR')
  @RequirePermissions('delivery.plan')
  async drivers() {
    return this.accounts.listAccountsWithRole('DRIVER');
  }
}
