import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { JwtPayload, JwtUser } from '../../../common/types/jwt-payload.type';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    const secret = configService.get<string>('JWT_SECRET');
    if (!secret) {
      throw new Error(
        'JWT_SECRET tidak di-set di environment. ' +
          'Tambahkan JWT_SECRET ke file .env (lihat .env.example).',
      );
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  validate(payload: JwtPayload & { type?: string }): JwtUser {
    // Refresh token tidak boleh dipakai untuk authentication ke endpoint biasa.
    // Hanya endpoint /auth/refresh yang menerima refresh token (via body, bukan
    // via Authorization header).
    if (payload.type === 'refresh') {
      throw new UnauthorizedException(
        'Refresh token tidak bisa dipakai untuk akses endpoint',
      );
    }

    return {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
    };
  }
}
