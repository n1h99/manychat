import type { NextFunction, Request, Response } from 'express';

export function createSecurityHeadersMiddleware(swaggerEnabled: boolean) {
  return (request: Request, response: Response, next: NextFunction): void => {
    const isSwaggerRequest =
      swaggerEnabled && (request.path === '/docs' || request.path.startsWith('/docs/'));
    const contentSecurityPolicy = isSwaggerRequest
      ? [
          "default-src 'self'",
          "base-uri 'self'",
          "frame-ancestors 'none'",
          "img-src 'self' data:",
          "object-src 'none'",
          "script-src 'self' 'unsafe-inline'",
          "style-src 'self' 'unsafe-inline'",
        ].join('; ')
      : "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'";

    response.setHeader('Content-Security-Policy', contentSecurityPolicy);
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    response.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=()');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    next();
  };
}
