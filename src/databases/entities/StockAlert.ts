import mongoose, { Schema, Document } from 'mongoose';

export interface IStockAlert extends Document<string> {
  _id: string;
  shopId: string;
  variantId: string;
  productTitle: string;
  variantTitle: string;
  sku: string;
  locationName: string;
  alertType: 'low_stock' | 'out_of_stock' | 'restock_soon' | 'untracked';
  status: 'active' | 'acknowledged' | 'resolved';
  currentQuantity: number;
  threshold: number;
  estimatedDaysRemaining: number | null;
  reason: string;
  createdAt: Date;
  acknowledgedAt?: Date | null;
  resolvedAt?: Date | null;
}

const StockAlertSchema: Schema = new Schema(
  {
    _id: { type: String, required: true },
    shopId: { type: String, required: true, index: true },
    variantId: { type: String, required: true, index: true },
    productTitle: { type: String, required: true },
    variantTitle: { type: String, default: '' },
    sku: { type: String, default: '' },
    locationName: { type: String, default: 'Main Warehouse' },
    alertType: {
      type: String,
      enum: ['low_stock', 'out_of_stock', 'restock_soon', 'untracked'],
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['active', 'acknowledged', 'resolved'],
      default: 'active',
      index: true,
    },
    currentQuantity: { type: Number, required: true },
    threshold: { type: Number, required: true },
    estimatedDaysRemaining: { type: Number, default: null },
    reason: { type: String, required: true },
    acknowledgedAt: { type: Date, default: null },
    resolvedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model<IStockAlert>('StockAlert', StockAlertSchema);
