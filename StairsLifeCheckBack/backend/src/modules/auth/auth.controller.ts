import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  Req,
  BadRequestException,
} from '@nestjs/common';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto, ResendVerificationDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // ====================================================
  // REGISTER & LOGIN
  // ====================================================

  @Post('register')
  @Throttle({
    short: { ttl: 60_000, limit: 5 },
    medium: { ttl: 60_000, limit: 5 },
  })
  async register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.authService.register(dto, {
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({
    short: { ttl: 60_000, limit: 10 },
    medium: { ttl: 60_000, limit: 10 },
  })
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ medium: { ttl: 60_000, limit: 30 } })
  async refresh(@Body() body: { refresh_token?: string }) {
    return this.authService.refresh(body.refresh_token);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @SkipThrottle()
  async logout() {
    return { data: null, message: 'Logout berhasil' };
  }

  // ====================================================
  // EMAIL VERIFICATION
  // ====================================================

  /**
   * POST /auth/verify-email
   * Body: { token }
   *
   * Dipanggil saat user klik link di email verification.
   * Token mentah dikirim, di-hash di service, lookup di DB.
   *
   * Throttle ketat — endpoint ini target favorit untuk token brute-force.
   */
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @Throttle({
    short: { ttl: 60_000, limit: 10 },
    medium: { ttl: 60_000, limit: 10 },
  })
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.authService.verifyEmail(dto.token);
  }

  /**
   * POST /auth/resend-verification
   * Body: { email }
   *
   * Resend email verifikasi. Throttle ketat (3/menit per IP).
   * Tidak bocorkan apakah email terdaftar — selalu return sukses.
   */
  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  @Throttle({
    short: { ttl: 60_000, limit: 3 },
    medium: { ttl: 60_000, limit: 3 },
  })
  async resendVerification(
    @Body() dto: ResendVerificationDto,
    @Req() req: Request,
  ) {
    return this.authService.resendVerification(dto.email, {
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });
  }

  // ====================================================
  // PASSWORD RESET
  // ====================================================

  /**
   * POST /auth/forgot-password
   * Body: { email }
   *
   * Trigger reset password — kirim email berisi link reset.
   * Response selalu sukses (jangan bocorkan email exists).
   */
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({
    short: { ttl: 60_000, limit: 3 },
    medium: { ttl: 60_000, limit: 3 },
  })
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @Req() req: Request,
  ) {
    return this.authService.forgotPassword(dto.email, {
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });
  }

  /**
   * POST /auth/reset-password
   * Body: { token, new_password }
   *
   * Konsumsi token dari email → set password baru.
   */
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({
    short: { ttl: 60_000, limit: 5 },
    medium: { ttl: 60_000, limit: 5 },
  })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.token, dto.new_password);
  }
}
