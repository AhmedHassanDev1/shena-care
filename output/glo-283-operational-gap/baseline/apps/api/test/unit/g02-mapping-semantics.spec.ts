// GLO-274 Gate 02 — a column layout match never implies financial or stock meaning (no database needed).
import { mappingApprovalProblems, ExportProfileService } from '../../src/modules/ingestion/services/export-profile.service';
import { FormatFingerprintService } from '../../src/modules/ingestion/services/format-fingerprint.service';
import { RowNormalizationService } from '../../src/modules/ingestion/services/row-normalization.service';
import { DiscountType } from '../../src/modules/ingestion/contracts/row-normalization.contract';

const base = { supplierSku: 'SKU', name: 'Name', price: 'Price', currency: 'EGP' };

describe('GLO-274 Gate 02: mapping semantics approval rules', () => {
  it('refuses a mapping with no reviewed semantics (the pre-fix self-approval case)', () => {
    expect(mappingApprovalProblems(base)).toEqual(expect.arrayContaining([
      'documentKind must be confirmed',
      expect.stringMatching(/UNIT_PURCHASE_COST/),
    ]));
  });

  it.each(['PACK_PURCHASE_COST', 'RETAIL_PRICE', 'UNKNOWN'] as const)('never approves a %s price as supplier cost', priceBasis => {
    expect(mappingApprovalProblems({ ...base, semantics: { documentKind: 'PRICE_LIST', priceBasis } })).toHaveLength(1);
  });

  it('requires confirmed quantity and discount bases when those columns are mapped', () => {
    const mapping = { ...base, quantity: 'Qty', discount: 'Disc', semantics: { documentKind: 'STOCK_FEED' as const, priceBasis: 'UNIT_PURCHASE_COST' as const } };
    expect(mappingApprovalProblems(mapping)).toEqual([
      'quantityBasis must be confirmed for the mapped quantity column',
      'discountBasis must be confirmed for the mapped discount column',
    ]);
  });

  it('never approves sales-invoice quantities as stock', () => {
    const invoice = { ...base, quantity: 'Qty', semantics: { documentKind: 'SALES_INVOICE' as const, priceBasis: 'UNIT_PURCHASE_COST' as const } };
    expect(mappingApprovalProblems({ ...invoice, semantics: { ...invoice.semantics, quantityBasis: 'ON_HAND' } }))
      .toEqual(['a sales invoice quantity cannot be approved as stock']);
    expect(mappingApprovalProblems({ ...invoice, semantics: { ...invoice.semantics, quantityBasis: 'INVOICE_QUANTITY' } })).toEqual([]);
  });

  it('heuristic proposals for a generic "Price"/"سعر" header carry no approvable semantics', () => {
    const profiles = new ExportProfileService({} as never, new FormatFingerprintService());
    for (const headers of [['Code', 'Name', 'Price EGP'], ['كود', 'اسم', 'سعر']]) {
      const proposal = profiles.proposeMapping(headers);
      expect(proposal.mapping.price).toBeDefined();
      expect(mappingApprovalProblems(proposal.mapping).length).toBeGreaterThan(0);
    }
  });
});

describe('GLO-274 Gate 02: discount unit comes from the approved profile, not the cell shape', () => {
  const rows = new RowNormalizationService();
  it('reads 0.5 as 0.5% under PERCENT and 0.5 currency under AMOUNT_PER_UNIT', () => {
    expect(rows.parseDiscount('0.5', 'PERCENT')).toMatchObject({ type: DiscountType.PERCENTAGE, value: 0.5 });
    expect(rows.parseDiscount('0.5', 'AMOUNT_PER_UNIT')).toMatchObject({ type: DiscountType.FIXED_AMOUNT, value: 0.5 });
    // Without a basis a bare number is ambiguous (HEAD guessed 0.5 → 50%); it is no longer turned into a discount.
    expect(rows.parseDiscount('0.5')).toBeNull();
    expect(rows.classifyDiscount('0.5').problem).toBe('AMBIGUOUS');
  });

  it('rejects signed, malformed or out-of-range discounts under an approved basis', () => {
    expect(rows.parseDiscount('-10%', 'PERCENT')).toBeNull();
    expect(rows.parseDiscount('120', 'PERCENT')).toBeNull();
    expect(rows.parseDiscount('15%', 'AMOUNT_PER_UNIT')).toBeNull();
    expect(rows.parseDiscount('ten', 'PERCENT')).toBeNull();
  });
});
