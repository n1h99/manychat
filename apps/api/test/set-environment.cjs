process.env.NODE_ENV ??= 'test';
process.env.APP_ENV ??= 'test';
process.env.CORS_ALLOWED_ORIGINS ??= 'http://localhost:5173';
process.env.DATABASE_URL ??= 'postgresql://omnicus:omnicus@127.0.0.1:5432/omnicus_test';
process.env.REDIS_URL ??= 'redis://127.0.0.1:6379';
process.env.JWT_ACCESS_SECRET ??= 'test-only-jwt-secret-that-is-long-enough-for-validation';
