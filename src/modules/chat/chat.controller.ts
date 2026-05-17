import type { JwtUser } from '../../common/types/jwt-payload.type';
import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SupabaseService } from '../../config/supabase.config';
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
  constructor(private supabase: SupabaseService) {}

  // GET /api/v1/chat/rooms — kontrak-based rooms
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

    return { data: contracts || [], message: 'Berhasil' };
  }

  // GET /api/v1/chat/support — ambil history support chat user ini
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

  // POST /api/v1/chat/support/messages — user kirim pesan ke support
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
    return { data, message: 'Pesan terkirim' };
  }

  // GET /api/v1/chat/support-inbox — admin lihat semua support rooms
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

    // Group by room_id, ambil pesan terakhir per room
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

  // POST /api/v1/chat/support/:roomId/reply — admin balas pesan support
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
    return { data, message: 'Balasan terkirim' };
  }

  // GET /api/v1/chat/support-rooms — admin lihat suspended users
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

  // GET /api/v1/chat/:contractId/messages
  @Get(':contractId/messages')
  async getMessages(
    @Param('contractId') contractId: string,
    @CurrentUser() _user: JwtUser,
  ) {
    const { data, error } = await this.supabase
      .getClient()
      .from('messages')
      .select(`*, sender:users!sender_id (id, full_name, role)`)
      .eq('contract_id', contractId)
      .order('created_at', { ascending: true });

    if (error) throw new Error(error.message);
    return { data, message: 'Berhasil' };
  }

  // POST /api/v1/chat/:contractId/messages
  @Post(':contractId/messages')
  async sendMessage(
    @Param('contractId') contractId: string,
    @Body() dto: SendMessageDto,
    @CurrentUser() user: JwtUser,
  ) {
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
    return { data, message: 'Pesan terkirim' };
  }

  // POST /api/v1/chat/direct
  @Post('direct')
  async sendDirectMessage(
    @Body() dto: DirectMessageDto,
    @CurrentUser() user: JwtUser,
  ) {
    const supabase = this.supabase.getClient();

    const { data: contract } = await supabase
      .from('contracts')
      .select('id')
      .or(
        `and(student_id.eq.${user.id},business_id.eq.${dto.receiver_id}),and(student_id.eq.${dto.receiver_id},business_id.eq.${user.id})`,
      )
      .limit(1)
      .maybeSingle();

    if (!contract) {
      return {
        data: null,
        message: 'Belum ada kontrak. Chat tersedia setelah kontrak dibuat.',
      };
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
}
