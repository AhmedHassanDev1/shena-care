// GLO-277 Gate 05 — supplier offer freshness from source time, not upload time (no database needed).
import { assessSourceFreshness, SourceTiming } from '../../src/modules/ingestion/services/offer-batch-commit.service';
import { RowNormalizationService } from '../../src/modules/ingestion/services/row-normalization.service';
import { NormalizedRowStatus } from '../../src/modules/ingestion/contracts/row-normalization.contract';

const t = (sourceObservedAt: string | null, receivedAt: string, workbookModifiedAt: string | null = null): SourceTiming =>
  ({ sourceObservedAt, receivedAt, workbookModifiedAt });

describe('GLO-277 Gate 05: assessSourceFreshness', () => {
  it('accepts the first offer for a SKU', () => {
    expect(assessSourceFreshness(t(null, '2026-10-22T10:00:00Z'), null)).toEqual({ verdict: 'FRESH' });
  });

  it('refuses a 2-day-old export uploaded today when the last accepted export is newer', () => {
    const lastAccepted = t('2026-10-21T09:00:00.000Z', '2026-10-21T10:00:00Z');
    const oldExportToday = t('2026-10-19T12:01:00.000Z', '2026-10-22T10:00:00Z');
    expect(assessSourceFreshness(oldExportToday, lastAccepted)).toMatchObject({ verdict: 'STALE' });
  });

  it('accepts a newer export even if its file reached us earlier than the last committed one', () => {
    const lastAccepted = t('2026-10-20T09:00:00.000Z', '2026-10-22T10:00:00Z');
    const newerExportUploadedEarlier = t('2026-10-21T09:00:00.000Z', '2026-10-22T08:00:00Z');
    expect(assessSourceFreshness(newerExportUploadedEarlier, lastAccepted)).toEqual({ verdict: 'FRESH' });
  });

  it('holds a row without a source time when the accepted offer came from a dated export', () => {
    expect(assessSourceFreshness(t(null, '2026-10-22T10:00:00Z'), t('2026-10-21T09:00:00.000Z', '2026-10-21T10:00:00Z')))
      .toMatchObject({ verdict: 'UNPROVEN' });
  });

  it('holds an XLSX whose workbook was last modified before the accepted export', () => {
    const lastAccepted = t(null, '2026-10-21T10:00:00Z', '2026-10-21T08:00:00.000Z');
    expect(assessSourceFreshness(t(null, '2026-10-22T10:00:00Z', '2026-10-18T08:00:00.000Z'), lastAccepted))
      .toMatchObject({ verdict: 'UNPROVEN', reason: 'workbook_modified_before_last_accepted_export' });
  });

  it('falls back to receipt order only when no source times exist', () => {
    const lastAccepted = t(null, '2026-10-22T10:00:00Z');
    expect(assessSourceFreshness(t(null, '2026-10-22T09:00:00Z'), lastAccepted)).toMatchObject({ verdict: 'STALE' });
    expect(assessSourceFreshness(t(null, '2026-10-22T11:00:00Z'), lastAccepted)).toEqual({ verdict: 'FRESH' });
  });
});

describe('GLO-277 Gate 05: source timestamp parsing', () => {
  const rows = new RowNormalizationService();
  const now = new Date('2026-10-22T12:00:00Z');

  it.each([
    ['2026-10-19 12:01', '2026-10-19T12:01:00.000Z'],
    ['2026-10-19T12:01:00Z', '2026-10-19T12:01:00.000Z'],
    ['٢٠٢٦-١٠-١٩', '2026-10-19T00:00:00.000Z'],
    ['19/10/2026', '2026-10-19T00:00:00.000Z'],
    [46314, '2026-10-19T00:00:00.000Z'],
  ])('reads %p', (raw, iso) => {
    expect(rows.parseSourceTimestamp(raw, now)).toEqual({ iso });
  });

  it('flags ambiguous day/month order, garbage and future dates instead of guessing', () => {
    expect(rows.parseSourceTimestamp('03/04/2026', now).problem).toBe('AMBIGUOUS');
    expect(rows.parseSourceTimestamp('yesterday', now).problem).toBe('UNPARSEABLE');
    expect(rows.parseSourceTimestamp('2026-02-30', now).problem).toBe('UNPARSEABLE');
    expect(rows.parseSourceTimestamp('2026-11-30', now).problem).toBe('FUTURE');
    expect(rows.parseSourceTimestamp('', now)).toEqual({ iso: null });
  });

  it('holds a row whose source time is unusable (field hold, never fast-laned)', () => {
    const result = rows.normalizeRow({ sourceRowNumber: 2, supplierSku: 'S-1', name: 'CeraVe Cleanser 236ml', brand: 'CeraVe',
      price: '100', currency: 'EGP', sourceTimestamp: '03/04/2026' });
    expect(result.status).toBe(NormalizedRowStatus.REVIEW);
    expect(result.holds).toEqual({ scope: false, fields: true });
    expect(result.sourceObservedAt).toBeNull();
  });
});
