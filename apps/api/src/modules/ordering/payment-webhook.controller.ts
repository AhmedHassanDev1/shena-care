import { Body, Controller, Headers, HttpCode, Param, Post } from '@nestjs/common';
import { PaymentsService } from './services/payments.service';

/**
 * Provider callbacks (GLO-241). Unauthenticated by design: authenticity is the provider signature,
 * verified by the registered adapter before anything is applied. Unknown provider → 404.
 */
@Controller('payments/webhooks')
export class PaymentWebhookController {
  constructor(private readonly payments: PaymentsService) {}

  @Post(':provider')
  @HttpCode(200)
  receive(@Param('provider') provider: string, @Body() body: unknown, @Headers('x-provider-signature') signature?: string) {
    // The JSON body is re-serialized deterministically; real adapters may require the raw bytes (raw-body middleware) when integrated.
    return this.payments.handleProviderEvent(provider, JSON.stringify(body), signature);
  }
}
