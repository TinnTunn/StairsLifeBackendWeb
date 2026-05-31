import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PaymentsRepository } from './payments.repository';
import { ContractsModule } from '../contracts/contracts.module';
import { NotificationsModule } from '../notifications/notifications.module';

/**
 * XenditService disediakan oleh XenditModule (@Global) — tidak perlu
 * di-import di sini lagi.
 */
@Module({
  imports: [ContractsModule, NotificationsModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, PaymentsRepository],
  exports: [PaymentsService, PaymentsRepository],
})
export class PaymentsModule {}
