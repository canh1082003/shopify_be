import mongoose from 'mongoose';

let isConnected = false;

export async function connectMongo(uri?: string): Promise<boolean> {
  let mongoUri =
    uri ||
    process.env.MONGODB_URL ||
    process.env.mongodb_url ||
    process.env.MONGODB_URI ||
    process.env.DATABASE_URL;

  if (!mongoUri || !mongoUri.startsWith('mongodb')) {
    console.log('[MongoDB] No valid MONGODB_URI found in environment, skipping MongoDB connection.');
    return false;
  }

  // Ensure database name is set if url ends with trailing slash
  if (mongoUri.endsWith('/')) {
    mongoUri = `${mongoUri}shopify_order_watchdog?retryWrites=true&w=majority`;
  }

  if (isConnected) {
    return true;
  }

  try {
    console.log('[MongoDB] Connecting to MongoDB Atlas with URI:', mongoUri.replace(/:[^:]*@/, ':****@'));
    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 15000,
    });

    isConnected = true;
    console.log('[MongoDB] Successfully connected to MongoDB Atlas!');
    return true;
  } catch (error) {
    console.error('[MongoDB] Connection error:', error);
    isConnected = false;
    return false;
  }
}

export function isMongoConnected(): boolean {
  return isConnected && mongoose.connection.readyState === 1;
}

export async function disconnectMongo(): Promise<void> {
  if (isConnected) {
    await mongoose.disconnect();
    isConnected = false;
    console.log('[MongoDB] Disconnected from MongoDB.');
  }
}
