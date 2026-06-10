import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

/**
 * Bangun daftar origin yang diizinkan untuk koneksi WebSocket /notifications.
 * Identik dengan logic di ChatGateway dan REST CORS — di-duplikasi karena
 * decorator @WebSocketGateway() butuh nilai compile-time.
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

const WS_ALLOWED_ORIGINS = buildWsOriginList();

/**
 * Gateway untuk push notifikasi real-time.
 * Per-user room — setiap user di-join ke room `user:{userId}` saat connect.
 *
 * Namespace `/notifications` — client connect ke `ws://host/notifications`.
 */
@Injectable()
@WebSocketGateway({
  cors: {
    // Whitelist eksplisit. SEBELUMNYA: origin: '*' + credentials: true,
    // kombinasi yang ditolak browser dan security risk.
    origin: WS_ALLOWED_ORIGINS,
    credentials: false,
  },
  namespace: '/notifications',
})
export class NotificationsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(NotificationsGateway.name);

  // Tracking connected sockets per user (1 user bisa multi-device).
  private userSockets = new Map<string, Set<string>>(); // userId → Set<socketId>

  constructor(private jwtService: JwtService) {
    this.logger.log(
      `WS /notifications allowed origins: ${WS_ALLOWED_ORIGINS.join(', ') || '(none)'}`,
    );
  }

  handleConnection(client: Socket) {
    try {
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

      // Tolak refresh token dipakai untuk koneksi WS.
      if (payload['type'] === 'refresh') {
        client.emit('error', {
          message: 'Refresh token tidak bisa dipakai untuk WebSocket',
        });
        client.disconnect();
        return;
      }

      client.data = { userId } as Record<string, string>;

      if (!this.userSockets.has(userId)) {
        this.userSockets.set(userId, new Set());
      }
      this.userSockets.get(userId).add(client.id);

      void client.join(`user:${userId}`);

      client.emit('connected', { userId });
      this.logger.log(`Notif connected: ${userId} (socket: ${client.id})`);
    } catch {
      client.emit('error', { message: 'Autentikasi gagal' });
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const userId = (client.data as Record<string, string>)?.userId;
    if (userId) {
      const set = this.userSockets.get(userId);
      if (set) {
        set.delete(client.id);
        if (set.size === 0) this.userSockets.delete(userId);
      }
    }
    this.logger.log(`Notif disconnected: ${client.id}`);
  }

  /**
   * Push notifikasi baru ke semua device user.
   * Dipanggil dari NotificationsService.create().
   */
  async pushToUser(userId: string, notif: unknown): Promise<boolean> {
    if (!this.server) return false;
    const sockets = this.userSockets.get(userId);
    const isOnline = !!sockets && sockets.size > 0;

    this.server.to(`user:${userId}`).emit('new_notification', notif);

    if (isOnline) {
      this.logger.log(`Notif pushed to ${userId} (${sockets.size} device)`);
    }
    return isOnline;
  }

  /**
   * Push update unread count ke user (mis. setelah markRead).
   */
  async pushUnreadCount(userId: string, count: number): Promise<void> {
    if (!this.server) return;
    this.server.to(`user:${userId}`).emit('unread_count', { count });
  }
}
