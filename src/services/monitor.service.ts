import { repository } from '../db/repository';
import { Order, Alert, Settings } from '../types';

export interface OverdueEvaluationResult {
  isEligible: boolean;
  isOverdue: boolean;
  isInWarningWindow: boolean;
  deadline: Date;
  elapsedHours: number;
  overdueMinutes: number;
  reason?: string;
}

export class MonitorService {
  /**
   * Pure evaluation function: determines eligibility and overdue status of an order.
   * Crucial for automated unit testing!
   */
  public evaluateOrder(
    order: Pick<
      Order,
      'createdAt' | 'cancelledAt' | 'financialStatus' | 'fulfillmentStatus' | 'fulfillableQuantity'
    >,
    settings: Pick<Settings, 'overdueThresholdHours' | 'warningLeadTimeHours'>,
    currentTime: Date = new Date()
  ): OverdueEvaluationResult {
    const createdTime = new Date(order.createdAt).getTime();
    const thresholdMs = settings.overdueThresholdHours * 60 * 60 * 1000;
    const warningMs = settings.warningLeadTimeHours * 60 * 60 * 1000;
    const deadline = new Date(createdTime + thresholdMs);
    const nowTime = currentTime.getTime();

    const elapsedMs = Math.max(0, nowTime - createdTime);
    const elapsedHours = Number((elapsedMs / (1000 * 60 * 60)).toFixed(2));

    // 1. Exclude canceled orders
    if (order.cancelledAt !== null && order.cancelledAt !== undefined) {
      return {
        isEligible: false,
        isOverdue: false,
        isInWarningWindow: false,
        deadline,
        elapsedHours,
        overdueMinutes: 0,
        reason: 'Order is canceled',
      };
    }

    // 2. Exclude unpaid / non-authorized orders
    if (order.financialStatus !== 'paid' && order.financialStatus !== 'authorized') {
      return {
        isEligible: false,
        isOverdue: false,
        isInWarningWindow: false,
        deadline,
        elapsedHours,
        overdueMinutes: 0,
        reason: `Order financial status is ${order.financialStatus} (requires paid or authorized)`,
      };
    }

    // 3. Exclude completely fulfilled orders
    if (
      order.fulfillmentStatus === 'fulfilled' ||
      order.fulfillableQuantity === 0
    ) {
      return {
        isEligible: false,
        isOverdue: false,
        isInWarningWindow: false,
        deadline,
        elapsedHours,
        overdueMinutes: 0,
        reason: 'Order is completely fulfilled',
      };
    }

    // 4. Eligible order! Now evaluate timeline
    const isOverdue = nowTime >= deadline.getTime();
    const overdueMinutes = isOverdue
      ? Math.floor((nowTime - deadline.getTime()) / (1000 * 60))
      : 0;

    const warningThresholdTime = deadline.getTime() - warningMs;
    const isInWarningWindow = !isOverdue && nowTime >= warningThresholdTime;

    return {
      isEligible: true,
      isOverdue,
      isInWarningWindow,
      deadline,
      elapsedHours,
      overdueMinutes,
      reason: isOverdue
        ? `Overdue by ${overdueMinutes} minutes (Threshold: ${settings.overdueThresholdHours}h)`
        : isInWarningWindow
        ? `Approaching fulfillment deadline in ${(
            (deadline.getTime() - nowTime) /
            (1000 * 60 * 60)
          ).toFixed(1)}h`
        : 'On track',
    };
  }

  /**
   * Run full evaluation pass across all orders for a shop
   */
  public async evaluateShopOrders(shopId: string): Promise<{
    evaluatedCount: number;
    newOverdueCount: number;
    resolvedAlertsCount: number;
  }> {
    const settings = await repository.getSettings(shopId);
    const orders = await repository.getAllActiveOrders(shopId);
    const existingAlerts = (await repository.getAlerts(shopId, { limit: 500 })).items;

    let newOverdueCount = 0;
    let resolvedAlertsCount = 0;
    const now = new Date();

    for (const order of orders) {
      const result = this.evaluateOrder(order, settings, now);

      // Update order computed state
      order.deadline = result.deadline.toISOString();
      order.isOverdue = result.isOverdue;
      order.overdueMinutes = result.overdueMinutes;
      await repository.upsertOrder(shopId, order);

      // Find any existing active/acknowledged alert for this order
      const existingAlert = existingAlerts.find(
        (a) => a.orderId === order.id && a.status !== 'resolved'
      );

      if (!result.isEligible || order.fulfillmentStatus === 'fulfilled') {
        // If order became fulfilled or is ineligible, resolve any lingering active alerts
        if (existingAlert) {
          await repository.resolveAlertsForOrder(
            shopId,
            order.id,
            'Order has been fulfilled or canceled in Shopify'
          );
          resolvedAlertsCount++;
        }
        continue;
      }

      if (result.isOverdue) {
        newOverdueCount++;

        if (existingAlert) {
          // Update severity to critical if it was warning
          if (existingAlert.severity !== 'critical') {
            existingAlert.severity = 'critical';
            existingAlert.reason = `Order unfulfilled for ${result.elapsedHours}h (exceeded ${settings.overdueThresholdHours}h threshold).`;
            existingAlert.elapsedHours = result.elapsedHours;
            await repository.upsertAlert(shopId, existingAlert);
          }
        } else {
          // Create new critical alert (deduplicated)
          const newAlert: Alert = {
            id: `alert-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
            shopId,
            orderId: order.id,
            orderNumber: order.orderNumber,
            severity: 'critical',
            status: 'active',
            reason: `Order unfulfilled for ${result.elapsedHours}h (exceeded ${settings.overdueThresholdHours}h threshold).`,
            elapsedHours: result.elapsedHours,
            thresholdHours: settings.overdueThresholdHours,
            createdAt: now.toISOString(),
            acknowledgedAt: null,
            resolvedAt: null,
          };
          await repository.upsertAlert(shopId, newAlert);
        }
      } else if (result.isInWarningWindow) {
        if (!existingAlert) {
          // Create new warning alert (deduplicated)
          const newAlert: Alert = {
            id: `alert-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
            shopId,
            orderId: order.id,
            orderNumber: order.orderNumber,
            severity: 'warning',
            status: 'active',
            reason: `Fulfillment deadline approaching in ${(
              (result.deadline.getTime() - now.getTime()) /
              (1000 * 60 * 60)
            ).toFixed(1)}h.`,
            elapsedHours: result.elapsedHours,
            thresholdHours: settings.overdueThresholdHours,
            createdAt: now.toISOString(),
            acknowledgedAt: null,
            resolvedAt: null,
          };
          await repository.upsertAlert(shopId, newAlert);
        }
      }
    }

    return {
      evaluatedCount: orders.length,
      newOverdueCount,
      resolvedAlertsCount,
    };
  }
}

export const monitorService = new MonitorService();
