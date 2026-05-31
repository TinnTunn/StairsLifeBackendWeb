import { Global, Module } from '@nestjs/common';
import { EmailService } from './email.service';

/**
 * EmailModule sengaja Global supaya semua module bisa pakai EmailService
 * tanpa harus import EmailModule satu-per-satu.
 */
@Global()
@Module({
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
