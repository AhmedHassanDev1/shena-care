/**
 * ShinaCare Complete Order Lifecycle E2E Test Dataset Fixture
 *
 * Populates deterministic development test orders across all 11 supported lifecycle stages:
 *  1. Newly Placed (placed) - pending procurement on buy list
 *  2. Pending Procurement (placed) - multiple units to buy
 *  3. Partial Procurement / Incomplete Receiving (placed) - 1 unit received, 1 awaiting receiving
 *  4. Received Inventory Awaiting Preparation (confirmed) - ready_to_prepare
 *  5. In Preparation / Awaiting Barcode Verification (confirmed) - preparing session in progress
 *  6. Fully Verified Awaiting Packaging/Printing (packing) - prepared
 *  7. Packaged Awaiting Courier Handoff (packing) - packed (eligible for run)
 *  8. Courier Assigned (packing) - packed on planning batch
 *  9. In Delivery (shipped) - out_for_delivery on dispatched batch
 * 10. Successfully Delivered COD (delivered) - delivered with collected cash
 * 11A. Failed Delivery Attempt (shipped) - failed attempt awaiting hub return
 * 11B. Returned Order (returned) - returned to sender
 *
 * Safety: Runs only against development database (refuses production).
 */

import {
  PrismaClient,
  OrderStatus,
  ShipmentStatus,
  ReceivedGoodsCondition,
  PreparationSessionStatus,
  PaymentMethod,
  SettlementStatus,
  Role,
  SourceConfirmationResult,
} from '@prisma/client';
import * as crypto from 'crypto';

const prisma = new PrismaClient();

// Guard against production
if (process.env.NODE_ENV === 'production') {
  console.error('REFUSING to seed test dataset in production environment!');
  process.exit(1);
}

const DEV_ONLY_LABEL_SECRET = 'shena-care-dev-only-shipment-label-secret';
function signBarcode(shipmentId: string): string {
  const secret = process.env.SHIPMENT_LABEL_SECRET || process.env.SECRET_KEY || DEV_ONLY_LABEL_SECRET;
  const signature = crypto.createHmac('sha256', secret).update(shipmentId).digest('hex').substring(0, 16);
  return `SHP-${shipmentId.substring(0, 8).toUpperCase()}-${signature.toUpperCase()}`;
}

export const E2E_CUSTOMER_PHONE = '+201099990001';
export const E2E_ORDER_PREFIX = 'ORD-E2E-';

