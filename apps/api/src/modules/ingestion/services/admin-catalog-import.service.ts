import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AdminCatalogImportRowOutcome as Outcome, AdminCatalogImportStatus as Status, Prisma } from '@prisma/client';
import * as crypto from 'crypto';
import { PrismaService } from '../../../platform/database/prisma.service';
import { StorageService } from '../../../platform/storage/storage.service';
import { SpreadsheetParserService, ParsedSpreadsheet } from './spreadsheet-parser.service';
import { RowNormalizationService } from './row-normalization.service';
import { MatchClassification, ProductIdentityMatchResult, ProductIdentityService, CandidateItemIdentityInput } from './product-identity.service';
import { IngestionEligibilityService } from './ingestion-eligibility.service';
import { compileEligibilityPolicy, EligibilityDecision } from './ingestion-eligibility.policy';

type Policy = ReturnType<typeof compileEligibilityPolicy>;
type Decision = { outcome: Outcome; reasonCode: string; reason: string; matchedSkuId?: string; identity?: Record<string, unknown> };
const POLICY_TEXT: Record<string, string> = {
  POLICY_NOT_CONFIGURED: 'No Catalog Policy is active yet', BRAND_NOT_ALLOWED: 'The brand is not enabled in the Catalog Policy',
  BRAND_UNKNOWN: 'The brand is not a known canonical brand or alias', BRAND_AMBIGUOUS: 'The brand name points to more than one brand',
  CATEGORY_DENIED: 'The category is excluded', CATEGORY_NOT_ALLOWED: 'No enabled brand allows this category',
  CATEGORY_NOT_ALLOWED_FOR_BRAND: 'This category is not allowed for the brand', CATEGORY_UNKNOWN: 'The category is missing or unknown',
  CATEGORY_AMBIGUOUS: 'The category name has more than one meaning', CATEGORY_REQUIRES_LEAF: 'A precise sub-category is required',
  PRODUCT_EXCLUDED: 'The product is explicitly excluded in the Catalog Policy',
};
/** Policy SKIP is a settled REJECTED row; policy HOLD waits for a person. Both keep the policy version that decided them. */
const policyDecision = (d: EligibilityDecision): Decision => ({
  outcome: d.outcome === 'SKIP' ? Outcome.REJECTED : Outcome.HOLD, reasonCode: `POLICY_${d.reason}`, reason: POLICY_TEXT[d.reason] ?? d.reason,
});

/** Admin lists are short product lists, not supplier exports; the bound keeps one request's matching honest. */
export const ADMIN_IMPORT_MAX_ROWS = 5000;
const MATCH_CHUNK = 200;
const MAX_NAME = 300;
const MAX_FIELD = 200;
const MAX_URL = 2000;
const SPREADSHEET_MIME = /^(text\/csv|application\/vnd\.ms-excel|application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet)$/;
const MATCH_LOCK = 'admin-catalog-import:match';

type Field = 'name' | 'brand' | 'size' | 'barcode' | 'category' | 'url';

/** Exact folded header names only. A column that is not listed here is never read, so price, cost and stock columns cannot leak in. */
const HEADERS: Record<Field, string[]> = {
  name: ['name', 'productname', 'product', 'title', 'itemname', 'اسم المنتج', 'المنتج', 'اسم', 'الاسم', 'اسم الصنف', 'الصنف'],
  brand: ['brand', 'brandname', 'manufacturer', 'الماركه', 'ماركه', 'العلامه التجاريه', 'براند'],
  size: ['size', 'volume', 'netcontent', 'net content', 'weight', 'الحجم', 'المقاس', 'الوزن', 'السعه'],
  barcode: ['barcode', 'gtin', 'ean', 'upc', 'الباركود', 'باركود'],
  category: ['category', 'categoryname', 'التصنيف', 'القسم', 'الفئه'],
  url: ['url', 'link', 'sourceurl', 'source url', 'productpage', 'product page', 'productlink', 'product link', 'الرابط', 'رابط', 'رابط المنتج'],
};

