-- ============================================================
-- StairsLife — Schema additions untuk Sprint Plan 4 minggu
-- ============================================================
-- Jalankan di Supabase SQL Editor atau via psql.
-- Setiap section bisa di-apply terpisah (sesuai minggu).
-- ============================================================

-- ============================================================
-- MINGGU 1: Email verification + password reset
-- ============================================================

-- Tabel token untuk: email_verification, password_reset, login_link (future)
CREATE TABLE IF NOT EXISTS verification_tokens (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    TEXT         NOT NULL UNIQUE,  -- HASH dari token, BUKAN token mentah
  type          TEXT         NOT NULL CHECK (type IN ('email_verification', 'password_reset')),
  expires_at    TIMESTAMPTZ  NOT NULL,
  used_at       TIMESTAMPTZ,                   -- NULL = belum dipakai
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  ip_address    TEXT,                          -- audit trail
  user_agent    TEXT
);

-- Index untuk lookup cepat saat verify
CREATE INDEX IF NOT EXISTS idx_verification_tokens_user_type
  ON verification_tokens (user_id, type) WHERE used_at IS NULL;

-- Cleanup index: hapus token expired secara berkala
CREATE INDEX IF NOT EXISTS idx_verification_tokens_expires
  ON verification_tokens (expires_at);

-- Update users.email_verified_at (kolom baru, bukan boolean — track kapan verify)
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;

-- Backfill: anggap user lama sudah verified (jangan force semua user re-verify)
-- HAPUS baris ini kalau kamu MAU semua user lama harus verify ulang.
UPDATE users SET email_verified_at = COALESCE(created_at, NOW())
WHERE email_verified_at IS NULL;

-- ============================================================
-- MINGGU 2: Google OAuth + profile completion
-- ============================================================

-- OAuth linking. NULL = user pakai email/password biasa.
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id TEXT UNIQUE;

-- Avatar URL (kalau belum ada)
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- Password hash boleh NULL untuk Google-only users.
-- ⚠️ Setelah ALTER ini, kode register/login HARUS mengecek
-- password_hash != NULL sebelum bcrypt.compare(). Kalau user
-- Google-only mencoba login pakai password, return error jelas:
-- "Akun ini terdaftar via Google. Login dengan tombol Google."
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- Portfolio mahasiswa (3-10 contoh karya)
CREATE TABLE IF NOT EXISTS portfolios (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT         NOT NULL,
  description TEXT,
  image_url   TEXT         NOT NULL,
  project_url TEXT,                            -- link demo / live URL
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  display_order INT        DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_portfolios_user
  ON portfolios (user_id, display_order);

-- Skill tags (autocomplete; admin-managed taxonomy)
CREATE TABLE IF NOT EXISTS skills (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        TEXT         NOT NULL UNIQUE,    -- 'react', 'figma', 'ui-design'
  label       TEXT         NOT NULL,           -- 'React', 'Figma', 'UI Design'
  category    TEXT,                            -- 'frontend' | 'design' | 'writing' | ...
  is_active   BOOLEAN      DEFAULT TRUE
);

-- Many-to-many: user_skills, project_skills
CREATE TABLE IF NOT EXISTS user_skills (
  user_id    UUID  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill_id   UUID  NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  level      INT   CHECK (level BETWEEN 1 AND 5),
  PRIMARY KEY (user_id, skill_id)
);

CREATE TABLE IF NOT EXISTS project_skills (
  project_id UUID  NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  skill_id   UUID  NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, skill_id)
);

