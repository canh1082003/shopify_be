import mongoose, { Schema, Document } from 'mongoose';

export interface ISettings extends Document<string> {
  _id: string;
  shopId: string;
  overdueThresholdHours: number;
  warningLeadTimeHours: number;
  emailEnabled: boolean;
  notificationEmail: string;
  digestFrequency: 'immediate' | 'daily' | 'hourly';
  autoAcknowledge: boolean;
  excludeTags: string[];
  createdAt: Date;
  updatedAt: Date;
}

const SettingsSchema: Schema = new Schema(
  {
    _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
    shopId: { type: String, required: true, unique: true, index: true },
    overdueThresholdHours: { type: Number, default: 24 },
    warningLeadTimeHours: { type: Number, default: 4 },
    emailEnabled: { type: Boolean, default: true },
    notificationEmail: { type: String, default: 'merchant@example.com' },
    digestFrequency: { type: String, enum: ['immediate', 'daily', 'hourly'], default: 'immediate' },
    autoAcknowledge: { type: Boolean, default: false },
    excludeTags: { type: [String], default: [] },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model<ISettings>('Settings', SettingsSchema);
