import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { JwtUser } from '../types/jwt-payload.type';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>('roles', [
      context.getHandler(),
      context.getClass(),
    ]);

    // Kalau tidak ada @Roles() requirement → allow semua authenticated user
    if (!requiredRoles) return true;

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: JwtUser }>();
    const user = request.user;

    if (!user || !requiredRoles.includes(user.role)) {
      throw new ForbiddenException(
        `Akses ditolak. Diperlukan role: ${requiredRoles.join(', ')}`,
      );
    }

    return true;
  }
}
