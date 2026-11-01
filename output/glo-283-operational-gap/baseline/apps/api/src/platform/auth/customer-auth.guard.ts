import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';

@Injectable()
export class CustomerAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const customerId = request.headers['x-customer-id'];
    
    if (!customerId) {
      throw new UnauthorizedException('Missing x-customer-id header');
    }
    
    request.user = { id: customerId };
    return true;
  }
}
