import mongoose, { Schema, Document } from 'mongoose';

export interface ISettings extends Document<string> {
  _id: string;
  shopId: string;
  defaultLowStockThreshold: number;
  defaultLeadTimeDays: number;
  defaultSafetyStockDays: number;
  salesVelocityDays: number;
  locationScope: string;
  emailEnabled: boolean;
  notificationEmail: string;
  dailyDigest: boolean;
  productOverrides: Record<string, {
    lowStockThreshold?: number;
    leadTimeDays?: number;
    safetyStockDays?: number;
  }>;
  overdueThresholdHours?: number;
  warningLeadTimeHours?: number;
  createdAt: Date;
  updatedAt: Date;
}

const SettingsSchema: Schema = new Schema(
  {
    _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
    shopId: { type: String, required: true, unique: true, index: true },
    defaultLowStockThreshold: { type: Number, default: 10 },
    defaultLeadTimeDays: { type: Number, default: 7 },
    defaultSafetyStockDays: { type: Number, default: 5 },
    salesVelocityDays: { type: Number, default: 30 },
    locationScope: { type: String, default: 'all' },
    emailEnabled: { type: Boolean, default: true },
    notificationEmail: { type: String, default: 'merchant@example.com' },
    dailyDigest: { type: Boolean, default: false },
    productOverrides: { type: Schema.Types.Mixed, default: {} },
    overdueThresholdHours: { type: Number, default: 24 },
    warningLeadTimeHours: { type: Number, default: 4 },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model<ISettings>('Settings', SettingsSchema);
