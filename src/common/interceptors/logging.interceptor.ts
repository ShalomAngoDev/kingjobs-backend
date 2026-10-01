import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request & { requestId?: string }>();
    const response = http.getResponse<Response>();
    const startedAt = Date.now();
    const { method, originalUrl } = request;

    return next.handle().pipe(
      tap({
        next: () => {
          this.logger.log(
            `${method} ${originalUrl} ${response.statusCode} ${Date.now() - startedAt}ms` +
              (request.requestId ? ` req=${request.requestId}` : ''),
          );
        },
        error: (error: unknown) => {
          const status =
            typeof error === 'object' &&
            error !== null &&
            'status' in error &&
            typeof (error as { status?: unknown }).status === 'number'
              ? (error as { status: number }).status
              : 500;
          this.logger.warn(
            `${method} ${originalUrl} ${status} ${Date.now() - startedAt}ms` +
              (request.requestId ? ` req=${request.requestId}` : ''),
          );
        },
      }),
    );
  }
}
