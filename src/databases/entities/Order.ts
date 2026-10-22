import mongoose, { Schema, Document } from 'mongoose';

export interface ILineItem {
  id: string;
  title: string;
  quantity: number;
  fulfillableQuantity: number;
  price: number;
  sku?: string;
}

export interface IOrder extends Document<string> {
  _id: string;
  shopId: string;
  shopifyOrderId: string;
  orderNumber: string;
  name: string;
  customerName?: string | null;
  customerEmail?: string | null;
  financialStatus: string;
  fulfillmentStatus: string;
  totalAmount: number;
  currencyCode: string;
  totalItems: number;
  fulfillableQuantity: number;
  lineItems: ILineItem[];
  deadline?: Date | null;
  isOverdue: boolean;
  overdueMinutes: number;
  shopifyUrl?: string | null;
  processedAt?: Date | null;
  cancelledAt?: Date | null;
  lastSyncedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const LineItemSchema = new Schema(
  {
    id: { type: String, required: true },
    title: { type: String, required: true },
    quantity: { type: Number, required: true },
    fulfillableQuantity: { type: Number, required: true },
    price: { type: Number, required: true },
    sku: { type: String, default: '' },
  },
  { _id: false }
);

const OrderSchema: Schema = new Schema(
  {
    _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
    shopId: { type: String, required: true, index: true },
    shopifyOrderId: { type: String, required: true },
    orderNumber: { type: String, required: true },
    name: { type: String, required: true },
    customerName: { type: String, default: null },
    customerEmail: { type: String, default: null },
    financialStatus: { type: String, required: true },
    fulfillmentStatus: { type: String, required: true },
    totalAmount: { type: Number, default: 0 },
    currencyCode: { type: String, default: 'USD' },
    totalItems: { type: Number, default: 1 },
    fulfillableQuantity: { type: Number, default: 1 },
    lineItems: { type: [LineItemSchema], default: [] },
    deadline: { type: Date, default: null },
    isOverdue: { type: Boolean, default: false },
    overdueMinutes: { type: Number, default: 0 },
    shopifyUrl: { type: String, default: null },
    processedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    lastSyncedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
  }
);

OrderSchema.index({ shopId: 1, shopifyOrderId: 1 }, { unique: true });
OrderSchema.index({ shopId: 1, isOverdue: 1 });
OrderSchema.index({ shopId: 1, fulfillmentStatus: 1 });
OrderSchema.index({ shopId: 1, createdAt: -1 });

export default mongoose.model<IOrder>('Order', OrderSchema);