-- Seed initial skills (bisa di-extend lewat admin)
INSERT INTO skills (slug, label, category) VALUES
  ('html-css',     'HTML/CSS',       'frontend'),
  ('javascript',   'JavaScript',     'frontend'),
  ('react',        'React',          'frontend'),
  ('vue',          'Vue.js',         'frontend'),
  ('nodejs',       'Node.js',        'backend'),
  ('python',       'Python',         'backend'),
  ('php',          'PHP / Laravel',  'backend'),
  ('mobile-dev',   'Mobile Dev',     'mobile'),
  ('figma',        'Figma',          'design'),
  ('ui-design',    'UI Design',      'design'),
  ('ux-design',    'UX Design',      'design'),
  ('illustrator',  'Illustrator',    'design'),
  ('photoshop',    'Photoshop',      'design'),
  ('content-writing', 'Content Writing', 'writing'),
  ('copywriting',  'Copywriting',    'writing'),
  ('translation',  'Translation',    'writing'),
  ('seo',          'SEO',            'marketing'),
  ('social-media', 'Social Media',   'marketing'),
  ('video-editing','Video Editing',  'multimedia'),
  ('photography',  'Photography',    'multimedia'),
  ('data-entry',   'Data Entry',     'admin'),
  ('research',     'Research',       'admin')
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- MINGGU 3: Payment gateway (Midtrans) + wallet
-- ============================================================

-- Saldo virtual mahasiswa.
-- amount = total uang yang sudah di-release tapi belum ditarik.
-- pending_amount = uang yang sedang di-withdrawal request (locked).
CREATE TABLE IF NOT EXISTS wallets (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID         NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  amount          BIGINT       NOT NULL DEFAULT 0 CHECK (amount >= 0),
  pending_amount  BIGINT       NOT NULL DEFAULT 0 CHECK (pending_amount >= 0),
  total_earned    BIGINT       NOT NULL DEFAULT 0,  -- akumulasi histori (untuk dashboard)
  total_withdrawn BIGINT       NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Backfill wallet untuk user mahasiswa existing
INSERT INTO wallets (user_id)
SELECT id FROM users WHERE role = 'mahasiswa'
ON CONFLICT (user_id) DO NOTHING;

-- Transaksi wallet (audit log saldo bertambah/berkurang)
-- Setiap perubahan amount HARUS lewat tabel ini — jangan UPDATE wallets.amount langsung.
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id    UUID         NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  user_id      UUID         NOT NULL REFERENCES users(id),
  type         TEXT         NOT NULL CHECK (type IN (
    'earn_release',     -- dari escrow release
    'earn_split',       -- dari dispute split
    'withdrawal_lock',  -- request withdraw (kurangi amount, tambah pending)
    'withdrawal_done',  -- admin approve (kurangi pending)
    'withdrawal_refund' -- admin reject (kembalikan pending ke amount)
  )),
  amount       BIGINT       NOT NULL,
  ref_type     TEXT,                              -- 'payment' | 'withdrawal' | 'dispute'
  ref_id       UUID,                              -- ID di tabel terkait
  description  TEXT,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallet_tx_wallet
  ON wallet_transactions (wallet_id, created_at DESC);

-- Payment intents: state machine untuk pembayaran via Midtrans Snap.
-- Sebelumnya tabel `payments` langsung jadi escrow tanpa flow gateway.
-- Sekarang flow-nya: create intent → bayar di Midtrans → webhook → upgrade ke `payments`.
CREATE TABLE IF NOT EXISTS payment_intents (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id     UUID         NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  payer_id        UUID         NOT NULL REFERENCES users(id),
  amount          BIGINT       NOT NULL CHECK (amount > 0),
  platform_fee   BIGINT       NOT NULL,
  net_amount      BIGINT       NOT NULL,
  midtrans_order_id TEXT       NOT NULL UNIQUE,    -- order_id yang dikirim ke Midtrans
  snap_token      TEXT,                            -- token Snap (dipakai frontend)
  status          TEXT         NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',     -- baru dibuat, user belum bayar
    'paid',        -- sudah dibayar (lewat webhook)
    'failed',      -- gagal / expired
    'cancelled'    -- user cancel
  )),
  payment_method  TEXT,                            -- 'bca_va' | 'gopay' | 'qris' | ...
  paid_at         TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ,
  raw_response    JSONB,                           -- untuk debugging webhook
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_intents_contract
  ON payment_intents (contract_id);
