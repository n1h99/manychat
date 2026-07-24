# Railway configuration

Stage 0 defines three independent Railway services from the same monorepo. No
deployment has been performed.

## Service configuration

For each service, keep the repository root as the source directory and select the
following Railway config file:

| Service | Config file                 | Start command       | Healthcheck     |
| ------- | --------------------------- | ------------------- | --------------- |
| web     | `/apps/web/railway.toml`    | `pnpm start:web`    | `/health/live`  |
| api     | `/apps/api/railway.toml`    | `pnpm start:api`    | `/health/ready` |
| worker  | `/apps/worker/railway.toml` | `pnpm start:worker` | `/health/ready` |

The web production server serves the built SPA and exposes a liveness endpoint.
API readiness requires PostgreSQL and Redis. Worker readiness requires Redis.

## Variables

### API

| Variable               | Required | Notes                             |
| ---------------------- | -------: | --------------------------------- |
| `NODE_ENV`             |      yes | `production`                      |
| `APP_ENV`              |      yes | `production` or `staging`         |
| `DATABASE_URL`         |      yes | PostgreSQL private connection URL |
| `REDIS_URL`            |      yes | Redis private connection URL      |
| `API_HOST`             |       no | defaults to `0.0.0.0`             |
| `API_PORT`             |       no | local default `3000`              |
| `PORT`                 | supplied | assigned by Railway               |
| `CORS_ALLOWED_ORIGINS` |      yes | comma-separated exact web origins |

### Worker

| Variable       | Required | Notes                                           |
| -------------- | -------: | ----------------------------------------------- |
| `NODE_ENV`     |      yes | `production`                                    |
| `APP_ENV`      |      yes | `production` or `staging`                       |
| `DATABASE_URL` |      yes | reserved for transactional work in later stages |
| `REDIS_URL`    |      yes | BullMQ connection                               |
| `WORKER_HOST`  |       no | defaults to `0.0.0.0`                           |
| `WORKER_PORT`  |       no | local default `3001`                            |
| `PORT`         | supplied | assigned by Railway                             |

### Web

| Variable       | Required | Notes                                    |
| -------------- | -------: | ---------------------------------------- |
| `VITE_API_URL` |      yes | public API origin, embedded during build |
| `PORT`         | supplied | read by the production static server     |

Do not copy local credentials into Railway variables. PostgreSQL and Redis
references should be configured through Railway service variables. Stage 1 will
document cookie domains and CSRF configuration before Auth is implemented.

## Deployment gate

Before a first deployment:

1. all CI checks must pass from the lockfile;
2. the initial Prisma migration SQL must be reviewed separately;
3. backup/restore verification steps must be completed and recorded;
4. deployment requires explicit approval.
