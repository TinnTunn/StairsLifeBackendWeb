import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { SupabaseService } from '../../config/supabase.config';
import * as bcrypt from 'bcryptjs';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    private supabaseService: SupabaseService,
    private jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const supabase = this.supabaseService.getClient();

    // Cek email sudah terdaftar
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('email', dto.email)
      .single();

    if (existing) {
      throw new ConflictException('Email sudah terdaftar');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(dto.password, 12);

    // Insert user baru.
    const { data: user, error } = await supabase
      .from('users')
      .insert({
        full_name: dto.full_name,
        email: dto.email,
        password_hash: hashedPassword,
        role: dto.role,
        tier: 'pemula',
        is_verified: false,
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

    const tokens = this._generateTokenPair(user);

    return {
      data: { user, ...tokens },
      message: 'Pendaftaran berhasil',
    };
  }

  async login(dto: LoginDto) {
    const supabase = this.supabaseService.getClient();

    const { data: user } = await supabase
      .from('users')
      .select(
        'id, full_name, email, role, tier, is_verified, is_suspended, suspension_reason, password_hash',
      )
      .eq('email', dto.email)
      .single();

    if (!user) {
      throw new UnauthorizedException('Email atau password salah');
    }

    const isPasswordValid = await bcrypt.compare(
      dto.password,
      user.password_hash,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Email atau password salah');
    }

    const { password_hash: _password_hash, ...userWithoutPassword } = user;
    const tokens = this._generateTokenPair(userWithoutPassword);

    return {
      data: { user: userWithoutPassword, ...tokens },
      message: 'Login berhasil',
    };
  }

  /**
   * Refresh token — verifikasi refresh token dan issue access token baru.
   * Refresh token punya expiry yang lebih panjang (30 hari) dari access token (7 hari),
   * sehingga user tidak perlu login ulang sebelum 30 hari aktif.
   */
  async refresh(refreshToken?: string) {
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token tidak ditemukan');
    }

    let payload: any;
    try {
      payload = this.jwtService.verify(refreshToken);
    } catch {
      throw new UnauthorizedException('Refresh token tidak valid atau sudah expired');
    }

    // Cuma terima refresh token, bukan access token
    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Token bukan refresh token');
    }

    // Fetch user terbaru dari DB untuk memastikan akun masih aktif
    const supabase = this.supabaseService.getClient();
    const { data: user } = await supabase
      .from('users')
      .select('id, full_name, email, role, tier, is_verified, is_suspended')
      .eq('id', payload.sub)
      .single();

    if (!user) {
      throw new UnauthorizedException('User tidak ditemukan');
    }
    if (user.is_suspended) {
      throw new UnauthorizedException('Akun di-suspend');
    }

    // Issue access token baru + rotate refresh token (rolling refresh)
    const tokens = this._generateTokenPair(user);

    return {
      data: { user, ...tokens },
      message: 'Token berhasil diperbarui',
    };
  }

  /**
   * Forgot password — placeholder untuk integrasi email provider.
   * Selalu return sukses agar tidak expose existence of email.
   */
  async forgotPassword(email: string) {
    const supabase = this.supabaseService.getClient();

    const { data: user } = await supabase
      .from('users')
      .select('id, email')
      .eq('email', email)
      .single();

    if (user) {
      // TODO: Kirim email via Resend/Nodemailer saat provider sudah dikonfigurasi.
      console.log(`[ForgotPassword] Reset requested for: ${email} (user: ${user.id})`);
    }

    return {
      data: null,
      message:
        'Jika email terdaftar, link reset password akan dikirim ke inbox kamu.',
    };
  }

  /**
   * Generate sepasang token: access (7d) dan refresh (30d).
   * Refresh token punya field `type: 'refresh'` untuk membedakan dari access.
   */
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

    const token = this.jwtService.sign(basePayload);

    const refresh_token = this.jwtService.sign(
      { ...basePayload, type: 'refresh' },
      { expiresIn: '30d' as any },
    );

    return { token, refresh_token };
  }
}
