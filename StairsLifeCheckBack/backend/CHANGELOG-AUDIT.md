# StairsLife Backend — Changelog Audit (Bug Duplikasi & Anti Double-Submit)

Tanggal: 24 Mei 2026
Scope: Backend NestJS

## Akar Masalah Yang Diatasi

User melaporkan project terlihat duplikat setelah post project. Audit
menemukan: tombol submit di frontend tidak punya proteksi double-tap, sehingga
double-click cepat menghasilkan 2 POST identical → 2 row di DB dengan title
sama tapi id berbeda. Dedup defensif di FE renderer pakai `id` sehingga tidak
menutupi gejala.

Solusi: Defense-in-depth dua lapis. Frontend pakai submit lock per-handler.
Backend pakai idempotency guard untuk handler yang berbahaya kalau duplikat
(fan-out notif, mutation finansial, dispute ganda).

## File Yang Dimodifikasi

### 1. `src/modules/projects/projects.service.ts`

Tambah idempotency guard di `createProject`:

- Sebelum INSERT, cek apakah ada project IDENTIK (title + budget_min +
  budget_max + deadline + category) dari business yang sama dalam 10 detik
  terakhir.
- Kalau ada → return project yang sudah ada (idempotent response).
- Tidak pakai DB-level unique constraint karena bisnis valid saja punya 2
  project dengan title sama di waktu berbeda (mis. "Desain Logo" untuk 2
  klien berbeda).

### 2. `src/modules/projects/projects.repository.ts`

Method baru `findRecentDuplicate({ businessId, title, budgetMin, budgetMax,
deadline, category, since })` — query Prisma `findFirst` dengan filter
identical fields + `created_at >= since`.

### 3. `src/modules/disputes/disputes.service.ts`

Tambah guard di `create`:

- Cegah dispute ganda untuk kontrak yang sama.
- Satu kontrak hanya boleh punya 1 dispute aktif (status `open` atau
  `mediation`).
- Kalau dispute existing aktif → return dispute lama (idempotent).
- Dispute yang sudah `resolved`/`cancelled` BOLEH dibuka ulang (use case sah:
  masalah baru muncul setelah resolution sebelumnya).

### 4. `src/modules/admin/admin.service.ts`

Tambah guard di `sendAnnouncement`:

- Cegah duplicate announcement dari admin yang sama dengan title + body +
  target identik dalam 10 detik terakhir.
- Penting karena setiap announcement fan-out notifikasi ke semua user —
  double-click → 2x notifikasi ke ribuan user.

## Yang TIDAK Berubah

- Tidak ada migration SQL baru
- Tidak ada perubahan schema Prisma
- Tidak ada perubahan DTO atau endpoint signature
- Aman untuk hot-swap deployment

## Status Existing Guards (Verifikasi)

Yang SUDAH punya guard (tidak perlu diubah):

- ✓ `applications.applyToProject` → `findByProjectAndStudent` check +
  `@@unique([project_id, student_id])` di schema
- ✓ `contracts.createContract` → `findFirst` check (Anda fix sebelumnya)
- ✓ `payments.holdEscrow` → `findByContractId` returns ConflictException kalau
  sudah ada
- ✓ `payments.releaseEscrow` → idempotent kalau status sudah `released`
- ✓ `reviews.create` → `findFirst` check + `@@unique([contract_id,
  reviewer_id])`

## Cara Test

### Test 1: Backend idempotency (curl)

```bash
# Login dulu sebagai bisnis, dapat token
TOKEN="<bisnis-token>"

# Kirim 2 POST identical dalam <10 detik
for i in 1 2; do
  curl -X POST http://localhost:3000/api/v1/projects \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
      "title": "Test Duplicate",
      "description": "Test deskripsi yang panjang minimal 50 karakter untuk validasi DTO yang ada",
      "budget_min": 100000,
      "budget_max": 200000,
      "deadline": "2026-06-30",
      "category": "Desain Grafis",
      "tier": "pemula"
    }' &
done
wait
```

Expected: response 200 dua kali, tapi `data.id` sama di kedua response. Cek DB
— hanya 1 row.

Kemudian retry SAMA persis setelah 11 detik → row baru terbentuk (expected,
karena window 10 detik sudah lewat).

### Test 2: Dispute guard

Buka 2 dispute paralel untuk kontrak yang sama → request kedua return dispute
pertama, tidak insert row baru.

### Test 3: Announcement guard

Admin double-tap "Kirim Broadcast" dalam 10 detik → notif fan-out hanya 1x ke
target users, tidak 2x.

## Run

```bash
cd backend
npm install
npx prisma generate
npm run build
npm run start:dev
```

Note: tidak ada migration baru. Schema Prisma identik dengan versi sebelumnya.

---

# Patch — 28 Mei 2026 (Avatar pada Reviews)

Scope: Backend. Tidak ada migration / perubahan schema / endpoint.

## `src/modules/reviews/reviews.service.ts`

Melengkapi fix avatar lintas-actor: `getByContract` & `getByUser` sebelumnya
meng-`select` user (reviewer/reviewee) TANPA `avatar_url`, sehingga avatar
pe-review pada daftar review (mis. di public profile) selalu jatuh ke inisial
walau user punya foto. Ditambahkan `avatar_url: true` pada select terkait.

Backend `tsc --noEmit`: bersih. Sisa flow pembayaran Xendit (createInvoice,
webhook, sync, rollback) sudah benar — bug pembayaran ada di sisi frontend
(lihat CHANGELOG-AUDIT frontend).
