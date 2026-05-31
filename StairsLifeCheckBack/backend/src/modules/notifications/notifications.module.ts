import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationsGateway } from './notifications.gateway';

@Module({
  imports: [
    // JwtModule supaya gateway bisa verify token WS (sama pola dgn ChatModule)
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsGateway],
  // Export Service supaya module lain (Applications, Contracts, Payments,
  // Reviews, Disputes) bisa inject dan trigger notif.
  exports: [NotificationsService],
})
export class NotificationsModule {}
