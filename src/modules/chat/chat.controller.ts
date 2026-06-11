import type { JwtUser } from '../../common/types/jwt-payload.type';
import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SupabaseService } from '../../config/supabase.config';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';
import { IsString, IsNotEmpty, IsUUID } from 'class-validator';

class SendMessageDto {
  @IsString()
  @IsNotEmpty()
  content: string;
}

class DirectMessageDto {
  @IsUUID()
  receiver_id: string;

  @IsString()
  @IsNotEmpty()
  content: string;
}

@Controller('chat')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ChatController {
  constructor(
    private supabase: SupabaseService,
    private chatService: ChatService,
    private chatGateway: ChatGateway,
  ) {}

  @Get('rooms')
  async getMyRooms(@CurrentUser() user: JwtUser) {
    const supabase = this.supabase.getClient();
    const { data: contracts } = await supabase
      .from('contracts')
      .select(
        `
        id, status, agreed_budget,
        projects!project_id (id, title),
        users_contracts_student_idTousers:users!student_id (id, full_name),
        users_contracts_business_idTousers:users!business_id (id, full_name)
      `,
      )
      .or(`student_id.eq.${user.id},business_id.eq.${user.id}`)
      .order('created_at', { ascending: false });

    // Enrich tiap kontrak dengan pesan terakhir (untuk tampilan ala WhatsApp:
    // snippet + urut terbaru). Satu query saja (bukan N+1).
    const list = contracts || [];
    const ids = list.map((c: any) => c.id);
    const lastMsg: Record<string, any> = {};
    const unreadCount: Record<string, number> = {};
    if (ids.length) {
      const { data: msgs } = await supabase
        .from('messages')
        .select('contract_id, content, created_at, sender_id, is_read')
        .in('contract_id', ids)
        .order('created_at', { ascending: false });
      for (const m of msgs || []) {
        if (!lastMsg[m.contract_id]) lastMsg[m.contract_id] = m; // pertama = terbaru
        // Belum dibaca = pesan dari LAWAN (bukan aku) yang is_read != true.
        if (m.sender_id !== user.id && m.is_read !== true) {
          unreadCount[m.contract_id] = (unreadCount[m.contract_id] || 0) + 1;
        }
      }
    }
    const enriched = list.map((c: any) => ({
      ...c,
      last_message: lastMsg[c.id]?.content ?? null,
      last_message_at: lastMsg[c.id]?.created_at ?? null,
      unread_count: unreadCount[c.id] || 0,
    }));

    return { data: enriched, message: 'Berhasil' };
  }

  @Get('support')
  async getSupportRoom(@CurrentUser() user: JwtUser) {
    const supabase = this.supabase.getClient();
    const roomId = `support-${user.id}`;

    const { data: messages } = await supabase
      .from('support_messages')
      .select(`*, sender:users!sender_id (id, full_name, role)`)
      .eq('room_id', roomId)
      .order('created_at', { ascending: true });

    return {
      data: {
        room_id: roomId,
        messages: messages || [],
        last_message: messages?.length
          ? messages[messages.length - 1].content
          : null,
      },
      message: 'Berhasil',
    };
  }

  @Post('support/messages')
  async sendSupportMessage(
    @Body() dto: SendMessageDto,
    @CurrentUser() user: JwtUser,
  ) {
    const supabase = this.supabase.getClient();
    const roomId = `support-${user.id}`;

    const { data, error } = await supabase
      .from('support_messages')
      .insert({
        room_id: roomId,
        sender_id: user.id,
        content: dto.content,
        sender_role: user.role,
        created_at: new Date().toISOString(),
      })
      .select(`*, sender:users!sender_id (id, full_name, role)`)
      .single();

    if (error) throw new Error(error.message);

    // WA-style realtime: push ke SEMUA admin yang sedang online supaya
    // admin inbox + room mereka update tanpa polling. Kita ambil daftar
    // admin dari tabel users (sedikit; admin biasanya < 5 orang).
    const { data: admins } = await supabase
      .from('users')
      .select('id')
      .eq('role', 'admin');
    const senderName =
      (data as { sender?: { full_name?: string } })?.sender?.full_name ||
      (user as { full_name?: string }).full_name ||
      'Pengguna';
    const createdAt =
      (data as { created_at?: string })?.created_at ?? new Date().toISOString();
    for (const a of admins || []) {
      this.chatGateway.emitSupportMessage(a.id, {
        roomId,
        senderUserId: user.id,
        senderRole: user.role as 'student' | 'mahasiswa' | 'bisnis',
        senderName,
        content: dto.content,
        created_at: createdAt,
      });
    }
    // Echo balik ke pengirim juga (di tab lain dia bisa lihat update).
    this.chatGateway.emitSupportMessage(user.id, {
      roomId,
      senderUserId: user.id,
      senderRole: user.role as 'student' | 'mahasiswa' | 'bisnis',
      senderName,
      content: dto.content,
      created_at: createdAt,
    });

    return { data, message: 'Pesan terkirim' };
  }

  @Get('support-inbox')
  @Roles('admin')
  async getSupportInbox(@CurrentUser() _user: JwtUser) {
    const supabase = this.supabase.getClient();

    const { data: messages } = await supabase
      .from('support_messages')
      .select(
        `
        room_id, content, created_at,
        sender:users!sender_id (id, full_name, role, is_suspended, suspension_reason)
      `,
      )
      .order('created_at', { ascending: false });

    const rooms: Record<string, any> = {};
    (messages || []).forEach((m: any) => {
      if (!rooms[m.room_id]) {
        rooms[m.room_id] = {
          room_id: m.room_id,
          user_id: m.sender?.id,
          user_name: m.sender?.full_name,
          user_role: m.sender?.role,
          is_suspended: m.sender?.is_suspended,
          suspension_reason: m.sender?.suspension_reason,
          last_message: m.content,
          updated_at: m.created_at,
        };
      }
    });

    return { data: Object.values(rooms), message: 'Berhasil' };
  }

  @Post('support/:roomId/reply')
  @Roles('admin')
  async adminReplySupport(
    @Param('roomId') roomId: string,
    @Body() dto: SendMessageDto,
    @CurrentUser() user: JwtUser,
  ) {
    const supabase = this.supabase.getClient();

    const { data, error } = await supabase
      .from('support_messages')
      .insert({
        room_id: roomId,
        sender_id: user.id,
        content: dto.content,
        sender_role: 'admin',
        created_at: new Date().toISOString(),
      })
      .select(`*, sender:users!sender_id (id, full_name, role)`)
      .single();

    if (error) throw new Error(error.message);

    // WA-style realtime: roomId untuk support = "support-{userId}", jadi user
    // pemilik room = potongan setelah prefix. Push ke dia supaya layar chat-nya
    // langsung tampilkan balasan admin tanpa polling.
    const recipientUserId = roomId.replace(/^support-/, '');
    const senderName =
      (data as { sender?: { full_name?: string } })?.sender?.full_name ||
      (user as { full_name?: string }).full_name ||
      'Admin Support';
    const createdAt =
      (data as { created_at?: string })?.created_at ?? new Date().toISOString();
    if (recipientUserId) {
      this.chatGateway.emitSupportMessage(recipientUserId, {
        roomId,
        senderUserId: user.id,
        senderRole: 'admin',
        senderName,
        content: dto.content,
        created_at: createdAt,
      });
    }
    // Echo ke admin sendiri (kalau ada tab lain terbuka)
    this.chatGateway.emitSupportMessage(user.id, {
      roomId,
      senderUserId: user.id,
      senderRole: 'admin',
      senderName,
      content: dto.content,
      created_at: createdAt,
    });

    return { data, message: 'Balasan terkirim' };
  }

  @Get('support-rooms')
  @Roles('admin')
  async getSupportRooms(@CurrentUser() _user: JwtUser) {
    const supabase = this.supabase.getClient();
    const { data: users } = await supabase
      .from('users')
      .select(
        'id, full_name, email, role, is_suspended, suspension_reason, created_at',
      )
      .eq('is_suspended', true)
      .order('created_at', { ascending: false });

    return { data: users || [], message: 'Berhasil' };
  }

  @Get('support-history/:roomId')
  @Roles('admin')
  async getSupportHistory(
    @Param('roomId') roomId: string,
    @CurrentUser() _user: JwtUser,
  ) {
    const supabase = this.supabase.getClient();
    const { data } = await supabase
      .from('support_messages')
      .select(`*, sender:users!sender_id (id, full_name, role)`)
      .eq('room_id', roomId)
      .order('created_at', { ascending: true });
    return { data: data || [], message: 'Berhasil' };
  }

  // ──────────────────────────────────────────────────────────────
  // CONTRACT MESSAGES — SECURITY: validasi akses kontrak dulu.
  // Sebelumnya: user manapun yang login bisa baca/kirim pesan ke
  // kontrak orang lain asal tahu UUID-nya. Sekarang: cek lewat
  // ChatService.validateContractAccess() (sama pola dgn WS gateway).
  // ──────────────────────────────────────────────────────────────

  @Get(':contractId/messages')
  async getMessages(
    @Param('contractId') contractId: string,
    @CurrentUser() user: JwtUser,
  ) {
    const hasAccess = await this.chatService.validateContractAccess(
      contractId,
      user.id,
    );
    if (!hasAccess && user.role !== 'admin') {
      // Admin di-allow untuk mediasi/audit. User lain ditolak.
      throw new ForbiddenException(
        'Kamu tidak punya akses ke chat kontrak ini',
      );
    }

    const { data, error } = await this.supabase
      .getClient()
      .from('messages')
      .select(`*, sender:users!sender_id (id, full_name, role)`)
      .eq('contract_id', contractId)
      .order('created_at', { ascending: true });

    if (error) throw new Error(error.message);

    // BUG FIX: auto-mark sebagai dibaca saat user fetch history via REST.
    // Skenario yg ditutup: kalau WS tidak konek, joinRoom tidak fire →
    // markAsRead WS gateway tidak jalan → badge unread tetap walau user
    // sudah lihat pesan. Cabang fallback REST sekarang juga mark-read.
    // Admin di-skip supaya tidak menandai pesan sebagai dibaca saat
    // sekadar audit/mediasi.
    if (user.role !== 'admin') {
      try {
        await this.chatService.markAsRead(contractId, user.id);
      } catch (_) {
        // Non-fatal — fetch tetap success, mark-read bisa retry next time.
      }
    }

    return { data, message: 'Berhasil' };
  }

  @Post(':contractId/messages')
  async sendMessage(
    @Param('contractId') contractId: string,
    @Body() dto: SendMessageDto,
    @CurrentUser() user: JwtUser,
  ) {
    // Untuk kirim, admin TIDAK boleh menyamar jadi pihak —
    // admin punya jalur sendiri lewat /chat/support/:roomId/reply.
    const hasAccess = await this.chatService.validateContractAccess(
      contractId,
      user.id,
    );
    if (!hasAccess) {
      throw new ForbiddenException(
        'Kamu tidak punya akses untuk mengirim pesan di kontrak ini',
      );
    }

    const { data, error } = await this.supabase
      .getClient()
      .from('messages')
      .insert({
        contract_id: contractId,
        sender_id: user.id,
        content: dto.content,
        created_at: new Date().toISOString(),
      })
      .select(`*, sender:users!sender_id (id, full_name, role)`)
      .single();

    if (error) throw new Error(error.message);

    // BUG FIX: REST send DULU cuma simpan ke DB tanpa emit WS event. Akibat:
    // kalau WS pengirim down → fallback REST jalan, tapi penerima TIDAK
    // pernah dapat realtime push → pesan baru "hilang" sampai refresh.
    // Sekarang: setelah simpan, emit WS event yang sama seperti via gateway
    // → penerima dapat new_message (kalau di room) atau chat_inbox (kalau di
    // daftar chat), persis sama dgn jalur WS.
    try {
      const parties = await this.chatService.getContractParties(contractId);
      const recipientId = parties
        ? (parties.student_id === user.id
            ? parties.business_id
            : parties.student_id)
        : null;
      const senderName =
        (data as { sender?: { full_name?: string } })?.sender?.full_name ||
        (user as { full_name?: string }).full_name ||
        'Seseorang';
      this.chatGateway.emitContractMessage(
        contractId,
        data,
        user.id,
        recipientId,
        senderName,
      );
    } catch {
      // Non-fatal — simpan sudah berhasil. Push realtime gagal tidak boleh
      // membatalkan response. User bisa refresh untuk lihat.
    }

    return { data, message: 'Pesan terkirim' };
  }

  @Post('direct')
  async sendDirectMessage(
    @Body() dto: DirectMessageDto,
    @CurrentUser() user: JwtUser,
  ) {
    const supabase = this.supabase.getClient();

    const { data: contract } = await supabase
      .from('contracts')
      .select('id, student_id, business_id')
      .or(
        `and(student_id.eq.${user.id},business_id.eq.${dto.receiver_id}),and(student_id.eq.${dto.receiver_id},business_id.eq.${user.id})`,
      )
      .limit(1)
      .maybeSingle();

    if (!contract) {
      throw new NotFoundException(
        'Belum ada kontrak antara kamu dan user ini. Chat tersedia setelah kontrak dibuat.',
      );
    }

    // Double-check (paranoia): kontrak hasil filter HARUS melibatkan user
    if (contract.student_id !== user.id && contract.business_id !== user.id) {
      throw new ForbiddenException('Kamu bukan pihak di kontrak ini');
    }

    const { data, error } = await supabase
      .from('messages')
      .insert({
        contract_id: contract.id,
        sender_id: user.id,
        content: dto.content,
        created_at: new Date().toISOString(),
      })
      .select(`*, sender:users!sender_id (id, full_name, role)`)
      .single();

    if (error) throw new Error(error.message);
    return { data, message: 'Pesan terkirim' };
  }

  // ──────────────────────────────────────────────────────────────
  // INQUIRY CHAT (pre-contract)
  // ──────────────────────────────────────────────────────────────
  // Sebelumnya chat sebelum kontrak hanya tersimpan di memori FE
  // (CHAT_MESSAGES[chatId] di chat.js) — hilang saat refresh, target
  // tidak menerima.
  //
  // Solusi: pakai tabel `support_messages` yang sudah ada (kolom
  // room_id tersedia) dengan konvensi room_id:
  //   inquiry-{userA_id}-{userB_id}  (sorted alphabetically)
  //
  // Sorting alphabetical memastikan A→B dan B→A menghasilkan room_id
  // yang sama, jadi kedua user lihat percakapan yang konsisten.
  //
  // Yang TIDAK kami lakukan: bikin tabel baru `inquiries`. Cukup pakai
  // support_messages dengan prefix `inquiry-` untuk room_id — ini
  // mengurangi kompleksitas tanpa mengurangi fungsionalitas.

  private _buildInquiryRoomId(userIdA: string, userIdB: string): string {
    // Sort alphabetical supaya A→B dan B→A jadi room yang sama
    const [a, b] = [userIdA, userIdB].sort();
    return `inquiry-${a}-${b}`;
  }

  @Get('inquiry/:otherUserId/messages')
  async getInquiryMessages(
    @Param('otherUserId') otherUserId: string,
    @CurrentUser() user: JwtUser,
  ) {
    if (otherUserId === user.id) {
      throw new ForbiddenException('Tidak bisa chat dengan diri sendiri');
    }

    const supabase = this.supabase.getClient();
    const roomId = this._buildInquiryRoomId(user.id, otherUserId);

    // Pastikan target user ada (cegah kirim pesan ke UUID acak)
    const { data: targetUser } = await supabase
      .from('users')
      .select('id, full_name, role, avatar_url')
      .eq('id', otherUserId)
      .maybeSingle();
    if (!targetUser) {
      throw new NotFoundException('User tidak ditemukan');
    }

    const { data: messages, error } = await supabase
      .from('support_messages')
      .select(`*, sender:users!sender_id (id, full_name, role, avatar_url)`)
      .eq('room_id', roomId)
      .order('created_at', { ascending: true });

    if (error) throw new Error(error.message);
    return {
      data: {
        room_id: roomId,
        other_user: targetUser,
        messages: messages || [],
      },
      message: 'Berhasil',
    };
  }

  @Post('inquiry/:otherUserId/messages')
  async sendInquiryMessage(
    @Param('otherUserId') otherUserId: string,
    @Body() dto: SendMessageDto,
    @CurrentUser() user: JwtUser,
  ) {
    if (otherUserId === user.id) {
      throw new ForbiddenException('Tidak bisa chat dengan diri sendiri');
    }

    const supabase = this.supabase.getClient();

    // Validasi target user ada & aktif (tidak suspended)
    const { data: targetUser } = await supabase
      .from('users')
      .select('id, is_suspended')
      .eq('id', otherUserId)
      .maybeSingle();
    if (!targetUser) {
      throw new NotFoundException('User tidak ditemukan');
    }
    if (targetUser.is_suspended) {
      throw new ForbiddenException('User ini sedang disuspend');
    }

    const roomId = this._buildInquiryRoomId(user.id, otherUserId);

    const { data, error } = await supabase
      .from('support_messages')
      .insert({
        room_id: roomId,
        sender_id: user.id,
        content: dto.content,
        sender_role: user.role,
        created_at: new Date().toISOString(),
      })
      .select(`*, sender:users!sender_id (id, full_name, role, avatar_url)`)
      .single();

    if (error) throw new Error(error.message);

    // Notif ke receiver — non-blocking, kalau gagal tidak mempengaruhi response
    void this.chatService.notifyInquiry?.(otherUserId, user, dto.content);

    // WA-style realtime: push WS event ke kedua pihak supaya inquiry chat
    // langsung update tanpa polling. Pakai event 'support_message' karena
    // payload-nya identik (FE listener sudah tangani berdasarkan roomId).
    const senderName =
      (data as { sender?: { full_name?: string } })?.sender?.full_name ||
      (user as { full_name?: string }).full_name ||
      'Pengguna';
    const createdAt =
      (data as { created_at?: string })?.created_at ?? new Date().toISOString();
    const payload = {
      roomId,
      senderUserId: user.id,
      senderRole: user.role as 'student' | 'mahasiswa' | 'bisnis' | 'admin',
      senderName,
      content: dto.content,
      created_at: createdAt,
    };
    this.chatGateway.emitSupportMessage(otherUserId, payload);
    this.chatGateway.emitSupportMessage(user.id, payload);

    return { data, message: 'Pesan terkirim' };
  }

  @Get('inquiry-rooms')
  async getInquiryRooms(@CurrentUser() user: JwtUser) {
    const supabase = this.supabase.getClient();

    // Pattern matching: cari semua room di mana user.id ada di room_id
    // Format: inquiry-{a}-{b} dimana a/b adalah UUID
    const { data: messages } = await supabase
      .from('support_messages')
      .select(
        `
        id, room_id, content, created_at, sender_id,
        sender:users!sender_id (id, full_name, role, avatar_url)
      `,
      )
      .like('room_id', 'inquiry-%')
      .or(`room_id.like.%${user.id}%`)
      .order('created_at', { ascending: false });

    // Group per room — ambil pesan terakhir dan info lawan bicara
    const rooms: Record<string, any> = {};
    for (const m of messages || []) {
      if (!m.room_id.includes(user.id)) continue; // safety filter

      if (!rooms[m.room_id]) {
        // Extract other user ID dari room_id (format: inquiry-{a}-{b})
        // Karena room_id = "inquiry-{uuid1}-{uuid2}", kita strip "inquiry-"
        // lalu split UUID berdasarkan posisi (UUID = 36 chars dengan dash).
        const withoutPrefix = m.room_id.replace(/^inquiry-/, '');
        const userA = withoutPrefix.substring(0, 36);
        const userB = withoutPrefix.substring(37); // skip "-"
        const otherId = userA === user.id ? userB : userA;

        // Fetch other user info — bisa di-batch nanti kalau performance issue
        rooms[m.room_id] = {
          room_id: m.room_id,
          other_user_id: otherId,
          last_message: m.content,
          last_message_at: m.created_at,
          last_sender_id: m.sender_id,
        };
      }
    }

    // Enrich dengan info user lawan
    const roomList = Object.values(rooms);
    if (roomList.length > 0) {
      const otherIds = [...new Set(roomList.map((r: any) => r.other_user_id))];
      const { data: users } = await supabase
        .from('users')
        .select('id, full_name, role, avatar_url')
        .in('id', otherIds);

      const userMap = new Map((users || []).map((u: any) => [u.id, u]));
      roomList.forEach((r: any) => {
        r.other_user = userMap.get(r.other_user_id) || null;
      });
    }

    return { data: roomList, message: 'Berhasil' };
  }

  // ════════════════════════════════════════════════════════════
  //  MEDIATION CHAT (dispute) — persisten via support_messages
  //  room_id = "mediation-{disputeId}". Peserta: student & business
  //  dari kontrak yang disengketakan, + admin. Pola sama dgn inquiry,
  //  tanpa tabel baru.
  // ════════════════════════════════════════════════════════════

  private _mediationRoomId(disputeId: string): string {
    return `mediation-${disputeId}`;
  }

  /**
   * Pastikan requester berhak akses room mediasi dispute ini.
   * Return info dispute+kontrak; throw kalau tidak berhak.
   */
  private async _authorizeMediation(disputeId: string, user: JwtUser) {
    const supabase = this.supabase.getClient();
    const { data: dispute } = await supabase
      .from('disputes')
      .select(
        `id, contract_id,
         contracts:contracts!contract_id ( id, student_id, business_id )`,
      )
      .eq('id', disputeId)
      .maybeSingle();

    if (!dispute) throw new NotFoundException('Dispute tidak ditemukan');

    const contract = (dispute as any).contracts;
    const isParticipant =
      contract &&
      (contract.student_id === user.id || contract.business_id === user.id);
    const isAdmin = user.role === 'admin';

    if (!isParticipant && !isAdmin) {
      throw new ForbiddenException(
        'Kamu tidak punya akses ke ruang mediasi ini',
      );
    }
    return dispute as any;
  }

  @Get('mediation/:disputeId/messages')
  async getMediationMessages(
    @Param('disputeId') disputeId: string,
    @CurrentUser() user: JwtUser,
  ) {
    await this._authorizeMediation(disputeId, user);
    const supabase = this.supabase.getClient();
    const roomId = this._mediationRoomId(disputeId);

    const { data: messages, error } = await supabase
      .from('support_messages')
      .select(`*, sender:users!sender_id (id, full_name, role, avatar_url)`)
      .eq('room_id', roomId)
      .order('created_at', { ascending: true });

    if (error) throw new Error(error.message);
    return {
      data: {
        room_id: roomId,
        dispute_id: disputeId,
        messages: messages || [],
      },
      message: 'Berhasil',
    };
  }

  @Post('mediation/:disputeId/messages')
  async sendMediationMessage(
    @Param('disputeId') disputeId: string,
    @Body() dto: SendMessageDto,
    @CurrentUser() user: JwtUser,
  ) {
    await this._authorizeMediation(disputeId, user);
    const supabase = this.supabase.getClient();
    const roomId = this._mediationRoomId(disputeId);

    const { data, error } = await supabase
      .from('support_messages')
      .insert({
        room_id: roomId,
        sender_id: user.id,
        content: dto.content,
        sender_role: user.role,
        created_at: new Date().toISOString(),
      })
      .select(`*, sender:users!sender_id (id, full_name, role, avatar_url)`)
      .single();

    if (error) throw new Error(error.message);
    return { data, message: 'Pesan terkirim' };
  }
}
