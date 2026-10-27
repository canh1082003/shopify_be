import mongoose, { Schema, Document } from 'mongoose';

export interface IProductImage {
  id?: string;
  url: string;
  alt?: string;
  position?: number;
  width?: number;
  height?: number;
}

export interface IProductOption {
  id?: string;
  name: string;
  position?: number;
  values: string[];
}

export interface IProductSEO {
  title?: string;
  description?: string;
}

export interface IProduct extends Document<string> {
  _id: string;
  shopId: string;
  shopifyProductId: string;
  title: string;
  handle?: string;
  description?: string;
  vendor: string;
  productType: string;
  category?: string;
  productKind: 'physical' | 'digital' | 'service' | 'bundle';
  status: 'active' | 'draft' | 'archived';
  imageUrl?: string | null;
  images: IProductImage[];
  options: IProductOption[];
  tags: string[];
  attributes: Record<string, any>; // Flexible metadata for any product niche (Tech specs, expiry, ingredients, etc.)
  hasVariants: boolean;
  seo?: IProductSEO;
  publishedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const ProductImageSchema = new Schema(
  {
    id: { type: String },
    url: { type: String, required: true },
    alt: { type: String, default: '' },
    position: { type: Number, default: 1 },
    width: { type: Number },
    height: { type: Number },
  },
  { _id: false }
);

const ProductOptionSchema = new Schema(
  {
    id: { type: String },
    name: { type: String, required: true },
    position: { type: Number, default: 1 },
    values: { type: [String], default: [] },
  },
  { _id: false }
);

const ProductSchema: Schema = new Schema(
  {
    _id: { type: String, required: true },
    shopId: { type: String, required: true, index: true },
    shopifyProductId: { type: String, required: true, index: true },
    title: { type: String, required: true, index: true },
    handle: { type: String, index: true },
    description: { type: String, default: '' },
    vendor: { type: String, default: '', index: true },
    productType: { type: String, default: '', index: true },
    category: { type: String, default: '' },
    productKind: {
      type: String,
      enum: ['physical', 'digital', 'service', 'bundle'],
      default: 'physical',
      index: true,
    },
    status: {
      type: String,
      enum: ['active', 'draft', 'archived'],
      default: 'active',
      index: true,
    },
    imageUrl: { type: String, default: null },
    images: { type: [ProductImageSchema], default: [] },
    options: { type: [ProductOptionSchema], default: [] },
    tags: { type: [String], default: [], index: true },
    attributes: { type: Schema.Types.Mixed, default: {} },
    hasVariants: { type: Boolean, default: false },
    seo: {
      title: { type: String },
      description: { type: String },
    },
    publishedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    minimize: false,
  }
);

export default mongoose.model<IProduct>('Product', ProductSchema);
