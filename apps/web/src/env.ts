import { validateWebEnvironment } from '@omnicus/config/web';

export function readWebEnvironment() {
  return validateWebEnvironment(import.meta.env, { production: import.meta.env.PROD });
}

export function selectApiBaseUrl(
  configuredApiUrl: string,
  production: boolean,
  browserOrigin?: string,
): string {
  return production && browserOrigin ? browserOrigin : configuredApiUrl;
}

export function readApiBaseUrl(): string {
  const environment = readWebEnvironment();
  return selectApiBaseUrl(
    environment.VITE_API_URL,
    import.meta.env.PROD,
    globalThis.location?.origin,
  );
}
