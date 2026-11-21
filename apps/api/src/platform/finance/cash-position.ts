import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

const cents = (value: Prisma.Decimal | number | null | undefined) => Math.round(Number(value ?? 0) * 100);
const money = (valueInCents: number) => valueInCents / 100;

export interface CashPeriod { start: Date; end: Date }

/**
 * THE definition of the COD cash position, shared by every report (Finance profit, summary, Admin overview) so they can never disagree.
 *
 *   expectedOnRoad   = cash couriers must still collect: collections in status `expected` (the order is out for delivery)
 *   inCourierCustody = cash couriers declared at the door and still hold: status `collected`, valued at the DECLARED amount, not yet counted by the hub
 *   disputed         = collections in status `disputed`, at the expected amount
 *   settlements      = (period) what the hub physically counted, what couriers declared in those settlements, and the difference (counted − declared):
 *                      a shortage or surplus of the SETTLEMENT. It is never spread over single orders and never changes what a customer paid.
 *
 * Profit never reads any of this: whether a delivered order's cash is settled only decides whether its profit is payable now.
 */
export async function readCashPosition(prisma: PrismaService, period?: CashPeriod) {
  const [expected, custody, disputed, batches] = await Promise.all([
    prisma.paymentCollection.aggregate({ where: { status: 'expected' }, _sum: { expectedAmount: true }, _count: { id: true } }),
    prisma.paymentCollection.aggregate({ where: { status: 'collected' }, _sum: { declaredAmount: true }, _count: { id: true } }),
    prisma.paymentCollection.aggregate({ where: { status: 'disputed' }, _sum: { expectedAmount: true }, _count: { id: true } }),
    period ? prisma.courierSettlementBatch.findMany({ where: { settledAt: { gte: period.start, lt: period.end } }, select: { totalExpected: true, totalCollected: true, totalDeclared: true, variance: true, fees: true } }) : Promise.resolve([]),
  ]);
  const counted = batches.reduce((sum, batch) => sum + cents(batch.totalCollected), 0);
  // Settlements made before the declared total was recorded fall back to the expected total.
  const declared = batches.reduce((sum, batch) => sum + cents(batch.totalDeclared ?? batch.totalExpected), 0);
  const variance = batches.reduce((sum, batch) => sum + (batch.variance !== null ? cents(batch.variance) : cents(batch.totalCollected) - cents(batch.totalExpected)), 0);
  return {
    expectedOnRoad: { amount: money(cents(expected._sum.expectedAmount)), orders: expected._count.id },
    inCourierCustody: { amount: money(cents(custody._sum.declaredAmount)), orders: custody._count.id },
    disputed: { amount: money(cents(disputed._sum.expectedAmount)), orders: disputed._count.id },
    ...(period ? { settlements: { count: batches.length, counted: money(counted), declared: money(declared), variance: money(variance), fees: money(batches.reduce((sum, batch) => sum + cents(batch.fees), 0)) } } : {}),
  };
}
