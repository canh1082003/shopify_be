import mongoose, { Schema, Document } from 'mongoose';

export interface IShop extends Document {
  shopDomain: string;
  shopifyShopId?: string | null;
  name: string;
  email?: string | null;
  timezone: string;
  currency: string;
  plan: string;
  installedAt: Date;
  uninstalledAt?: Date | null;
  isDemo: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ShopSchema: Schema = new Schema(
  {
    shopDomain: { type: String, required: true, unique: true, index: true },
    shopifyShopId: { type: String, default: null },
    name: { type: String, required: true },
    email: { type: String, default: null },
    timezone: { type: String, default: 'UTC' },
    currency: { type: String, default: 'USD' },
    plan: { type: String, default: 'basic' },
    installedAt: { type: Date, default: Date.now },
    uninstalledAt: { type: Date, default: null },
    isDemo: { type: Boolean, default: false },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model<IShop>('Shop', ShopSchema);
