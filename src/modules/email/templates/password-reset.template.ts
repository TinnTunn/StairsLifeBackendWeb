import { htmlLayout, ctaButton, escapeHtml } from './layout';

export interface PasswordResetEmailProps {
  fullName: string;
  resetUrl: string;
}

export function passwordResetTemplate(props: PasswordResetEmailProps): {
  subject: string;
  html: string;
  text: string;
} {
  const name = escapeHtml(props.fullName || 'Kamu');

  const bodyHtml = `
    <h2 style="margin:0 0 16px 0;font-size:22px;font-weight:800;color:#0f172a">
      Reset Password 🔑
    </h2>

    <p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;color:#374151">
      Hai ${name}, kami terima permintaan reset password untuk akun StairsLife
      kamu. Klik tombol di bawah untuk membuat password baru:
    </p>

    ${ctaButton({ url: props.resetUrl, label: '🔑 Reset Password Saya' })}

    <p style="margin:24px 0 8px 0;font-size:13px;color:#6b7280">
      Atau salin link ini ke browser:
    </p>
    <p style="margin:0 0 24px 0;font-size:13px;color:#14b8a6;word-break:break-all">
      <a href="${props.resetUrl}" style="color:#14b8a6;text-decoration:underline">
        ${props.resetUrl}
      </a>
    </p>

    <div style="padding:16px;background:#fef2f2;border-radius:8px;border-left:3px solid #ef4444;margin-bottom:16px">
      <p style="margin:0 0 6px 0;font-size:13px;color:#991b1b;font-weight:700">
        ⚠️ Bukan kamu yang minta reset?
      </p>
      <p style="margin:0;font-size:13px;color:#7f1d1d;line-height:1.5">
        Abaikan email ini — password kamu tidak akan berubah. Tapi kalau
        ini terjadi sering, mungkin ada yang coba akses akun kamu. Pertimbangkan
        ganti password setelah login.
      </p>
    </div>

    <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.6">
      🔒 <strong>Link berlaku 1 jam.</strong> Demi keamanan, link akan
      otomatis kedaluwarsa setelah waktu itu.
    </p>
  `;

  const text = `Hai ${props.fullName || 'Kamu'},

Kami menerima permintaan reset password untuk akun StairsLife kamu.
Buka link berikut untuk membuat password baru:

${props.resetUrl}

Link berlaku 1 jam. Bukan kamu yang minta reset? Abaikan email ini —
password kamu tidak akan berubah.

Salam,
Tim StairsLife
`;

  return {
    subject: '🔑 Reset password StairsLife',
    html: htmlLayout({ title: 'Reset Password', bodyHtml }),
    text,
  };
}
