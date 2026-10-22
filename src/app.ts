import express, { Application } from 'express';
import cors from 'cors';
import { config } from './config';
import { requestLogger } from './middleware/logger.middleware';
import { notFoundHandler, errorHandler } from './middleware/error.middleware';
import apiRoutes from './routes/api.routes';

const app: Application = express();

// Middleware: CORS configuration
const allowedOrigins = [
  config.clientOrigin,
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, curl, postman)
      if (!origin) return callback(null, true);
      if (allowedOrigins.indexOf(origin) !== -1 || !config.isProduction) {
        return callback(null, true);
      }
      return callback(new Error('Blocked by CORS policy'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  })
);

// Middleware: Body parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Middleware: Custom Logger
app.use(requestLogger);

// Base route for quick server status verification
app.get('/', (_req, res) => {
  res.json({
    status: 'online',
    service: 'StockPilot - Shopify Inventory & Order Management API',
    version: '1.0.0',
    documentation: '/api',
  });
});

// Main API Router
app.use('/api', apiRoutes);

// 404 & Centralized Error Handlers
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
