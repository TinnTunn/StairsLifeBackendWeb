# StairsLife — Backend

API server untuk platform freelance mahasiswa Indonesia **Stairs Life**.

Dibangun dengan **NestJS 11**, **Prisma 7**, **PostgreSQL** (via Supabase) dan **Socket.IO** untuk chat realtime.

---

## 📋 Daftar Isi

- [Tech Stack](#tech-stack)
- [Struktur Folder](#struktur-folder)
- [Quick Start](#quick-start)
- [Environment Variables](#environment-variables)
- [Arsitektur](#arsitektur)
- [Daftar Endpoint](#daftar-endpoint)
- [Database](#database)
- [WebSocket](#websocket)
- [Testing](#testing)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)

---

## Tech Stack

| Layer | Tool | Versi |
|---|---|---|
| Framework | NestJS | 11.x |
| Database | PostgreSQL (Supabase) | 15+ |
| ORM | Prisma | 7.x |
| Auth | Passport JWT | — |
| Validasi | class-validator | — |
| Realtime | Socket.IO | 4.x |
| File Storage | Multer (lokal) + Supabase Storage | — |

---

## Struktur Folder

```
src/
├── main.ts                          # Bootstrap: CORS, ValidationPipe, global filters
├── app.module.ts                    # Root module
│
├── common/                          # Shared utilities (lintas modul)
│   ├── decorators/                  # @CurrentUser, @Roles
│   ├── guards/                      # JwtAuthGuard, RolesGuard
│   ├── filters/                     # HttpExceptionFilter (response konsisten)
│   ├── interceptors/                # ResponseInterceptor (wrap { data, message })
│   ├── dto/                         # Shared DTOs (e.g., PaginationDto)
│   └── types/                       # Shared TypeScript types
│
├── config/                          # Konfigurasi infrastruktur
│   ├── index.ts                     # DatabaseModule (@Global) — eksport PrismaService, SupabaseService
│   ├── prisma.service.ts            # PrismaClient wrapper, lifecycle hooks
│   └── supabase.config.ts           # SupabaseService (untuk Realtime, Storage, Auth)
│
└── modules/                         # SEMUA modul fitur ada di sini
    ├── auth/                        # Login, register, JWT
    ├── users/                       # Profile, verifikasi KTM
    ├── projects/                    # CRUD project (oleh bisnis)
    ├── applications/                # Apply ke project (oleh mahasiswa)
    ├── contracts/                   # Kontrak + deliverable (upload, approve, reject)
    ├── payments/                    # Escrow (hold, release) dengan fee platform
    ├── reviews/                     # Rating + review per kontrak
    ├── disputes/                    # Sengketa antar pihak
    ├── chat/                        # Pesan kontrak (WS) + support inbox
    ├── notifications/               # Notifikasi (derived dari applications & contracts)
    ├── upload/                      # File upload (multer disk storage)
    └── admin/                       # Admin dashboard, suspend user, resolve dispute, dll

prisma/
└── schema.prisma                    # Schema database (12+ tabel)

uploads/                             # File upload user (gitignored, hanya .gitkeep)
```

### Struktur tiap modul

Setiap modul mengikuti pola **layered architecture**:

```
modules/<module>/
├── <module>.module.ts               # NestJS module definition
├── <module>.controller.ts           # HTTP routes — input/output, validation, auth guard
├── <module>.service.ts              # Business logic — transaksi, validasi domain
├── <module>.repository.ts           # (opsional) Data access — query Prisma
├── dto/                             # Data Transfer Objects (input validation)
│   ├── create-<entity>.dto.ts
│   └── update-<entity>.dto.ts
└── strategies/                      # (auth only) Passport JWT strategy
```

**Aturan**:
- **Controller** hanya menerima request dan delegate ke service. Tidak ada business logic.
- **Service** menangani business logic, validasi domain, transaksi.
- **Repository** (jika ada) menangani query database — service tidak pernah query langsung.
- **DTOs** memvalidasi input dengan `class-validator` decorators.

---

## Quick Start

### Prerequisites
- Node.js 20+
- npm 10+ atau pnpm
- Akun Supabase (untuk PostgreSQL + Storage + Realtime)

### 1. Install dependencies

```bash
npm install
```

### 2. Setup environment

```bash
cp .env.example .env
```

Lalu edit `.env`. **Wajib di-set:**

```bash
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DBNAME
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")
```

> 💡 **JWT_SECRET wajib minimal 64 karakter**. Generate dengan command di atas — JANGAN pakai nilai placeholder. App akan crash saat startup kalau kosong.

### 3. Generate Prisma client

```bash
npx prisma generate
```

### 4. Run database migrations

```bash
npx prisma migrate dev
```

### 5. Start server

```bash
# Development (watch mode)
npm run start:dev

# Production
npm run build
npm run start:prod
```

Server akan jalan di `http://localhost:3000/api/v1` dan WebSocket di `ws://localhost:3000/chat`.

---

## Environment Variables

Semua env var didokumentasikan di `.env.example`. Yang **paling penting**:

| Variable | Wajib | Deskripsi |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL connection string (Supabase pooler) |
| `SUPABASE_URL` | ✅ | URL project Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Service role key (akses penuh — jangan expose) |
| `JWT_SECRET` | ✅ | Secret JWT 64+ char hex |
| `JWT_EXPIRES_IN` | ❌ | Default `7d` |
| `FRONTEND_URL` | ✅ (prod) | Origin frontend untuk CORS, koma untuk multi-origin |
| `PUBLIC_BASE_URL` | ❌ (prod) | URL publik API untuk construct upload URL |
| `PORT` | ❌ | Default `3000` |
| `NODE_ENV` | ❌ | `development` / `production` |

⚠️ **Jangan commit `.env`!** Sudah ada di `.gitignore`. Kalau accidentally ter-commit, rotate semua kredensial via dashboard Supabase.

---

## Arsitektur

### Request Pipeline

```
Request
  ↓
ValidationPipe (validate DTO)
  ↓
JwtAuthGuard (verify token)  ←—— @UseGuards(JwtAuthGuard)
  ↓
RolesGuard (cek role)        ←—— @Roles('admin')
  ↓
Controller method
  ↓
Service (business logic)
  ↓
Repository (Prisma query)
  ↓
ResponseInterceptor (wrap { data, message })
  ↓
HttpExceptionFilter (normalize errors)
  ↓
Response
```

### Format Response

Semua endpoint return format konsisten:

```jsonc
// Success
{
  "data": {...},
  "message": "Berhasil"
}

// Error
{
  "statusCode": 400,
  "message": "Email sudah terdaftar",
  "error": "Bad Request",
  "timestamp": "2026-05-17T...",
  "path": "/api/v1/auth/register"
}
```

Logic ini di-handle oleh `ResponseInterceptor` (success) dan `HttpExceptionFilter` (error) — controller tinggal `return { data, message }`.

### Authorization

Pakai dekorator `@Roles()` + `RolesGuard`:

```typescript
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminController {
  @Get('users')
  @Roles('admin')                    // Hanya admin yang bisa akses
  async getAllUsers() { ... }
}
```

Role yang tersedia: `mahasiswa`, `bisnis`, `admin`.

---

## Daftar Endpoint

Base path: `/api/v1`

### Auth (`/auth`)
| Method | Path | Auth | Deskripsi |
|---|---|---|---|
| POST | `/auth/register` | ❌ | Register user baru |
| POST | `/auth/login` | ❌ | Login, return JWT |

### Users (`/users`)
| Method | Path | Auth | Deskripsi |
|---|---|---|---|
| GET | `/users/me` | ✅ | Profile user login |
| PATCH | `/users/me` | ✅ | Update profile |
| POST | `/users/me/verify-ktm` | ✅ student | Submit verifikasi KTM |

### Projects (`/projects`)
| Method | Path | Auth | Deskripsi |
|---|---|---|---|
| GET | `/projects` | ❌ | Browse projects (dengan filter) |
| GET | `/projects/:id` | ❌ | Detail project |
| POST | `/projects` | ✅ bisnis | Buat project |
| PATCH | `/projects/:id` | ✅ bisnis | Update project |
| DELETE | `/projects/:id` | ✅ bisnis | Hapus project |
| GET | `/projects/me` | ✅ bisnis | Project saya |

### Applications (`/applications`)
| Method | Path | Auth | Deskripsi |
|---|---|---|---|
| POST | `/applications` | ✅ student | Apply ke project |
| GET | `/applications/me` | ✅ student | Lamaran saya |
| GET | `/applications/project/:projectId` | ✅ bisnis | Lamaran untuk project saya |
| PATCH | `/applications/:id/status` | ✅ bisnis | Approve/reject lamaran |

### Contracts (`/contracts`)
| Method | Path | Auth | Deskripsi |
|---|---|---|---|
| POST | `/contracts` | ✅ bisnis | Buat kontrak (setelah accept application) |
| GET | `/contracts/me` | ✅ | Kontrak saya |
| GET | `/contracts/:id` | ✅ | Detail kontrak |
| POST | `/contracts/:id/deliverable` | ✅ student | Upload deliverable |
| POST | `/contracts/:id/approve` | ✅ bisnis | Approve deliverable (selesaikan kontrak) |
| POST | `/contracts/:id/reject` | ✅ bisnis | Reject deliverable (minta revisi) |
| GET | `/contracts/:id/deliverables` | ✅ | History deliverable |

### Payments (`/payments`)
| Method | Path | Auth | Deskripsi |
|---|---|---|---|
| POST | `/payments/hold` | ✅ bisnis | Hold ke escrow (bayar contract) |
| POST | `/payments/release/:contractId` | ✅ system | Release ke student |
| GET | `/payments/me` | ✅ | Pembayaran saya |

### Reviews (`/reviews`)
| Method | Path | Auth | Deskripsi |
|---|---|---|---|
| POST | `/reviews` | ✅ | Beri review (1 review per kontrak per user) |
| GET | `/reviews/contract/:contractId` | ✅ | Review untuk kontrak |
| GET | `/reviews/user/:userId` | ❌ | Review yang diterima user |

### Disputes (`/disputes`)
| Method | Path | Auth | Deskripsi |
|---|---|---|---|
| POST | `/disputes` | ✅ | Buat sengketa |
| GET | `/disputes/me` | ✅ | Sengketa saya |
| GET | `/disputes` | ✅ admin | Semua sengketa |
| PATCH | `/disputes/:id/resolve` | ✅ admin | Resolve sengketa |

### Chat (`/chat`)
| Method | Path | Auth | Deskripsi |
|---|---|---|---|
| GET | `/chat/rooms` | ✅ | Daftar room kontrak saya |
| GET | `/chat/:contractId/messages` | ✅ | Riwayat pesan |
| POST | `/chat/:contractId/messages` | ✅ | Kirim pesan (juga via WS) |
| GET | `/chat/support` | ✅ | Riwayat support user |
| POST | `/chat/support/messages` | ✅ | Kirim pesan ke support |
| GET | `/chat/support-inbox` | ✅ admin | Inbox semua support |
| POST | `/chat/support/:roomId/reply` | ✅ admin | Balas pesan support |

### Notifications (`/notifications`)
| Method | Path | Auth | Deskripsi |
|---|---|---|---|
| GET | `/notifications` | ✅ | Notifikasi saya (derived dari applications + contracts) |

### Upload (`/upload`)
| Method | Path | Auth | Deskripsi |
|---|---|---|---|
| POST | `/upload` | ✅ | Upload file (jpg/png/webp/pdf, max 10MB) |

### Admin (`/admin`)
| Method | Path | Auth | Deskripsi |
|---|---|---|---|
| GET | `/admin/stats` | ✅ admin | Stats dashboard (30-day trend) |
| GET | `/admin/users` | ✅ admin | Daftar user dengan filter |
| POST | `/admin/users/:id/suspend` | ✅ admin | Suspend user |
| POST | `/admin/users/:id/unsuspend` | ✅ admin | Unsuspend user |
| DELETE | `/admin/users/:id` | ✅ admin | Hapus user |
| GET | `/admin/verifications` | ✅ admin | Antrian verifikasi KTM |
| PATCH | `/admin/verifications/:id` | ✅ admin | Approve/reject verifikasi |
| GET | `/admin/finance` | ✅ admin | Laporan finance (daily trend) |
| POST | `/admin/announcements` | ✅ admin | Kirim pengumuman |
| GET | `/admin/settings` | ✅ admin | Platform settings (fee, SLA) |
| PATCH | `/admin/settings` | ✅ admin | Update platform settings |

---

## Database

Schema lengkap: [`prisma/schema.prisma`](./prisma/schema.prisma)

### Tabel utama

```
users (id, email, password_hash, role, full_name, ...)
  ├── role: 'mahasiswa' | 'bisnis' | 'admin'
  ├── tier: 'pemula' | 'menengah' | 'mahir' (auto-upgrade by total_projects + rating_avg)
  ├── (mahasiswa) university, major, semester
  ├── (bisnis)    phone, company_name
  └── verification: pending | approved | rejected (untuk mahasiswa)

projects (id, business_id, title, budget_min, budget_max, status, ...)
  └── status: open | inProgress | completed | disputed | cancelled

applications (id, project_id, student_id, status, ...)
  └── status: pending | approved | rejected

contracts (id, project_id, student_id, business_id, agreed_budget, status, ...)
  ├── status: active | pending_review | completed | disputed
  └── deliverable_url, deliverable_uploaded_at

payments (id, contract_id, amount, platform_fee, status, ...)
  └── status: held | released

reviews (id, contract_id, reviewer_id, reviewee_id, rating, comment, tags)

disputes (id, contract_id, raised_by, reason, evidence_url, status, resolution)

chat_messages (id, contract_id, sender_id, content, created_at)
support_messages (id, room_id, sender_id, content, created_at)
```

### Migrations

```bash
# Setelah edit schema.prisma
npx prisma migrate dev --name describe_your_change

# Apply existing migrations di production
npx prisma migrate deploy

# Reset database (DEV ONLY — drops all data!)
npx prisma migrate reset
```

---

## WebSocket

Namespace: `/chat` (URL: `ws://localhost:3000/chat`)

### Handshake

```javascript
const socket = io('http://localhost:3000/chat', {
  auth: { token: '<JWT>' }
});
```

Backend extract `Bearer <JWT>` dari `auth.token` atau header `Authorization`. Connection di-reject kalau token invalid.

### Events

**Client → Server:**
- `joinRoom` `{ contractId }` — Join room untuk kontrak
- `leaveRoom` `{ contractId }` — Leave room
- `sendMessage` `{ contractId, content }` — Kirim pesan

**Server → Client:**
- `message` `{ message }` — Pesan baru di room yang di-join
- `error` `{ message }` — Error (auth, validation, dll)

Detail: lihat [`src/modules/chat/chat.gateway.ts`](./src/modules/chat/chat.gateway.ts).

---

## Testing

> **TODO**: file `.spec.ts` saat ini hanya boilerplate auto-generate "should be defined". Test asli belum ada — ini akan diisi bertahap.

```bash
# Unit tests
npm run test

# E2E tests
npm run test:e2e

# Coverage
npm run test:cov
```

---

## Deployment

### Railway / Render / Heroku

1. Set semua env vars di dashboard provider (lihat [`.env.example`](./.env.example)).
2. `NODE_ENV=production` — wajib! Mengaktifkan CORS strict mode (hanya `FRONTEND_URL`).
3. Build command: `npm install && npx prisma generate && npm run build`
4. Start command: `npm run start:prod`
5. Pastikan `DATABASE_URL` pakai **pooled connection** Supabase (port 5432, bukan 6543) untuk performa.

### Health check

`GET /api/v1` — should return 404 (kalau no root handler) atau 200 (kalau ada). Untuk health check formal, tambah endpoint `/health` ke `AppController`.

---

## Troubleshooting

### "JWT_SECRET tidak di-set di environment"

`.env` tidak terbaca atau `JWT_SECRET` kosong. Cek:
```bash
node -e "require('dotenv').config(); console.log('JWT_SECRET length:', process.env.JWT_SECRET?.length)"
```
Harus output `64` atau lebih.

### "Origin tidak diizinkan: ..."

CORS reject origin frontend. Tambahkan origin ke `FRONTEND_URL` di `.env`:
```bash
FRONTEND_URL=http://localhost:5173,https://stairslife.vercel.app
```

### Prisma connection pool exhausted

Supabase free tier: 60 connection limit. Pastikan tidak ada `PrismaService` yang di-instantiate manual — semua harus inject lewat NestJS DI dari `DatabaseModule` (global). Cek dengan:
```bash
grep -rn "new PrismaClient\|new PrismaService" src/
```
Harus 0 hasil di luar `config/prisma.service.ts`.

### Upload URL `localhost:3000` di production

Set `PUBLIC_BASE_URL=https://api.yourdomain.com` di `.env` production. Atau biarkan kosong — controller akan otomatis pakai `req.protocol + req.get('host')` (yang biasanya benar di belakang reverse proxy yang set `X-Forwarded-Proto`/`X-Forwarded-Host`).

---

## License

Internal use — Stairs Life team.
