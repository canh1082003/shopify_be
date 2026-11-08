/**
 * Test Environment Isolation Preload
 * 
 * ZERO IMPORTS ALLOWED IN THIS FILE.
 * Executing this guarantees environment variables and credential purging happen
 * synchronously and deterministically before any module resolution begins.
 */

// 1. Enforce test isolation flags deterministically
process.env.STOCKPILOT_TEST_ENV = 'true';
process.env.STOCKPILOT_ISOLATE_STORAGE = 'true';
process.env.NODE_ENV = 'test';

// 2. Scrub production database credentials from process.env
delete process.env.MONGODB_URL;
delete process.env.mongodb_url;
delete process.env.MONGODB_URI;
delete process.env.DATABASE_URL;

// 3. Provide deterministic mock credentials for offline testing and CI runners
if (!process.env.SHOPIFY_API_KEY) {
  process.env.SHOPIFY_API_KEY = 'test_mock_shopify_api_key_ci';
}
if (!process.env.SHOPIFY_API_SECRET) {
  process.env.SHOPIFY_API_SECRET = 'test_mock_shopify_api_secret_ci_shpss_123456';
}


