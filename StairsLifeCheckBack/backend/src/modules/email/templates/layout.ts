/**
 * Layout dasar untuk semua email transactional.
 *
 * Kenapa inline CSS:
 * - Email client (Gmail, Outlook) banyak yang strip <style> tags.
 * - Inline CSS adalah satu-satunya cara yang reliable.
 *
 * Width 600px = sweet spot untuk email rendering di semua client.
 */

export function htmlLayout(args: { title: string; bodyHtml: string }): string {
  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${args.title}</title>
</head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1f2937">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f4f5f7;padding:24px 0">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.04)">

          <!-- Header -->
          <tr>
            <td style="padding:24px 32px;background:linear-gradient(135deg,#14b8a6,#0d9488);color:white">
              <div style="font-size:22px;font-weight:800;letter-spacing:-0.5px">StairsLife</div>
              <div style="font-size:12px;opacity:0.85;margin-top:2px">Platform Freelance Mahasiswa</div>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px">
              ${args.bodyHtml}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px;background:#f9fafb;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;text-align:center">
              <p style="margin:0 0 4px 0">Email ini dikirim otomatis. Jangan balas ke alamat ini.</p>
              <p style="margin:0">© ${new Date().getFullYear()} StairsLife · <a href="${process.env.APP_URL || 'https://stairslife.id'}" style="color:#14b8a6;text-decoration:none">stairslife.id</a></p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Helper untuk button CTA — konsisten di semua email.
 */
export function ctaButton(args: { url: string; label: string }): string {
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0">
    <tr>
      <td style="border-radius:8px;background:#14b8a6">
        <a href="${args.url}"
           style="display:inline-block;padding:14px 28px;color:#ffffff;font-weight:700;font-size:15px;text-decoration:none;border-radius:8px">
          ${args.label}
        </a>
      </td>
    </tr>
  </table>`;
}

/**
 * Escape user-supplied content untuk dipasang di HTML email.
 * Penting: nama user bisa berisi `<script>` atau quote.
 */
export function escapeHtml(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}
