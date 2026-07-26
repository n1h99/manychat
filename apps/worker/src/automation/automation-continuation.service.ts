import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { WorkerEnvironment } from '@omnicus/config/server';

import { DatabaseService } from '../database/database.service';
import { AutomationRuntimeService } from './automation-runtime.service';

/**
 * PostgreSQL is authoritative: this polling loop merely resumes durable
 * continuations, and may run safely in more than one worker replica.
 */
@Injectable()
export class AutomationContinuationService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(AutomationContinuationService.name);
  private scanning = false;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    @Inject(ConfigService) private readonly config: ConfigService<WorkerEnvironment, true>,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AutomationRuntimeService) private readonly runtime: AutomationRuntimeService,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(
      () => void this.scanOnce(),
      this.config.get('AUTOMATION_CONTINUATION_INTERVAL_MS', { infer: true }),
    );
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async scanOnce(now = new Date()): Promise<void> {
    if (this.scanning) return;
    this.scanning = true;
    try {
      const take = this.config.get('AUTOMATION_CONTINUATION_BATCH_SIZE', { infer: true });
      const [delays, waits] = await Promise.all([
        this.database.client.delayedAction.findMany({
          orderBy: { nextAttemptAt: 'asc' },
          select: { id: true },
          take,
          where: { nextAttemptAt: { lte: now }, status: 'PENDING' },
        }),
        this.database.client.waitState.findMany({
          orderBy: { expiresAt: 'asc' },
          select: { id: true },
          take,
          where: { expiresAt: { lte: now }, status: 'ACTIVE' },
        }),
      ]);
      for (const delay of delays) await this.runtime.resumeDelayedAction(delay.id);
      for (const wait of waits) await this.runtime.timeoutWait(wait.id);
      this.logger.log({
        delays: delays.length,
        message: 'automation_continuation_scan',
        waits: waits.length,
      });
    } catch {
      this.logger.warn({ message: 'automation_continuation_scan_failed' });
    } finally {
      this.scanning = false;
    }
  }
}
