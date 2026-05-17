import { Module } from '@nestjs/common';
import { JwtModule, JwtModuleOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService): JwtModuleOptions => {
        const secret = config.get<string>('JWT_SECRET');
        if (!secret) {
          throw new Error(
            'JWT_SECRET tidak di-set di environment. ' +
              'Tambahkan JWT_SECRET ke file .env (lihat .env.example).',
          );
        }
        // Cast ke `any` karena @nestjs/jwt versi baru mengharuskan
        // type `StringValue` dari ms package — string biasa tidak match
        // walaupun secara runtime valid (mis. '7d', '1h', '30m').
        const expiresIn = (config.get<string>('JWT_EXPIRES_IN') ?? '7d') as any;
        return {
          secret,
          signOptions: { expiresIn },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService, JwtModule, PassportModule],
})
export class AuthModule {}

