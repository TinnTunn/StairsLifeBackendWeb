import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { JwtUser } from '../types/jwt-payload.type';

/**
 * @CurrentUser() — extract user dari JWT token yang sudah di-validate.
 * Return type: JwtUser { id, email, role }
 * Diisi oleh JwtStrategy.validate() via Passport.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtUser => {
    const request = ctx
      .switchToHttp()
      .getRequest<Request & { user: JwtUser }>();
    return request.user;
  },
);
