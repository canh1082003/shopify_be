import { connectDatabase, disconnectDatabase, isDatabaseConnected } from '../databases';

export const connectMongo = connectDatabase;
export const disconnectMongo = disconnectDatabase;
export const isMongoConnected = isDatabaseConnected;
