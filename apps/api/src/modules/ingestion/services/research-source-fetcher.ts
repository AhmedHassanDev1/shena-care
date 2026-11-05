import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { createHash } from 'crypto';
import { lookup } from 'dns/promises';
import { isPrivateAddress, validateSafeUrl } from '../../../platform/security/url-validator';

export type FetchOutcome =
  | 'OK' | 'HOST_NOT_APPROVED' | 'UNSAFE_URL' | 'ROBOTS_DISALLOWED' | 'ACCESS_DENIED' | 'NOT_FOUND' | 'RATE_LIMITED' | 'CIRCUIT_OPEN' | 'TIMEOUT' | 'UPSTREAM_ERROR' | 'WRONG_CONTENT_TYPE' | 'TOO_LARGE' | 'TOO_MANY_REDIRECTS';

export interface FetchedSource {
  url: string;
  finalUrl: string;
  outcome: FetchOutcome;
  body?: Buffer;
  contentType?: string;
  contentHash?: string;
  fetchedAt: string;
  detail?: string;
}

/** Whether a failure says something about this attempt (worth resuming) or about the source itself (not). */
export const RETRYABLE_OUTCOMES: ReadonlySet<FetchOutcome> = new Set(['RATE_LIMITED', 'CIRCUIT_OPEN', 'TIMEOUT', 'UPSTREAM_ERROR']);

export const RESEARCH_TRANSPORT = 'RESEARCH_TRANSPORT';
export interface TransportResponse { status: number; headers: { get(name: string): string | null }; arrayBuffer(): Promise<ArrayBuffer> }
/** The network boundary, replaced by a recorded site in tests. */
export interface ResearchTransport {
  resolve(hostname: string): Promise<string[]>;
  get(url: string, init: { accept: string; timeoutMs: number }): Promise<TransportResponse>;
}

const USER_AGENT = 'ShinaCareResearch/1.0 (+product-information-review)';
export class NodeResearchTransport implements ResearchTransport {
  async resolve(hostname: string) {
    return (await lookup(hostname, { all: true })).map(entry => entry.address);
  }
  async get(url: string, init: { accept: string; timeoutMs: number }): Promise<TransportResponse> {
    return fetch(url, { redirect: 'manual', headers: { 'User-Agent': USER_AGENT, Accept: init.accept }, signal: AbortSignal.timeout(init.timeoutMs) });
  }
}

const MAX_PAGE_BYTES = 4 * 1024 * 1024;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 15_000;
const CACHE_TTL_MS = 60 * 60 * 1000;
const ROBOTS_TTL_MS = 6 * 60 * 60 * 1000;
const BREAKER_THRESHOLD = 3;
const BREAKER_OPEN_MS = 5 * 60 * 1000;
const ATTEMPTS = 2;

interface RobotsRules { allows: string[]; disallows: string[] }

export function parseRobots(content: string): RobotsRules {
  const rules: RobotsRules = { allows: [], disallows: [] };
  let applies = false;
  let lastWasAgent = false;
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === 'user-agent') {
      const matches = value === '*' || USER_AGENT.toLowerCase().startsWith(value.toLowerCase());
      applies = lastWasAgent ? applies || matches : matches;
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!applies || !value) continue;
    if (key === 'allow') rules.allows.push(value);
    if (key === 'disallow') rules.disallows.push(value);
  }
  return rules;
}

export function robotsAllows(rules: RobotsRules, path: string): boolean {
  const matchLength = (pattern: string) => {
    const regex = new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$')}`);
    return regex.test(path) ? pattern.length : -1;
  };
  const allow = Math.max(-1, ...rules.allows.map(matchLength));
  const disallow = Math.max(-1, ...rules.disallows.map(matchLength));
  return disallow < 0 || allow >= disallow;
}

/**
 * Direct, polite reads of approved sites: public addresses only, approved hosts only, robots.txt honoured, bounded size and time, per-host pacing, a circuit breaker and a short
 * cache. A refusal from a site is an answer, recorded as such and never worked around.
 */
@Injectable()
export class ResearchSourceFetcher {
  private readonly logger = new Logger(ResearchSourceFetcher.name);
  private readonly cache = new Map<string, { expires: number; source: FetchedSource }>();
  private readonly robots = new Map<string, { expires: number; rules: RobotsRules | null }>();
  private readonly breakers = new Map<string, { failures: number; openUntil: number }>();
  private readonly lastRequest = new Map<string, number>();

  constructor(@Optional() @Inject(RESEARCH_TRANSPORT) private readonly transport: ResearchTransport = new NodeResearchTransport()) {}

  private paceMs() {
    return Number(process.env.RESEARCH_HOST_INTERVAL_MS ?? (process.env.NODE_ENV === 'test' ? 0 : 1500));
  }

  private async assertPublic(url: URL): Promise<boolean> {
    if (url.protocol !== 'https:') return false;
    try { validateSafeUrl(url.toString()); } catch { return false; }
    try {
      const addresses = await this.transport.resolve(url.hostname);
      return addresses.length > 0 && addresses.every(address => !isPrivateAddress(address));
    } catch {
      return false;
    }
  }

  private async pace(host: string) {
    const wait = (this.lastRequest.get(host) ?? 0) + this.paceMs() - Date.now();
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    this.lastRequest.set(host, Date.now());
  }

