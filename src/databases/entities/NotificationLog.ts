import mongoose, { Schema, Document } from 'mongoose';

export interface INotificationLog extends Document<string> {
  _id: string;
  shopId: string;
  alertId?: string | null;
  recipient: string;
  subject: string;
  deliveryStatus: 'sent' | 'failed' | 'simulated_no_credentials';
  errorMessage?: string | null;
  sentAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const NotificationLogSchema: Schema = new Schema(
  {
    _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
    shopId: { type: String, required: true, index: true },
    alertId: { type: String, default: null },
    recipient: { type: String, required: true },
    subject: { type: String, required: true },
    deliveryStatus: {
      type: String,
      enum: ['sent', 'failed', 'simulated_no_credentials'],
      required: true,
    },
    errorMessage: { type: String, default: null },
    sentAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
  }
);

NotificationLogSchema.index({ shopId: 1, sentAt: -1 });

export default mongoose.model<INotificationLog>('NotificationLog', NotificationLogSchema);
