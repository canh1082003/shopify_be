import mongoose, { Schema, Document } from 'mongoose';

export interface IProduct extends Document<string> {
  _id: string;
  shopId: string;
  shopifyProductId: string;
  title: string;
  description?: string;
  vendor: string;
  productType: string;
  status: 'active' | 'draft' | 'archived';
  imageUrl?: string | null;
  tags?: string[];
  createdAt: Date;
  updatedAt: Date;
}

const ProductSchema: Schema = new Schema(
  {
    _id: { type: String, required: true },
    shopId: { type: String, required: true, index: true },
    shopifyProductId: { type: String, required: true, index: true },
    title: { type: String, required: true },
    description: { type: String },
    vendor: { type: String, default: '' },
    productType: { type: String, default: '' },
    status: { type: String, enum: ['active', 'draft', 'archived'], default: 'active' },
    imageUrl: { type: String, default: null },
    tags: { type: [String], default: [] },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model<IProduct>('Product', ProductSchema);
