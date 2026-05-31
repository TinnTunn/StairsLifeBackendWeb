import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/** Shape yang kita terima dari controller sebelum di-wrap */
interface ControllerResponse {
  data?: unknown;
  message?: string;
}

/** Shape response final yang dikirim ke client */
interface StandardResponse {
  success: boolean;
  data: unknown;
  message: string;
  timestamp: string;
}

/**
 * Wrap semua response sukses dalam format standar:
 * { success, data, message, timestamp }
 */
@Injectable()
export class ResponseInterceptor<
  T extends ControllerResponse,
> implements NestInterceptor<T, StandardResponse> {
  intercept(
    _context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<StandardResponse> {
    return next.handle().pipe(
      map((data) => ({
        success: true,
        data: data?.data ?? data,
        message: data?.message ?? 'Berhasil',
        timestamp: new Date().toISOString(),
      })),
    );
  }
}
