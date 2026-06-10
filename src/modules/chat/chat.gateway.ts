import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WsException,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ChatService } from './chat.service';

/**
 * Bangun daftar origin yang diizinkan untuk koneksi WebSocket.
 * Sama logic dengan REST CORS di main.ts — kita re-implement di sini
 * karena @WebSocketGateway() butuh nilai di decorator (compile-time).
 *
 * Sumber:
 *   FRONTEND_URL (comma-separated)  + dev defaults kalau NODE_ENV != production.
 */
function buildWsOriginList(): string[] {
  const fromEnv = (process.env.FRONTEND_URL || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  const isDev = (process.env.NODE_ENV || 'development') !== 'production';
  const devDefaults = isDev
    ? [
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        'http://localhost:5500',
        'http://127.0.0.1:5500',
      ]
    : [];

  return Array.from(new Set([...fromEnv, ...devDefaults]));
}

// Evaluated saat module load — sama pola dengan REST CORS.
// Kalau env berubah di runtime, perlu restart server (acceptable).
const WS_ALLOWED_ORIGINS = buildWsOriginList();

@WebSocketGateway({
  cors: {
    // Whitelist eksplisit. SEBELUMNYA: origin: '*' + credentials: true,
    // kombinasi ini ditolak browser (CORS spec) dan juga security risk.
    origin: WS_ALLOWED_ORIGINS,
    // credentials: false karena auth lewat handshake.auth.token (bukan cookie).
    // Kalau di kemudian hari pindah ke cookie-based auth, set true dan
    // pastikan origin tidak '*'.
    credentials: false,
  },
  namespace: '/chat', // ws://localhost:3000/chat
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ChatGateway.name);

  // Map socketId → userId untuk tracking koneksi
  private connectedUsers = new Map<string, string>();

  constructor(
    private chatService: ChatService,
    private jwtService: JwtService,
  ) {
    // Log saat startup supaya kalau koneksi ditolak, log-nya menunjukkan
    // origin apa yang sebenarnya diizinkan.
    this.logger.log(
      `WS /chat allowed origins: ${WS_ALLOWED_ORIGINS.join(', ') || '(none)'}`,
    );
  }

  /* ----------------------------------------------------------------
     CONNECTION LIFECYCLE
  ---------------------------------------------------------------- */
  handleConnection(client: Socket) {
    try {
      // Ambil token dari handshake auth atau query
      const token =
        (client.handshake.auth as Record<string, string> | undefined)?.token ??
        client.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!token) {
        client.emit('error', { message: 'Token tidak ditemukan' });
        client.disconnect();
        return;
      }

      const payload = this.jwtService.verify<Record<string, string>>(token);
      const userId = payload['sub'] ?? payload['id'];

      if (!userId) {
        client.emit('error', { message: 'Token tidak valid' });
        client.disconnect();
        return;
      }

      // Tolak refresh token dipakai untuk koneksi WS — sama prinsip
      // dengan JwtStrategy di REST.
      if (payload['type'] === 'refresh') {
        client.emit('error', {
          message: 'Refresh token tidak bisa dipakai untuk WebSocket',
        });
        client.disconnect();
        return;
      }

      // Simpan userId ke socket data supaya bisa diakses di handlers
      client.data = {
        userId,
        userRole: payload['role'],
        userName: payload['full_name'] ?? payload['name'],
      } as Record<string, string>;

      this.connectedUsers.set(client.id, userId);
      // Personal room untuk push inbox real-time (badge unread + sort daftar)
      // walau user belum membuka room kontrak tertentu.
      void client.join(`user:${userId}`);
      this.logger.log(`Connected: ${userId} (socket: ${client.id})`);
    } catch {
      client.emit('error', { message: 'Autentikasi gagal' });
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    this.connectedUsers.delete(client.id);
    this.logger.log(`Disconnected: ${client.id}`);
  }

  /* ----------------------------------------------------------------
     JOIN ROOM
  ---------------------------------------------------------------- */
  @SubscribeMessage('join_room')
  async handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { contractId: string },
  ) {
    const { contractId } = data;
    const userId = client.data.userId;

    if (!userId) {
      throw new WsException('Tidak terautentikasi');
    }

    const hasAccess = await this.chatService.validateContractAccess(
      contractId,
      userId,
    );

    if (!hasAccess) {
      client.emit('error', { message: 'Tidak punya akses ke room ini' });
      return;
    }

    const roomName = `contract:${contractId}`;

    // Keluar dari room chat lain (1 active chat per socket)
    const currentRooms = Array.from(client.rooms).filter(
      (r) => r !== client.id && r.startsWith('contract:'),
    );
    for (const room of currentRooms) {
      void client.leave(room);
    }

    void client.join(roomName);

    await this.chatService.markAsRead(contractId, userId);
    // Beri tahu pengirim bahwa pesannya sudah dibaca → centang biru
    client.to(roomName).emit('messages_read', { contractId, readerId: userId });

    const messages = await this.chatService.getMessages(contractId);
    client.emit('message_history', { contractId, messages });

    client.to(roomName).emit('user_joined', {
      userId,
      userName: (client.data as Record<string, string>).userName,
    });

    this.logger.log(`${userId} joined room ${roomName}`);
  }

  /* ----------------------------------------------------------------
     LEAVE ROOM
  ---------------------------------------------------------------- */
  @SubscribeMessage('leave_room')
  handleLeaveRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { contractId: string },
  ) {
    const roomName = `contract:${data.contractId}`;
    client.leave(roomName);
    this.logger.log(`${client.data.userId} left room ${roomName}`);
  }

  /* ----------------------------------------------------------------
     SEND MESSAGE
  ---------------------------------------------------------------- */
  @SubscribeMessage('send_message')
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { contractId: string; content: string },
  ) {
    const { contractId, content } = data;
    const userId = client.data.userId;

    if (!userId) throw new WsException('Tidak terautentikasi');
    if (!content?.trim()) throw new WsException('Pesan tidak boleh kosong');
    if (content.length > 5000) {
      throw new WsException('Pesan terlalu panjang (maks 5000 karakter)');
    }

    const hasAccess = await this.chatService.validateContractAccess(
      contractId,
      userId,
    );
    if (!hasAccess) {
      client.emit('error', { message: 'Tidak punya akses' });
      return;
    }

    const message = await this.chatService.saveMessage(
      contractId,
      userId,
      content.trim(),
    );

    const roomName = `contract:${contractId}`;
    this.server.to(roomName).emit('new_message', {
      contractId,
      message,
    });

    // Push inbox ke PENERIMA (lawan) walau dia belum join room ini — supaya
    // daftar chat-nya update real-time: badge unread bertambah + pindah ke atas.
    const parties = await this.chatService.getContractParties(contractId);
    if (parties) {
      const recipientId =
        parties.student_id === userId
          ? parties.business_id
          : parties.student_id;
      if (recipientId && recipientId !== userId) {
        this.server.to(`user:${recipientId}`).emit('chat_inbox', {
          contractId,
          preview: content.trim().slice(0, 140),
          senderName:
            (client.data as Record<string, string>).userName || 'Seseorang',
          created_at: (message as { created_at?: string }).created_at,
        });
      }
    }

    this.logger.log(`Message in ${roomName} from ${userId}`);
  }

  /* ----------------------------------------------------------------
     MARK READ — penerima menandai pesan lawan sudah dibaca
  ---------------------------------------------------------------- */
  @SubscribeMessage('mark_read')
  async handleMarkRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { contractId: string },
  ) {
    const userId = client.data.userId;
    if (!userId || !data?.contractId) return;

    await this.chatService.markAsRead(data.contractId, userId);
    const roomName = `contract:${data.contractId}`;
    // Kabari pengirim (semua di room kecuali si pembaca) → centang biru
    client.to(roomName).emit('messages_read', {
      contractId: data.contractId,
      readerId: userId,
    });
  }

  /* ----------------------------------------------------------------
     TYPING INDICATOR
  ---------------------------------------------------------------- */
  @SubscribeMessage('typing')
  handleTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { contractId: string; isTyping: boolean },
  ) {
    const roomName = `contract:${data.contractId}`;
    client.to(roomName).emit('user_typing', {
      userId: client.data.userId,
      userName: client.data.userName,
      isTyping: data.isTyping,
    });
  }

  /* ----------------------------------------------------------------
     SUPPORT MESSAGE PUSH (WA-style realtime untuk admin chat)

     Dipanggil dari ChatController setelah REST insert berhasil. Mendorong
     pesan ke personal-room kedua pihak (user pengirim + penerima admin
     atau sebaliknya) supaya keduanya melihat pesan baru tanpa polling.

     Catatan: support chat tidak pakai 'contract room', tapi push ke
     personal room user:{id} (sama channel yang kita pakai untuk inbox
     contract). Ini membuat FE bisa pasang satu listener saja.
  ---------------------------------------------------------------- */
  emitSupportMessage(
    recipientUserId: string,
    payload: {
      roomId: string;
      senderUserId: string;
      senderRole: 'student' | 'mahasiswa' | 'bisnis' | 'admin';
      senderName: string;
      content: string;
      created_at: string;
    },
  ): void {
    if (!recipientUserId || !this.server) return;
    this.server.to(`user:${recipientUserId}`).emit('support_message', payload);
  }
}