  private async robotsFor(url: URL): Promise<RobotsRules | null> {
    const cached = this.robots.get(url.host);
    if (cached && cached.expires > Date.now()) return cached.rules;
    let rules: RobotsRules | null;
    try {
      await this.pace(url.host);
      const res = await this.transport.get(`${url.origin}/robots.txt`, { accept: 'text/plain', timeoutMs: FETCH_TIMEOUT_MS });
      if (res.status === 200) rules = parseRobots(Buffer.from(await res.arrayBuffer()).toString('utf8'));
      else if (res.status >= 400 && res.status < 500) rules = { allows: [], disallows: [] }; // no robots file: the site states no restriction
      else rules = null;
    } catch {
      rules = null; // unknown is not permission
    }
    this.robots.set(url.host, { expires: Date.now() + ROBOTS_TTL_MS, rules });
    return rules;
  }

  private tripped(host: string) {
    const breaker = this.breakers.get(host);
    return !!breaker && breaker.openUntil > Date.now();
  }

  private record(host: string, ok: boolean) {
    if (ok) { this.breakers.delete(host); return; }
    const breaker = this.breakers.get(host) ?? { failures: 0, openUntil: 0 };
    breaker.failures++;
    if (breaker.failures >= BREAKER_THRESHOLD) { breaker.openUntil = Date.now() + BREAKER_OPEN_MS; breaker.failures = 0; this.logger.warn(`Research circuit open for ${host}`); }
    this.breakers.set(host, breaker);
  }

  async fetch(rawUrl: string, options: { kind: 'page' | 'image'; isApprovedHost: (host: string) => boolean; bypassCache?: boolean }): Promise<FetchedSource> {
    const fetchedAt = new Date().toISOString();
    const fail = (finalUrl: string, outcome: FetchOutcome, detail?: string): FetchedSource => ({ url: rawUrl, finalUrl, outcome, fetchedAt, detail });
    const cacheKey = `${options.kind}:${rawUrl}`;
    const hit = this.cache.get(cacheKey);
    if (!options.bypassCache && hit && hit.expires > Date.now()) return hit.source;

    let current: URL;
    try { current = new URL(rawUrl); } catch { return fail(rawUrl, 'UNSAFE_URL'); }
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!options.isApprovedHost(current.hostname.toLowerCase())) return fail(current.toString(), 'HOST_NOT_APPROVED', current.hostname);
      if (!(await this.assertPublic(current))) return fail(current.toString(), 'UNSAFE_URL');
      if (this.tripped(current.host)) return fail(current.toString(), 'CIRCUIT_OPEN');
      const rules = await this.robotsFor(current);
      if (!rules) return fail(current.toString(), 'ROBOTS_DISALLOWED', 'robots.txt could not be read');
      if (!robotsAllows(rules, `${current.pathname}${current.search}`)) return fail(current.toString(), 'ROBOTS_DISALLOWED');

      const outcome = await this.request(current, options.kind);
      if (outcome.redirect) {
        try { current = new URL(outcome.redirect, current); } catch { return fail(current.toString(), 'UNSAFE_URL'); }
        continue;
      }
      if (outcome.source.outcome === 'OK') {
        const source: FetchedSource = { ...outcome.source, url: rawUrl, finalUrl: current.toString() };
        this.cache.set(cacheKey, { expires: Date.now() + CACHE_TTL_MS, source });
        return source;
      }
      return { ...outcome.source, url: rawUrl, finalUrl: current.toString() };
    }
    return fail(current.toString(), 'TOO_MANY_REDIRECTS');
  }

  private async request(url: URL, kind: 'page' | 'image'): Promise<{ redirect?: string; source: FetchedSource }> {
    const fetchedAt = new Date().toISOString();
    const source = (outcome: FetchOutcome, detail?: string, extra: Partial<FetchedSource> = {}): FetchedSource => ({ url: url.toString(), finalUrl: url.toString(), outcome, fetchedAt, detail, ...extra });
    let last: FetchedSource = source('UPSTREAM_ERROR');
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      await this.pace(url.host);
      let res: TransportResponse;
      try {
        res = await this.transport.get(url.toString(), { accept: kind === 'page' ? 'text/html,application/xhtml+xml' : 'image/*', timeoutMs: FETCH_TIMEOUT_MS });
      } catch (error) {
        last = source((error as Error).name === 'TimeoutError' ? 'TIMEOUT' : 'UPSTREAM_ERROR', (error as Error).message?.slice(0, 200));
        this.record(url.host, false);
        continue;
      }
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (location) return { redirect: location, source: last };
      }
      if (res.status === 401 || res.status === 403 || res.status === 451) return { source: source('ACCESS_DENIED', `HTTP ${res.status}`) };
      if (res.status === 404 || res.status === 410) return { source: source('NOT_FOUND', `HTTP ${res.status}`) };
      if (res.status === 429 || res.status >= 500) {
        this.record(url.host, false);
        last = source(res.status === 429 ? 'RATE_LIMITED' : 'UPSTREAM_ERROR', `HTTP ${res.status}`);
        continue;
      }
      if (res.status !== 200) return { source: source('UPSTREAM_ERROR', `HTTP ${res.status}`) };
      const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
      const expected = kind === 'page' ? /text\/html|application\/xhtml/ : /^image\//;
      if (!expected.test(contentType)) return { source: source('WRONG_CONTENT_TYPE', contentType) };
      const declared = Number(res.headers.get('content-length') ?? 0);
      const limit = kind === 'page' ? MAX_PAGE_BYTES : MAX_IMAGE_BYTES;
      if (declared > limit) return { source: source('TOO_LARGE') };
      const body = Buffer.from(await res.arrayBuffer());
      if (body.length > limit) return { source: source('TOO_LARGE') };
      this.record(url.host, true);
      return { source: source('OK', undefined, { body, contentType, contentHash: createHash('sha256').update(body).digest('hex') }) };
    }
    return { source: last };
  }

  /** Test seam: forget robots, breakers and cache. */
  reset() {
    this.cache.clear();
    this.robots.clear();
    this.breakers.clear();
    this.lastRequest.clear();
  }
}
