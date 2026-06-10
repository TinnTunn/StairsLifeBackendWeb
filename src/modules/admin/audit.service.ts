import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../config/supabase.config';

export interface AuditEntry {
  actorId?: string;
  actorName?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, any>;
}

/**
 * AuditService — mencatat aksi admin ke tabel `audit_logs`.
 *
 * Filosofi:
 * - Kegagalan menulis audit TIDAK boleh menggagalkan aksi utama
 *   (semua dibungkus try/catch, dipanggil via `void`).
 * - Storage pakai Supabase client (tabel tidak ada di Prisma schema),
 *   konsisten dengan modul chat.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async log(entry: AuditEntry): Promise<void> {
    try {
      await this.supabase
        .getClient()
        .from('audit_logs')
        .insert({
          actor_id: entry.actorId ?? null,
          actor_name: entry.actorName ?? null,
          action: entry.action,
          target_type: entry.targetType ?? null,
          target_id: entry.targetId ?? null,
          metadata: entry.metadata ?? null,
          created_at: new Date().toISOString(),
        });
    } catch (e) {
      // Jangan ganggu alur utama kalau audit gagal.
      this.logger.warn(
        `Gagal menulis audit log (${entry.action}): ${(e as Error).message}`,
      );
    }
  }

  async list(limit = 50): Promise<any[]> {
    const { data } = await this.supabase
      .getClient()
      .from('audit_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    return data || [];
  }
}
