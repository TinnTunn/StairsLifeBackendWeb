import { Global, Module } from '@nestjs/common';
import { XenditService } from './xendit.service';

/**
 * XenditModule — dipakai oleh PaymentsModule, WithdrawalsModule, dan
 * (lewat dispute resolution) AdminModule.
 *
 * @Global() supaya tidak perlu import berulang di module lain.
 */
@Global()
@Module({
  providers: [XenditService],
  exports: [XenditService],
})
export class XenditModule {}
