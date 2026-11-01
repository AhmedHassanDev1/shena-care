import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';

@Injectable()
export class FormatFingerprintService {
  /**
   * Normalizes a header label: trims, lowercases, removes special characters, and collapses whitespace.
   */
  normalizeHeader(header: string): string {
    return String(header || '')
      .toLowerCase()
      .trim()
      .replace(/[\r\n\t_]+/g, ' ')
      .replace(/[^\p{L}\p{N} ]/gu, '')
      .replace(/\s+/g, ' ');
  }

  /**
   * Generates a structural format fingerprint from sheet names and column headers.
   * Format: v1:sheets=<count>:headers=<norm1>|<norm2>|...:hash=<sha256>
   */
  computeFingerprint(headers: string[], sheetNames: string[] = ['Sheet1']): string {
    const normHeaders = headers.map((h) => this.normalizeHeader(h));
    const headerString = normHeaders.join('|');
    const sheetString = sheetNames.map((s) => s.trim().toLowerCase()).sort().join('|');

    const signature = `sheets=${sheetNames.length}[${sheetString}]:headers=[${headerString}]`;
    const hash = crypto.createHash('sha256').update(signature).digest('hex').slice(0, 16);

    return `v1:${hash}`;
  }
}
