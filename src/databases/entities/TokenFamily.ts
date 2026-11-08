import mongoose, { Schema, Document } from 'mongoose';

export interface ITokenFamily extends Document<string> {
  _id: string; // familyId (UUID e.g. fam-...)
  shopId: string;
  currentJti: string;
  previousJti?: string | null;
  rotatedAt?: Date | null;
  revoked: boolean;
  revokedReason?: string | null;
  createdAt: Date;
  updatedAt: Date;
  absoluteExpiresAt: number; // Unix timestamp (seconds) for application-level authorization
  ttlExpiresAt: Date; // BSON Date for MongoDB background TTL cleanup
}

const TokenFamilySchema: Schema = new Schema(
  {
    _id: { type: String, required: true },
    shopId: { type: String, required: true, index: true },
    currentJti: { type: String, required: true },
    previousJti: { type: String, default: null },
    rotatedAt: { type: Date, default: null },
    revoked: { type: Boolean, default: false, index: true },
    revokedReason: { type: String, default: null },
    absoluteExpiresAt: { type: Number, required: true },
    ttlExpiresAt: { type: Date, required: true },
  },
  {
    timestamps: true,
  }
);

// Background scavenger: automatically deletes documents when current time exceeds ttlExpiresAt
TokenFamilySchema.index({ ttlExpiresAt: 1 }, { expireAfterSeconds: 0 });

// Compound index for shop-scoped queries, tenant isolation, and mass revocation
TokenFamilySchema.index({ shopId: 1, revoked: 1 });

export default mongoose.model<ITokenFamily>('TokenFamily', TokenFamilySchema);

