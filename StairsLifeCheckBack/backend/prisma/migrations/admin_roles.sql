-- ============================================================
-- Admin Roles (Access Control) — registry role + permission admin.
-- Jalankan di Supabase SQL Editor.
--
-- CATATAN: ini layer REGISTRI (definisi role + permission yang bisa
-- dikelola), BUKAN enforcement. Enforcement saat ini tetap memakai
-- cek tunggal role='admin' di JwtAuthGuard/RolesGuard. Mengubah
-- enforcement granular adalah langkah terpisah.
-- ============================================================

CREATE TABLE IF NOT EXISTS admin_roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        varchar(100) NOT NULL UNIQUE,
  description varchar(255),
  permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
  members     jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_system   boolean DEFAULT false,        -- role bawaan, tidak boleh dihapus
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

-- Seed default (idempotent) — sesuai mock ADMIN_ROLES sebelumnya.
INSERT INTO admin_roles (name, description, permissions, members, is_system)
VALUES
  ('Super Admin', 'Akses penuh ke semua modul',
   '["Overview","Projects","Users","Verification","Disputes","Support","Announcement","Settings"]'::jsonb,
   '["Super Admin"]'::jsonb, true),
  ('Admin', 'Operasional harian',
   '["Overview","Projects","Users","Verification","Disputes","Support"]'::jsonb,
   '["Ops Admin"]'::jsonb, false)
ON CONFLICT (name) DO NOTHING;

-- Verifikasi:
-- SELECT name, permissions, members, is_system FROM admin_roles ORDER BY created_at;
