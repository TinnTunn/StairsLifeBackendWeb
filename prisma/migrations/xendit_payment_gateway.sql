-- ============================================================
-- StairsLife — Migration: Xendit Payment Gateway Integration
-- ============================================================
-- Jalankan di Supabase SQL Editor.
-- Setiap section ber-IF-EXISTS / IF-NOT-EXISTS, aman di-rerun.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. ENUM payment_status — tambah value yang dibutuhkan
-- ============================================================
-- ALTER TYPE ... ADD VALUE tidak bisa dipanggil di dalam transaction
-- di sebagian versi PostgreSQL — jalankan section ini di luar transaction
-- kalau error.
-- Note: di Supabase modern (PG 15+) ini OK.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'split_settled'
                 AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'payment_status')) THEN
    ALTER TYPE payment_status ADD VALUE 'split_settled';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'expired'
                 AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'payment_status')) THEN
    ALTER TYPE payment_status ADD VALUE 'expired';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'failed'
                 AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'payment_status')) THEN
    ALTER TYPE payment_status ADD VALUE 'failed';
  END IF;
END$$;

-- ============================================================
-- 2. ENUM notification_type — tambah 'withdrawal'
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'withdrawal'
                 AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'notification_type')) THEN
    ALTER TYPE notification_type ADD VALUE 'withdrawal';
  END IF;
END$$;

-- ============================================================
-- 3. Tabel payments — tambah kolom Xendit
-- ============================================================
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS xendit_external_id  VARCHAR(100) UNIQUE,
  ADD COLUMN IF NOT EXISTS xendit_invoice_id   VARCHAR(100),
  ADD COLUMN IF NOT EXISTS xendit_invoice_url  TEXT,
  ADD COLUMN IF NOT EXISTS payment_method      VARCHAR(50),
  ADD COLUMN IF NOT EXISTS payment_channel     VARCHAR(50),
  ADD COLUMN IF NOT EXISTS expires_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS paid_at             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS xendit_payload      JSONB,
  ADD COLUMN IF NOT EXISTS xendit_refund_id    VARCHAR(100),
  ADD COLUMN IF NOT EXISTS refunded_at         TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_payments_status_created
  ON payments (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_xendit_invoice
  ON payments (xendit_invoice_id);

-- ============================================================
-- 4. Wallet & Wallet Transactions
-- ============================================================
CREATE TABLE IF NOT EXISTS wallets (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID         NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  amount          BIGINT       NOT NULL DEFAULT 0 CHECK (amount >= 0),
  pending_amount  BIGINT       NOT NULL DEFAULT 0 CHECK (pending_amount >= 0),
  total_earned    BIGINT       NOT NULL DEFAULT 0,
  total_withdrawn BIGINT       NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Backfill: setiap mahasiswa yang sudah ada wajib punya wallet kosong.
-- (Wallet untuk role lain di-create on-demand di service kalau perlu).
INSERT INTO wallets (user_id)
SELECT id FROM users WHERE role = 'mahasiswa'
ON CONFLICT (user_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id    UUID         NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  user_id      UUID         NOT NULL REFERENCES users(id),
  type         VARCHAR(50)  NOT NULL CHECK (type IN (
    'earn_release',     -- dari escrow released
    'earn_split',       -- dari dispute split outcome
    'withdrawal_lock',  -- request withdrawal: amount → pending_amount
    'withdrawal_done',  -- admin approve: pending_amount turun
    'withdrawal_refund' -- admin reject: pending_amount → amount
  )),
  amount       BIGINT       NOT NULL,
  ref_type     VARCHAR(50),                       -- 'payment' | 'withdrawal' | 'dispute'
  ref_id       UUID,
  description  TEXT,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallet_tx_wallet
  ON wallet_transactions (wallet_id, created_at DESC);

-- ============================================================
-- 5. Bank Accounts
-- ============================================================
CREATE TABLE IF NOT EXISTS bank_accounts (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bank_name       VARCHAR(100) NOT NULL,
  bank_code       VARCHAR(20)  NOT NULL,            -- "BCA", "BNI", "MANDIRI", "BRI", dll
  account_number  VARCHAR(30)  NOT NULL,
  account_holder  VARCHAR(255) NOT NULL,
  is_primary      BOOLEAN      DEFAULT FALSE,
  verified_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, account_number)
);

-- Hanya 1 primary per user (partial unique index).
CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_primary
  ON bank_accounts (user_id) WHERE is_primary = TRUE;

CREATE INDEX IF NOT EXISTS idx_bank_user
  ON bank_accounts (user_id, is_primary);

-- ============================================================
-- 6. Withdrawals
-- ============================================================
CREATE TABLE IF NOT EXISTS withdrawals (
  id                       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID         NOT NULL REFERENCES users(id),
  bank_account_id          UUID         NOT NULL REFERENCES bank_accounts(id),
  amount_gross             INTEGER      NOT NULL CHECK (amount_gross > 0),
  admin_fee                INTEGER      NOT NULL DEFAULT 0,
  amount_net               INTEGER      NOT NULL,
  status                   VARCHAR(20)  NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',     -- request baru masuk, admin belum action
    'processing',  -- admin approve, sedang disbursement (atau menunggu Xendit callback)
    'completed',   -- dana cair ke rekening
    'rejected',    -- admin reject, dana refund ke wallet
    'failed'       -- disbursement gagal (saldo Xendit habis / rekening invalid)
  )),
  rejection_reason         TEXT,
  processed_by             UUID         REFERENCES users(id),
  processed_at             TIMESTAMPTZ,
  xendit_disbursement_id   VARCHAR(100),
  xendit_payload           JSONB,
  requested_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_withdrawals_user
  ON withdrawals (user_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status
  ON withdrawals (status, requested_at);

COMMIT;

-- ============================================================
-- VERIFICATION QUERIES (jalankan setelah apply)
-- ============================================================

-- Cek enum payment_status sudah punya semua nilai:
-- SELECT unnest(enum_range(NULL::payment_status));

-- Cek kolom Xendit ada di payments:
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'payments' AND column_name LIKE 'xendit_%';

-- Cek tabel baru ada:
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public'
--   AND table_name IN ('wallets', 'wallet_transactions', 'bank_accounts', 'withdrawals');

-- Cek wallet sudah di-backfill ke mahasiswa:
-- SELECT COUNT(*) FROM wallets w
-- JOIN users u ON u.id = w.user_id AND u.role = 'mahasiswa';
