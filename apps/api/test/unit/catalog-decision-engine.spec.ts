import {
  chooseIdentityImage, decideEditorial, decideFacts, decideMatchedRow, decideNewProduct, FactReading, FactVerdict, hasMedicalClaim, independentLinkSupport, rinseMode, SourceCheck,
} from '../../src/modules/catalog/research/catalog-decision-engine';

const check = (overrides: Partial<SourceCheck> = {}): SourceCheck => ({
  url: 'https://www.brand.example/p', tier: 'OFFICIAL_MANUFACTURER', outcome: 'OK', retryable: false, identityMatched: true, sizeConfirmed: true, rejectedReasons: [], pageGtin: null, ...overrides,
});
const fact = (id: string, field: string, value: unknown, tiers: FactReading['tiers'] = ['OFFICIAL_MANUFACTURER'], status: FactReading['status'] = 'PROPOSED'): FactReading => ({ id, field, value, tiers, status });

describe('Catalog decision engine', () => {
  describe('matched rows', () => {
    it('policy rejections SKIP with no person; matcher rejections SKIP; an earlier duplicate waits for its product', () => {
      expect(decideMatchedRow({ outcome: 'REJECTED', reasonCode: 'POLICY_BRAND_NOT_ALLOWED', matchedSkuId: null, resolvedByAdmin: false })).toMatchObject({ decision: 'SKIP' });
      expect(decideMatchedRow({ outcome: 'REJECTED', reasonCode: 'POLICY_CATEGORY_NOT_ALLOWED_FOR_BRAND', matchedSkuId: null, resolvedByAdmin: false })).toMatchObject({ decision: 'SKIP' });
      expect(decideMatchedRow({ outcome: 'REJECTED', reasonCode: 'OUT_OF_SCOPE', matchedSkuId: null, resolvedByAdmin: false })).toMatchObject({ decision: 'SKIP' });
      expect(decideMatchedRow({ outcome: 'REJECTED', reasonCode: 'DUPLICATE_OF_ROW', matchedSkuId: null, resolvedByAdmin: false })).toBeNull();
    });

    it('a verified link is AUTO_LINK; NEW_CANDIDATE is decided later by source verification, never here', () => {
      expect(decideMatchedRow({ outcome: 'LINKED_EXISTING', reasonCode: 'AUTO_LINK_PIPELINE_PROVENANCE', matchedSkuId: 's', resolvedByAdmin: false })).toMatchObject({ decision: 'AUTO_LINK' });
      expect(decideMatchedRow({ outcome: 'NEW_CANDIDATE', reasonCode: 'UNKNOWN_PRODUCT', matchedSkuId: null, resolvedByAdmin: false })).toBeNull();
    });

    it('competing identities and conflicts are critical, with a precomputed resolution when one SKU is suggested', () => {
      const one = decideMatchedRow({ outcome: 'HOLD', reasonCode: 'AMBIGUOUS_IDENTITY', matchedSkuId: null, resolvedByAdmin: false, suggestedSkuId: 'sku-1' })!;
      expect(one).toMatchObject({ decision: 'HOLD_CRITICAL', reasonCode: 'IDENTITY_UNCONFIRMED' });
      expect(one.hold!.recommended).toMatchObject({ action: 'RESOLVE', payload: { skuId: 'sku-1' } });
      expect(decideMatchedRow({ outcome: 'HOLD', reasonCode: 'AMBIGUOUS_IDENTITY', matchedSkuId: null, resolvedByAdmin: false })).toMatchObject({ reasonCode: 'COMPETING_IDENTITIES' });
      expect(decideMatchedRow({ outcome: 'HOLD', reasonCode: 'IDENTITY_CONFLICT', matchedSkuId: null, resolvedByAdmin: false })!.hold!.severity).toBe('CRITICAL');
    });
  });

  describe('independent support for linking an existing SKU', () => {
    const sku = { identityStatus: 'UNVERIFIED', barcode: null, barcodeStatus: 'UNKNOWN', identityEvidence: null };
    it('name and size alone never link', () => {
      expect(independentLinkSupport({ rowFingerprint: 'f', rowSourceUrl: null, rowBarcode: null, sku, provenanceRows: 0 }).supported).toBe(false);
    });
    it('the pipeline created the SKU from this fingerprint: link (re-import)', () => {
      expect(independentLinkSupport({ rowFingerprint: 'f', rowSourceUrl: null, rowBarcode: null, sku: { ...sku, identityEvidence: { fingerprints: ['f'] } }, provenanceRows: 0 }))
        .toEqual({ supported: true, basis: 'PIPELINE_PROVENANCE' });
      expect(independentLinkSupport({ rowFingerprint: 'f', rowSourceUrl: null, rowBarcode: null, sku, provenanceRows: 2 }).supported).toBe(true);
    });
    it('the same verified source page: link; a different page: no', () => {
      const verified = { ...sku, identityStatus: 'EVIDENCE_VERIFIED', identityEvidence: { sourceUrls: ['https://www.cerave.example/p/hydrating'] } };
      expect(independentLinkSupport({ rowFingerprint: 'x', rowSourceUrl: 'https://cerave.example/p/hydrating/', rowBarcode: null, sku: verified, provenanceRows: 0 }).basis).toBe('SAME_VERIFIED_SOURCE');
      expect(independentLinkSupport({ rowFingerprint: 'x', rowSourceUrl: 'https://cerave.example/p/foaming', rowBarcode: null, sku: verified, provenanceRows: 0 }).supported).toBe(false);
    });
    it('a barcode only links when the SKU barcode is VERIFIED; a merchant-recorded one does not', () => {
      expect(independentLinkSupport({ rowFingerprint: 'x', rowSourceUrl: null, rowBarcode: '3337875597388', sku: { ...sku, barcode: '3337875597388', barcodeStatus: 'VERIFIED' }, provenanceRows: 0 }).basis).toBe('VERIFIED_BARCODE');
      expect(independentLinkSupport({ rowFingerprint: 'x', rowSourceUrl: null, rowBarcode: '3337875597388', sku: { ...sku, barcode: '3337875597388', barcodeStatus: 'RECORDED' }, provenanceRows: 0 }).supported).toBe(false);
    });
  });

  describe('new products: identity by evidence, barcode optional', () => {
    it('an official page naming the product and size verifies identity without a barcode', () => {
      expect(decideNewProduct([check()], { barcode: null })).toMatchObject({ decision: 'AUTO_ACCEPT', reasonCode: 'IDENTITY_VERIFIED_BY_SOURCE' });
      expect(decideNewProduct([check({ tier: 'TRUSTED_DISTRIBUTOR' })], { barcode: null }).decision).toBe('AUTO_ACCEPT');
    });
    it('no source at all: HOLD for a URL; a retailer page alone is not enough', () => {
      expect(decideNewProduct([], { barcode: null })).toMatchObject({ decision: 'HOLD_CRITICAL', reasonCode: 'NO_IDENTITY_SOURCE' });
      expect(decideNewProduct([check({ tier: 'RETAILER' })], { barcode: null })).toMatchObject({ decision: 'HOLD_CRITICAL', reasonCode: 'SOURCE_NOT_TRUSTED' });
    });
    it('a page about another product or size is a critical contradiction, not a silent pass', () => {
      expect(decideNewProduct([check({ identityMatched: false, sizeConfirmed: null, rejectedReasons: ['IDENTITY_MISMATCH'] })], { barcode: null }))
        .toMatchObject({ decision: 'HOLD_CRITICAL', reasonCode: 'SOURCE_CONTRADICTS_IDENTITY' });
      expect(decideNewProduct([check({ sizeConfirmed: false, rejectedReasons: ['SIZE_MISMATCH'] })], { barcode: null }).reasonCode).toBe('SOURCE_CONTRADICTS_IDENTITY');
    });
    it('a page naming no size leaves the variant unproven', () => {
      expect(decideNewProduct([check({ sizeConfirmed: null })], { barcode: null }).reasonCode).toBe('SIZE_NOT_CONFIRMED');
    });
    it('a transient failure retries automatically', () => {
      expect(decideNewProduct([check({ outcome: 'TIMEOUT', retryable: true, identityMatched: false, sizeConfirmed: null })], { barcode: null }).decision).toBe('RETRY_AUTOMATIC');
    });
    it('a stated barcode the manufacturer page contradicts is a critical conflict; one it does not mention is fine', () => {
      expect(decideNewProduct([check({ pageGtin: '3337875597388' })], { barcode: '6224008073666' })).toMatchObject({ decision: 'HOLD_CRITICAL', reasonCode: 'BARCODE_CONFLICT' });
      expect(decideNewProduct([check({ pageGtin: '03337875597388' })], { barcode: '3337875597388' }).decision).toBe('AUTO_ACCEPT');
      expect(decideNewProduct([check()], { barcode: '6224008073666' }).decision).toBe('AUTO_ACCEPT');
      // A retailer's structured "gtin" is not a manufacturer statement and cannot raise a conflict.
      expect(decideNewProduct([check({ tier: 'TRUSTED_DISTRIBUTOR', pageGtin: '3337875597388' })], { barcode: '6224008073666' }).decision).toBe('AUTO_ACCEPT');
    });
  });

  describe('facts', () => {
    it('consistent manufacturer facts apply with zero clicks; retailer-only facts stay unknown', () => {
      const verdicts = decideFacts([fact('t', 'attributes.texture', 'CREAM'), fact('a', 'usage.targetArea', 'FACE'), fact('r', 'suitability.skinTypes', ['dry'], ['RETAILER'])]);
      expect(verdicts.get('t')).toMatchObject({ kind: 'APPLY', rule: 'OFFICIAL_SOURCE' });
      expect(verdicts.get('a')).toMatchObject({ kind: 'APPLY' });
      expect(verdicts.get('r')).toMatchObject({ kind: 'KEEP_UNVERIFIED', rule: 'RETAILER_ONLY' });
    });
    it('descriptive conflicts settle by authority, or stay unknown when equal; never a hold', () => {
      const higher = decideFacts([fact('o', 'attributes.texture', 'CREAM'), fact('d', 'attributes.texture', 'LOTION', ['TRUSTED_DISTRIBUTOR'])]);
      expect(higher.get('o')).toMatchObject({ kind: 'APPLY', rule: 'HIGHER_AUTHORITY_WINS' });
      expect(higher.get('d')).toMatchObject({ kind: 'REJECT' });
      const equal = decideFacts([fact('o1', 'attributes.texture', 'CREAM'), fact('o2', 'attributes.texture', 'GEL')]);
      expect([equal.get('o1')!.kind, equal.get('o2')!.kind]).toEqual(['KEEP_UNVERIFIED', 'KEEP_UNVERIFIED']);
    });
    it('two trusted ingredient lists or sizes that disagree open one critical exception', () => {
      const verdicts = decideFacts([fact('i1', 'composition.inci', ['AQUA', 'GLYCERIN']), fact('i2', 'composition.inci', ['AQUA', 'ALCOHOL'], ['TRUSTED_DISTRIBUTOR'])]);
      expect(verdicts.get('i1')).toMatchObject({ kind: 'CRITICAL' });
      const hold = (verdicts.get('i1') as Extract<FactVerdict, { kind: 'CRITICAL' }>).hold;
      expect(hold.reasonCode).toBe('COMPOSITION_INCI_CONFLICT');
      expect(hold.recommended?.payload?.factId).toBe('i1');
    });
    it('rinse-off versus leave-on instructions from trusted sources is critical; a single consistent instruction applies', () => {
      const conflict = decideFacts([fact('u1', 'usage.instructions', ['Apply to wet hair, massage and rinse thoroughly.']),
        fact('u2', 'usage.instructions', ['Apply to towel-dried hair. Do not rinse.'], ['TRUSTED_DISTRIBUTOR'])]);
      expect(conflict.get('u1')).toMatchObject({ kind: 'CRITICAL', rule: 'RINSE_MODE_CONFLICT' });
      expect(decideFacts([fact('u', 'usage.instructions', ['Massage into wet hair, then rinse.'])]).get('u')).toMatchObject({ kind: 'APPLY' });
    });
    it('marketing never overrides explicit instructions; treatment claims never reach the description', () => {
      const verdicts = decideFacts([fact('u', 'usage.instructions', ['Apply to wet hair and rinse thoroughly.']),
        fact('d', 'marketing.description', 'A leave-in conditioner you never rinse out, for silky hair all day.')]);
      expect(verdicts.get('u')).toMatchObject({ kind: 'APPLY' });
      expect(verdicts.get('d')).toMatchObject({ kind: 'REJECT', rule: 'MARKETING_CONTRADICTS_INSTRUCTIONS' });
      expect(decideFacts([fact('m', 'marketing.description', 'Clinically proven to stop hair loss and regrow hair in 4 weeks.')]).get('m')).toMatchObject({ kind: 'REJECT', rule: 'MEDICAL_CLAIM_NOT_PUBLISHED' });
    });
    it('the ingredient list outranks a fragrance-free claim; warnings accumulate; evidence-only fields are never applied', () => {
      const verdicts = decideFacts([fact('p', 'composition.fragrance', 'PRESENT'), fact('f', 'composition.fragrance', 'FREE'),
        fact('w1', 'safety.warnings', ['Avoid contact with eyes.']), fact('w2', 'safety.warnings', ['For external use only.'], ['TRUSTED_DISTRIBUTOR']),
        fact('c', 'claims.manufacturerStated', ['Reduces hair fall'])]);
      expect(verdicts.get('p')).toMatchObject({ kind: 'APPLY', rule: 'INCI_OUTRANKS_CLAIM' });
      expect(verdicts.get('f')).toMatchObject({ kind: 'REJECT', rule: 'CLAIM_CONTRADICTED_BY_INCI' });
      expect([verdicts.get('w1')!.kind, verdicts.get('w2')!.kind]).toEqual(['APPLY', 'APPLY']);
      expect(verdicts.get('c')).toMatchObject({ kind: 'KEEP_UNVERIFIED', rule: 'EVIDENCE_ONLY_FIELD' });
    });
    it('missing facts produce no verdict at all: unknown is never turned into a negative fact', () => {
      expect(decideFacts([]).size).toBe(0);
      expect([...decideFacts([fact('t', 'attributes.texture', 'GEL')]).keys()]).toEqual(['t']);
    });
    it('reads rinse modes and medical claims in English and Arabic', () => {
      expect(rinseMode(['Leave on, do not rinse'])).toBe('LEAVE_ON');
      // Real Clary Conditioner / Mask instructions: a contact time, then rinse. Rinse-off, never a contradiction.
      expect(rinseMode(['After shampooing, apply to damp hair, focusing on mid-lengths and ends.', 'Leave on for 3-5 minutes for deep hydration.', 'Rinse thoroughly.'])).toBe('RINSE_OFF');
      expect(rinseMode(['Leave on for 10–15 minutes to allow deep absorption.', 'For intensive care: Apply to dry hair and leave it on for 15 minutes while wrapping your head with a towel.', 'Rinse thoroughly and style as usual.'])).toBe('RINSE_OFF');
      expect(rinseMode(['Leave in. Do not rinse.'])).toBe('LEAVE_ON');
      expect(rinseMode(['Leave on hair, do not rinse out', 'Rinse thoroughly'])).toBe('CONTRADICTORY');
      expect(rinseMode(['اشطف جيدا بالماء'])).toBe('RINSE_OFF');
      expect(rinseMode(['Apply daily'])).toBe('UNKNOWN');
      expect(hasMedicalClaim('علاج تساقط الشعر')).toBe(true);
      expect(hasMedicalClaim('Hydrating conditioner for frizz-free hair')).toBe(false);
    });
  });

  describe('media', () => {
    it('chooses the best authentic image at or above 400 px; never upscales a small one; never reuses another SKU proof', () => {
      const { chosen, rejected } = chooseIdentityImage([
        { url: 'https://a/small.png', width: 360, height: 400, tier: 'OFFICIAL_MANUFACTURER', reusedBySku: null },
        { url: 'https://a/big.png', width: 1080, height: 1080, tier: 'TRUSTED_DISTRIBUTOR', reusedBySku: null },
        { url: 'https://a/official.png', width: 800, height: 900, tier: 'OFFICIAL_MANUFACTURER', reusedBySku: null },
        { url: 'https://a/other.png', width: 1200, height: 1200, tier: 'OFFICIAL_MANUFACTURER', reusedBySku: 'sku-x' },
        { url: 'https://shop/x.png', width: 2000, height: 2000, tier: 'RETAILER', reusedBySku: null },
      ]);
      expect(chosen?.url).toBe('https://a/official.png');
      expect(rejected.map(r => r.reason)).toEqual(expect.arrayContaining(['RESOLUTION_TOO_LOW:360x400', 'IMAGE_IS_PROOF_FOR_ANOTHER_SKU:sku-x', 'SOURCE_NOT_AUTHENTIC_ENOUGH']));
      expect(chooseIdentityImage([{ url: 'https://a/s.png', width: 300, height: 300, tier: 'OFFICIAL_MANUFACTURER', reusedBySku: null }]).chosen).toBeNull();
    });
    it('approves an editorial derivative only with no damage warnings', () => {
      expect(decideEditorial({ warnings: ['SOURCE_SHADOW_REMOVED', 'UPSCALED'] }, 'SUCCEEDED')).toEqual({ approve: true, reason: 'QUALITY_CHECKS_PASSED' });
      expect(decideEditorial({ warnings: ['DETACHED_PART'] }, 'SUCCEEDED').approve).toBe(false);
      expect(decideEditorial({ warnings: ['UPSCALED_SMALL_SOURCE'] }, 'SUCCEEDED').approve).toBe(false);
      expect(decideEditorial(null, 'FAILED').approve).toBe(false);
    });
  });
});
