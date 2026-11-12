import type { ProductDetail } from '@/features/catalog/api/discovery';
import { getProductDetail } from '@/features/catalog/api/discovery';
import type { ProductView } from '@/features/catalog/api/products';
import { sequenceRoutine } from '@/features/routine/lib/catalog-routine';
import { formatAmount } from '@/lib/i18n/format';
import type { Locale } from '@/lib/i18n/messages';
import {
  buildFollowUpSuggestions,
  buildShinaComparison,
  chooseCatalogProducts,
  pickComparisonPair,
  productViewToShinaProduct,
  routineSequenceToPreview,
  toChatProduct,
} from './catalog-chat';
import {
  proposalToRoutinePreview,
  resolvedProductToShinaProduct,
  type GuidanceMessageDto,
} from './shina-api';
import type { ShinaActivityState, ShinaMessage, ShinaProduct } from './shina-types';

let seq = 0;

export function createMessageId(prefix = 'shina'): string {
  seq += 1;
  return `${prefix}-${Date.now()}-${seq}`;
}

export function formatTimeLabel(locale: Locale): string {
  return new Date().toLocaleTimeString(locale === 'ar' ? 'ar-EG' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
}

export function buildContextProductMessage(detail: ProductDetail, locale: Locale): ShinaMessage {
  const variant = detail.selectedVariant ?? detail.skus[0];
  const primaryMedia =
    detail.media.find((item) => item.skuId === variant?.id && item.isPrimary)?.url ??
    detail.media.find((item) => item.isPrimary)?.url ??
    detail.media[0]?.url;

  const canOrder = Boolean(variant?.canOrder && variant?.price?.currency === 'EGP');
  const product: ShinaProduct = {
    id: detail.id,
    slug: detail.slug,
    name: detail.name,
    brand: detail.brand.name,
    price: variant?.price?.amount ?? 0,
    currency: variant?.price?.currency ?? 'EGP',
    skuId: variant?.id ?? detail.selectedSkuId,
    variantName: variant?.variantName,
    category: detail.category?.name ?? '',
    imageUrl: primaryMedia,
    canOrder,
  };

  const parts: string[] = [];
  if (locale === 'ar') {
    parts.push(`اطلعت على بيانات ${detail.name} من ${detail.brand.name} في الكتالوج المباشر.`);
    if (variant?.price && canOrder) {
      parts.push(`السعر المتاح الآن: ${formatAmount(variant.price.amount, locale)}.`);
    } else {
      parts.push('هذا الخيار غير متاح للطلب حاليًا في المتجر.');
    }
    if (detail.usage) parts.push(`طريقة الاستخدام الموثقة:\n${detail.usage}`);
    if (detail.warnings) parts.push(`تنبيهات السلامة:\n${detail.warnings}`);
  } else {
    parts.push(`Verified catalog record for ${detail.name} by ${detail.brand.name}.`);
    if (variant?.price && canOrder) {
      parts.push(`Current price: ${formatAmount(variant.price.amount, locale)}.`);
    } else {
      parts.push('This variant is currently unavailable to order.');
    }
    if (detail.usage) parts.push(`Verified usage:\n${detail.usage}`);
    if (detail.warnings) parts.push(`Warnings:\n${detail.warnings}`);
  }

  return {
    id: createMessageId('ctx'),
    role: 'assistant',
    content: parts.join('\n\n'),
    timestamp: formatTimeLabel(locale),
    sourceKind: 'catalog-detail',
    products: [product],
    suggestions:
      locale === 'ar'
        ? [`قارني بين ${detail.name} ومنتج مشابه`, 'رتّبي لي روتين يضم هذا المنتج']
        : [`Compare ${detail.name} with a similar formula`, 'Sequence a morning routine'],
  };
}

export async function runCatalogCompareWorkflow(
  query: string,
  catalog: ProductView[],
  locale: Locale,
  isAuthenticated: boolean,
  signal?: AbortSignal,
): Promise<{ message: ShinaMessage; state: ShinaActivityState }> {
  const pair = pickComparisonPair(query, catalog);
  if (!pair) {
    return {
      state: 'completed',
      message: {
        id: createMessageId('cmp-empty'),
        role: 'assistant',
        content:
          locale === 'ar'
            ? 'لا يوجد منتجان كافيان حاليًا في الكتالوج لإجراء مقارنة موثقة. يمكنك البحث عن منتج محدد أولاً.'
            : 'There are not two matching catalog products available to compare right now.',
        timestamp: formatTimeLabel(locale),
        sourceKind: 'catalog-compare',
        suggestions: buildFollowUpSuggestions({ locale, isAuthenticated }),
      },
    };
  }

  const [firstDetail, secondDetail] = await Promise.all([
    getProductDetail(pair[0].slug),
    getProductDetail(pair[1].slug),
  ]);
  throwIfAborted(signal);

  const comparison = buildShinaComparison([firstDetail, secondDetail], locale);
  return {
    state: 'completed',
    message: {
      id: createMessageId('cmp'),
      role: 'assistant',
      content:
        locale === 'ar'
          ? `هذه مقارنة موثقة بين ${comparison.products[0].name} و${comparison.products[1].name} بالاعتماد فقط على بيانات الكتالوج والأسعار الحالية.`
          : `Here is a verified side-by-side comparison between ${comparison.products[0].name} and ${comparison.products[1].name} using live catalog facts.`,
      timestamp: formatTimeLabel(locale),
      sourceKind: 'catalog-compare',
      comparison,
      suggestions: buildFollowUpSuggestions({
        locale,
        hasComparison: true,
        isAuthenticated,
      }),
    },
  };
}

export function runCatalogSearchWorkflow(
  query: string,
  catalog: ProductView[],
  locale: Locale,
  isAuthenticated: boolean,
): { message: ShinaMessage; state: ShinaActivityState } {
  const matchedViews = chooseCatalogProducts(query, catalog);
  const candidates = matchedViews.length > 0 ? matchedViews : [];
  const sellable = candidates
    .map(toChatProduct)
    .filter((item): item is ShinaProduct => item !== null);
  const itemsToRender =
    sellable.length > 0
      ? sellable
      : candidates
          .map(productViewToShinaProduct)
          .filter((item): item is ShinaProduct => item !== null);

  if (itemsToRender.length === 0) {
    return {
      state: 'completed',
      message: {
        id: createMessageId('search-empty'),
        role: 'assistant',
        content:
          locale === 'ar'
            ? 'لم أجد منتجات مطابقة في الكتالوج المتاح حاليًا لهذا البحث. جربي كلمة مفتاحية أخرى مثل «غسول» أو «كريم» أو «شامبو».'
            : 'No live catalog products matched that query right now. Try searching for cleanser, shampoo, or cream.',
        timestamp: formatTimeLabel(locale),
        sourceKind: 'catalog-search',
        suggestions: buildFollowUpSuggestions({ locale, isAuthenticated }),
      },
    };
  }

  return {
    state: 'completed',
    message: {
      id: createMessageId('search'),
      role: 'assistant',
      content:
        locale === 'ar'
          ? `وجدت ${itemsToRender.length} منتجات مطابقة في كتالوج شينا كير الحالي:`
          : `Found ${itemsToRender.length} matching products in the live ShinaCare catalog:`,
      timestamp: formatTimeLabel(locale),
      sourceKind: 'catalog-search',
      products: itemsToRender,
      suggestions: buildFollowUpSuggestions({
        locale,
        products: itemsToRender,
        isAuthenticated,
      }),
    },
  };
}

export async function runCatalogRoutineWorkflow(
  query: string,
  catalog: ProductView[],
  locale: Locale,
  isAuthenticated: boolean,
  signal?: AbortSignal,
): Promise<{ message: ShinaMessage; state: ShinaActivityState }> {
  const q = query.toLowerCase();
  const period: 'AM' | 'PM' = /مسا|pm|evening|ليل/.test(q) ? 'PM' : 'AM';
  const matched = chooseCatalogProducts(query, catalog);
  const pool = matched.length >= 2 ? matched : catalog;
  const candidateSkuIds = pool
    .flatMap((product) => product.skus.filter((sku) => sku.canOrder).map((sku) => sku.id))
    .slice(0, 6);

  if (candidateSkuIds.length === 0) {
    return {
      state: 'completed',
      message: {
        id: createMessageId('routine-empty'),
        role: 'assistant',
        content:
          locale === 'ar'
            ? 'لا توجد وحدات متاحة للطلب حاليًا لترتيب خطوات الروتين منها.'
            : 'No orderable SKUs are available in the catalog to sequence a routine right now.',
        timestamp: formatTimeLabel(locale),
        sourceKind: 'routine-sequence',
      },
    };
  }

  const sequenced = await sequenceRoutine(candidateSkuIds, period);
  throwIfAborted(signal);

  if (sequenced.steps.length === 0) {
    return {
      state: 'completed',
      message: {
        id: createMessageId('routine-noprofile'),
        role: 'assistant',
        content:
          locale === 'ar'
            ? 'لم يتم ربط ملفات ترتيب الروتين بهذه المنتجات بعد. يمكنك استعراض كل المنتجات المتاحة واختيار خطواتك من أداة بناء الروتين.'
            : 'Curated routine sequence profiles are not linked to these products yet. You can customize steps in the routine builder.',
        timestamp: formatTimeLabel(locale),
        sourceKind: 'routine-sequence',
        suggestions: buildFollowUpSuggestions({ locale, hasRoutine: true, isAuthenticated }),
      },
    };
  }

  const routine = routineSequenceToPreview(sequenced, pool, period, locale);

  return {
    state: 'completed',
    message: {
      id: createMessageId('routine'),
      role: 'assistant',
      content:
        locale === 'ar'
          ? `رتّبت لك هذه الخطوات اعتمادًا على قواعد التسلسل الموثقة في الكتالوج (${period === 'PM' ? 'المساء' : 'الصباح'}):`
          : `Here is your catalog-verified ${period} routine sequence based on live SKU profiles:`,
      timestamp: formatTimeLabel(locale),
      sourceKind: 'routine-sequence',
      routine,
      suggestions: buildFollowUpSuggestions({ locale, hasRoutine: true, isAuthenticated }),
    },
  };
}

export function mapGuidanceDtoToMessage(
  dto: GuidanceMessageDto,
  locale: Locale,
  isAuthenticated: boolean,
): { message: ShinaMessage; state: ShinaActivityState } {
  const products = (dto.resolvedProducts ?? []).map(resolvedProductToShinaProduct);
  const routine = proposalToRoutinePreview(dto.proposal, dto.resolvedProducts);
  const isClarification = dto.type === 'clarification';

  return {
    state: isClarification ? 'clarification' : 'completed',
    message: {
      id: dto.id || createMessageId('ai'),
      role: 'assistant',
      content: dto.content,
      timestamp: formatTimeLabel(locale),
      sourceKind: 'ai-guidance',
      guidanceType: dto.type,
      products: products.length > 0 ? products : undefined,
      routine,
      suggestions: buildFollowUpSuggestions({
        locale,
        products,
        hasRoutine: Boolean(routine),
        isAuthenticated,
      }),
    },
  };
}
