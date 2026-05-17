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

@WebSocketGateway({
  cors: {
    origin: '*', // sesuaikan dengan domain frontend di production
    credentials: true,
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
  ) {}

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

      // Simpan userId ke socket data supaya bisa diakses di handlers
      client.data = {
        userId,
        userRole: payload['role'],
        userName: payload['full_name'] ?? payload['name'],
      } as Record<string, string>;

      this.connectedUsers.set(client.id, userId);
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
     Client kirim: { contractId: "uuid" }
     Server join ke room "contract:{contractId}"
     Server kirim balik: riwayat pesan
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

    // Validasi: user harus punya akses ke kontrak ini
    const hasAccess = await this.chatService.validateContractAccess(
      contractId,
      userId,
    );

    if (!hasAccess) {
      client.emit('error', { message: 'Tidak punya akses ke room ini' });
      return;
    }

    const roomName = `contract:${contractId}`;

    // Keluar dari room chat lain yang sedang diikuti (1 active chat per socket)
    const currentRooms = Array.from(client.rooms).filter(
      (r) => r !== client.id && r.startsWith('contract:'),
    );
    for (const room of currentRooms) {
      void client.leave(room);
    }

    void client.join(roomName);

    // Tandai pesan sebagai terbaca
    await this.chatService.markAsRead(contractId, userId);

    // Kirim riwayat pesan ke client yang baru join
    const messages = await this.chatService.getMessages(contractId);
    client.emit('message_history', { contractId, messages });

    // Informasikan ke room bahwa ada user yang join
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
     Client kirim: { contractId: "uuid", content: "teks" }
     Server simpan ke DB, broadcast ke semua di room
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

    // Validasi akses
    const hasAccess = await this.chatService.validateContractAccess(
      contractId,
      userId,
    );
    if (!hasAccess) {
      client.emit('error', { message: 'Tidak punya akses' });
      return;
    }

    // Simpan ke DB
    const message = await this.chatService.saveMessage(
      contractId,
      userId,
      content.trim(),
    );

    const roomName = `contract:${contractId}`;

    // Broadcast ke semua di room (termasuk pengirim)
    this.server.to(roomName).emit('new_message', {
      contractId,
      message,
    });

    this.logger.log(`Message in ${roomName} from ${userId}`);
  }

  /* ----------------------------------------------------------------
     TYPING INDICATOR
     Client kirim: { contractId, isTyping }
     Server broadcast ke room (kecuali pengirim)
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
}
