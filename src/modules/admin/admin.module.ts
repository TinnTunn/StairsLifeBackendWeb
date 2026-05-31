import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AuditService } from './audit.service';
import { RolesService } from './roles.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [AdminController],
  providers: [AdminService, AuditService, RolesService],
  exports: [AdminService, AuditService, RolesService],
})
export class AdminModule {}
