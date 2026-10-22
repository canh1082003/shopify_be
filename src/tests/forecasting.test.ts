import { describe, it } from 'node:test';
import assert from 'node:assert';
import { forecastingService } from '../services/forecasting.service';

describe('StockPilot — Inventory Forecasting Engine Tests', () => {
  it('1. Average daily sales: handles normal sales velocity correctly', () => {
    // 30 units sold in 10 days = 3.0 units/day
    const rate = forecastingService.calculateAverageDailySales(30, 10);
    assert.strictEqual(rate, 3);

    // 45 units sold in 30 days = 1.5 units/day
    const rate2 = forecastingService.calculateAverageDailySales(45, 30);
    assert.strictEqual(rate2, 1.5);
  });

  it('2. Average daily sales: handles zero sales and edge cases gracefully without divide by zero', () => {
    assert.strictEqual(forecastingService.calculateAverageDailySales(0, 30), 0);
    assert.strictEqual(forecastingService.calculateAverageDailySales(-5, 30), 0);
    assert.strictEqual(forecastingService.calculateAverageDailySales(10, 0), 0);
    assert.strictEqual(forecastingService.calculateAverageDailySales(10, -5), 0);
  });

  it('3. Days of stock remaining: handles normal stock and positive velocity', () => {
    // 60 units available, 3 units/day = 20 days remaining
    const days = forecastingService.calculateDaysRemaining(60, 3, true);
    assert.strictEqual(days, 20);
  });

  it('4. Days of stock remaining: zero sales velocity returns null (insufficient sales data)', () => {
    const days = forecastingService.calculateDaysRemaining(100, 0, true);
    assert.strictEqual(days, null);
  });

  it('5. Days of stock remaining: untracked products return null', () => {
    const days = forecastingService.calculateDaysRemaining(50, 2, false);
    assert.strictEqual(days, null);
  });

  it('6. Days of stock remaining: zero or negative stock returns 0 days', () => {
    assert.strictEqual(forecastingService.calculateDaysRemaining(0, 5, true), 0);
    assert.strictEqual(forecastingService.calculateDaysRemaining(-2, 5, true), 0);
  });

  it('7. Stock status: identifies untracked products', () => {
    const status = forecastingService.calculateStockStatus(100, 10, 20, 7, 5, false);
    assert.strictEqual(status, 'untracked');
  });

  it('8. Stock status: identifies out of stock products', () => {
    const status = forecastingService.calculateStockStatus(0, 10, 0, 7, 5, true);
    assert.strictEqual(status, 'out_of_stock');

    const statusNegative = forecastingService.calculateStockStatus(-4, 10, 0, 7, 5, true);
    assert.strictEqual(statusNegative, 'out_of_stock');
  });

  it('9. Stock status: identifies low stock when quantity is below or at threshold', () => {
    // Available = 8, Low Stock Threshold = 10
    const status = forecastingService.calculateStockStatus(8, 10, 15, 7, 5, true);
    assert.strictEqual(status, 'low_stock');
  });

  it('10. Stock status: identifies restock_soon when daysRemaining is within lead time + safety horizon', () => {
    // Lead time = 7, Safety = 5 => Horizon = 12 days
    // Available = 25 (above threshold of 10), but velocity yields 10 days remaining <= 12
    const status = forecastingService.calculateStockStatus(25, 10, 10, 7, 5, true);
    assert.strictEqual(status, 'restock_soon');
  });

  it('11. Stock status: identifies healthy stock when plenty of quantity and long runway', () => {
    // Available = 100, threshold = 10, days remaining = 45 (> 12)
    const status = forecastingService.calculateStockStatus(100, 10, 45, 7, 5, true);
    assert.strictEqual(status, 'healthy');
  });

  it('12. Restock suggestion: computes reorder quantity accurately', () => {
    // Available = 15, daily sales = 4, lead time = 7, safety = 5 (horizon = 12)
    // dynamic target = ceil(4 * 12) = 48. Target = max(48, threshold 10) = 48.
    // Recommended restock = 48 - 15 = 33 units.
    const result = forecastingService.calculateRestockSuggestion(15, 4, 7, 5, 10);
    assert.strictEqual(result.targetStock, 48);
    assert.strictEqual(result.recommendedQuantity, 33);
  });

  it('13. Restock suggestion: returns 0 recommended quantity if current stock exceeds target', () => {
    const result = forecastingService.calculateRestockSuggestion(60, 2, 7, 5, 10);
    // target = max(ceil(2 * 12) = 24, 10) = 24.
    // available = 60 => recommended = 0.
    assert.strictEqual(result.targetStock, 24);
    assert.strictEqual(result.recommendedQuantity, 0);
  });

  it('14. Full evaluation pipeline integration test', () => {
    const res = forecastingService.evaluateVariant({
      availableQuantity: 12,
      unitsSold: 60,
      periodDays: 30, // 2 units/day
      leadTimeDays: 7,
      safetyStockDays: 5, // horizon = 12 days => target = 24
      lowStockThreshold: 15, // target = max(24, 15) = 24
      tracked: true,
    });

    assert.strictEqual(res.averageDailySales, 2);
    assert.strictEqual(res.daysRemaining, 6); // 12 / 2 = 6 days
    assert.strictEqual(res.status, 'low_stock'); // 12 <= 15
    assert.strictEqual(res.targetStock, 24);
    assert.strictEqual(res.recommendedQuantity, 12); // 24 - 12 = 12
  });
});
