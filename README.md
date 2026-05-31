# StairsLife Backend — Production Build v2

Backend NestJS lengkap untuk StairsLife: project asli + 20 security
patches (v1) + Sprint Week 1 (email verification + password reset).

**Versi**: 2.0.0 (post-audit + sprint week 1)
**Status**: ready to run untuk dev, siap deploy setelah env di-isi

---

## 🚀 Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Copy & isi env
cp .env.example .env
# Edit .env — lihat section "Environment Variables" di bawah

# 3. Apply migration ke Supabase
# Buka Supabase Dashboard → SQL Editor → paste isi:
#   prisma/migrations/sprint_full_schema.sql
# Section minggu 1 cukup; minggu 2-4 kerjakan saat sampai sprintnya.

# 4. Generate Prisma client
npx prisma generate

# 5. Run dev
npm run start:dev
```

Backend jalan di **http://localhost:3000**, prefix API `/api/v1`.

---

## 📋 Environment Variables

File `.env.example` sudah berisi semua var untuk 4 minggu sprint.
Untuk minggu 1, **WAJIB diisi**:

| Variable | Cara dapat | Catatan |
|---|---|---|
| `DATABASE_URL` | Supabase Dashboard → Settings → Database | Connection pooler URL |
| `SUPABASE_URL` | Supabase Dashboard → Settings → API | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Dashboard → Settings → API | **Service role** key (jangan anon) |
| `JWT_SECRET` | `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"` | 64+ char random |
| `JWT_REFRESH_SECRET` | sama caranya, **harus beda dari JWT_SECRET** | defense-in-depth |
| `RESEND_API_KEY` | https://resend.com → API Keys | start dengan `re_` |
| `EMAIL_FROM` | `"StairsLife <noreply@yourdomain.com>"` | domain harus verified di Resend |
| `APP_URL` | `http://localhost:5173` dev, frontend URL prod | dipakai untuk link di email |

**Optional**:
- `GOOGLE_CLIENT_ID` & `GOOGLE_CLIENT_SECRET` — minggu 2
- `MIDTRANS_SERVER_KEY` & `MIDTRANS_CLIENT_KEY` — minggu 3
- `FRONTEND_URL` — untuk CORS (multiple origins boleh, pisah koma)

Lihat `../docs/01-dashboard-setup.md` untuk panduan detail tiap provider.

---

## 🏗️ Yang sudah ada di versi ini

### Security (dari patches v1)
- ✅ Privilege escalation block di register (anti `role=admin` injection)
- ✅ Chat REST endpoint access validation (anti baca chat orang lain)
- ✅ WebSocket CORS whitelist (anti origin `*`)
- ✅ JWT access vs refresh secret terpisah
- ✅ Rate limiting (login 10/min, register 5/min, forgot-pwd 3/min, default 100/min)
- ✅ Platform fee dibaca dari `platform_settings` (bukan hardcoded)
- ✅ Dispute resolution dengan financial settlement (refund/release/split)
- ✅ Null-check `project` di contracts & applications service

### Sprint Week 1
- ✅ EmailService (Resend) + 3 template (verification, password-reset, welcome)
- ✅ VerificationTokenService (SHA-256 hash, single-use, expires)
- ✅ Endpoint `/auth/verify-email`
- ✅ Endpoint `/auth/resend-verification`
- ✅ Endpoint `/auth/reset-password`
- ✅ Endpoint `/auth/forgot-password` (sudah ada, sekarang sungguh kirim email)
- ✅ Schema: `email_verified_at`, `google_id` (untuk minggu 2), `verification_tokens` table

---

## 🧪 Smoke Test setelah deploy

```bash
# 1. Health check
curl http://localhost:3000/api/v1

# 2. Coba register
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{
    "full_name": "Test User",
    "email": "test@yourdomain.com",
    "password": "test12345",
    "role": "mahasiswa"
  }'

# 3. Coba privilege escalation block
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"full_name":"X","email":"x@y.com","password":"12345678","role":"admin"}'
# Expected: 400 "Role tidak valid"

# 4. Coba rate limit login (jalankan banyak kali cepat)
# Expected: setelah ~10 request, mulai dapat 429
```

---

## 📝 Next Sprint (Week 2-4)

- **Minggu 2**: Google OAuth + profile completion (portfolio, skills)
- **Minggu 3**: Midtrans payment gateway + wallet
- **Minggu 4**: Withdrawal + closed beta launch

Schema untuk minggu 2-4 sudah ada di `prisma/migrations/sprint_full_schema.sql`.

---

## 🐛 Troubleshooting

### "RESEND_API_KEY belum di-set" warning di console
Itu hanya warning. Aplikasi tetap jalan, tapi email tidak benar-benar dikirim
— di-log ke console (cocok untuk dev tanpa kredensial Resend).

### Email tidak masuk inbox
1. Cek domain Resend status = "Verified" (hijau)
2. Cek SPF/DKIM record di DNS provider
3. Cek folder spam
4. Cek log backend: `📧 Email terkirim ke ...` muncul?
5. Cek Resend Dashboard → Emails → cari log delivery

### TypeScript compile error setelah update schema
```bash
npx prisma generate
npm run build
```

### Migration gagal di Supabase
Jalankan per-section. Section yang sudah dijalankan tidak akan duplicate
karena pakai `IF NOT EXISTS` / `ON CONFLICT DO NOTHING`.

---

## 🔐 Security Checklist Sebelum Production

- [ ] **Rotate JWT_SECRET & JWT_REFRESH_SECRET** (kalau .env pernah di-commit)
- [ ] Reset `SUPABASE_SERVICE_ROLE_KEY` di Supabase
- [ ] Reset password DB
- [ ] `NODE_ENV=production` di Railway/host
- [ ] `MIDTRANS_IS_PRODUCTION=true` (setelah merchant verified)
- [ ] CORS whitelist di `FRONTEND_URL` hanya production frontend URL
- [ ] Domain Resend benar-benar verified
- [ ] Google OAuth Authorized origins/redirect URIs include production URL
