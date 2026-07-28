import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiBody, ApiTags } from '@nestjs/swagger';
import { parseCorsOrigins, type ApiEnvironment } from '@omnicus/config/server';
import type { Response } from 'express';

import { AuthService } from './auth.service';
import { type RequestSecurityContext, type SessionTokens } from './auth.service';
import { firstHeaderValue, type AuthenticatedRequest } from './auth.types';
import { LoginDto } from './dto';
import { JwtAuthGuard } from './jwt-auth.guard';

const refreshCookieName = 'omnicus_refresh';
const csrfCookieName = 'omnicus_csrf';

function cookies(request: AuthenticatedRequest): Record<string, string> {
  const header = request.headers.cookie;
  if (!header) {
    return {};
  }
  return Object.fromEntries(
    header.split(';').flatMap((entry) => {
      const index = entry.indexOf('=');
      if (index <= 0) {
        return [];
      }
      try {
        return [[entry.slice(0, index).trim(), decodeURIComponent(entry.slice(index + 1).trim())]];
      } catch {
        return [];
      }
    }),
  );
}

@ApiTags('auth')
@Controller('api/v1/auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ConfigService) private readonly config: ConfigService<ApiEnvironment, true>,
  ) {}

  @Post('login')
  @HttpCode(200)
  @ApiBody({ type: LoginDto })
  async login(
    @Body() body: LoginDto,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.login(body.email, body.password, this.context(request));
    this.setSessionCookies(response, result.tokens);
    return {
      data: {
        accessToken: result.tokens.accessToken,
        csrfToken: result.tokens.csrfToken,
        user: result.identity,
      },
      meta: {},
    };
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.assertTrustedBrowserOrigin(request);
    const values = cookies(request);
    const result = await this.auth.refresh(
      values[refreshCookieName],
      firstHeaderValue(request.headers['x-csrf-token']),
      this.context(request),
    );
    this.setSessionCookies(response, result.tokens);
    return {
      data: {
        accessToken: result.tokens.accessToken,
        csrfToken: result.tokens.csrfToken,
        user: result.identity,
      },
      meta: {},
    };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    this.assertTrustedBrowserOrigin(request);
    const values = cookies(request);
    await this.auth.logout(
      values[refreshCookieName],
      firstHeaderValue(request.headers['x-csrf-token']),
      this.context(request),
    );
    this.clearSessionCookies(response);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('logout-all')
  @HttpCode(204)
  async logoutAll(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.auth.logoutAll(request.auth!, this.context(request));
    this.clearSessionCookies(response);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@Req() request: AuthenticatedRequest) {
    return { data: await this.auth.me(request.auth!), meta: {} };
  }

  private context(request: AuthenticatedRequest): RequestSecurityContext {
    return {
      correlationId: firstHeaderValue(request.headers['x-correlation-id']) ?? 'unavailable',
      ip: request.ip,
      userAgent: firstHeaderValue(request.headers['user-agent']),
    };
  }

  private setSessionCookies(response: Response, tokens: SessionTokens): void {
    const secure = this.secureCookies();
    const sameSite = secure ? 'none' : 'strict';
    // Clear legacy API-origin CSRF cookies. The cross-origin SPA persists the
    // response token on its own origin and sends it only as a request header.
    response.clearCookie(csrfCookieName, { path: '/api/v1/auth', sameSite: 'strict' });
    response.clearCookie(csrfCookieName, { path: '/', sameSite: 'strict' });
    response.cookie(refreshCookieName, tokens.refreshToken, {
      httpOnly: true,
      maxAge: this.config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true }) * 24 * 60 * 60 * 1_000,
      path: '/api/v1/auth',
      sameSite,
      secure,
    });
  }

  private clearSessionCookies(response: Response): void {
    const secure = this.secureCookies();
    const sameSite = secure ? 'none' : 'strict';
    response.clearCookie(csrfCookieName, { path: '/', sameSite: 'strict' });
    response.clearCookie(csrfCookieName, { path: '/api/v1/auth', sameSite: 'strict' });
    response.clearCookie(refreshCookieName, {
      httpOnly: true,
      path: '/api/v1/auth',
      sameSite,
      secure,
    });
  }

  private assertTrustedBrowserOrigin(request: AuthenticatedRequest): void {
    const allowedOrigins = parseCorsOrigins(
      this.config.get('CORS_ALLOWED_ORIGINS', { infer: true }),
    );
    const origin = firstHeaderValue(request.headers.origin);
    const referer = firstHeaderValue(request.headers.referer);
    let requestOrigin = origin;

    if (!requestOrigin && referer) {
      try {
        requestOrigin = new URL(referer).origin;
      } catch {
        requestOrigin = undefined;
      }
    }

    if (!requestOrigin || !allowedOrigins.includes(requestOrigin)) {
      throw new ForbiddenException({
        code: 'CSRF_ORIGIN_REJECTED',
        message: 'Request origin is not allowed',
      });
    }
  }

  private secureCookies(): boolean {
    return (
      this.config.get('APP_ENV', { infer: true }) !== 'development' &&
      this.config.get('APP_ENV', { infer: true }) !== 'test'
    );
  }
}
