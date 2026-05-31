import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { SupabaseService } from '../../config/supabase.config';
import { PrismaService } from '../../config/prisma.service';
import { TokenService } from './token.service';
import { VerificationTokenService } from './verification-token.service';
import { EmailService } from '../email/email.service';
import * as bcrypt from 'bcryptjs';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

const ALLOWED_REGISTER_ROLES = ['mahasiswa', 'bisnis'] as const;
type AllowedRegisterRole = (typeof ALLOWED_REGISTER_ROLES)[number];

interface RequestContext {
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private supabaseService: SupabaseService,
    private prisma: PrismaService,
    private tokenService: TokenService,
    private verificationToken: VerificationTokenService,
    private emailService: EmailService,
  ) {}

  // ============================================================
  // REGISTER — sekarang kirim email verifikasi setelah create
  // ============================================================

  async register(dto: RegisterDto, ctx?: RequestContext) {
    const supabase = this.supabaseService.getClient();

    if (!ALLOWED_REGISTER_ROLES.includes(dto.role as AllowedRegisterRole)) {
      throw new BadRequestException(
        'Role tidak valid. Hanya mahasiswa atau bisnis yang bisa daftar.',
      );
    }

    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('email', dto.email)
      .single();

    if (existing) {
      throw new ConflictException('Email sudah terdaftar');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 12);

    const { data: user, error } = await supabase
      .from('users')
      .insert({
        full_name: dto.full_name,
        email: dto.email,
        password_hash: hashedPassword,
        role: dto.role,
        tier: 'pemula',
        // Bisnis: otomatis terverifikasi saat daftar karena verifikasi
        // mereka melalui escrow payment, bukan dokumen KTM.
        // Mahasiswa: is_verified = false, harus upload KTM dan tunggu admin approve.
        is_verified: dto.role === 'bisnis' ? true : false,
        email_verified_at: null,    // email verification belum
        university: dto.university ?? null,
        major: dto.major ?? null,
        semester: dto.semester ?? null,
        phone: dto.phone ?? null,
        company_name: dto.company_name ?? null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select(
        'id, full_name, email, role, tier, is_verified, university, major, semester, phone, company_name',
      )
      .single();

    if (error) {
      throw new BadRequestException(error.message);
    }

    // Kirim email verifikasi (async, jangan block response).
    // User yang gagal terima email bisa request resend.
    void this._sendVerificationEmail(user.id, user.email, user.full_name, ctx);

    const tokens = this._generateTokenPair(user);

    return {
      data: {
        user: { ...user, email_verified: false },
        ...tokens,
      },
      message:
        'Pendaftaran berhasil. Cek email kamu untuk verifikasi (jangan lupa folder spam).',
    };
  }

  // ============================================================
  // LOGIN — block kalau email belum diverifikasi (opsional)
  // ============================================================

  async login(dto: LoginDto) {
    const supabase = this.supabaseService.getClient();

    const { data: user } = await supabase
      .from('users')
      .select(
        'id, full_name, email, role, tier, is_verified, is_suspended, suspension_reason, email_verified_at, password_hash',
      )
      .eq('email', dto.email)
      .single();

    if (!user) {
      throw new UnauthorizedException('Email atau password salah');
    }

    // Akun tanpa password_hash (mis. dibuat lewat jalur non-password).
    // Arahkan ke "Lupa password" untuk mengatur password baru.
    if (!user.password_hash) {
      throw new UnauthorizedException(
        'Akun ini belum memiliki password. Silakan atur password melalui fitur "Lupa password".',
      );
    }

    const isPasswordValid = await bcrypt.compare(
      dto.password,
      user.password_hash,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Email atau password salah');
    }

    if (user.is_suspended) {
      throw new UnauthorizedException(
        user.suspension_reason
          ? `Akun di-suspend: ${user.suspension_reason}`
          : 'Akun di-suspend. Hubungi support.',
      );
    }

    // OPSIONAL: block login kalau email belum diverifikasi.
    // Pilihan desain:
    //   (a) STRICT: tolak login, paksa verify dulu (lebih aman, friction tinggi)
    //   (b) SOFT: izinkan login, batasi fitur sampai verified (UX lebih baik)
    //
    // Default kita: SOFT. Frontend cek `user.email_verified` → tampilkan
    // banner "Verifikasi email kamu" + batasi apply project / post project.
    // Kalau mau strict, uncomment di bawah:
    //
    // if (!user.email_verified_at) {
    //   throw new UnauthorizedException(
    //     'Email belum diverifikasi. Cek email kamu untuk link verifikasi.',
    //   );
    // }

    const {
      password_hash: _password_hash,
      email_verified_at,
      ...userWithoutPassword
    } = user;
    const userPayload = {
      ...userWithoutPassword,
      email_verified: !!email_verified_at,
    };
    const tokens = this._generateTokenPair(userPayload);

    return {
      data: { user: userPayload, ...tokens },
      message: 'Login berhasil',
    };
  }

  // ============================================================
  // EMAIL VERIFICATION
  // ============================================================

  async verifyEmail(rawToken: string) {
    const result = await this.verificationToken.consume({
      rawToken,
      type: 'email_verification',
    });

    if (!result) {
      throw new BadRequestException(
        'Link verifikasi tidak valid atau sudah kedaluwarsa. Minta link baru di halaman login.',
      );
    }

    // Tandai email verified
    const supabase = this.supabaseService.getClient();
    const { data: user } = await supabase
      .from('users')
      .update({
        email_verified_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', result.userId)
      .select('id, full_name, email, role')
      .single();

    if (!user) {
      throw new BadRequestException('User tidak ditemukan');
    }

    // Kirim welcome email (fire-and-forget)
    void this.emailService.sendWelcomeEmail({
      to: user.email,
      fullName: user.full_name,
      role: user.role as 'mahasiswa' | 'bisnis',
    });

    return {
      data: { email_verified: true },
      message: 'Email berhasil diverifikasi. Selamat datang di StairsLife! 🎉',
    };
  }

  async resendVerification(email: string, ctx?: RequestContext) {
    const supabase = this.supabaseService.getClient();
    const { data: user } = await supabase
      .from('users')
      .select('id, email, full_name, email_verified_at')
      .eq('email', email)
      .single();

    // SECURITY: jangan bocorkan apakah email terdaftar.
    // Selalu return success message yang sama.
    if (user && !user.email_verified_at) {
      void this._sendVerificationEmail(
        user.id,
        user.email,
        user.full_name,
        ctx,
      );
    }

    return {
      data: null,
      message:
        'Kalau email kamu terdaftar dan belum diverifikasi, link verifikasi baru sudah dikirim.',
    };
  }

  // ============================================================
  // PASSWORD RESET
  // ============================================================

  async forgotPassword(email: string, ctx?: RequestContext) {
    const supabase = this.supabaseService.getClient();
    const { data: user } = await supabase
      .from('users')
      .select('id, email, full_name, password_hash')
      .eq('email', email)
      .single();

    // SECURITY: jangan bocorkan apakah email terdaftar.
    // Akun tanpa password pun boleh — reset jadi cara mereka mengatur
    // password pertama kali.
    if (user) {
      const { rawToken } = await this.verificationToken.create({
        userId: user.id,
        type: 'password_reset',
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
      });

      void this.emailService.sendPasswordResetEmail({
        to: user.email,
        fullName: user.full_name,
        rawToken,
      });
    }

    return {
      data: null,
      message:
        'Jika email terdaftar, link reset password akan dikirim ke inbox kamu.',
    };
  }

  async resetPassword(rawToken: string, newPassword: string) {
    const result = await this.verificationToken.consume({
      rawToken,
      type: 'password_reset',
    });

    if (!result) {
      throw new BadRequestException(
        'Link reset password tidak valid atau sudah kedaluwarsa.',
      );
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    const supabase = this.supabaseService.getClient();
    const { error } = await supabase
      .from('users')
      .update({
        password_hash: hashedPassword,
        updated_at: new Date().toISOString(),
      })
      .eq('id', result.userId);

    if (error) {
      throw new BadRequestException('Gagal update password');
    }

    return {
      data: null,
      message: 'Password berhasil direset. Silakan login dengan password baru.',
    };
  }

  // ============================================================
  // REFRESH (unchanged)
  // ============================================================

  async refresh(refreshToken?: string) {
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token tidak ditemukan');
    }

    let payload: any;
    try {
      payload = this.tokenService.verifyRefresh(refreshToken);
    } catch {
      throw new UnauthorizedException(
        'Refresh token tidak valid atau sudah expired',
      );
    }

    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Token bukan refresh token');
    }

    const supabase = this.supabaseService.getClient();
    const { data: user } = await supabase
      .from('users')
      .select(
        'id, full_name, email, role, tier, is_verified, is_suspended, email_verified_at',
      )
      .eq('id', payload.sub)
      .single();

    if (!user) {
      throw new UnauthorizedException('User tidak ditemukan');
    }
    if (user.is_suspended) {
      throw new UnauthorizedException('Akun di-suspend');
    }

    const userPayload = {
      ...user,
      email_verified: !!user.email_verified_at,
    };
    delete (userPayload as any).email_verified_at;

    const tokens = this._generateTokenPair(userPayload);

    return {
      data: { user: userPayload, ...tokens },
      message: 'Token berhasil diperbarui',
    };
  }

  // ============================================================
  // HELPERS
  // ============================================================

  private async _sendVerificationEmail(
    userId: string,
    email: string,
    fullName: string,
    ctx?: RequestContext,
  ): Promise<void> {
    try {
      const { rawToken } = await this.verificationToken.create({
        userId,
        type: 'email_verification',
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
      });

      await this.emailService.sendVerificationEmail({
        to: email,
        fullName,
        rawToken,
      });
    } catch (err: any) {
      // Email gagal kirim TIDAK boleh block register. Log saja.
      console.error(`[Auth] gagal kirim verification email: ${err.message}`);
    }
  }

  private _generateTokenPair(user: {
    id: string;
    email: string;
    role: string;
  }): { token: string; refresh_token: string } {
    const basePayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    return {
      token: this.tokenService.signAccess(basePayload),
      refresh_token: this.tokenService.signRefresh(basePayload),
    };
  }
}
