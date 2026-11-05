import { BadRequestException } from '@nestjs/common';

// WHATWG URL parsing has already normalised decimal, hex and octal IPv4 spellings to dotted form.
const PRIVATE_IPV4 = /^(0\.|10\.|127\.|169\.254\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|198\.(1[89])\.|22[4-9]\.|2[3-5]\d\.)/;
const INTERNAL_NAME = /(^localhost$|\.localhost$|\.local$|\.internal$|^[^.]+$)/;

function isPrivateIpv6(address: string): boolean {
  if (address === '::' || address === '::1' || /^(fc|fd|fe[89ab])/.test(address)) return true;
  const mapped = address.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!mapped) return false;
  const [high, low] = [parseInt(mapped[1], 16), parseInt(mapped[2], 16)];
  return PRIVATE_IPV4.test(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
}

/** True for an address no outbound research request may reach (a hostname's resolved address, IPv4 or IPv6). */
export function isPrivateAddress(address: string): boolean {
  return address.includes(':') ? isPrivateIpv6(address.toLowerCase()) : PRIVATE_IPV4.test(address);
}

/** Static check of a provider-supplied URL. It does not resolve DNS: a direct read must also check resolved addresses with isPrivateAddress. */
export function validateSafeUrl(urlString: string): void {
  try {
    const url = new URL(urlString);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('Invalid protocol');
    }
    if (url.username || url.password) {
      throw new Error('Credentials in URLs are not allowed');
    }

    const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
    const unsafe = hostname.startsWith('[')
      ? isPrivateIpv6(hostname.slice(1, -1))
      : PRIVATE_IPV4.test(hostname) || INTERNAL_NAME.test(hostname);
    if (unsafe) {
      throw new Error('Private or local addresses are not allowed');
    }
  } catch (e) {
    throw new BadRequestException(`Unsafe or invalid URL provided: ${urlString}`);
  }
}
