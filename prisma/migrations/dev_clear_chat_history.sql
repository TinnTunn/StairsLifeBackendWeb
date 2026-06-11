-- ════════════════════════════════════════════════════════════════
-- DEV-ONLY: Hapus SEMUA history chat untuk testing bersih
-- ════════════════════════════════════════════════════════════════
--
-- Run di Supabase SQL Editor saat ingin reset chat state.
-- AMAN: kontrak, project, user, payment TIDAK terhapus — hanya pesan.
--
-- WARNING: Pesan yang sudah dihapus tidak bisa di-recover. JANGAN run
-- di production kecuali memang ingin reset semua chat.
-- ════════════════════════════════════════════════════════════════

BEGIN;

-- 1. Hapus pesan kontrak (chat student ↔ business via WS)
DELETE FROM messages;

-- 2. Hapus pesan support / inquiry / mediasi
--    room_id prefix:
--      'support-{userId}'        → chat user ↔ admin
--      'inquiry-{userA}-{userB}' → chat pre-kontrak antar user
--      'mediation-{disputeId}'   → mediasi dispute
DELETE FROM support_messages;

-- (Opsional) reset unread count contoh — tidak perlu karena unread_count
-- dihitung dari messages.is_read di query /chat/rooms.

COMMIT;

-- Verifikasi (run setelah commit):
-- SELECT COUNT(*) AS messages_left FROM messages;
-- SELECT COUNT(*) AS support_left  FROM support_messages;
-- Keduanya harus return 0.
