import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException
        ? exception.getResponse()
        : 'Internal server error';

    // Log errors for internal debugging, avoiding sensitive credentials/PII leakage
    if (status >= 500) {
      const details = exception instanceof Error ? exception.stack || exception.message : String(exception);
      this.logger.error(`[${request.method}] ${request.url} - ${status} Server Error: ${details}`);
    } else {
      const formattedMessage =
        typeof message === 'object' && message !== null
          ? JSON.stringify(message)
          : String(message);
      this.logger.warn(`[${request.method}] ${request.url} - ${status}: ${formattedMessage}`);
    }

    // Never leak stack traces to the client
    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      message: status >= 500 ? 'Internal server error' : message,
    });
  }
}
