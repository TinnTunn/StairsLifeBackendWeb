-- StairsLife — Migration: Add persistent notifications table
--
-- Apply ini di Supabase SQL Editor atau psql kalau database SUDAH ADA data
-- dan kamu tidak mau reset. Kalau kamu jalankan `npx prisma db push` di
-- environment dev fresh, ini tidak perlu — Prisma akan auto-create.
--
-- Idempotent: aman dijalankan berkali-kali (semua statement pakai IF NOT EXISTS).

-- 1) Enum notification_type
DO $$ BEGIN
  CREATE TYPE notification_type AS ENUM (
    'application',
    'contract',
    'payment',
    'review',
    'dispute',
    'verification',
    'system'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 2) Tabel notifications
CREATE TABLE IF NOT EXISTS notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        notification_type NOT NULL,
  title       VARCHAR(255) NOT NULL,
  body        TEXT NOT NULL,
  ref_id      UUID,
  action_url  TEXT,
  is_read     BOOLEAN NOT NULL DEFAULT FALSE,
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3) Index untuk query umum
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread_created
  ON notifications (user_id, is_read, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications (user_id, created_at DESC);

-- 4) Verifikasi
SELECT
  (SELECT COUNT(*) FROM pg_type WHERE typname = 'notification_type') AS enum_created,
  (SELECT COUNT(*) FROM information_schema.tables
   WHERE table_name = 'notifications') AS table_created,
  (SELECT COUNT(*) FROM pg_indexes
   WHERE tablename = 'notifications') AS indexes_created;
