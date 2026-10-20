export enum RowDiffAction {
  UPDATE = 'UPDATE',
  CREATE = 'CREATE',
  UNCHANGED = 'UNCHANGED',
  REVIEW = 'REVIEW',
  SKIP = 'SKIP',
  ERROR = 'ERROR',
  DEACTIVATE = 'DEACTIVATE',
}

export interface RowOfferSnapshot {
  costPrice: number | null;
  currency: string | null;
  isAvailable: boolean | null;
  lastObservedAt?: Date | null;
}

export interface RowDiff {
  itemId: string;
  supplierSkuCode: string;
  matchedSkuId: string | null;
  canonicalSkuCode: string | null;
  productName: string;
  action: RowDiffAction;
  reasons: string[];
  before: RowOfferSnapshot | null;
  after: RowOfferSnapshot;
  priceChangePercent: number | null;
  isLargePriceJump: boolean;
  isRetailOnly: boolean;
  isPriceOnly: boolean;
}

export interface JobDiffSummary {
  jobId: string;
  supplierId: string;
  mode: string;
  totalRows: number;
  counters: {
    updated: number;
    created: number;
    unchanged: number;
    review: number;
    skipped: number;
    error: number;
    deactivationsPending: number;
  };
  rows: RowDiff[];
  deactivationCandidates: Array<{
    skuId: string;
    skuCode: string;
    productName: string;
    currentCost: number;
    isAvailable: boolean;
  }>;
  requiresDeactivationApproval: boolean;
}

export interface CommitJobOptions {
  autoApplyLowRisk?: boolean;
  allowPriceOnlyUpdates?: boolean;
  declaredCompleteAssortment?: boolean;
  actorId?: string;
}

export interface ItemCommitOutcome {
  itemId: string;
  supplierSkuCode: string;
  skuId: string | null;
  action: RowDiffAction;
  status: 'COMMITTED' | 'HELD_FOR_REVIEW' | 'SKIPPED' | 'ERROR';
  reason?: string;
  appliedCostPrice?: number | null;
  appliedAvailability?: boolean | null;
}

export interface CommitJobResult {
  jobId: string;
  supplierId: string;
  status: string;
  committedCount: number;
  unchangedCount: number;
  heldForReviewCount: number;
  skippedCount: number;
  errorCount: number;
  deactivatedCount: number;
  itemOutcomes: ItemCommitOutcome[];
}

export interface ApproveDeactivationsOptions {
  supplierId?: string;
  confirmedAssortmentCoverage?: boolean;
  approvedSkuIds?: string[];
}
