import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import * as crypto from 'crypto';

/**
 * VerificationTokenService — kelola token email verification & password reset.
 *
 * Prinsip keamanan:
 * - Kita NEVER simpan token mentah di DB. Token mentah hanya ada di
 *   memory + di email user. DB simpan SHA-256 hash.
 * - Token mentah = 32 bytes random base64url (43 char). Cukup entropy
 *   untuk tidak bisa di-brute-force (~256 bit).
 * - Saat verify, hash input, lookup by hash. Constant-time, tidak bocor
 *   informasi "token X ada di DB" lewat timing attack.
 * - Token single-use: setelah `used_at` di-set, lookup harus skip.
 * - Token bisa expire. Cleanup row expired secara berkala (cron).
 *
 * Kenapa hash, bukan plain?
 * - Kalau DB bocor (mis. backup terbaca attacker), attacker masih TIDAK BISA
 *   pakai token tersimpan (mereka cuma punya hash, butuh preimage untuk
 *   pakai endpoint verify).
 */

const TOKEN_BYTES = 32;
const TTL_EMAIL_VERIFICATION_MS = 24 * 60 * 60 * 1000; // 24 jam
const TTL_PASSWORD_RESET_MS = 60 * 60 * 1000; // 1 jam

export type TokenType = 'email_verification' | 'password_reset';

@Injectable()
export class VerificationTokenService {
  constructor(private prisma: PrismaService) {}

  /**
   * Buat token baru untuk user. Return token MENTAH (untuk dikirim ke email).
   * Hash-nya disimpan di DB.
   *
   * Side effect: invalidate semua token type yang sama untuk user ini
   * (yang masih unused). Mencegah user pakai email verify lama setelah
   * minta resend.
   */
  async create(args: {
    userId: string;
    type: TokenType;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<{ rawToken: string; expiresAt: Date }> {
    // 1. Invalidate token unused sebelumnya untuk user+type ini
    await this.prisma.verification_tokens.updateMany({
      where: {
        user_id: args.userId,
        type: args.type,
        used_at: null,
        expires_at: { gt: new Date() },
      },
      data: { used_at: new Date() },
    });

    // 2. Generate token baru
    const rawToken = this._generateToken();
    const tokenHash = this._hashToken(rawToken);
    const ttl =
      args.type === 'email_verification'
        ? TTL_EMAIL_VERIFICATION_MS
        : TTL_PASSWORD_RESET_MS;
    const expiresAt = new Date(Date.now() + ttl);

    await this.prisma.verification_tokens.create({
      data: {
        user_id: args.userId,
        token_hash: tokenHash,
        type: args.type,
        expires_at: expiresAt,
        ip_address: args.ipAddress ?? null,
        user_agent: args.userAgent ?? null,
      },
    });

    return { rawToken, expiresAt };
  }

  /**
   * Konsumsi token: cari → cek valid → mark used.
   * Throw null kalau invalid (caller lempar BadRequestException).
   *
   * IDEMPOTEN per token: kalau dipanggil dua kali dengan token yang sama,
   * call kedua return null (sudah used).
   */
  async consume(args: {
    rawToken: string;
    type: TokenType;
  }): Promise<{ userId: string } | null> {
    if (!args.rawToken || args.rawToken.length < 10) return null;
    const tokenHash = this._hashToken(args.rawToken);

    // Lookup
    const row = await this.prisma.verification_tokens.findUnique({
      where: { token_hash: tokenHash },
    });

    if (!row) return null;
    if (row.type !== args.type) return null;
    if (row.used_at) return null;
    if (row.expires_at < new Date()) return null;

    // Mark used (atomic-ish — race kondisi minimal karena single-row update)
    const updated = await this.prisma.verification_tokens.updateMany({
      where: {
        token_hash: tokenHash,
        used_at: null,
      },
      data: { used_at: new Date() },
    });

    // Kalau update count 0, berarti ada race lain yang sudah pakai.
    if (updated.count === 0) return null;

    return { userId: row.user_id };
  }

  /**
   * Cleanup token expired/used yang sudah lebih dari 30 hari.
   * Panggil dari cron / jadwal.
   */
  async cleanup(): Promise<number> {
    const threshold = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const result = await this.prisma.verification_tokens.deleteMany({
      where: {
        OR: [
          { expires_at: { lt: threshold } },
          { used_at: { not: null, lt: threshold } as any },
        ],
      },
    });
    return result.count;
  }

  private _generateToken(): string {
    // base64url — URL-safe, tidak butuh encoding tambahan
    return crypto.randomBytes(TOKEN_BYTES).toString('base64url');
  }

  private _hashToken(raw: string): string {
    return crypto.createHash('sha256').update(raw).digest('hex');
  }
}
