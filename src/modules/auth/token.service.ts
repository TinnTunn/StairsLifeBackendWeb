import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

/**
 * TokenService — pembungkus tipis di atas JwtService untuk men-sign
 * dan verifikasi REFRESH TOKEN dengan secret terpisah dari access token.
 *
 * Kenapa terpisah?
 * - Access token bocor (misalnya via XSS sebelum kita pasang esc()) tidak
 *   otomatis berarti penyerang bisa palsukan refresh token.
 * - Memungkinkan rotate refresh-secret tanpa logout semua sesi access.
 *
 * Implementasi: kita inject JwtService standar (untuk access token, dibuat
 * di AuthModule), plus secret refresh dari env. Untuk verify/sign refresh
 * kita pakai jsonwebtoken via JwtService.sign() tapi override secret-nya.
 *
 * Fallback: kalau JWT_REFRESH_SECRET tidak di-set, otomatis pakai
 * JWT_SECRET (perilaku lama). Ini supaya deployment lama tidak mendadak
 * broken — tapi log warning supaya admin tahu.
 */
@Injectable()
export class TokenService {
  private readonly accessSecret: string;
  private readonly refreshSecret: string;
  private readonly accessExpiresIn: string;
  private readonly refreshExpiresIn: string;

  constructor(
    private jwtService: JwtService,
    private config: ConfigService,
  ) {
    const access = this.config.get<string>('JWT_SECRET');
    if (!access) {
      throw new Error('JWT_SECRET wajib di-set');
    }
    this.accessSecret = access;

    const refresh = this.config.get<string>('JWT_REFRESH_SECRET');
    if (!refresh) {
      console.warn(
        '⚠️  JWT_REFRESH_SECRET belum di-set — fallback ke JWT_SECRET. ' +
          'Untuk produksi, set JWT_REFRESH_SECRET yang BERBEDA dari JWT_SECRET ' +
          'agar token bocor di salah satu lapisan tidak bisa dipakai di lapisan lain.',
      );
    }
    this.refreshSecret = refresh ?? access;

    // Default pendek: access token stateless tak bisa di-revoke, jadi TTL
    // pendek membatasi paparan token bocor / user suspended. Refresh (30d)
    // menangani UX; FE proactive-refresh sebelum expire. Override via env.
    this.accessExpiresIn = this.config.get<string>('JWT_EXPIRES_IN') ?? '60m';
    this.refreshExpiresIn =
      this.config.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '30d';
  }

  signAccess(payload: Record<string, any>): string {
    // jwtService di-config dengan access secret default — pakai dia.
    return this.jwtService.sign(payload, {
      secret: this.accessSecret,
      expiresIn: this.accessExpiresIn as any,
    });
  }

  signRefresh(payload: Record<string, any>): string {
    return this.jwtService.sign(
      { ...payload, type: 'refresh' },
      {
        secret: this.refreshSecret,
        expiresIn: this.refreshExpiresIn as any,
      },
    );
  }

  verifyRefresh(token: string): any {
    return this.jwtService.verify(token, { secret: this.refreshSecret });
  }
}
