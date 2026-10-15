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

    // Log the actual exception for internal debugging, but avoid logging PII payload directly
    if (status >= 500) {
      this.logger.error(`[${request.method}] ${request.url} - ${exception}`);
    }

    // A deliberate, contract-bearing error (an HttpException that names its own `code`, such as
    // OTP_UNAVAILABLE) is not an internal failure: the client needs the code to tell the person the truth.
    const declared =
      exception instanceof HttpException &&
      typeof message === 'object' &&
      message !== null &&
      typeof (message as { code?: unknown }).code === 'string';

    // Never leak stack traces to the client
    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      message: status >= 500 && !declared ? 'Internal server error' : message,
    });
  }
}