async function main() {
  const isReset = process.argv.includes('--clean') || process.argv.includes('--reset');

  console.log('=== ShinaCare Order Lifecycle E2E Seeder ===');

  // Check Hub & Driver
  const hub = await prisma.fulfillmentLocation.findFirst({
    where: { name: 'Maadi Pharmacy Hub' },
  });
  if (!hub) {
    throw new Error('Maadi Pharmacy Hub not found in database. Seed staff/hubs first.');
  }
  const hubId = hub.id;

  const driver = await prisma.customer.findFirst({
    where: { email: 'driver@shenacare.com', roles: { has: 'DRIVER' } },
  });
  if (!driver) {
    throw new Error('Driver driver@shenacare.com not found in database.');
  }

  const hubOperator = await prisma.customer.findFirst({
    where: { email: 'hub@shenacare.com', roles: { has: 'HUB_OPERATOR' } },
  });
  if (!hubOperator) {
    throw new Error('Hub operator hub@shenacare.com not found in database.');
  }

  // Find real active catalog SKUs
  const skus = await prisma.sku.findMany({
    where: { isActive: true },
    include: { product: { include: { brand: true } } },
    take: 6,
  });

  if (skus.length < 3) {
    throw new Error('At least 3 active SKUs are required in catalog.');
  }

  const [skuShampoo, skuConditioner, skuSerum] = skus;
  console.log(`Using Catalog SKUs:`);
  console.log(`- SKU 1: ${skuShampoo.product.name} (${skuShampoo.code}) [Barcode: ${skuShampoo.barcode || 'N/A'}]`);
  console.log(`- SKU 2: ${skuConditioner.product.name} (${skuConditioner.code}) [Barcode: ${skuConditioner.barcode || 'N/A'}]`);
  console.log(`- SKU 3: ${skuSerum.product.name} (${skuSerum.code}) [Barcode: ${skuSerum.barcode || 'N/A'}]`);

  // Cleanup prior E2E orders if reset or existing
  console.log('\nCleaning up any existing E2E test orders...');
  const existingOrders = await prisma.order.findMany({
    where: {
      OR: [
        { orderNumber: { startsWith: E2E_ORDER_PREFIX } },
        { customerPhone: { startsWith: '+20109999' } },
      ],
    },
    select: { id: true, orderNumber: true },
  });

  if (existingOrders.length > 0) {
    const orderIds = existingOrders.map((o) => o.id);
    console.log(`Found ${orderIds.length} existing E2E orders to clean up.`);

    // Cascade delete associated records
    await prisma.$transaction(async (tx) => {
      // 1. Delivery stops
      const shipments = await tx.shipment.findMany({
        where: { orderId: { in: orderIds } },
        select: { id: true },
      });
      const shipmentIds = shipments.map((s) => s.id);

      await tx.deliveryStop.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
      await tx.preparationScanEvent.deleteMany({
        where: { session: { shipmentId: { in: shipmentIds } } },
      });
      await tx.shipmentPreparationSession.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
      await tx.shipmentEvent.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
      await tx.shipmentItem.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
      await tx.shipment.deleteMany({ where: { id: { in: shipmentIds } } });

      // 2. Receipts and inventory
      const receipts = await tx.fulfillmentReceipt.findMany({
        where: { orderId: { in: orderIds } },
        select: { id: true, inventoryTransactionId: true },
      });
      await tx.fulfillmentReceipt.deleteMany({ where: { orderId: { in: orderIds } } });
      await tx.inventoryTransaction.deleteMany({
        where: { id: { in: receipts.map((r) => r.inventoryTransactionId) } },
      });

      // 3. Sourcing allocations & requirements
      const requests = await tx.supplyRequest.findMany({
        where: { orderId: { in: orderIds } },
        select: { id: true },
      });
      const reqIds = (
        await tx.supplyRequirement.findMany({
          where: { supplyRequestId: { in: requests.map((r) => r.id) } },
          select: { id: true },
        })
      ).map((r) => r.id);

      await tx.sourceAllocation.deleteMany({ where: { requirementId: { in: reqIds } } });
      await tx.supplyRequirement.deleteMany({ where: { id: { in: reqIds } } });
      await tx.supplyRequest.deleteMany({ where: { id: { in: requests.map((r) => r.id) } } });

      // 4. Payments, resolutions, events, orders
      await tx.paymentCollection.deleteMany({ where: { orderId: { in: orderIds } } });
      await tx.orderStatusEvent.deleteMany({ where: { orderId: { in: orderIds } } });
      await tx.orderResolutionItem.deleteMany({
        where: { resolution: { orderId: { in: orderIds } } },
      });
      await tx.orderResolutionEvent.deleteMany({
        where: { resolution: { orderId: { in: orderIds } } },
      });
      await tx.orderResolution.deleteMany({ where: { orderId: { in: orderIds } } });
      await tx.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
      await tx.order.deleteMany({ where: { id: { in: orderIds } } });

      // Clean up orphaned delivery batches created for E2E
      await tx.deliveryBatch.deleteMany({
        where: {
          stops: { none: {} },
          driverId: driver.id,
        },
      });
    });
    console.log('Cleanup complete.');
  }

  if (isReset) {
    console.log('Clean flag provided. Stopping here.');
    return;
  }

  // Ensure Customer Account
  const customer = await prisma.customer.upsert({
    where: { email: 'e2e-customer@shenacare.test' },
    update: { name: 'سارة أحمد [تجريبي]', phone: E2E_CUSTOMER_PHONE },
    create: {
      name: 'سارة أحمد [تجريبي]',
      email: 'e2e-customer@shenacare.test',
      phone: E2E_CUSTOMER_PHONE,
      roles: [Role.CUSTOMER],
      isActive: true,
    },
  });

  console.log('\nCreating realistic E2E lifecycle test scenarios...');

  // Helper to create base order
  async function createOrderFixture(params: {
    suffix: string;
    stageName: string;
    status: OrderStatus;
    items: Array<{ sku: typeof skuShampoo; quantity: number; price: number }>;
  }) {
    const orderId = crypto.randomUUID();
    const orderNumber = `${E2E_ORDER_PREFIX}${params.suffix}`;
    const subtotal = params.items.reduce((acc, it) => acc + it.price * it.quantity, 0);
    const shippingFee = 20;
    const totalAmount = subtotal + shippingFee;

    const order = await prisma.order.create({
      data: {
        id: orderId,
        orderNumber,
        customerId: customer.id,
        customerName: `عميل تجريبي (${params.stageName})`,
        customerPhone: E2E_CUSTOMER_PHONE,
        shippingAddress: '١٤ شارع النصر، المعادي الجديدة، القاهرة',
        governorate: 'Cairo',
        area: 'Maadi',
        latitude: 29.9602,
        longitude: 31.2569,
        locationSource: 'map_pin',
        locationConfirmedAt: new Date(),
        locationConfirmedBy: 'customer',
        subtotal,
        shippingFee,
        totalAmount,
        codAmount: totalAmount,
        currency: 'EGP',
        status: params.status,
        paymentMethod: PaymentMethod.COD,
        deliveryPromise: 'التوصيل متوقع خلال ٢٤ ساعة',
        promisedDate: new Date(Date.now() + 86400000),
        availabilityCertainty: 'confirmed',
        items: {
          create: params.items.map((it) => ({
            id: crypto.randomUUID(),
            skuId: it.sku.id,
            quantity: it.quantity,
            price: it.price,
            productName: it.sku.product.name,
            skuCode: it.sku.code,
            variantName: it.sku.variantName,
            lineTotal: it.price * it.quantity,
            currency: 'EGP',
            lineState: 'active',
          })),
        },
        statusEvents: {
          create: [{ status: params.status }],
        },
        paymentCollection: {
          create: {
            expectedAmount: totalAmount,
            currency: 'EGP',
            status: SettlementStatus.expected,
            locationId: hubId,
          },
        },
      },
      include: { items: true },
    });

    // Create SupplyRequest & requirements
    const supplyRequest = await prisma.supplyRequest.create({
      data: {
        orderId: order.id,
        status: 'CONFIRMING',
        requirements: {
          create: order.items.map((item) => ({
            orderItemId: item.id,
            skuId: item.skuId,
            requiredQuantity: item.quantity,
            orderSnapshotRef: item.id,
          })),
        },
      },
      include: { requirements: true },
    });

    return { order, supplyRequest };
  }

  // --------------------------------------------------------------------------
  // 1. Newly placed order (placed, to_buy)
  // --------------------------------------------------------------------------
  console.log('1. Seeding: 01-PLACED (طلب جديد مستني الشراء)...');
  const sc1 = await createOrderFixture({
    suffix: '01-PLACED',
    stageName: 'طلب جديد',
    status: OrderStatus.placed,
    items: [{ sku: skuShampoo, quantity: 1, price: 150 }],
  });

  // --------------------------------------------------------------------------
  // 2. Pending procurement (placed, multiple items to buy)
  // --------------------------------------------------------------------------
  console.log('2. Seeding: 02-BUYPEND (طلب بانتظار الشراء)...');
  const sc2 = await createOrderFixture({
    suffix: '02-BUYPEND',
    stageName: 'شراء معلق',
    status: OrderStatus.placed,
    items: [
      { sku: skuSerum, quantity: 2, price: 195 },
      { sku: skuConditioner, quantity: 1, price: 140 },
    ],
  });

  // --------------------------------------------------------------------------
  // 3. Partial procurement / incomplete receiving (1 item received, 1 awaiting)
  // --------------------------------------------------------------------------
  console.log('3. Seeding: 03-PARTREC (استلام جزئي بالمخزن)...');
  const sc3 = await createOrderFixture({
    suffix: '03-PARTREC',
    stageName: 'استلام جزئي',
    status: OrderStatus.placed,
    items: [
      { sku: skuShampoo, quantity: 1, price: 150 },
      { sku: skuConditioner, quantity: 1, price: 140 },
    ],
  });
  // Allocate both on buy list
  for (const req of sc3.supplyRequest.requirements) {
    const alloc = await prisma.sourceAllocation.create({
      data: {
        requirementId: req.id,
        requestedQuantity: req.requiredQuantity,
        allocatedQuantity: req.requiredQuantity,
        confirmedQuantity: req.requiredQuantity,
        result: 'confirmed_full',
        reportedResult: 'confirmed_full',
        reportedQuantity: req.requiredQuantity,
        confirmedAt: new Date(),
        evidenceRef: `BUY-LIST-${crypto.randomUUID()}`,
      },
    });
    // Receive ONLY the first requirement (Shampoo) at Hub
    if (req.skuId === skuShampoo.id) {
      const invBalance = await prisma.inventoryBalance.upsert({
        where: { locationId_skuId: { locationId: hubId, skuId: req.skuId } },
        update: { ownedOnHand: { increment: 1 } },
        create: { locationId: hubId, skuId: req.skuId, ownedOnHand: 1 },
      });
      const tx = await prisma.inventoryTransaction.create({
        data: {
          balanceId: invBalance.id,
          type: 'RECEIVE_OWNED',
          quantity: 1,
          actorId: hubOperator.id,
          referenceId: sc3.order.id,
        },
      });
      await prisma.fulfillmentReceipt.create({
        data: {
          locationId: hubId,
          supplyRequestId: req.supplyRequestId,
          sourceAllocationId: alloc.id,
          orderId: sc3.order.id,
          orderItemId: req.orderItemId,
          skuId: req.skuId,
          variantName: skuShampoo.variantName || '200 ml',
          quantity: 1,
          allocationConfirmedQuantity: 1,
          condition: ReceivedGoodsCondition.ACCEPTABLE,
          idempotencyKey: crypto.randomUUID(),
          identityMethod: 'primary_barcode',
          barcodeScanned: skuShampoo.barcode || '3610340655210',
          actorId: hubOperator.id,
          inventoryTransactionId: tx.id,
          expiryDate: new Date('2028-12-31'),
        },
      });
    }
  }

  // --------------------------------------------------------------------------
  // 4. Received inventory awaiting preparation (ready_to_prepare)
  // --------------------------------------------------------------------------
  console.log('4. Seeding: 04-AWAITPREP (مستلم بالكامل - بانتظار التجهيز)...');
  const sc4 = await createOrderFixture({
    suffix: '04-AWAITPREP',
    stageName: 'بانتظار التجهيز',
    status: OrderStatus.confirmed,
    items: [{ sku: skuSerum, quantity: 1, price: 195 }],
  });
  // Allocate & receive
  for (const req of sc4.supplyRequest.requirements) {
    const alloc = await prisma.sourceAllocation.create({
      data: {
        requirementId: req.id,
        requestedQuantity: req.requiredQuantity,
        allocatedQuantity: req.requiredQuantity,
        confirmedQuantity: req.requiredQuantity,
        result: 'confirmed_full',
        reportedResult: 'confirmed_full',
        reportedQuantity: req.requiredQuantity,
        confirmedAt: new Date(),
        evidenceRef: `BUY-LIST-${crypto.randomUUID()}`,
      },
    });
    const invBalance = await prisma.inventoryBalance.upsert({
      where: { locationId_skuId: { locationId: hubId, skuId: req.skuId } },
      update: { ownedOnHand: { increment: 1 } },
      create: { locationId: hubId, skuId: req.skuId, ownedOnHand: 1 },
    });
    const tx = await prisma.inventoryTransaction.create({
      data: {
        balanceId: invBalance.id,
        type: 'RECEIVE_OWNED',
        quantity: 1,
        actorId: hubOperator.id,
        referenceId: sc4.order.id,
      },
    });
    await prisma.fulfillmentReceipt.create({
      data: {
        locationId: hubId,
        supplyRequestId: req.supplyRequestId,
        sourceAllocationId: alloc.id,
        orderId: sc4.order.id,
        orderItemId: req.orderItemId,
        skuId: req.skuId,
        variantName: skuSerum.variantName || '30 ml',
        quantity: 1,
        allocationConfirmedQuantity: 1,
        condition: ReceivedGoodsCondition.ACCEPTABLE,
        idempotencyKey: crypto.randomUUID(),
        identityMethod: 'primary_barcode',
        barcodeScanned: skuSerum.barcode || '6223001380054',
        actorId: hubOperator.id,
        inventoryTransactionId: tx.id,
        expiryDate: new Date('2028-12-31'),
      },
    });
  }
  // Create Shipment ready_to_prepare
  const shipment4 = await prisma.shipment.create({
    data: {
      orderId: sc4.order.id,
      locationId: hubId,
      status: ShipmentStatus.ready_to_prepare,
      items: {
        create: sc4.order.items.map((i) => ({ skuId: i.skuId, quantity: i.quantity })),
      },
    },
  });

  // --------------------------------------------------------------------------
  // 5. In preparation / awaiting barcode verification (preparing)
  // --------------------------------------------------------------------------
  console.log('5. Seeding: 05-PREPARING (جلسة تجهيز وفحص باركود جارية)...');
  const sc5 = await createOrderFixture({
    suffix: '05-PREPARING',
    stageName: 'جلسة تجهيز وفحص',
    status: OrderStatus.confirmed,
    items: [{ sku: skuShampoo, quantity: 2, price: 150 }],
  });
  // Allocate & receive
  for (const req of sc5.supplyRequest.requirements) {
    const alloc = await prisma.sourceAllocation.create({
      data: {
        requirementId: req.id,
        requestedQuantity: req.requiredQuantity,
        allocatedQuantity: req.requiredQuantity,
        confirmedQuantity: req.requiredQuantity,
        result: 'confirmed_full',
        reportedResult: 'confirmed_full',
        reportedQuantity: req.requiredQuantity,
        confirmedAt: new Date(),
        evidenceRef: `BUY-LIST-${crypto.randomUUID()}`,
      },
    });
    const invBalance = await prisma.inventoryBalance.upsert({
      where: { locationId_skuId: { locationId: hubId, skuId: req.skuId } },
      update: { ownedOnHand: { increment: 2 } },
      create: { locationId: hubId, skuId: req.skuId, ownedOnHand: 2 },
    });
    const tx = await prisma.inventoryTransaction.create({
      data: {
        balanceId: invBalance.id,
        type: 'RECEIVE_OWNED',
        quantity: 2,
        actorId: hubOperator.id,
        referenceId: sc5.order.id,
      },
    });
    await prisma.fulfillmentReceipt.create({
      data: {
        locationId: hubId,
        supplyRequestId: req.supplyRequestId,
        sourceAllocationId: alloc.id,
        orderId: sc5.order.id,
        orderItemId: req.orderItemId,
        skuId: req.skuId,
        variantName: skuShampoo.variantName || '200 ml',
        quantity: 2,
        allocationConfirmedQuantity: 2,
        condition: ReceivedGoodsCondition.ACCEPTABLE,
        idempotencyKey: crypto.randomUUID(),
        identityMethod: 'primary_barcode',
        barcodeScanned: skuShampoo.barcode || '3610340655210',
        actorId: hubOperator.id,
        inventoryTransactionId: tx.id,
        expiryDate: new Date('2028-12-31'),
      },
    });
  }
  const shipment5 = await prisma.shipment.create({
    data: {
      orderId: sc5.order.id,
      locationId: hubId,
      status: ShipmentStatus.preparing,
      items: {
        create: sc5.order.items.map((i) => ({ skuId: i.skuId, quantity: i.quantity })),
      },
      preparationSessions: {
        create: {
          operatorId: hubOperator.id,
          status: PreparationSessionStatus.in_progress,
          scanEvents: {
            create: [
              {
                skuId: skuShampoo.id,
                barcodeScanned: skuShampoo.barcode || '3610340655210',
                isSuccessful: true,
                verificationMethod: 'primary_barcode',
                operatorId: hubOperator.id,
                clientScanId: crypto.randomUUID(),
              },
            ],
          },
        },
      },
    },
  });

  // --------------------------------------------------------------------------
  // 6. Fully verified awaiting packaging/printing (prepared)
  // --------------------------------------------------------------------------
  console.log('6. Seeding: 06-VERIFIED (تم الفحص - بانتظار التغليف والطباعة)...');
  const sc6 = await createOrderFixture({
    suffix: '06-VERIFIED',
    stageName: 'مفحوص بانتظار التغليف',
    status: OrderStatus.packing,
    items: [{ sku: skuConditioner, quantity: 1, price: 140 }],
  });
  const shipment6 = await prisma.shipment.create({
    data: {
      orderId: sc6.order.id,
      locationId: hubId,
      status: ShipmentStatus.prepared,
      items: {
        create: sc6.order.items.map((i) => ({ skuId: i.skuId, quantity: i.quantity })),
      },
      preparationSessions: {
        create: {
          operatorId: hubOperator.id,
          status: PreparationSessionStatus.completed,
          completedAt: new Date(),
          scanEvents: {
            create: [
              {
                skuId: skuConditioner.id,
                barcodeScanned: skuConditioner.barcode || '3610340655173',
                isSuccessful: true,
                verificationMethod: 'primary_barcode',
                operatorId: hubOperator.id,
                clientScanId: crypto.randomUUID(),
              },
            ],
          },
        },
      },
    },
  });

  // --------------------------------------------------------------------------
  // 7. Packaged awaiting courier handoff (packed, eligible for batch)
  // --------------------------------------------------------------------------
  console.log('7. Seeding: 07-PACKED (مغلف وجاهز للتسليم للمندوب)...');
  const sc7 = await createOrderFixture({
    suffix: '07-PACKED',
    stageName: 'مغلف بانتظار المندوب',
    status: OrderStatus.packing,
    items: [{ sku: skuSerum, quantity: 1, price: 195 }],
  });
  const shipment7Id = crypto.randomUUID();
  const shipment7Barcode = signBarcode(shipment7Id);
  const shipment7 = await prisma.shipment.create({
    data: {
      id: shipment7Id,
      orderId: sc7.order.id,
      locationId: hubId,
      status: ShipmentStatus.packed,
      trackingNumber: `TRK-${sc7.order.orderNumber.replace('ORD-', '')}`,
      items: {
        create: sc7.order.items.map((i) => ({ skuId: i.skuId, quantity: i.quantity })),
      },
      events: {
        create: [
          { type: 'LABEL_GENERATED', actorId: hubOperator.id, notes: shipment7Barcode },
          { type: 'LABEL_PRINTED', actorId: hubOperator.id },
          { type: 'RECEIPT_PRINTED', actorId: hubOperator.id },
          { type: 'PACKED', actorId: hubOperator.id },
        ],
      },
    },
  });

  // --------------------------------------------------------------------------
  // 8. Courier-assigned order (packed on a planning batch)
  // --------------------------------------------------------------------------
  console.log('8. Seeding: 08-ASSIGNED (معين للمندوب في مشوار قيد التخطيط)...');
  const sc8 = await createOrderFixture({
    suffix: '08-ASSIGNED',
    stageName: 'معين للمندوب',
    status: OrderStatus.packing,
    items: [{ sku: skuShampoo, quantity: 1, price: 150 }],
  });
  const shipment8Id = crypto.randomUUID();
  const shipment8Barcode = signBarcode(shipment8Id);
  const shipment8 = await prisma.shipment.create({
    data: {
      id: shipment8Id,
      orderId: sc8.order.id,
      locationId: hubId,
      status: ShipmentStatus.packed,
      trackingNumber: `TRK-${sc8.order.orderNumber.replace('ORD-', '')}`,
      items: {
        create: sc8.order.items.map((i) => ({ skuId: i.skuId, quantity: i.quantity })),
      },
      events: {
        create: [
          { type: 'LABEL_PRINTED', actorId: hubOperator.id },
          { type: 'RECEIPT_PRINTED', actorId: hubOperator.id },
          { type: 'PACKED', actorId: hubOperator.id },
        ],
      },
    },
  });
  // Create delivery batch in planning status
  const batchPlanning = await prisma.deliveryBatch.create({
    data: {
      status: 'planning',
      driverId: driver.id,
      locationId: hubId,
      plannedAt: new Date(),
      stops: {
        create: [
          {
            shipmentId: shipment8.id,
            sequence: 1,
            status: 'active',
          },
        ],
      },
    },
  });

  // --------------------------------------------------------------------------
  // 9. Order in delivery (out_for_delivery, batch dispatched)
  // --------------------------------------------------------------------------
  console.log('9. Seeding: 09-INDELIV (في الطريق مع المندوب)...');
  const sc9 = await createOrderFixture({
    suffix: '09-INDELIV',
    stageName: 'في طريق التوصيل',
    status: OrderStatus.shipped,
    items: [{ sku: skuConditioner, quantity: 1, price: 140 }],
  });
  const shipment9Id = crypto.randomUUID();
  const shipment9Barcode = signBarcode(shipment9Id);
  const shipment9 = await prisma.shipment.create({
    data: {
      id: shipment9Id,
      orderId: sc9.order.id,
      locationId: hubId,
      status: ShipmentStatus.out_for_delivery,
      trackingNumber: `TRK-${sc9.order.orderNumber.replace('ORD-', '')}`,
      dispatchedAt: new Date(Date.now() - 3600000),
      items: {
        create: sc9.order.items.map((i) => ({ skuId: i.skuId, quantity: i.quantity })),
      },
      events: {
        create: [
          { type: 'LABEL_PRINTED', actorId: hubOperator.id },
          { type: 'PACKED', actorId: hubOperator.id },
          { type: 'HANDOFF_SCANNED', actorId: driver.id, notes: shipment9Barcode },
          { type: 'OUT_FOR_DELIVERY', actorId: driver.id },
        ],
      },
    },
  });
  const batchDispatched = await prisma.deliveryBatch.create({
    data: {
      status: 'dispatched',
      driverId: driver.id,
      locationId: hubId,
      plannedAt: new Date(Date.now() - 7200000),
      dispatchedAt: new Date(Date.now() - 3600000),
      stops: {
        create: [
          {
            shipmentId: shipment9.id,
            sequence: 1,
            status: 'active',
          },
        ],
      },
    },
  });

  // --------------------------------------------------------------------------
  // 10. Successfully delivered COD order (delivered, cash collected)
  // --------------------------------------------------------------------------
  console.log('10. Seeding: 10-DELIVERED (تم التوصيل بنجاح وتحصيل النقدية)...');
  const sc10 = await createOrderFixture({
    suffix: '10-DELIVERED',
    stageName: 'تم التوصيل كاش',
    status: OrderStatus.delivered,
    items: [{ sku: skuSerum, quantity: 1, price: 195 }],
  });
  const shipment10Id = crypto.randomUUID();
  const shipment10Barcode = signBarcode(shipment10Id);
  const shipment10 = await prisma.shipment.create({
    data: {
      id: shipment10Id,
      orderId: sc10.order.id,
      locationId: hubId,
      status: ShipmentStatus.delivered,
      trackingNumber: `TRK-${sc10.order.orderNumber.replace('ORD-', '')}`,
      dispatchedAt: new Date(Date.now() - 14400000),
      deliveredAt: new Date(Date.now() - 7200000),
      items: {
        create: sc10.order.items.map((i) => ({ skuId: i.skuId, quantity: i.quantity })),
      },
      events: {
        create: [
          { type: 'PACKED', actorId: hubOperator.id },
          { type: 'HANDOFF_SCANNED', actorId: driver.id, notes: shipment10Barcode },
          { type: 'OUT_FOR_DELIVERY', actorId: driver.id },
          { type: 'DELIVERED', actorId: driver.id, notes: 'Delivered and cash collected' },
        ],
      },
    },
  });
  // Update PaymentCollection to collected
  await prisma.paymentCollection.update({
    where: { orderId: sc10.order.id },
    data: {
      status: SettlementStatus.collected,
      declaredAmount: sc10.order.totalAmount,
      declaredAt: new Date(Date.now() - 7200000),
      courierId: driver.id,
    },
  });

  // --------------------------------------------------------------------------
  // 11A. Failed delivery attempt (failed, awaiting hub return)
  // --------------------------------------------------------------------------
  console.log('11A. Seeding: 11-FAILED (محاولة تسليم فاشلة)...');
  const sc11A = await createOrderFixture({
    suffix: '11-FAILED',
    stageName: 'محاولة فاشلة',
    status: OrderStatus.shipped,
    items: [{ sku: skuShampoo, quantity: 1, price: 150 }],
  });
  const shipment11AId = crypto.randomUUID();
  const shipment11ABarcode = signBarcode(shipment11AId);
  const shipment11A = await prisma.shipment.create({
    data: {
      id: shipment11AId,
      orderId: sc11A.order.id,
      locationId: hubId,
      status: ShipmentStatus.failed,
      trackingNumber: `TRK-${sc11A.order.orderNumber.replace('ORD-', '')}`,
      dispatchedAt: new Date(Date.now() - 10800000),
      items: {
        create: sc11A.order.items.map((i) => ({ skuId: i.skuId, quantity: i.quantity })),
      },
      events: {
        create: [
          { type: 'PACKED', actorId: hubOperator.id },
          { type: 'HANDOFF_SCANNED', actorId: driver.id, notes: shipment11ABarcode },
          { type: 'OUT_FOR_DELIVERY', actorId: driver.id },
          {
            type: 'FAILED',
            actorId: driver.id,
            reasonCode: 'CUSTOMER_UNREACHABLE',
            notes: 'العميل لا يجيب على الهاتف بعد ٣ محاولات',
          },
        ],
      },
    },
  });

  // --------------------------------------------------------------------------
  // 11B. Returned order (returned, terminal)
  // --------------------------------------------------------------------------
  console.log('11B. Seeding: 12-RETURNED (مرتجع نهائي بالمخزن)...');
  const sc11B = await createOrderFixture({
    suffix: '12-RETURNED',
    stageName: 'مرتجع نهائي',
    status: OrderStatus.returned,
    items: [{ sku: skuConditioner, quantity: 1, price: 140 }],
  });
  const shipment11BId = crypto.randomUUID();
  const shipment11BBarcode = signBarcode(shipment11BId);
  const shipment11B = await prisma.shipment.create({
    data: {
      id: shipment11BId,
      orderId: sc11B.order.id,
      locationId: hubId,
      status: ShipmentStatus.returned,
      trackingNumber: `TRK-${sc11B.order.orderNumber.replace('ORD-', '')}`,
      dispatchedAt: new Date(Date.now() - 86400000),
      items: {
        create: sc11B.order.items.map((i) => ({ skuId: i.skuId, quantity: i.quantity })),
      },
      events: {
        create: [
          { type: 'PACKED', actorId: hubOperator.id },
          { type: 'HANDOFF_SCANNED', actorId: driver.id, notes: shipment11BBarcode },
          { type: 'OUT_FOR_DELIVERY', actorId: driver.id },
          {
            type: 'FAILED',
            actorId: driver.id,
            reasonCode: 'CUSTOMER_REJECTED',
            notes: 'رفض استلام الطلب عند الباب',
          },
          {
            type: 'RETURNED',
            actorId: hubOperator.id,
            reasonCode: 'REJECTED_AT_DOOR',
            notes: 'تم استلام الطرد المرتجع في المخزن وحفظه',
          },
        ],
      },
    },
  });

  console.log('\n=== E2E ORDER LIFECYCLE SEED COMPLETED SUCCESSFULLY! ===');
  console.log('Seeded Order Summary:');
  console.log(`1.  ORD-E2E-01-PLACED    [placed]           ${sc1.order.id}`);
  console.log(`2.  ORD-E2E-02-BUYPEND   [placed]           ${sc2.order.id}`);
  console.log(`3.  ORD-E2E-03-PARTREC   [placed]           ${sc3.order.id}`);
  console.log(`4.  ORD-E2E-04-AWAITPREP [confirmed]        ${sc4.order.id}`);
  console.log(`5.  ORD-E2E-05-PREPARING [confirmed]        ${sc5.order.id}`);
  console.log(`6.  ORD-E2E-06-VERIFIED  [packing]          ${sc6.order.id}`);
  console.log(`7.  ORD-E2E-07-PACKED    [packing]          ${sc7.order.id}`);
  console.log(`8.  ORD-E2E-08-ASSIGNED  [packing]          ${sc8.order.id}`);
  console.log(`9.  ORD-E2E-09-INDELIV   [shipped]          ${sc9.order.id}`);
  console.log(`10. ORD-E2E-10-DELIVERED [delivered]        ${sc10.order.id}`);
  console.log(`11. ORD-E2E-11-FAILED    [shipped/failed]   ${sc11A.order.id}`);
  console.log(`12. ORD-E2E-12-RETURNED  [returned]         ${sc11B.order.id}`);
}

main()
  .catch((err) => {
    console.error('Seeding failed with error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
