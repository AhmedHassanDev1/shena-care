export type ShinaActivityState =
  | 'idle'
  | 'thinking'
  | 'searching'
  | 'comparing'
  | 'routine'
  | 'recommending'
  | 'streaming'
  | 'clarification'
  | 'completed'
  | 'warning'
  | 'listening';

export interface ShinaProduct {
  id?: string;
  slug: string;
  name: string;
  brand: string;
  price: number;
  currency?: string;
  skuId: string;
  variantName?: string;
  category: string;
  imageUrl?: string;
  canOrder: boolean;
  stepBadge?: string;
  rationale?: string;
}

export interface ShinaComparisonSpec {
  label: string;
  value: string;
}

export interface ShinaComparisonProduct {
  slug: string;
  skuId: string;
  brand: string;
  name: string;
  imageUrl?: string;
  price: number | null;
  currency: string;
  canOrder: boolean;
  variantLabel: string;
  specs: ShinaComparisonSpec[];
}

export interface ShinaComparison {
  title: string;
  products: [ShinaComparisonProduct, ShinaComparisonProduct];
}

export interface ShinaRoutineStep {
  order: number;
  title: string;
  timing: 'am' | 'pm' | 'both' | 'as_needed';
  instructions?: string | null;
  isOptional: boolean;
  roleLabel?: string | null;
  product?: ShinaProduct | null;
  /** Same-type products the customer may swap in (AI routines only). */
  alternatives?: ShinaProduct[];
}

export interface ShinaRoutinePreview {
  title: string;
  description?: string | null;
  careArea: 'skin' | 'hair';
  source: 'ai-guidance' | 'catalog-sequence';
  steps: ShinaRoutineStep[];
  notes?: string[];
  excludedCount?: number;
  save?: ShinaRoutineSave;
}

export type ShinaSourceKind =
  | 'ai-guidance'
  | 'catalog-search'
  | 'catalog-compare'
  | 'catalog-detail'
  | 'routine-sequence'
  | 'error';

export type ShinaGuidanceType = 'answer' | 'clarification' | 'shortlist' | 'proposal';

export interface ShinaMessage {
  id: string;
  role: 'assistant' | 'user' | 'system';
  content: string;
  timestamp: string;
  sourceKind?: ShinaSourceKind;
  guidanceType?: ShinaGuidanceType;
  products?: ShinaProduct[];
  comparison?: ShinaComparison;
  routine?: ShinaRoutinePreview;
  suggestions?: string[];
  isError?: boolean;
  retryable?: boolean;
  requiresAuthPrompt?: boolean;
  pendingQuery?: string;
  consult?: ShinaConsultExtras;
}

export interface CustomerCareProfileSummary {
  skinType?: string | null;
  sensitivities?: string | null;
  concerns?: Array<{ concern?: { name: string; slug: string } }>;
}

/** What the consultation adds to an assistant turn (apps/api guidance ConsultPayload, mapped for the chat). */
export interface ShinaConsultExtras {
  /** The answer came from the catalogue engine because the AI was unavailable. */
  fallback?: boolean;
  /** «See a professional» reasons decided by the backend; when present, no product is recommended for the problem. */
  escalation?: string[];
  /** Sourced statements the answer relied on. */
  citations?: Array<{ title: string; url: string | null; professionallyReviewed: boolean }>;
  /** Why no personal routine was built (e.g. pregnancy needs a professional's review first). */
  routineNote?: string | null;
}

/** An assistant routine the customer can review and save to My Routines (never saved without their explicit tap). */
export interface ShinaRoutineSave {
  title: string;
  careArea: 'skin' | 'hair';
  steps: Array<{ title: string; timing: 'AM' | 'PM' | 'AS_NEEDED'; skuId: string; reason?: string }>;
  /** Compatibility notes from the shared routine rules, already in the customer's language. */
  issues: Array<{ severity: 'BLOCK' | 'WARN' | 'INFO'; text: string }>;
}
