import { z } from 'zod';

const apiUrlSchema = z
  .string()
  .url()
  .refine((value) => ['http:', 'https:'].includes(new URL(value).protocol), {
    message: 'VITE_API_URL must use HTTP or HTTPS',
  });

export interface WebEnvironmentValidationOptions {
  production: boolean;
}

export interface WebEnvironment {
  VITE_API_URL: string;
}

export function validateWebEnvironment(
  input: Record<string, unknown>,
  options: WebEnvironmentValidationOptions,
): WebEnvironment {
  return z
    .object({
      VITE_API_URL: options.production
        ? apiUrlSchema
        : apiUrlSchema.default('http://localhost:3000'),
    })
    .parse(input);
}
