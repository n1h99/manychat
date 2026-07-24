import { validateWebEnvironment } from '@omnicus/config/web';

export function readWebEnvironment() {
  return validateWebEnvironment(import.meta.env, { production: import.meta.env.PROD });
}
