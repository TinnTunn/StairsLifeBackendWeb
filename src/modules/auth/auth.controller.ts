import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // POST /api/v1/auth/register
  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  // POST /api/v1/auth/login
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  // POST /api/v1/auth/refresh
  // Dipanggil oleh frontend api-core.js untuk proactive token refresh.
  // Karena JWT kita stateless (tidak ada refresh token table), endpoint ini
  // cukup validasi token lama (opsional) dan issue token baru dari payload-nya.
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() body: { refresh_token?: string }) {
    return this.authService.refresh(body.refresh_token);
  }

  // POST /api/v1/auth/logout
  // Stateless JWT — server tidak perlu invalidate token.
  // Endpoint ini ada agar frontend bisa hit "best-effort" tanpa error 404.
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout() {
    return { data: null, message: 'Logout berhasil' };
  }

  // POST /api/v1/auth/forgot-password
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.email);
  }
}
