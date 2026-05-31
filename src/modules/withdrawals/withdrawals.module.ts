import { Module } from '@nestjs/common';
import { WithdrawalsController } from './withdrawals.controller';
import { WithdrawalsService } from './withdrawals.service';
import { PaymentsModule } from '../payments/payments.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [PaymentsModule, NotificationsModule],
  controllers: [WithdrawalsController],
  providers: [WithdrawalsService],
  exports: [WithdrawalsService],
})
export class WithdrawalsModule {}
