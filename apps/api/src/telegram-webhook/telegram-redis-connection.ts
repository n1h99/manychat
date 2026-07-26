import type { RedisOptions } from 'bullmq';

export function redisConnectionFromUrl(value: string): RedisOptions {
  const url = new URL(value);
  const database = url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0;

  if (!Number.isInteger(database) || database < 0) {
    throw new Error('REDIS_URL contains an invalid database index');
  }

  return {
    db: database,
    host: url.hostname,
    ...(url.password.length > 0 ? { password: decodeURIComponent(url.password) } : {}),
    port: url.port.length > 0 ? Number(url.port) : 6379,
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
    ...(url.username.length > 0 ? { username: decodeURIComponent(url.username) } : {}),
  };
}
