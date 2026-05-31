import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { verificationEmailTemplate } from './templates/verification.template';
import { passwordResetTemplate } from './templates/password-reset.template';
import { welcomeTemplate } from './templates/welcome.template';

/**
 * EmailService — wrapper di atas Resend SDK.
 *
 * Filosofi:
 * - Service ini provider-agnostic dari sisi caller. Service lain
 *   memanggil `sendVerificationEmail(email, link)` — tidak tahu Resend.
 *   Kalau suatu hari kita ganti ke SendGrid/Brevo, cuma file ini berubah.
 * - Email TEMPLATE dipisah ke file sendiri (lihat folder templates/).
 *   Setiap template export function `(props) => { subject, html, text }`.
 * - Mengirim email TIDAK BLOCK request user. Caller pakai `void emailService.send(...)`
 *   atau `.catch(log)`. Email gagal kirim TIDAK boleh bikin register gagal.
 * - Untuk dev tanpa RESEND_API_KEY: log ke console saja. Aplikasi
 *   tetap jalan (developer experience).
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend: Resend | null;
  private readonly fromAddress: string;
  private readonly appUrl: string;
  private readonly devMode: boolean;

  constructor(private config: ConfigService) {
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    this.fromAddress =
      this.config.get<string>('EMAIL_FROM') ?? 'StairsLife <noreply@example.com>';
    this.appUrl =
      this.config.get<string>('APP_URL') ??
      this.config.get<string>('FRONTEND_URL') ??
      'http://localhost:5173';

    if (!apiKey) {
      this.resend = null;
      this.devMode = true;
      this.logger.warn(
        '⚠️  RESEND_API_KEY belum di-set. EmailService akan log ke console, tidak mengirim email.',
      );
    } else {
      this.resend = new Resend(apiKey);
      this.devMode = false;
      this.logger.log(`📧 EmailService ready. From: ${this.fromAddress}`);
    }
  }

  /**
   * Kirim email verifikasi setelah register.
   * Link berisi token mentah (bukan hash). User klik → handler `/auth/verify-email`
   * akan hash & lookup di DB.
   */
  async sendVerificationEmail(args: {
    to: string;
    fullName: string;
    rawToken: string;
  }): Promise<void> {
    const verifyUrl = `${this.appUrl}/verify-email?token=${encodeURIComponent(args.rawToken)}`;
    const { subject, html, text } = verificationEmailTemplate({
      fullName: args.fullName,
      verifyUrl,
    });

    return this._send({
      to: args.to,
      subject,
      html,
      text,
      tag: 'verification',
    });
  }

  /**
   * Kirim email password reset. Token expires 1 jam.
   */
  async sendPasswordResetEmail(args: {
    to: string;
    fullName: string;
    rawToken: string;
  }): Promise<void> {
    const resetUrl = `${this.appUrl}/reset-password?token=${encodeURIComponent(args.rawToken)}`;
    const { subject, html, text } = passwordResetTemplate({
      fullName: args.fullName,
      resetUrl,
    });

    return this._send({
      to: args.to,
      subject,
      html,
      text,
      tag: 'password_reset',
    });
  }

  /**
   * Welcome email setelah verifikasi sukses.
   * Opsional — call dari handler verify-email.
   */
  async sendWelcomeEmail(args: {
    to: string;
    fullName: string;
    role: 'mahasiswa' | 'bisnis';
  }): Promise<void> {
    const { subject, html, text } = welcomeTemplate({
      fullName: args.fullName,
      role: args.role,
      appUrl: this.appUrl,
    });

    return this._send({
      to: args.to,
      subject,
      html,
      text,
      tag: 'welcome',
    });
  }

  /**
   * Low-level send. Tidak throw — error di-log saja.
   * Caller bisa await tapi sebaiknya void / fire-and-forget.
   */
  private async _send(args: {
    to: string;
    subject: string;
    html: string;
    text: string;
    tag?: string;
  }): Promise<void> {
    if (this.devMode || !this.resend) {
      this.logger.log(
        `[DEV EMAIL] To: ${args.to} | Subject: ${args.subject}\n--- TEXT ---\n${args.text}\n--- END ---`,
      );
      return;
    }

    try {
      const { data, error } = await this.resend.emails.send({
        from: this.fromAddress,
        to: args.to,
        subject: args.subject,
        html: args.html,
        text: args.text,
        // Resend "tags" untuk analytics di dashboard (opsional)
        tags: args.tag ? [{ name: 'category', value: args.tag }] : undefined,
      });

      if (error) {
        this.logger.error(
          `Gagal kirim email ke ${args.to}: ${error.message}`,
          error,
        );
        return;
      }

      this.logger.log(
        `📧 Email terkirim ke ${args.to} | Subject: ${args.subject} | id=${data?.id}`,
      );
    } catch (err: any) {
      // Network error, dst — jangan re-throw.
      this.logger.error(
        `Exception saat kirim email ke ${args.to}: ${err.message}`,
        err,
      );
    }
  }
}
