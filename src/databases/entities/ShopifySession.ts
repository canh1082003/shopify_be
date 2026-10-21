import mongoose, { Schema, Document } from 'mongoose';

export interface IShopifySession extends Document<string> {
  _id: string;
  shopId: string;
  sessionType: 'offline' | 'online';
  encryptedAccessToken: string;
  iv: string;
  authTag: string;
  scope: string;
  expiresAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const ShopifySessionSchema: Schema = new Schema(
  {
    _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
    shopId: { type: String, required: true, index: true },
    sessionType: { type: String, enum: ['offline', 'online'], default: 'offline' },
    encryptedAccessToken: { type: String, required: true },
    iv: { type: String, required: true },
    authTag: { type: String, required: true },
    scope: { type: String, required: true },
    expiresAt: { type: Date, default: null },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model<IShopifySession>('ShopifySession', ShopifySessionSchema);
