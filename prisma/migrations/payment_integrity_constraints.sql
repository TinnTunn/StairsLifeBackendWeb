-- ============================================================
-- payment_integrity_constraints.sql
-- Audit ronde 1 — perkuat integritas alur pembayaran/escrow.
--
-- Jalankan di Supabase SQL Editor. URUTAN PENTING:
--   1. Jalankan blok CEK (langkah 1) lebih dulu.
--   2. Kalau ada baris yang muncul → BERSIHKAN duplikat dulu, baru
--      jalankan langkah 2. Kalau kosong → langsung langkah 2.
--
-- Index ini adalah BACKSTOP level-DB. Logika aplikasi (FOR UPDATE +
-- UPDATE bersyarat) sudah menahan race; index ini jaminan terakhir.
-- ============================================================

-- 1) CEK DUPLIKAT (jalankan & pastikan hasilnya KOSONG) ----------

-- a. Payment ganda untuk satu kontrak:
SELECT contract_id, COUNT(*) AS n
FROM payments
GROUP BY contract_id
HAVING COUNT(*) > 1;

-- b. wallet_transactions ganda (entity + aksi sama = potensi double-credit):
SELECT ref_type, ref_id, type, COUNT(*) AS n
FROM wallet_transactions
WHERE ref_id IS NOT NULL
GROUP BY ref_type, ref_id, type
HAVING COUNT(*) > 1;

-- 2) BUAT CONSTRAINT (idempotent — aman dijalankan ulang) ---------

-- 1 kontrak = 1 payment. Menutup race "2 createInvoice konkuren → 2 invoice".
CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_contract_id
  ON payments (contract_id);

-- Idempotency-key dompet: 1 (entity, id, aksi) hanya tercatat sekali.
-- Insert kedua (mis. earn_release ganda akibat double-click "Approve")
-- melempar unique_violation → transaksi rollback → TIDAK ada increment ganda.
-- Catatan: baris dgn ref_id NULL dianggap distinct oleh Postgres (tidak
-- mengganggu data lama yang belum punya ref_id).
CREATE UNIQUE INDEX IF NOT EXISTS uq_wallet_tx_ref
  ON wallet_transactions (ref_type, ref_id, type);
