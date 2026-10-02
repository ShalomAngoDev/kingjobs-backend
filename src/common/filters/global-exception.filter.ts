import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { requestId?: string }>();

    const isHttp = exception instanceof HttpException;
    const status = isHttp
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    if (isHttp) {
      const payload = exception.getResponse();
      if (
        typeof payload === 'object' &&
        payload !== null &&
        'database' in payload &&
        'service' in payload
      ) {
        const healthPayload = payload as Record<string, unknown>;
        response.status(status).json({
          ...healthPayload,
          path: request.url,
          timestamp:
            typeof healthPayload.timestamp === 'string'
              ? healthPayload.timestamp
              : new Date().toISOString(),
          ...(request.requestId ? { requestId: request.requestId } : {}),
        });
        return;
      }
    }

    const errorName = HttpStatus[status] ?? 'Error';
    let message: string | string[] = 'Internal server error';

    if (isHttp) {
      const payload = exception.getResponse();
      if (typeof payload === 'string') {
        message = payload;
      } else if (typeof payload === 'object' && payload !== null) {
        const record = payload as Record<string, unknown>;
        if (
          typeof record.message === 'string' ||
          Array.isArray(record.message)
        ) {
          message = record.message as string | string[];
        } else if (
          record.message &&
          typeof record.message === 'object' &&
          record.message !== null &&
          'message' in (record.message as object) &&
          typeof (record.message as { message?: unknown }).message === 'string'
        ) {
          message = (record.message as { message: string }).message;
        } else if (typeof record.error === 'string') {
          message = record.error;
        }

        const reasons =
          Array.isArray(record.reasons)
            ? record.reasons
            : record.message &&
                typeof record.message === 'object' &&
                record.message !== null &&
                Array.isArray((record.message as { reasons?: unknown }).reasons)
              ? (record.message as { reasons: unknown[] }).reasons
              : null;

        response.status(status).json({
          statusCode: status,
          error: errorName.replace(/_/g, ' '),
          message,
          ...(reasons ? { reasons } : {}),
          path: request.url,
          timestamp: new Date().toISOString(),
          ...(request.requestId ? { requestId: request.requestId } : {}),
        });
        return;
      }
    }

    if (status >= 500 && !(exception instanceof HttpException)) {
      this.logger.error(
        `Unhandled error on ${request.method} ${request.url}` +
          (request.requestId ? ` req=${request.requestId}` : ''),
      );
    }

    response.status(status).json({
      statusCode: status,
      error: errorName.replace(/_/g, ' '),
      message,
      path: request.url,
      timestamp: new Date().toISOString(),
      ...(request.requestId ? { requestId: request.requestId } : {}),
    });
  }
}
