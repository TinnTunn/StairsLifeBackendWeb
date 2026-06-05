import { Injectable, Optional } from '@nestjs/common';
import { SupabaseService } from '../../config/supabase.config';
import { NotificationsService } from '../notifications/notifications.service';

interface InquirySender {
  id: string;
  full_name?: string;
  role?: string;
}

@Injectable()
export class ChatService {
  constructor(
    private supabase: SupabaseService,
    // Optional: bisa null kalau NotificationsModule tidak tersedia
    // (mis. saat unit test). Pemanggilan diaman-kan via optional chain.
    @Optional() private notificationsService?: NotificationsService,
  ) {}

  async getMessages(contractId: string) {
    const { data, error } = await this.supabase
      .getClient()
      .from('messages')
      .select(
        `
        *,
        sender:users!sender_id (id, full_name, role)
      `,
      )
      .eq('contract_id', contractId)
      .order('created_at', { ascending: true });

    if (error) throw new Error(error.message);
    return data || [];
  }

  async saveMessage(contractId: string, senderId: string, content: string) {
    const { data, error } = await this.supabase
      .getClient()
      .from('messages')
      .insert({
        contract_id: contractId,
        sender_id: senderId,
        content,
        created_at: new Date().toISOString(),
      })
      .select(
        `
        *,
        sender:users!sender_id (id, full_name, role)
      `,
      )
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async markAsRead(contractId: string, userId: string) {
    await this.supabase
      .getClient()
      .from('messages')
      .update({ is_read: true })
      .eq('contract_id', contractId)
      .neq('sender_id', userId);
  }

  /**
   * Ambil kedua pihak kontrak (student & business) — dipakai gateway untuk
   * menentukan penerima saat push notifikasi inbox real-time.
   */
  async getContractParties(
    contractId: string,
  ): Promise<{ student_id: string; business_id: string } | null> {
    const { data } = await this.supabase
      .getClient()
      .from('contracts')
      .select('student_id, business_id')
      .eq('id', contractId)
      .maybeSingle();
    return (data as { student_id: string; business_id: string } | null) ?? null;
  }

  async validateContractAccess(
    contractId: string,
    userId: string,
  ): Promise<boolean> {
    const { data } = await this.supabase
      .getClient()
      .from('contracts')
      .select('id')
      .eq('id', contractId)
      .or(`student_id.eq.${userId},business_id.eq.${userId}`)
      .maybeSingle();

    return !!data;
  }

  /**
   * Kirim notif ke receiver saat ada inquiry message baru.
   * Non-blocking: kalau gagal, hanya log warning (operasi kirim pesan
   * tetap sukses).
   */
  async notifyInquiry(
    receiverId: string,
    sender: InquirySender,
    content: string,
  ) {
    if (!this.notificationsService) return;

    const senderName = sender.full_name || 'Seseorang';
    // Truncate content supaya body notif tidak terlalu panjang
    const preview = content.length > 80
      ? content.substring(0, 77) + '...'
      : content;

    await this.notificationsService.create({
      user_id:    receiverId,
      // Pakai 'system' karena enum notification_type tidak punya 'inquiry'.
      // Title yang descriptive sudah cukup untuk membedakan dari notif lain.
      type:       'system',
      title:      `💬 Pesan baru dari ${senderName}`,
      body:       preview,
      ref_id:     sender.id,
      action_url: `/chat/inquiry/${sender.id}`,
    });
  }
}
