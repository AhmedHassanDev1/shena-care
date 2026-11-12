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
}

export interface ShinaRoutinePreview {
  title: string;
  description?: string | null;
  careArea: 'skin' | 'hair';
  source: 'ai-guidance' | 'catalog-sequence';
  steps: ShinaRoutineStep[];
  notes?: string[];
  excludedCount?: number;
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
}

export interface CustomerCareProfileSummary {
  skinType?: string | null;
  sensitivities?: string | null;
  concerns?: Array<{ concern?: { name: string; slug: string } }>;
}
