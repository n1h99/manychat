import { validateWebEnvironment } from '@omnicus/config';

export const webEnvironment = validateWebEnvironment(import.meta.env);
