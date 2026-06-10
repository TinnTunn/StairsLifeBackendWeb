import { htmlLayout, ctaButton, escapeHtml } from './layout';

export interface WelcomeEmailProps {
  fullName: string;
  role: 'mahasiswa' | 'bisnis';
  appUrl: string;
}

export function welcomeTemplate(props: WelcomeEmailProps): {
  subject: string;
  html: string;
  text: string;
} {
  const name = escapeHtml(props.fullName || 'Kamu');
  const isStudent = props.role === 'mahasiswa';

  const tips = isStudent
    ? [
        '🎓 Upload KTM untuk verifikasi akun (max 2 hari kerja)',
        '✨ Lengkapi profil & portfolio untuk menarik klien',
        '🔍 Browse project sesuai skill kamu di tab "Cari Project"',
        '💬 Apply dengan proposal yang personal & spesifik',
      ]
    : [
        '🏢 Lengkapi profil bisnis & verifikasi',
        '📝 Post project pertama dengan brief yang jelas',
        '👥 Review portofolio kandidat sebelum approve',
        '💳 Dana aman di escrow — cair setelah deliverable disetujui',
      ];

  const ctaUrl = isStudent
    ? `${props.appUrl}/?tab=verification`
    : `${props.appUrl}/?tab=projects`;
  const ctaLabel = isStudent
    ? '🎓 Mulai Verifikasi KTM'
    : '🏢 Post Project Pertama';

  const bodyHtml = `
    <h2 style="margin:0 0 16px 0;font-size:22px;font-weight:800;color:#0f172a">
      Welcome ke StairsLife, ${name}! 🎉
    </h2>

    <p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;color:#374151">
      Email kamu sudah terverifikasi. Akun ${isStudent ? 'mahasiswa' : 'bisnis'} kamu siap dipakai.
    </p>

    <p style="margin:24px 0 12px 0;font-size:15px;font-weight:700;color:#0f172a">
      4 langkah cepat untuk mulai:
    </p>

    <ol style="margin:0 0 24px 20px;padding:0;font-size:14px;color:#374151;line-height:1.9">
      ${tips.map((t) => `<li style="margin-bottom:4px">${t}</li>`).join('')}
    </ol>

    ${ctaButton({ url: ctaUrl, label: ctaLabel })}

    <p style="margin:24px 0 0 0;font-size:13px;color:#6b7280;line-height:1.6">
      Butuh bantuan? Kontak support kami di
      <a href="mailto:support@stairslife.id" style="color:#14b8a6;text-decoration:none">support@stairslife.id</a>
      — kami balas dalam 24 jam.
    </p>
  `;

  const text = `Welcome ke StairsLife, ${props.fullName || 'Kamu'}!

Email kamu sudah terverifikasi. Akun ${isStudent ? 'mahasiswa' : 'bisnis'} siap dipakai.

4 langkah cepat untuk mulai:
${tips.map((t, i) => `${i + 1}. ${t}`).join('\n')}

Mulai sekarang: ${ctaUrl}

Butuh bantuan? Kontak support@stairslife.id

Salam,
Tim StairsLife
`;

  return {
    subject: `🎉 Welcome ke StairsLife, ${props.fullName || 'Kamu'}!`,
    html: htmlLayout({ title: 'Welcome', bodyHtml }),
    text,
  };
}
