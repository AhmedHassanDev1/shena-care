import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard';
import { PERMISSIONS_KEY } from './permissions.decorator';
import { Permission } from './permissions';
import { isAuthBypassEnabled } from './auth-bypass';
import { RolesGuard } from '../../modules/accounts/guards/roles.guard';

describe('PermissionsGuard', () => {
  let guard: PermissionsGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new PermissionsGuard(reflector);
    delete process.env.TEST_BYPASS_AUTH;
  });

  const createMockContext = (user: any, requiredPermissions: Permission[] = []) => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(requiredPermissions);
    
    return {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    } as unknown as ExecutionContext;
  };

  it('should allow access if no permissions are required', () => {
    const context = createMockContext({ roles: ['CUSTOMER'] });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('should deny access if user is not authenticated', () => {
    const context = createMockContext(null, ['order.manage']);
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('should allow CUSTOMER if they have no required permissions but none are needed', () => {
    const context = createMockContext({ roles: ['CUSTOMER'] });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('should deny CUSTOMER from accessing admin routes', () => {
    const context = createMockContext({ roles: ['CUSTOMER'] }, ['catalog.manage']);
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('should allow ADMIN to access any required permission', () => {
    const context = createMockContext({ roles: ['ADMIN'] }, ['hub.receive', 'supplier.manage']);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('should allow HUB_OPERATOR to access fulfillment permissions', () => {
    const context = createMockContext({ roles: ['HUB_OPERATOR'] }, ['hub.pack']);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('should deny HUB_OPERATOR from catalog manage', () => {
    const context = createMockContext({ roles: ['HUB_OPERATOR'] }, ['catalog.manage']);
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('should allow SUPPLIER to manage supplier offers', () => {
    const context = createMockContext({ roles: ['SUPPLIER'] }, ['supplier_offer.manage']);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('should deny SUPPLIER from managing other things', () => {
    const context = createMockContext({ roles: ['SUPPLIER'] }, ['hub.pack']);
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  describe('test-only auth bypass', () => {
    const nodeEnv = process.env.NODE_ENV;
    afterEach(() => { process.env.NODE_ENV = nodeEnv; delete process.env.TEST_BYPASS_AUTH; });

    it.each(['production', 'development', 'staging', undefined])('is ignored when NODE_ENV=%s', (env) => {
      if (env === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = env;
      process.env.TEST_BYPASS_AUTH = 'true';
      expect(isAuthBypassEnabled()).toBe(false);
      expect(() => guard.canActivate(createMockContext({ roles: ['CUSTOMER'] }, ['catalog.manage']))).toThrow(ForbiddenException);
      expect(() => new RolesGuard(rolesReflector(['ADMIN'])).canActivate(createMockContext({ roles: ['CUSTOMER'] })))
        .toThrow(ForbiddenException);
    });

    it('is honoured only inside the test environment', () => {
      process.env.NODE_ENV = 'test';
      process.env.TEST_BYPASS_AUTH = 'true';
      expect(isAuthBypassEnabled()).toBe(true);
      expect(guard.canActivate(createMockContext({ roles: ['CUSTOMER'] }, ['catalog.manage']))).toBe(true);
    });
  });
});

function rolesReflector(roles: string[]) {
  const reflector = new Reflector();
  jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(roles);
  return reflector;
}
