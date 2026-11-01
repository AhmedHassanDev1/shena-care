import { BadRequestException } from '@nestjs/common';

export function validateSafeUrl(urlString: string): void {
  try {
    const url = new URL(urlString);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('Invalid protocol');
    }

    const hostname = url.hostname;
    
    // Basic SSRF protection against common local/private IPs and localhost
    const privateIpRegex = /^(localhost|127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|0\.0\.0\.0|\[::1\])$/i;
    
    if (privateIpRegex.test(hostname)) {
      throw new Error('Private or local addresses are not allowed');
    }
  } catch (e) {
    throw new BadRequestException(`Unsafe or invalid URL provided: ${urlString}`);
  }
}
