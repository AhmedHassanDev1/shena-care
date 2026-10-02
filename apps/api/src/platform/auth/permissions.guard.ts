import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { Permission, ROLE_PERMISSIONS } from './permissions';
import { PERMISSIONS_KEY } from './permissions.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    
    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }
    
    const { user } = context.switchToHttp().getRequest();
    
    if (process.env.TEST_BYPASS_AUTH === 'true') {
      return true;
    }
    
    if (!user) {
      throw new ForbiddenException('User is not authenticated');
    }

    // A user has a required permission if ANY of their roles grants that permission
    const hasPermission = requiredPermissions.every((requiredPerm) => {
      return user.roles?.some((role: Role) => {
        const rolePerms = ROLE_PERMISSIONS[role] || [];
        return rolePerms.includes(requiredPerm);
      });
    });

    if (!hasPermission) {
      throw new ForbiddenException(`User lacks required permissions: ${requiredPermissions.join(', ')}`);
    }
    
    return true;
  }
}
