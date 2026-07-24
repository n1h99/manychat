export const DEMO_QUEUE_NAME = 'system-health';
export const DEMO_JOB_NAME = 'demo-job';

export interface DemoJobInput {
  requestedAt: string;
}

export interface DemoJobResult {
  processedAt: string;
  requestedAt: string;
  status: 'ok';
}

export function executeDemoJob(input: DemoJobInput): DemoJobResult {
  return {
    processedAt: new Date().toISOString(),
    requestedAt: input.requestedAt,
    status: 'ok',
  };
}
