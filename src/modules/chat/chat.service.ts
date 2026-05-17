import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../config/supabase.config';

@Injectable()
export class ChatService {
  constructor(private supabase: SupabaseService) {}

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
}
