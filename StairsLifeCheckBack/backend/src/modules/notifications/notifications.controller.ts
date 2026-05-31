import type { JwtUser } from '../../common/types/jwt-payload.type';
import {
  Controller,
  Get,
  Patch,
  Delete,
  Param,
  UseGuards,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  getAll(@CurrentUser() user: JwtUser) {
    return this.notificationsService.getAll(user.id);
  }

  @Get('unread-count')
  getUnreadCount(@CurrentUser() user: JwtUser) {
    return this.notificationsService.getUnreadCount(user.id);
  }

  // PENTING: route static (read-all) harus DI ATAS route dinamis (:id/read)
  // supaya tidak ke-tangkap sebagai param. NestJS evaluates by registration
  // order — sebelumnya route ini bisa miss kalau ada ID dengan format "read-all".
  @Patch('read-all')
  markAllRead(@CurrentUser() user: JwtUser) {
    return this.notificationsService.markAllRead(user.id);
  }

  @Patch(':id/read')
  markRead(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.notificationsService.markRead(id, user.id);
  }

  @Delete(':id')
  delete(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.notificationsService.delete(id, user.id);
  }
}
