import mongoose, { Schema, Document } from 'mongoose';

export interface IVariantOption {
  name: string;
  value: string;
}

export interface IInventoryLocationLevel {
  locationId: string;
  locationName: string;
  availableQuantity: number;
  committedQuantity: number;
  incomingQuantity: number;
  onHandQuantity?: number;
  lastSyncedAt?: Date;
}

export interface IVariantDimensions {
  length?: number;
  width?: number;
  height?: number;
  unit?: string;
}

export interface IProductVariant extends Document<string> {
  _id: string;
  shopId: string;
  productId: string;
  productTitle: string;
  productImage?: string | null;
  shopifyVariantId: string;
  inventoryItemId: string;
  sku: string;
  barcode?: string | null;
  title: string;
  price: number;
  compareAtPrice?: number | null;
  costPrice: number;
  tracked: boolean;
  requiresShipping: boolean;
  taxable: boolean;
  weight?: number;
  weightUnit?: string;
  dimensions?: IVariantDimensions;
  selectedOptions: IVariantOption[];
  locationId: string;
  locationName: string;
  locationLevels: IInventoryLocationLevel[];
  availableQuantity: number;
  committedQuantity: number;
  averageDailySales: number;
  daysRemaining: number | null;
  status: string;
  lowStockThreshold: number;
  leadTimeDays: number;
  safetyStockDays: number;
  recommendedRestockQuantity: number;
  attributes: Record<string, any>; // Serial numbers, warranty period, batch info, custom fields
  createdAt: Date;
  updatedAt: Date;
}

const VariantOptionSchema = new Schema(
  {
    name: { type: String, required: true },
    value: { type: String, required: true },
  },
  { _id: false }
);

const LocationLevelSchema = new Schema(
  {
    locationId: { type: String, required: true },
    locationName: { type: String, default: 'Warehouse' },
    availableQuantity: { type: Number, default: 0 },
    committedQuantity: { type: Number, default: 0 },
    incomingQuantity: { type: Number, default: 0 },
    onHandQuantity: { type: Number, default: 0 },
    lastSyncedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

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
    barcode: { type: String, default: null, index: true },
    title: { type: String, default: 'Default Title' },
    price: { type: Number, default: 0 },
    compareAtPrice: { type: Number, default: null },
    costPrice: { type: Number, default: 0 },
    tracked: { type: Boolean, default: true },
    requiresShipping: { type: Boolean, default: true },
    taxable: { type: Boolean, default: true },
    weight: { type: Number, default: 0 },
    weightUnit: { type: String, enum: ['kg', 'g', 'lb', 'oz'], default: 'kg' },
    dimensions: {
      length: { type: Number },
      width: { type: Number },
      height: { type: Number },
      unit: { type: String, default: 'cm' },
    },
    selectedOptions: { type: [VariantOptionSchema], default: [] },
    locationId: { type: String, default: 'loc-main' },
    locationName: { type: String, default: 'Main Warehouse' },
    locationLevels: { type: [LocationLevelSchema], default: [] },
    availableQuantity: { type: Number, default: 0 },
    committedQuantity: { type: Number, default: 0 },
    averageDailySales: { type: Number, default: 0 },
    daysRemaining: { type: Number, default: null },
    status: { type: String, default: 'healthy', index: true },
    lowStockThreshold: { type: Number, default: 10 },
    leadTimeDays: { type: Number, default: 7 },
    safetyStockDays: { type: Number, default: 5 },
    recommendedRestockQuantity: { type: Number, default: 0 },
    attributes: { type: Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: true,
    minimize: false,
  }
);

export default mongoose.model<IProductVariant>('ProductVariant', ProductVariantSchema);
