import { Injectable, Logger, NotFoundException, UnauthorizedException, UnprocessableEntityException } from '@nestjs/common';
import { PaymentMethod, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../platform/database/prisma.service';
import { DomainEventsService } from '../../../platform/events/domain-events.service';
import { OutboxService } from '../../operations/services/outbox.service';

type Tx = Prisma.TransactionClient;

/** What a provider callback means once its signature is verified. Provider-neutral. */
export interface VerifiedProviderEvent {
  eventId: string;
  type: 'payment.confirmed' | 'payment.failed';
  reference: string;
  amount: string;
  currency: string;
  providerTransactionId?: string;
  failureReason?: string;
}

/**
 * A real payment provider connector (card PSP, Vodafone Cash…). None is registered in this codebase:
 * card and wallet checkout stay unavailable until an Egypt-supported provider, merchant account,
 * credentials and signed-callback verification exist (GLO-241). Tests register doubles only.
 */
export interface PaymentProviderAdapter {
  name: string;
  methods: PaymentMethod[];
  /** Throws if the signature is not the provider's; never trust an unsigned body. */
  verify(rawBody: string, signature: string | undefined): VerifiedProviderEvent;
}

const ONLINE: PaymentMethod[] = [PaymentMethod.CARD, PaymentMethod.MOBILE_WALLET];

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly providers = new Map<string, PaymentProviderAdapter>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEventsService,
    private readonly outbox: OutboxService,
  ) {}

  registerProvider(adapter: PaymentProviderAdapter) {
    this.providers.set(adapter.name, adapter);
  }

  /** Online methods need a registered provider; COD never does. Fails closed (422). */
  resolveProvider(method: PaymentMethod, requested?: string): string | null {
    if (method === PaymentMethod.COD) return null;
    const candidates = [...this.providers.values()].filter(p => p.methods.includes(method) && (!requested || p.name === requested));
    if (!candidates.length) {
      throw new UnprocessableEntityException({ code: 'PAYMENT_METHOD_UNAVAILABLE',
        message: 'This payment method is not available yet. Choose cash on delivery.' });
    }
    return candidates[0].name;
  }

  static isOnline(method: PaymentMethod) {
    return ONLINE.includes(method);
  }

  /** Inside the checkout transaction: the pending attempt the provider will confirm. */
  async createAttempt(tx: Tx, input: { orderId: string; method: PaymentMethod; provider: string; amount: Prisma.Decimal | number; currency: string }) {
    return tx.paymentAttempt.create({ data: {
      orderId: input.orderId, method: input.method, provider: input.provider, amount: input.amount, currency: input.currency,
      reference: 'PAY-' + randomUUID().replace(/-/g, '').slice(0, 24).toUpperCase(),
    } });
  }

  async confirmedAmount(tx: Tx | PrismaService, orderId: string): Promise<Prisma.Decimal | null> {
    const confirmed = await tx.paymentAttempt.findFirst({ where: { orderId, status: 'confirmed' } });
    return confirmed?.amount ?? null;
  }

  async isPaymentSatisfied(orderId: string): Promise<boolean> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, select: { paymentMethod: true } });
    if (!order) return false;
    return order.paymentMethod === PaymentMethod.COD || (await this.confirmedAmount(this.prisma, orderId)) !== null;
  }

  /**
   * Provider callback (GLO-241): verified signature first, then applied exactly once per provider
   * event id. Only `payment.confirmed` with the attempt's exact amount and currency confirms it, and
   * only then does the order enter sourcing (durable order.placed). Out-of-order or contradictory
   * events are recorded and ignored, never applied.
   */
  async handleProviderEvent(providerName: string, rawBody: string, signature: string | undefined) {
    const adapter = this.providers.get(providerName);
    if (!adapter) throw new NotFoundException('Unknown payment provider');
    let event: VerifiedProviderEvent;
    try {
      event = adapter.verify(rawBody, signature);
    } catch {
      throw new UnauthorizedException('Invalid provider signature');
    }
    let payload: Prisma.InputJsonValue;
    try { payload = JSON.parse(rawBody); } catch { payload = { raw: rawBody }; }

    const result = await this.prisma.$transaction(async tx => {
      const record = (outcome: string, detail?: string) => tx.paymentProviderEvent.create({ data: {
        provider: providerName, providerEventId: event.eventId, type: event.type, reference: event.reference, outcome, detail, payload,
      } });
      const seen = await tx.paymentProviderEvent.findUnique({ where: { provider_providerEventId: { provider: providerName, providerEventId: event.eventId } } });
      if (seen) return { outcome: 'duplicate' as const, orderId: null };

      const attempt = await tx.paymentAttempt.findUnique({ where: { reference: event.reference } });
      if (!attempt || attempt.provider !== providerName) {
        await record('rejected', 'unknown reference');
        return { outcome: 'rejected' as const, orderId: null };
      }
      await tx.$queryRaw`SELECT id FROM "ordering"."payment_attempts" WHERE id = ${attempt.id}::uuid FOR UPDATE`;
      const current = await tx.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
      if (current.status !== 'pending') {
        await record('ignored', `attempt already ${current.status}`);
        return { outcome: 'ignored' as const, orderId: current.orderId };
      }
      if (event.type === 'payment.failed') {
        await tx.paymentAttempt.update({ where: { id: current.id }, data: { status: 'failed', failureReason: event.failureReason ?? 'provider reported failure' } });
        await record('applied');
        return { outcome: 'applied' as const, orderId: current.orderId };
      }
      if (!current.amount.equals(new Prisma.Decimal(event.amount)) || current.currency !== event.currency) {
        await record('rejected', `amount/currency mismatch: expected ${current.amount.toFixed(2)} ${current.currency}`);
        return { outcome: 'rejected' as const, orderId: current.orderId };
      }
      await tx.paymentAttempt.update({ where: { id: current.id }, data: {
        status: 'confirmed', confirmedAt: new Date(), providerTransactionId: event.providerTransactionId ?? null,
      } });
      const order = await tx.order.findUniqueOrThrow({ where: { id: current.orderId } });
      // The paid order now enters sourcing, exactly like a COD order at checkout.
      await this.events.record(tx, {
        eventType: 'order.placed', aggregateType: 'Order', aggregateId: order.id,
        payload: { orderId: order.id, orderNumber: order.orderNumber, paymentReference: current.reference },
      });
      await this.outbox.enqueue(tx, {
        eventType: 'payment.confirmed', aggregateId: order.id, aggregateType: 'Order', customerId: order.customerId || undefined,
        payload: { orderId: order.id, orderNumber: order.orderNumber }, channelIntent: 'whatsapp', templateId: 'payment_confirmed_v1',
        deduplicationKey: `payment.confirmed:${current.id}`,
      });
      await record('applied');
      return { outcome: 'applied' as const, orderId: order.id };
    }).catch(async error => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return { outcome: 'duplicate' as const, orderId: null };
      throw error;
    });
    if (result.orderId && result.outcome === 'applied') this.events.dispatchSoon(result.orderId);
    this.logger.log(`[AUDIT] payment event ${providerName}/${event.eventId}: ${result.outcome}`);
    return { received: true, outcome: result.outcome };
  }
}
