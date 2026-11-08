import mongoose, { Schema, Document } from 'mongoose';

export interface IOAuthTransaction extends Document<string> {
  _id: string; // nonce (32-hex character transaction identifier)
  stateHash: string; // SHA-256 of the complete state string
  shopDomain: string; // Target shop domain
  browserNonceHash: string; // SHA-256 of the browser-bound cookie nonce
  expiresAt: Date; // Timestamp when this transaction expires
  consumedAt: Date | null; // Timestamp when consumed, or null if pending
  createdAt: Date;
  updatedAt: Date;
}

const OAuthTransactionSchema: Schema = new Schema(
  {
    _id: { type: String, required: true },
    stateHash: { type: String, required: true },
    shopDomain: { type: String, required: true, index: true },
    browserNonceHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    consumedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
  }
);

// TTL Index: MongoDB automatically removes documents when current time exceeds expiresAt
OAuthTransactionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Compound Index for atomic conditional consumption: findOneAndUpdate({ _id, shopDomain, consumedAt: null, ... })
OAuthTransactionSchema.index({ _id: 1, shopDomain: 1, consumedAt: 1 });

export default mongoose.model<IOAuthTransaction>('OAuthTransaction', OAuthTransactionSchema);

