import { Injectable, Logger } from '@nestjs/common'

/**
 * Delivery channel for staff sign-in codes. No SMS provider is integrated yet, so the only transport is
 * a development console one that exists solely in `development` / `test`; every other environment
 * reports "unavailable" and the API refuses to issue codes (it never pretends a message was sent).
 * A real provider replaces this class behind the same contract (see docs/security/STAFF_AUTHENTICATION.md).
 */
@Injectable()
export class StaffOtpTransport {
  private readonly logger = new Logger(StaffOtpTransport.name)

  isAvailable(): boolean {
    return process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test'
  }

  async deliver(phone: string, code: string): Promise<void> {
    if (!this.isAvailable()) throw new Error('Staff OTP transport is not available in this environment')
    // Dev/test only: no SMS leaves the machine. Never reachable when NODE_ENV is anything else.
    this.logger.warn(`[dev transport] staff sign-in code for ${phone.slice(0, 5)}*****: ${code}`)
  }
}
