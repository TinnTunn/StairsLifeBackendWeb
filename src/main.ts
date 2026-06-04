import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import * as express from 'express';

// BigInt → number saat JSON.stringify. Kolom wallet/wallet_transactions pakai
// BigInt; tanpa patch ini endpoint yang mengembalikan BigInt mentah akan 500
// ("Do not know how to serialize a BigInt"). IDR < 2^53 jadi aman tanpa presisi hilang.
(BigInt.prototype as any).toJSON = function () {
  return Number(this);
};

/**
 * Bangun daftar origin yang diizinkan untuk CORS.
 * - FRONTEND_URL bisa berisi multiple origin dipisah koma.
 * - Di development, localhost:5173 (Vite default) selalu diizinkan
 *   walaupun tidak ada di FRONTEND_URL — supaya developer tidak terjebak.
 */
function buildCorsOriginList(): string[] {
  const fromEnv = (process.env.FRONTEND_URL || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  const isDev = (process.env.NODE_ENV || 'development') !== 'production';
  const devDefaults = isDev
    ? [
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        'http://localhost:5500',
        'http://127.0.0.1:5500',
      ]
    : [];

  // Dedup
  return Array.from(new Set([...fromEnv, ...devDefaults]));
}

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api/v1');

  // Increase payload limit untuk upload base64
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ limit: '10mb', extended: true }));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());

  // ─── CORS WHITELIST ──────────────────────────────────────────
  const allowedOrigins = buildCorsOriginList();
  logger.log(`CORS allowed origins: ${allowedOrigins.join(', ') || '(none)'}`);

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      // Request tanpa Origin (curl, Postman, server-to-server) — izinkan
      if (!origin) return callback(null, true);

      // Cek apakah origin ada di whitelist
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      logger.warn(`CORS rejected origin: ${origin}`);
      return callback(new Error(`Origin tidak diizinkan: ${origin}`), false);
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  const port = process.env.PORT ?? 3000;
  await app.listen(port, '0.0.0.0');
  logger.log(`🚀 StairsLife API running on: ${await app.getUrl()}/api/v1`);
  logger.log(`🔌 WebSocket ready on: ws://localhost:${port}/chat`);
}
void bootstrap();
