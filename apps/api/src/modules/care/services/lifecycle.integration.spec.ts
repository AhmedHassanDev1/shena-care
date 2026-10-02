import { Test, TestingModule } from '@nestjs/testing';
import { LifecycleTriggerService } from './lifecycle-trigger.service';
import { CareReminderOrchestrator, ReminderContext } from './reminder-orchestrator.service';
import { AdaptiveCheckinService } from './adaptive-checkin.service';
import { ReplenishmentEstimatorService } from './replenishment-estimator.service';
import { MessagingRouterService } from '../../messaging/services/router.service';

describe('Post-Purchase Lifecycle Integration', () => {
  let triggerService: LifecycleTriggerService;
  let orchestrator: CareReminderOrchestrator;
  let adaptiveCheckin: AdaptiveCheckinService;
  let replenishment: ReplenishmentEstimatorService;
  let messagingRouter: MessagingRouterService;

  beforeEach(async () => {
    // Mock the messaging router to intercept routed messages
    const mockMessagingRouter = {
      routeMessage: jest.fn().mockResolvedValue({ success: true, provider: 'whatsapp', externalId: 'msg_123' })
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LifecycleTriggerService,
        CareReminderOrchestrator,
        AdaptiveCheckinService,
        ReplenishmentEstimatorService,
        { provide: MessagingRouterService, useValue: mockMessagingRouter }
      ],
    }).compile();

    triggerService = module.get<LifecycleTriggerService>(LifecycleTriggerService);
    orchestrator = module.get<CareReminderOrchestrator>(CareReminderOrchestrator);
    adaptiveCheckin = module.get<AdaptiveCheckinService>(AdaptiveCheckinService);
    replenishment = module.get<ReplenishmentEstimatorService>(ReplenishmentEstimatorService);
    messagingRouter = module.get<MessagingRouterService>(MessagingRouterService);
  });

  it('validates idempotency and suppression rules (problem_irritation, frequency cap)', async () => {
    const customerId = 'cust_123';
    const productId = 'prod_abc';
    const orderId = 'ord_456';
    
    // 1. Order Delivered
    const deliveryDate = new Date();
    deliveryDate.setDate(deliveryDate.getDate() - 5); // 5 days ago
    triggerService.registerPostPurchaseDelivery(customerId, orderId, productId, deliveryDate);

    // 2. Evaluate triggers (should dispatch first-use-checkin because it's between 3 and 7 days)
    let dispatched = await triggerService.evaluateTriggers(new Date());
    expect(dispatched).toBe(1);
    expect(messagingRouter.routeMessage).toHaveBeenCalledTimes(1);

    const firstRouteCall = jest.mocked(messagingRouter.routeMessage).mock.calls[0][0];
    expect(firstRouteCall.templateId).toBe('first_use_checkin_v1');

    // 3. Evaluate triggers again immediately -> idempotency check (frequency cap)
    dispatched = await triggerService.evaluateTriggers(new Date());
    expect(dispatched).toBe(0); // Should not dispatch again

    // 4. User reports irritation via check-in
    const stateUpdate = adaptiveCheckin.processCheckin({
      customerId,
      routineId: 'rout_1',
      productId,
      response: 'problem_irritation',
      timestamp: new Date()
    });

    expect(stateUpdate.suppressPromotions).toBe(true);
    expect(stateUpdate.suppressReorders).toBe(true);
    expect(stateUpdate.needsSupportEscalation).toBe(true);

    // 5. Test orchestrator directly with problem reported
    const context: ReminderContext = {
      customerId,
      productId,
      intent: 'progress-checkin',
      userReportedProblem: true // from state update
    };

    const orchestratorResult = await orchestrator.evaluateAndDispatch(context);
    expect(orchestratorResult.dispatched).toBe(false);
    expect(orchestratorResult.reason).toContain('User reported problem');
  });

  it('validates replenishment estimation and safe reorder suggestions', async () => {
    const data = {
      productId: 'prod_xyz',
      startedAt: new Date(Date.now() - 55 * 24 * 60 * 60 * 1000), // 55 days ago
      frequency: 'AM' as const,
      baselineDaysOfUse: 60
    };

    const estimate = replenishment.estimateDepletion(data);
    
    // Days remaining = 60 - 55 = 5 days, which is <= 7, so isDue = true
    expect(estimate.isDue).toBe(true);
    expect(estimate.confidence).toBe('HIGH');
    
    const suggestion = await replenishment.generateReorderSuggestion('prod_xyz');
    expect(suggestion.isAvailable).toBeDefined();
    // Does not mutate cart, just returns DTO
    expect(suggestion.currentPrice).toBe(150);
  });
});
