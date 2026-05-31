-- ============================================================
-- Audit Logs — jejak aksi admin (suspend, delete, resolve dispute,
-- review verifikasi, announcement, ubah settings).
-- Jalankan di Supabase SQL Editor.
-- ============================================================

CREATE TABLE IF NOT EXISTS audit_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_name  varchar(255),
  action      varchar(255) NOT NULL,          -- mis. 'user.suspend', 'dispute.resolve'
  target_type varchar(100),                   -- mis. 'user', 'dispute', 'verification'
  target_id   varchar(255),
  metadata    jsonb,                          -- detail tambahan (alasan, outcome, dll)
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at
  ON audit_logs (created_at DESC);

-- Verifikasi:
-- SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 20;