const foldHeader = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
  .replace(/[\r\n\t_\-./]+/g, ' ').replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim();
const FOLDED: Record<Field, Set<string>> = Object.fromEntries(
  (Object.keys(HEADERS) as Field[]).map(field => [field, new Set(HEADERS[field].flatMap(h => [foldHeader(h), foldHeader(h).replace(/ /g, '')]))])) as Record<Field, Set<string>>;

export interface ColumnMap { mapped: Partial<Record<Field, string>>; ignored: string[] }

export interface AdminImportReceipt {
  jobId: string;
  status: Status;
  reused: boolean;
  totalRows: number;
  columnMap: ColumnMap;
  totals?: Record<string, number>;
  matching?: { status: 'COMPLETED' | 'FAILED_RETRYABLE'; error?: string };
}

interface PreparedRow {
  rowNumber: number;
  name: string;
  brand: string | null;
  size: number | null;
  sizeUnit: string | null;
  barcode: string | null;
  invalidBarcode: string | null;
  categoryHint: string | null;
  sourceUrl: string | null;
  sourceCells: Record<string, unknown>;
  outcome: Outcome;
  reasonCode: string | null;
  reason: string | null;
}

export interface ResolveRowInput { action: 'LINK_SKU' | 'REJECT'; skuId?: string; note: string }

// eslint-disable-next-line no-control-regex -- stripping control characters from spreadsheet cells is the point
const cell = (value: unknown): string => (value === null || value === undefined ? '' : String(value)).normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Admin Catalog Bootstrap: an Admin uploads a plain product list to grow the catalog. Rows go through the same canonical identity engine as every other source
 * (ProductIdentityService) and the same downstream research, media and publication workflow; this service only keeps the list's own rows and decisions.
 *
 * Contract: an import only ever adds knowledge. It never creates SKUs, offers, prices or stock, and nothing absent from a list is touched.
 */
