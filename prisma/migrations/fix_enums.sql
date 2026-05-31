-- ============================================================
-- Fix enum mismatches (H9, H10)
-- ============================================================
-- Jalankan di Supabase SQL Editor

-- 1. Tambah 'split_settled' ke payment_status enum
-- (dipakai saat dispute diselesaikan dengan outcome 'split')
ALTER TYPE payment_status ADD VALUE IF NOT EXISTS 'split_settled';

-- 2. Tambah 'refunded' ke payment_status kalau belum ada
ALTER TYPE payment_status ADD VALUE IF NOT EXISTS 'refunded';

-- 3. Tambah 'cancelled' ke contract_status enum
-- (dipakai saat bisnis menang dispute / kontrak dibatalkan)
ALTER TYPE contract_status ADD VALUE IF NOT EXISTS 'cancelled';

-- ============================================================
-- Verifikasi setelah run
-- ============================================================
-- SELECT enum_range(NULL::payment_status);
-- SELECT enum_range(NULL::contract_status);
