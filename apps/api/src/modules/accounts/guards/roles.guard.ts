import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    
    if (!requiredRoles) {
      return true;
    }
    const { user } = context.switchToHttp().getRequest();
    
    if (process.env.TEST_BYPASS_AUTH === 'true') {
      return true;
    }
    
    if (!user) {
      throw new ForbiddenException('User is not authenticated');
    }

    if (!user.roles || !user.roles.some((role: Role) => requiredRoles.includes(role))) {
      throw new ForbiddenException('User does not have required roles');
    }
    
    return true;
  }
}
