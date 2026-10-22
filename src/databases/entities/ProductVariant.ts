import mongoose, { Schema, Document } from 'mongoose';

export interface IProductVariant extends Document<string> {
  _id: string;
  shopId: string;
  productId: string;
  productTitle: string;
  productImage?: string | null;
  shopifyVariantId: string;
  inventoryItemId: string;
  sku: string;
  title: string;
  price: number;
  costPrice: number;
  tracked: boolean;
  barcode?: string | null;
  locationId: string;
  locationName: string;
  availableQuantity: number;
  committedQuantity: number;
  averageDailySales: number;
  daysRemaining: number | null;
  status: string;
  lowStockThreshold: number;
  leadTimeDays: number;
  safetyStockDays: number;
  recommendedRestockQuantity: number;
  createdAt: Date;
  updatedAt: Date;
}

const ProductVariantSchema: Schema = new Schema(
  {
    _id: { type: String, required: true },
    shopId: { type: String, required: true, index: true },
    productId: { type: String, required: true, index: true },
    productTitle: { type: String, required: true },
    productImage: { type: String, default: null },
    shopifyVariantId: { type: String, required: true, index: true },
    inventoryItemId: { type: String, required: true, index: true },
    sku: { type: String, default: '', index: true },
    title: { type: String, default: 'Default Title' },
    price: { type: Number, default: 0 },
    costPrice: { type: Number, default: 0 },
    tracked: { type: Boolean, default: true },
    barcode: { type: String, default: null },
    locationId: { type: String, default: 'loc-main' },
    locationName: { type: String, default: 'Main Warehouse' },
    availableQuantity: { type: Number, default: 0 },
    committedQuantity: { type: Number, default: 0 },
    averageDailySales: { type: Number, default: 0 },
    daysRemaining: { type: Number, default: null },
    status: { type: String, default: 'healthy', index: true },
    lowStockThreshold: { type: Number, default: 10 },
    leadTimeDays: { type: Number, default: 7 },
    safetyStockDays: { type: Number, default: 5 },
    recommendedRestockQuantity: { type: Number, default: 0 },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model<IProductVariant>('ProductVariant', ProductVariantSchema);
