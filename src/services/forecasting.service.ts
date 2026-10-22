import { StockStatus } from '../types';

export interface ForecastingInputs {
  availableQuantity: number;
  unitsSold: number;
  periodDays: number;
  leadTimeDays: number;
  safetyStockDays: number;
  lowStockThreshold: number;
  tracked: boolean;
}

export interface ForecastingResult {
  averageDailySales: number;
  daysRemaining: number | null;
  status: StockStatus;
  targetStock: number;
  recommendedQuantity: number;
}

export class ForecastingService {
  /**
   * Calculate average daily units sold over a specific period.
   * Handles edge cases: zero period, negative units, zero sales.
   */
  public calculateAverageDailySales(unitsSold: number, periodDays: number): number {
    if (periodDays <= 0 || unitsSold <= 0) {
      return 0;
    }
    const rate = unitsSold / periodDays;
    return Math.round(rate * 100) / 100;
  }

  /**
   * Calculate estimated days of stock remaining based on available quantity and sales velocity.
   * Returns null if product is untracked or has zero sales velocity (insufficient sales data).
   */
  public calculateDaysRemaining(
    availableQuantity: number,
    averageDailySales: number,
    tracked: boolean
  ): number | null {
    if (!tracked) {
      return null;
    }
    if (availableQuantity <= 0) {
      return 0;
    }
    if (averageDailySales <= 0) {
      return null;
    }
    return Math.round(availableQuantity / averageDailySales);
  }

  /**
   * Determine stock status based on inventory levels, thresholds, and lead time horizon.
   */
  public calculateStockStatus(
    availableQuantity: number,
    lowStockThreshold: number,
    daysRemaining: number | null,
    leadTimeDays: number,
    safetyStockDays: number,
    tracked: boolean
  ): StockStatus {
    if (!tracked) {
      return 'untracked';
    }
    if (availableQuantity <= 0) {
      return 'out_of_stock';
    }
    if (availableQuantity <= lowStockThreshold) {
      return 'low_stock';
    }
    const replenishmentHorizon = leadTimeDays + safetyStockDays;
    if (daysRemaining !== null && daysRemaining <= replenishmentHorizon) {
      return 'restock_soon';
    }
    return 'healthy';
  }

  /**
   * Calculate recommended reorder quantity:
   * targetStock = max(lowStockThreshold, ceil(averageDailySales * (leadTimeDays + safetyStockDays)))
   * recommendedQuantity = max(0, targetStock - availableQuantity)
   */
  public calculateRestockSuggestion(
    availableQuantity: number,
    averageDailySales: number,
    leadTimeDays: number,
    safetyStockDays: number,
    lowStockThreshold: number
  ): { targetStock: number; recommendedQuantity: number } {
    const horizon = Math.max(1, leadTimeDays + safetyStockDays);
    const dynamicTarget = Math.ceil(averageDailySales * horizon);
    const targetStock = Math.max(dynamicTarget, lowStockThreshold);
    const safeAvailable = Math.max(0, availableQuantity);
    const recommendedQuantity = Math.max(0, targetStock - safeAvailable);

    return {
      targetStock,
      recommendedQuantity,
    };
  }

  /**
   * Full evaluation pipeline for a product variant.
   */
  public evaluateVariant(inputs: ForecastingInputs): ForecastingResult {
    const averageDailySales = this.calculateAverageDailySales(
      inputs.unitsSold,
      inputs.periodDays
    );

    const daysRemaining = this.calculateDaysRemaining(
      inputs.availableQuantity,
      averageDailySales,
      inputs.tracked
    );

    const status = this.calculateStockStatus(
      inputs.availableQuantity,
      inputs.lowStockThreshold,
      daysRemaining,
      inputs.leadTimeDays,
      inputs.safetyStockDays,
      inputs.tracked
    );

    const { targetStock, recommendedQuantity } = this.calculateRestockSuggestion(
      inputs.availableQuantity,
      averageDailySales,
      inputs.leadTimeDays,
      inputs.safetyStockDays,
      inputs.lowStockThreshold
    );

    return {
      averageDailySales,
      daysRemaining,
      status,
      targetStock,
      recommendedQuantity,
    };
  }
}

export const forecastingService = new ForecastingService();
