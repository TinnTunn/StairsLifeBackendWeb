import { htmlLayout, ctaButton, escapeHtml } from './layout';

export interface VerificationEmailProps {
  fullName: string;
  verifyUrl: string;
}

/**
 * Template email verifikasi setelah register.
 * Return { subject, html, text }.
 *
 * Text version PENTING:
 * - Email client yang block HTML akan tampilkan text version.
 * - Spam filter (terutama Gmail) lebih trust email yang punya text version.
 */
export function verificationEmailTemplate(props: VerificationEmailProps): {
  subject: string;
  html: string;
  text: string;
} {
  const name = escapeHtml(props.fullName || 'Kamu');

  const bodyHtml = `
    <h2 style="margin:0 0 16px 0;font-size:22px;font-weight:800;color:#0f172a">
      Halo, ${name}! 👋
    </h2>

    <p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;color:#374151">
      Terima kasih sudah daftar di StairsLife. Satu langkah lagi sebelum
      kamu bisa mulai eksplor project & koneksi:
    </p>

    <p style="margin:0 0 8px 0;font-size:15px;line-height:1.6;color:#374151;font-weight:600">
      Konfirmasi email kamu dengan klik tombol di bawah:
    </p>

    ${ctaButton({ url: props.verifyUrl, label: '✅ Verifikasi Email Saya' })}

    <p style="margin:24px 0 8px 0;font-size:13px;color:#6b7280">
      Atau salin link ini ke browser kamu:
    </p>
    <p style="margin:0 0 24px 0;font-size:13px;color:#14b8a6;word-break:break-all">
      <a href="${props.verifyUrl}" style="color:#14b8a6;text-decoration:underline">
        ${props.verifyUrl}
      </a>
    </p>

    <div style="padding:16px;background:#f9fafb;border-radius:8px;border-left:3px solid #14b8a6;margin-bottom:16px">
      <p style="margin:0;font-size:13px;color:#374151;line-height:1.5">
        🔒 <strong>Link ini berlaku 24 jam.</strong> Kalau bukan kamu
        yang daftar, abaikan saja email ini — akun tidak akan aktif
        kalau email tidak diverifikasi.
      </p>
    </div>

    <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.6">
      Ada pertanyaan? Reply email ini atau kontak kami di
      <a href="mailto:support@stairslife.id" style="color:#14b8a6;text-decoration:none">support@stairslife.id</a>.
    </p>
  `;

  const text = `Halo, ${props.fullName || 'Kamu'}!

Terima kasih sudah daftar di StairsLife. Konfirmasi email kamu dengan
membuka link berikut:

${props.verifyUrl}

Link ini berlaku 24 jam. Kalau bukan kamu yang daftar, abaikan email ini.

Salam,
Tim StairsLife
`;

  return {
    subject: '✅ Verifikasi email StairsLife kamu',
    html: htmlLayout({ title: 'Verifikasi Email', bodyHtml }),
    text,
  };
}