@Injectable()
export class AdminCatalogImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly parser: SpreadsheetParserService,
    private readonly normalizer: RowNormalizationService,
    private readonly identity: ProductIdentityService,
    private readonly eligibility: IngestionEligibilityService,
  ) {}

  /** Maps headers to fields by exact folded name; everything else is ignored and reported, never read. */
  mapColumns(headers: string[]): ColumnMap {
    const mapped: Partial<Record<Field, string>> = {};
    for (const header of headers) {
      const folded = foldHeader(header);
      for (const field of Object.keys(FOLDED) as Field[]) {
        if (!mapped[field] && (FOLDED[field].has(folded) || FOLDED[field].has(folded.replace(/ /g, '')))) { mapped[field] = header; break; }
      }
    }
    const used = new Set(Object.values(mapped));
    return { mapped, ignored: headers.filter(header => !used.has(header)) };
  }

  private prepareRow(parsedRow: ParsedSpreadsheet['rows'][number], columns: ColumnMap['mapped']): PreparedRow {
    const read = (field: Field) => (columns[field] ? cell(parsedRow.data[columns[field]!]) : '');
    const name = read('name');
    const brand = read('brand');
    const sizeText = read('size');
    const barcodeText = read('barcode');
    const category = read('category');
    const urlText = read('url');
    const sourceCells: Record<string, unknown> = {};
    for (const field of Object.keys(columns) as Field[]) sourceCells[columns[field]!] = parsedRow.data[columns[field]!];

    const prepared: PreparedRow = { rowNumber: parsedRow.sourceRow, name, brand: brand || null, size: null, sizeUnit: null, barcode: null, invalidBarcode: null,
      categoryHint: category || null, sourceUrl: null, sourceCells, outcome: Outcome.PENDING, reasonCode: null, reason: null };
    const settle = (outcome: Outcome, reasonCode: string, reason: string) => { if (prepared.outcome === Outcome.PENDING || outcome === Outcome.REJECTED) Object.assign(prepared, { outcome, reasonCode, reason }); };

    if (!name) settle(Outcome.REJECTED, 'MISSING_NAME', 'Product name is required');
    else if (name.length > MAX_NAME) settle(Outcome.REJECTED, 'NAME_TOO_LONG', `Product name is longer than ${MAX_NAME} characters`);
    if (brand.length > MAX_FIELD || category.length > MAX_FIELD) settle(Outcome.REJECTED, 'FIELD_TOO_LONG', `Brand and category are limited to ${MAX_FIELD} characters`);

    if (barcodeText) {
      const barcode = this.normalizer.normalizeBarcode(barcodeText);
      if (barcode.isValid) prepared.barcode = barcode.barcode;
      else prepared.invalidBarcode = barcodeText;
    }
    if (sizeText) {
      const extracted = this.normalizer.extractSizeAndPack(sizeText);
      if (extracted.size !== null && extracted.unit) { prepared.size = extracted.size; prepared.sizeUnit = extracted.unit; }
      else settle(Outcome.HOLD, 'SIZE_UNREADABLE', `Size "${sizeText.slice(0, 60)}" is not a readable quantity and unit`);
    }
    if (urlText) {
      try {
        const url = new URL(urlText);
        // Stored as provenance only; every fetch of it still passes the research source validator.
        if (url.protocol === 'https:' && urlText.length <= MAX_URL && !url.username && !url.password) prepared.sourceUrl = url.toString();
      } catch { /* an unusable URL is simply not kept */ }
    }
    return prepared;
  }

  private sha256(buffer: Buffer): string {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  /** Stores the original, admits every row with its outcome, then matches. A retried upload of the same file resolves to the same job and resumes matching. */
  async upload(file: Express.Multer.File, actorId: string): Promise<AdminImportReceipt> {
    if (!file?.buffer?.length) throw new BadRequestException('File is required');
    if (!SPREADSHEET_MIME.test(file.mimetype)) throw new BadRequestException('A CSV or XLSX product list is required');
    this.storage.validateFile(file);
    const parsed = this.parser.parseSpreadsheet(file.buffer, file.originalname, { maxRows: ADMIN_IMPORT_MAX_ROWS });
    const columnMap = this.mapColumns(parsed.headers);
    if (!columnMap.mapped.name) {
      throw new BadRequestException({ code: 'NAME_COLUMN_NOT_FOUND', message: 'The file needs a product name column', headers: parsed.headers });
    }
    const checksum = this.sha256(file.buffer);

    const settled = async (): Promise<AdminImportReceipt | null> => {
      const existing = await this.prisma.adminCatalogImportJob.findUnique({ where: { sourceChecksum: checksum } });
      if (!existing) return null;
      return this.receipt(existing.id, true);
    };

    let receipt = await settled();
    if (!receipt) {
      const rows = parsed.rows.map(row => this.prepareRow(row, columnMap.mapped));
      try {
        const jobId = await this.prisma.$transaction(async tx => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`admin-catalog-import:${checksum}`}))`;
          const raced = await tx.adminCatalogImportJob.findUnique({ where: { sourceChecksum: checksum }, select: { id: true } });
          if (raced) return { id: raced.id, created: false };
          const fileUrl = await this.storage.uploadFile(file, true, 'catalog-imports', actorId);
          try {
            const job = await tx.adminCatalogImportJob.create({ data: {
              sourceKey: new URL(fileUrl).pathname.slice('/storage/'.length), sourceChecksum: checksum,
              sourceFileName: file.originalname.replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 200), sourceMimeType: file.mimetype, sourceSizeBytes: file.buffer.length,
              uploadedBy: actorId, columnMap: columnMap as unknown as Prisma.InputJsonValue,
            } });
            for (let start = 0; start < rows.length; start += 1000) {
              await tx.adminCatalogImportRow.createMany({ data: rows.slice(start, start + 1000).map(row => ({
                jobId: job.id, rowNumber: row.rowNumber, name: row.name, brand: row.brand, size: row.size, sizeUnit: row.sizeUnit, barcode: row.barcode,
                invalidBarcode: row.invalidBarcode, categoryHint: row.categoryHint, sourceUrl: row.sourceUrl, sourceCells: row.sourceCells as Prisma.InputJsonValue,
                outcome: row.outcome, reasonCode: row.reasonCode, reason: row.reason,
              })) });
            }
            return { id: job.id, created: true };
          } catch (error) {
            await this.storage.deleteFile(fileUrl);
            throw error;
          }
        }, { timeout: 120000 });
        receipt = await this.receipt(jobId.id, !jobId.created);
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') receipt = await settled();
        if (!receipt) throw error;
      }
    }

    if (receipt.status !== Status.COMPLETED) {
      const matching = await this.match(receipt.jobId).then(
        () => ({ status: 'COMPLETED' as const }),
        error => ({ status: 'FAILED_RETRYABLE' as const, error: error instanceof Error ? error.message : String(error) }));
      receipt = { ...(await this.receipt(receipt.jobId, receipt.reused)), matching };
    }
    return receipt;
  }

  private async receipt(jobId: string, reused: boolean): Promise<AdminImportReceipt> {
    const job = await this.prisma.adminCatalogImportJob.findUniqueOrThrow({ where: { id: jobId } });
    return { jobId, status: job.status, reused, totalRows: await this.prisma.adminCatalogImportRow.count({ where: { jobId } }),
      columnMap: job.columnMap as unknown as ColumnMap, totals: (job.totals as Record<string, number> | null) ?? undefined };
  }

  /**
   * Classifies every PENDING row with the shared identity engine. Safe to repeat: a decided row is never rewritten, so a retry, a crash or two
   * concurrent calls converge. With recheck, rows still waiting on a person (HOLD, NEW_CANDIDATE) are looked at again, e.g. after their SKU was created.
   */
  async match(jobId: string, options: { recheck?: boolean } = {}): Promise<Record<string, number>> {
    const job = await this.prisma.adminCatalogImportJob.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Import not found');
    try {
      await this.prisma.adminCatalogImportJob.update({ where: { id: jobId }, data: { status: Status.MATCHING, lastError: null } });
      if (options.recheck) {
        // A Catalog Policy change can settle earlier policy outcomes either way, so policy skips are looked at again too.
        await this.prisma.adminCatalogImportRow.updateMany({
          where: { jobId, resolvedBy: null, OR: [
            { outcome: { in: [Outcome.HOLD, Outcome.NEW_CANDIDATE] }, reasonCode: { not: 'SIZE_UNREADABLE' } },
            { outcome: Outcome.REJECTED, reasonCode: { startsWith: 'POLICY_' } },
          ] },
          data: { outcome: Outcome.PENDING, reasonCode: null, reason: null },
        });
      }
      // The policy active when matching runs decides every row of this pass.
      const policy = await this.eligibility.compile((await this.eligibility.current())?.id);
      let cursor = 0;
      for (;;) {
        const chunk = await this.prisma.adminCatalogImportRow.findMany({
          where: { jobId, outcome: Outcome.PENDING, rowNumber: { gt: cursor } }, orderBy: { rowNumber: 'asc' }, take: MATCH_CHUNK });
        if (!chunk.length) break;
        cursor = chunk[chunk.length - 1].rowNumber;
        await this.matchChunk(job.createdAt, chunk, policy);
      }
      const totals = await this.totals(jobId);
      await this.prisma.adminCatalogImportJob.update({ where: { id: jobId }, data: { status: Status.COMPLETED, totals, completedAt: new Date() } });
      return totals;
    } catch (error) {
      await this.prisma.adminCatalogImportJob.update({ where: { id: jobId }, data: { status: Status.FAILED, lastError: (error instanceof Error ? error.message : String(error)).slice(0, 500) } });
      throw error;
    }
  }

  private async totals(jobId: string): Promise<Record<string, number>> {
    const grouped = await this.prisma.adminCatalogImportRow.groupBy({ by: ['outcome'], where: { jobId }, _count: { _all: true } });
    const totals: Record<string, number> = { PENDING: 0, LINKED_EXISTING: 0, NEW_CANDIDATE: 0, HOLD: 0, REJECTED: 0 };
    for (const group of grouped) totals[group.outcome] = group._count._all;
    totals.total = Object.values(totals).reduce((sum, count) => sum + count, 0);
    return totals;
  }

  private async matchChunk(jobCreatedAt: Date, rows: Array<Prisma.AdminCatalogImportRowGetPayload<object>>, policy: Policy): Promise<void> {
    const inputs = new Map<string, CandidateItemIdentityInput>();
    const brands = new Map<string, string | null>();
    const stated = new Map<string, EligibilityDecision>();
    const skipped: typeof rows = [];
    for (const row of rows) {
      const isStated = this.identity.isStatedBrand(row.brand);
      const inferred = isStated ? null : await this.identity.inferBrandFromName(row.name);
      const brand = isStated ? row.brand! : inferred ?? '';
      // Policy before identity: a disallowed brand or a known disallowed category is settled here, with no matching spend.
      const decision = policy.evaluate('', brand, row.categoryHint ?? '');
      stated.set(row.id, decision);
      if (decision.outcome === 'SKIP') { skipped.push(row); continue; }
      brands.set(row.id, inferred);
      inputs.set(row.id, { name: row.name, brand, barcode: row.barcode, invalidBarcode: row.invalidBarcode,
        size: row.size?.toNumber() ?? null, sizeUnit: row.sizeUnit, category: row.categoryHint, rawName: row.name, rawBrand: row.brand });
    }
    const batch = await this.identity.prepareBatch([...inputs.values()]);
    const results = new Map<string, ProductIdentityMatchResult>();
    for (const row of rows) if (inputs.has(row.id)) results.set(row.id, await this.identity.classifyCandidateMatch(inputs.get(row.id)!, batch));
    // A row that resolved to a canonical product is judged as that product: its own Brand/Category, and any explicit exclusion.
    const products = await this.eligibility.productsForSkus([...results.values()]
      .filter(r => r.classification === MatchClassification.EXACT_MATCH && r.matchedSkuId).map(r => r.matchedSkuId!));
    const policyEvidence = (d: EligibilityDecision) => ({ policy: { id: d.policyId, version: d.version, outcome: d.outcome, reason: d.reason } });

    for (const row of skipped) {
      const d = stated.get(row.id)!;
      await this.prisma.adminCatalogImportRow.updateMany({ where: { id: row.id, outcome: Outcome.PENDING },
        data: { ...policyDecision(d), identity: policyEvidence(d) as unknown as Prisma.InputJsonValue } });
    }

    // Decide and write inside one critical section, so two imports of the same new product elect one candidate.
    await this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${MATCH_LOCK}))`;
      const fingerprints = [...new Set([...results.values()].map(result => result.fingerprint))];
      const peers = await tx.adminCatalogImportRow.findMany({
        where: { fingerprint: { in: fingerprints }, outcome: Outcome.NEW_CANDIDATE },
        select: { id: true, fingerprint: true, rowNumber: true, jobId: true, job: { select: { createdAt: true } } },
      });
      type Peer = { id: string; rowNumber: number; jobId: string; createdAt: Date };
      const claimed = new Map<string, Peer[]>();
      const claim = (fingerprint: string, peer: Peer) => claimed.set(fingerprint, [...(claimed.get(fingerprint) ?? []), peer]);
      for (const peer of peers) claim(peer.fingerprint!, { id: peer.id, rowNumber: peer.rowNumber, jobId: peer.jobId, createdAt: peer.job.createdAt });

      for (const row of rows) {
        const result = results.get(row.id);
        if (!result) continue;
        const text = stated.get(row.id)!;
        const product = result.classification === MatchClassification.EXACT_MATCH && result.matchedSkuId ? products.get(result.matchedSkuId) : undefined;
        const judged = product ? policy.evaluateIdentity(product) : text;
        let decision: Decision = judged.outcome === 'ALLOW' ? this.decide(inputs.get(row.id)!, result) : policyDecision(judged);
        // No brand at all is the more useful reason than "unknown brand".
        if (!product && judged.reason === 'BRAND_UNKNOWN' && !this.identity.isStatedBrand(inputs.get(row.id)!.brand))
          decision = { outcome: Outcome.HOLD, reasonCode: 'MISSING_BRAND', reason: 'No brand could be read or inferred for an unknown product' };
        decision = { ...decision, identity: { ...decision.identity, ...policyEvidence(judged) } };
        if (decision.outcome === Outcome.NEW_CANDIDATE) {
          // Oldest wins: a product waiting from an earlier row (this file or an earlier one) is the single candidate.
          const earlier = (claimed.get(result.fingerprint) ?? []).find(peer => peer.id !== row.id &&
            (peer.createdAt.getTime() < jobCreatedAt.getTime() || (peer.jobId === row.jobId && peer.rowNumber < row.rowNumber)));
          if (earlier) decision = { outcome: Outcome.REJECTED, reasonCode: 'DUPLICATE_OF_ROW', reason: 'The same product is already waiting from an earlier row', identity: { duplicateOfRowId: earlier.id } };
        }
        const written = await tx.adminCatalogImportRow.updateMany({
          where: { id: row.id, outcome: Outcome.PENDING },
          data: { outcome: decision.outcome, reasonCode: decision.reasonCode, reason: decision.reason, fingerprint: result.fingerprint, matchedSkuId: decision.matchedSkuId ?? null,
            identity: { classification: result.classification, route: result.route ?? null, matchReason: result.reason, conflicts: result.conflicts,
              suggestedSkuId: result.suggestedSkuId ?? null, candidates: result.candidates ?? [], inferredBrand: brands.get(row.id) ?? null, ...decision.identity } as unknown as Prisma.InputJsonValue },
        });
        if (written.count && decision.outcome === Outcome.NEW_CANDIDATE) claim(result.fingerprint, { id: row.id, rowNumber: row.rowNumber, jobId: row.jobId, createdAt: jobCreatedAt });
      }
    }, { timeout: 60000 });
  }

  private decide(input: CandidateItemIdentityInput, result: ProductIdentityMatchResult): Decision {
    switch (result.classification) {
      case MatchClassification.INVALID:
      case MatchClassification.OUT_OF_SCOPE:
        return { outcome: Outcome.REJECTED, reasonCode: result.classification, reason: result.reason };
      case MatchClassification.EXACT_MATCH:
        if (result.matchedSkuId) return { outcome: Outcome.LINKED_EXISTING, reasonCode: 'VERIFIED_EXISTING_SKU', reason: result.reason, matchedSkuId: result.matchedSkuId };
        return { outcome: Outcome.HOLD, reasonCode: 'AMBIGUOUS_IDENTITY', reason: result.reason };
      case MatchClassification.CONFLICT:
        return { outcome: Outcome.HOLD, reasonCode: 'IDENTITY_CONFLICT', reason: result.reason };
      case MatchClassification.LIKELY_MATCH:
        return { outcome: Outcome.HOLD, reasonCode: result.reason === 'invalid_gtin_held' ? 'INVALID_BARCODE' : 'AMBIGUOUS_IDENTITY', reason: result.reason };
      default: {
        if (result.existingCandidateId || result.previouslyRejectedCandidateId || result.possibleDuplicateCandidateIds?.length) {
          return { outcome: Outcome.HOLD, reasonCode: 'POSSIBLE_DUPLICATE_CANDIDATE', reason: result.reason };
        }
        if (!this.identity.isStatedBrand(input.brand)) return { outcome: Outcome.HOLD, reasonCode: 'MISSING_BRAND', reason: 'No brand could be read or inferred for an unknown product' };
        if (result.conflicts.includes('missing_net_content')) return { outcome: Outcome.HOLD, reasonCode: 'MISSING_NET_CONTENT', reason: 'Size and unit are needed to tell this product apart from other sizes' };
        return { outcome: Outcome.NEW_CANDIDATE, reasonCode: 'UNKNOWN_PRODUCT', reason: 'No canonical SKU matches; ready for research and intake' };
      }
    }
  }

  /** An Admin settles a held or new row: link it to a canonical SKU the identity engine accepts, or reject it. Nothing here edits the catalog. */
  async resolveRow(rowId: string, input: ResolveRowInput, actorId: string) {
    const row = await this.prisma.adminCatalogImportRow.findUnique({ where: { id: rowId } });
    if (!row) throw new NotFoundException('Row not found');
    if (row.outcome !== Outcome.HOLD && row.outcome !== Outcome.NEW_CANDIDATE) {
      throw new ConflictException({ code: 'ROW_NOT_OPEN', message: `A ${row.outcome} row cannot be resolved` });
    }
    if (input.action === 'LINK_SKU') {
      if (!input.skuId) throw new BadRequestException('skuId is required to link');
      const identityInput: CandidateItemIdentityInput = { name: row.name, brand: row.brand ?? '', barcode: row.barcode, invalidBarcode: row.invalidBarcode,
        size: row.size?.toNumber() ?? null, sizeUnit: row.sizeUnit };
      // The same canonical identity safeguard as any other link: explicit conflicts and colliding barcodes refuse, whoever asks.
      await this.identity.assertSkuAssociation(identityInput, input.skuId, this.prisma, true);
      // A manual link obeys the same Catalog Policy: an excluded or disallowed product is never linked.
      const product = (await this.eligibility.productsForSkus([input.skuId])).get(input.skuId);
      const policy = await this.eligibility.compile((await this.eligibility.current())?.id);
      const judged = product ? policy.evaluateIdentity(product) : null;
      if (judged?.outcome === 'SKIP') throw new ConflictException({ code: `POLICY_${judged.reason}`, message: POLICY_TEXT[judged.reason] ?? judged.reason });
    }
    const data = input.action === 'LINK_SKU'
      ? { outcome: Outcome.LINKED_EXISTING, matchedSkuId: input.skuId!, reasonCode: 'ADMIN_LINKED', reason: 'Linked to a canonical SKU by an Admin' }
      : { outcome: Outcome.REJECTED, reasonCode: 'ADMIN_REJECTED', reason: 'Rejected by an Admin' };
    const written = await this.prisma.adminCatalogImportRow.updateMany({
      where: { id: rowId, outcome: row.outcome },
      data: { ...data, resolvedBy: actorId, resolvedAt: new Date(), resolutionNote: input.note.trim() },
    });
    if (!written.count) throw new ConflictException({ code: 'ROW_CHANGED', message: 'The row changed; reload before deciding' });
    await this.refreshTotals(row.jobId);
    return this.prisma.adminCatalogImportRow.findUniqueOrThrow({ where: { id: rowId } });
  }

  private async refreshTotals(jobId: string): Promise<void> {
    await this.prisma.adminCatalogImportJob.update({ where: { id: jobId }, data: { totals: await this.totals(jobId) } });
  }

  async listJobs(limit = 50) {
    return this.prisma.adminCatalogImportJob.findMany({ orderBy: { createdAt: 'desc' }, take: Math.min(Math.max(limit, 1), 200),
      select: { id: true, sourceFileName: true, uploadedBy: true, status: true, totals: true, createdAt: true, completedAt: true } });
  }

  async getJob(jobId: string) {
    const job = await this.prisma.adminCatalogImportJob.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Import not found');
    return { ...job, totals: await this.totals(jobId) };
  }

  async listRows(jobId: string, filter: { outcome?: Outcome; offset?: number; limit?: number } = {}) {
    if (!(await this.prisma.adminCatalogImportJob.findUnique({ where: { id: jobId }, select: { id: true } }))) throw new NotFoundException('Import not found');
    const where = { jobId, ...(filter.outcome && { outcome: filter.outcome }) };
    const [rows, total] = await Promise.all([
      this.prisma.adminCatalogImportRow.findMany({ where, orderBy: { rowNumber: 'asc' }, skip: Math.max(filter.offset ?? 0, 0), take: Math.min(Math.max(filter.limit ?? 100, 1), 500) }),
      this.prisma.adminCatalogImportRow.count({ where }),
    ]);
    return { total, rows };
  }
}
