import mongoose, { Schema, Document } from 'mongoose';

export interface IAlert extends Document<string> {
  _id: string;
  shopId: string;
  orderId: string;
  orderNumber: string;
  severity: 'warning' | 'critical' | 'resolved';
  status: 'active' | 'acknowledged' | 'resolved';
  reason: string;
  elapsedHours: number;
  thresholdHours: number;
  acknowledgedAt?: Date | null;
  resolvedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const AlertSchema: Schema = new Schema(
  {
    _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
    shopId: { type: String, required: true, index: true },
    orderId: { type: String, required: true, index: true },
    orderNumber: { type: String, required: true },
    severity: { type: String, enum: ['warning', 'critical', 'resolved'], required: true },
    status: { type: String, enum: ['active', 'acknowledged', 'resolved'], default: 'active', required: true },
    reason: { type: String, required: true },
    elapsedHours: { type: Number, default: 0 },
    thresholdHours: { type: Number, default: 24 },
    acknowledgedAt: { type: Date, default: null },
    resolvedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
  }
);

AlertSchema.index({ shopId: 1, status: 1 });
AlertSchema.index({ shopId: 1, severity: 1 });
AlertSchema.index({ shopId: 1, createdAt: -1 });

export default mongoose.model<IAlert>('Alert', AlertSchema);