CREATE INDEX IF NOT EXISTS idx_payment_intents_status
  ON payment_intents (status);

-- Tambahkan kolom ke `payments` untuk link ke intent yang melahirkannya
ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_intent_id UUID
  REFERENCES payment_intents(id);

-- ============================================================
-- MINGGU 4: Withdrawal mahasiswa
-- ============================================================

-- Bank accounts mahasiswa (1 user bisa punya >1 rekening; ada primary)
-- Skema ini menggantikan blob JSON di settings.
CREATE TABLE IF NOT EXISTS bank_accounts (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bank_name       TEXT         NOT NULL,
  bank_code       TEXT,                            -- 'bca', 'mandiri', ... (untuk disbursement API)
  account_number  TEXT         NOT NULL,
  account_holder  TEXT         NOT NULL,
  is_primary      BOOLEAN      DEFAULT FALSE,
  verified_at     TIMESTAMPTZ,                     -- name-check via Xendit/Midtrans (opsional)
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, account_number)
);

-- Hanya satu rekening primary per user
CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_primary
  ON bank_accounts (user_id) WHERE is_primary = TRUE;

-- Withdrawal request
CREATE TABLE IF NOT EXISTS withdrawals (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID         NOT NULL REFERENCES users(id),
  bank_account_id    UUID         NOT NULL REFERENCES bank_accounts(id),
  amount_gross       BIGINT       NOT NULL CHECK (amount_gross > 0),  -- saldo yang dikurangi
  admin_fee          BIGINT       NOT NULL DEFAULT 0,                  -- biaya admin (mis. 2500)
  amount_net         BIGINT       NOT NULL,                            -- yang sampai ke rekening
  status             TEXT         NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',      -- baru request, admin belum action
    'processing',   -- admin approve, sedang disbursement
    'completed',    -- dana sudah cair
    'rejected',     -- admin reject, dana refund ke wallet
    'failed'        -- disbursement gagal (saldo Midtrans habis, dll)
  )),
  rejection_reason   TEXT,
  processed_by       UUID         REFERENCES users(id),    -- admin yang process
  processed_at       TIMESTAMPTZ,
  midtrans_payout_id TEXT,                                  -- untuk track via disbursement API
  requested_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_withdrawals_user
  ON withdrawals (user_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status
  ON withdrawals (status, requested_at);

-- ============================================================
-- BONUS: Audit log umum (opsional, dipakai mulai minggu 3-4)
-- ============================================================

CREATE TABLE IF NOT EXISTS audit_logs (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    UUID         REFERENCES users(id),     -- bisa NULL untuk system event
  action      TEXT         NOT NULL,                  -- 'withdrawal.approve', 'dispute.resolve'
  target_type TEXT,                                   -- 'withdrawal', 'dispute', 'user'
  target_id   UUID,
  metadata    JSONB,
  ip_address  TEXT,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor
  ON audit_logs (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target
  ON audit_logs (target_type, target_id, created_at DESC);

-- ============================================================
-- VERIFICATION QUERIES (jalankan setelah apply)
-- ============================================================

-- Cek semua tabel baru sudah terbuat
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public' AND table_name IN (
--   'verification_tokens', 'portfolios', 'skills', 'user_skills',
--   'project_skills', 'wallets', 'wallet_transactions',
--   'payment_intents', 'bank_accounts', 'withdrawals', 'audit_logs'
-- );

-- Cek kolom baru di users
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'users' AND column_name IN (
--   'email_verified_at', 'google_id', 'avatar_url'
-- );

-- Cek wallet sudah di-backfill
-- SELECT COUNT(*) FROM wallets w
-- JOIN users u ON u.id = w.user_id AND u.role = 'mahasiswa';
