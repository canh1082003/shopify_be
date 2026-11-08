import mongoose from 'mongoose';

// Test isolation flag to explicitly prevent any production/remote database access during testing
let isTestIsolationActive = false;

// Driver-level references for safe restoration if needed
const originalMongooseConnect = mongoose.connect.bind(mongoose);
const originalMongooseCreateConnection = mongoose.createConnection.bind(mongoose);

export const setTestDatabaseIsolation = (enabled: boolean): void => {
  isTestIsolationActive = enabled;
  if (enabled) {
    if (mongoose.connection.readyState !== 0) {
      mongoose.disconnect().catch(() => {});
    }

    // Intercept direct mongoose.connect calls to prevent network traffic.
    // Throws an explicit error instead of returning a misleading fake connection object.
    (mongoose as any).connect = async () => {
      throw new Error('[Database Test Guard] Direct mongoose.connect() is blocked in test mode.');
    };

    // Intercept direct mongoose.createConnection calls to prevent network traffic.
    (mongoose as any).createConnection = () => {
      throw new Error('[Database Test Guard] Direct mongoose.createConnection() is blocked in test mode.');
    };
  } else {
    (mongoose as any).connect = originalMongooseConnect;
    (mongoose as any).createConnection = originalMongooseCreateConnection;
  }
};

export const isTestIsolationEnabled = (): boolean => {
  return (
    isTestIsolationActive ||
    process.env.STOCKPILOT_TEST_ENV === 'true' ||
    process.env.STOCKPILOT_ISOLATE_STORAGE === 'true' ||
    process.env.NODE_ENV === 'test' ||
    process.argv.some((arg) => arg.includes('--test') || arg.includes('.test.'))
  );
};

export const connectDatabase = async (uri?: string): Promise<boolean> => {
  // Explicitly prevent any database connections when running under test isolation
  if (isTestIsolationEnabled()) {
    console.info('[Database] MongoDB connections blocked: Test storage isolation is active.');
    return false;
  }

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
  if (isTestIsolationEnabled()) {
    return false;
  }
  return mongoose.connection.readyState === 1;
};

export * from './entities';
export default connectDatabase;
