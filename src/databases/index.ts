import mongoose from 'mongoose';

export const connectDatabase = async (uri?: string): Promise<boolean> => {
  const mongoUrl =
    uri ||
    process.env.MONGODB_URL ||
    process.env.mongodb_url ||
    process.env.MONGODB_URI ||
    process.env.DATABASE_URL;

  if (!mongoUrl || !mongoUrl.startsWith('mongodb')) {
    console.warn('[Database] No valid MongoDB URL found in environment.');
    return false;
  }

  try {
    await mongoose.connect(mongoUrl, {
      serverSelectionTimeoutMS: 15000,
    });
    console.info('Database connected successfully!');
    return true;
  } catch (error) {
    console.error('Database connection failed:', error);
    return false;
  }
};

export const disconnectDatabase = async (): Promise<void> => {
  try {
    await mongoose.disconnect();
    console.info('Database disconnected.');
  } catch (error) {
    console.error('Database disconnect error:', error);
  }
};

export const isDatabaseConnected = (): boolean => {
  return mongoose.connection.readyState === 1;
};

export * from './entities';
export default connectDatabase;
