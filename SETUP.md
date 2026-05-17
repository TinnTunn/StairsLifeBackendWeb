# Setup Guide — StairsLife Backend

Ikuti langkah ini **berurutan** agar `npm run lint` dan `npm run build` berjalan tanpa error.

## 1. Install dependencies

```bash
npm install
```

## 2. Setup environment

```bash
cp .env.example .env
```

Lalu edit `.env` — isi setidaknya:
```
DATABASE_URL=postgresql://...
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
JWT_SECRET=<64+ char hex>
```

Generate JWT_SECRET:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

## 3. Generate Prisma client ← WAJIB sebelum lint/build

```bash
npx prisma generate
```

> ⚠️ **Ini langkah paling penting yang sering terlewat.**
>
> Tanpa ini, TypeScript tidak tahu type dari `this.prisma.users`, `this.prisma.projects`, dll.
> ESLint akan melaporkan ratusan error `no-unsafe-call` dan `no-unsafe-member-access`
> yang sebenarnya bukan bug — hanya karena types belum ada.
>
> Setelah `prisma generate`, errors tersebut hilang.

## 4. Lint

```bash
npm run lint
```

Setelah step 3, errors yang tersisa hanya **warnings** (bukan errors) dari pola `any`
yang memang disengaja untuk kompatibilitas dengan Supabase client.

## 5. Build

```bash
npm run build
```

## 6. Jalankan

```bash
# Development
npm run start:dev

# Production
npm run start:prod
```

---

## Kenapa banyak error saat `npm run lint` pertama kali?

Error `Unsafe call of a type that could not be resolved` dan
`Unsafe member access .findMany on a type that cannot be resolved`
datang dari **Prisma client yang belum di-generate**.

`@prisma/client` meng-generate TypeScript types dari `schema.prisma` ke
`node_modules/@prisma/client`. Tanpa generate, types tersebut tidak ada,
sehingga TypeScript/ESLint tidak bisa resolve type dari:
- `this.prisma.users`
- `this.prisma.projects`
- `this.prisma.contracts`
- dll.

**Solusi**: jalankan `npx prisma generate` → errors hilang.

---

## Troubleshooting

### Error: "JWT_SECRET tidak di-set di environment"
Pastikan `.env` ada dan `JWT_SECRET` tidak kosong. Minimal 64 karakter.

### Error: "Cannot connect to database"
Pastikan `DATABASE_URL` benar. Gunakan **pooled connection** Supabase (port 5432).

### `npm run lint` masih ada warnings setelah `prisma generate`
Warnings yang tersisa adalah pola `any` yang sengaja dari Supabase client
dan beberapa controller yang menggunakan `@Body() body: any`.
Ini bukan bug — hanya technical debt yang bisa di-address bertahap.
