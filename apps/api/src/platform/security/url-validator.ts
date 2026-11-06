import { BadRequestException } from '@nestjs/common';

// WHATWG URL parsing has already normalised decimal, hex and octal IPv4 spellings to dotted form.
const PRIVATE_IPV4 = /^(0\.|10\.|127\.|169\.254\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|192\.0\.[02]\.|198\.(1[89])\.|198\.51\.100\.|203\.0\.113\.|22[4-9]\.|2[3-5]\d\.)/;
const INTERNAL_NAME = /(^localhost$|\.localhost$|\.local$|\.internal$|^[^.]+$)/;

/** The eight 16-bit groups of an IPv6 address, or null when it is not a well-formed address (a malformed address is never trusted). */
function ipv6Groups(address: string): number[] | null {
  let text = address.toLowerCase().replace(/%.*$/, '');
  const dotted = text.match(/^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (dotted) {
    const octets = dotted.slice(2).map(Number);
    if (octets.some(octet => octet > 255)) return null;
    text = `${dotted[1]}${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...(halves.length === 2 ? Array<string>(missing).fill('0') : []), ...tail].map(group => (/^[0-9a-f]{1,4}$/.test(group) ? parseInt(group, 16) : NaN));
  return groups.length === 8 && groups.every(group => Number.isInteger(group)) ? groups : null;
}

const embeddedV4 = (high: number, low: number) => `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;

/**
 * Every IPv6 range that is not a plain public unicast address, and every range that embeds an IPv4 address (mapped, NAT64, 6to4) is judged by
 * that embedded address. Anything unparseable counts as private.
 */
function isPrivateIpv6(address: string): boolean {
  const groups = ipv6Groups(address);
  if (!groups) return true;
  const [a, b, c, d, e, f, g, h] = groups;
  if (groups.every(group => group === 0)) return true; // ::
  if (groups.slice(0, 7).every(group => group === 0) && h === 1) return true; // ::1
  if ((a & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
  if ((a & 0xffc0) === 0xfe80 || (a & 0xffc0) === 0xfec0) return true; // link-local and the old site-local range
  if ((a & 0xff00) === 0xff00) return true; // multicast
  if ([a, b, c, d, e].every(group => group === 0)) return f === 0xffff ? PRIVATE_IPV4.test(embeddedV4(g, h)) : true; // IPv4-mapped; IPv4-compatible and the rest of ::/80 are never public hosts
  if (a === 0x64 && b === 0xff9b) return c === 0 && d === 0 && e === 0 && f === 0 ? PRIVATE_IPV4.test(embeddedV4(g, h)) : true; // NAT64 and its local-use range
  if (a === 0x2002) return PRIVATE_IPV4.test(embeddedV4(b, c)); // 6to4
  if (a === 0x2001 && (b === 0 || b === 0xdb8)) return true; // Teredo and documentation
  return false;
}

/** True for an address no outbound research request may reach (a hostname's resolved address, IPv4 or IPv6). */
export function isPrivateAddress(address: string): boolean {
  if (address.includes(':')) return isPrivateIpv6(address);
  // Anything that is not a well-formed dotted IPv4 address is not trusted either.
  const octets = address.split('.');
  if (octets.length !== 4 || !octets.every(octet => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)) return true;
  return PRIVATE_IPV4.test(address);
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
