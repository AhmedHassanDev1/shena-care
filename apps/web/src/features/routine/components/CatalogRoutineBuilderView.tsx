'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Section, SectionHeader } from '@/components/layout/section';
import { Button } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card-variants';
import { ProductTile } from '@/components/ui/product-tile';
import { getProducts } from '@/features/catalog/api/products';
import { useCart } from '@/features/cart/hooks/useCart';
import { formatEgp, formatNumber, formatPackSize } from '@/lib/i18n/format';
import { useLocale } from '@/lib/i18n/LocaleProvider';
import { routes } from '@/lib/routes';
import { buildRoutineChoices, getRoutineProfiles, sequenceRoutine, type RoutineChoice, type SequencedRoutine } from '../lib/catalog-routine';

const roleLabels: Record<string, { ar: string; en: string }> = {
  CLEANSER: { ar: 'غسول', en: 'Cleanser' }, MOISTURIZER: { ar: 'مرطب', en: 'Moisturizer' },
  SERUM: { ar: 'سيروم', en: 'Serum' }, SUNSCREEN: { ar: 'واقي شمس', en: 'Sunscreen' },
  HAIR_WASH: { ar: 'شامبو', en: 'Shampoo' }, CONDITIONER: { ar: 'بلسم', en: 'Conditioner' },
};

export function CatalogRoutineBuilderView() {
  const locale = useLocale();
  const { addItem } = useCart();
  const requestedProduct = useSearchParams().get('product');
  const preselected = useRef(false);
  const [domain, setDomain] = useState<'SKIN' | 'HAIR'>('SKIN');
  const [period, setPeriod] = useState<'AM' | 'PM'>('AM');
  const [selected, setSelected] = useState<string[]>([]);
  const [result, setResult] = useState<SequencedRoutine | null>(null);
  const [sequenceState, setSequenceState] = useState<'idle' | 'pending' | 'error'>('idle');
  const [cartState, setCartState] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
  const query = useQuery({ queryKey: ['routine-live-catalog'], queryFn: async () => {
    const products = await getProducts();
    const profiles = await getRoutineProfiles(products.flatMap(product => product.skus.map(sku => sku.id)));
    return buildRoutineChoices(products, profiles);
  }, staleTime: 60_000, retry: false });

  useEffect(() => {
    if (preselected.current || !requestedProduct || !query.data) return;
    preselected.current = true;
    const found = query.data.find(choice => choice.slug === requestedProduct);
    if (found) { setSelected([found.skuId]); if (found.domain === 'HAIR') setDomain('HAIR'); }
  }, [query.data, requestedProduct]);

  const choices = query.data?.filter(choice => choice.domain === domain) ?? [];
  const bySku = new Map(query.data?.map(choice => [choice.skuId, choice]) ?? []);
  const toggle = (skuId: string) => {
    setSelected(current => current.includes(skuId) ? current.filter(id => id !== skuId) : [...current, skuId]);
    setResult(null); setSequenceState('idle'); setCartState('idle');
  };
  const build = async () => {
    if (!selected.length || sequenceState === 'pending') return;
    setSequenceState('pending'); setResult(null); setCartState('idle');
    try { setResult(await sequenceRoutine(selected, domain === 'SKIN' ? period : undefined)); setSequenceState('idle'); }
    catch { setSequenceState('error'); }
  };
  const addAll = async () => {
    if (!result || cartState === 'pending') return;
    setCartState('pending');
    try {
      for (const step of result.steps) {
        if (bySku.get(step.skuId)?.canOrder) await addItem({ skuId: step.skuId, quantity: 1 });
      }
      setCartState('success');
    } catch { setCartState('error'); }
  };
  const t = locale === 'ar' ? {
    title: 'ابنِ روتينك من الكتالوج', lead: 'اختر منتجات حقيقية، وسنرتب الخطوات وفق بياناتها المحفوظة. الترتيب إرشادي ولا يعني ملاءمة المنتج لحالتك.',
    skin: 'البشرة', hair: 'الشعر', am: 'صباحًا', pm: 'مساءً', loading: 'جاري تحميل المنتجات…',
    error: 'تعذر تحميل المنتجات أو بيانات الروتين.', retry: 'إعادة المحاولة', empty: 'لا توجد منتجات منشورة ببيانات روتين لهذا القسم.',
    choose: 'اختر المنتجات', build: 'رتّب الخطوات', building: 'جاري ترتيب الخطوات…', buildError: 'تعذر ترتيب الخطوات. حاول مرة أخرى.',
    results: 'ترتيب الخطوات', missing: 'بعض المنتجات لم تعد متاحة ضمن الروتين.', excluded: 'استبعدت الخدمة بعض المنتجات لقيود الترتيب.',
    add: 'أضف المتاح للسلة', adding: 'جاري الإضافة…', added: 'تمت الإضافة', addError: 'تعذر إضافة بعض المنتجات. راجع السلة قبل المحاولة مجددًا.',
    viewCart: 'عرض السلة', noPrice: 'السعر غير متاح', devPrice: 'سعر اختباري للتطوير', derived: 'ترتيب مستنتج من نوع المنتج',
    notOrderable: 'غير متاح للطلب', count: 'منتجات مختارة', noSteps: 'لم تنتج خطوات قابلة للعرض.',
  } : {
    title: 'Build a routine from the catalog', lead: 'Choose live products and we will order them using their saved profiles. This is guidance, not a personal suitability assessment.',
    skin: 'Skin', hair: 'Hair', am: 'Morning', pm: 'Evening', loading: 'Loading products…',
    error: 'Could not load products or routine profiles.', retry: 'Retry', empty: 'No published products with routine profiles in this category.',
    choose: 'Choose products', build: 'Order steps', building: 'Ordering steps…', buildError: 'Could not order the steps. Please retry.',
    results: 'Step order', missing: 'Some products are no longer available for this routine.', excluded: 'The service excluded some products due to placement constraints.',
    add: 'Add available items to cart', adding: 'Adding…', added: 'Added', addError: 'Some items could not be added. Check your cart before retrying.',
    viewCart: 'View cart', noPrice: 'Price unavailable', devPrice: 'Development test price', derived: 'Order derived from product type',
    notOrderable: 'Unavailable to order', count: 'selected products', noSteps: 'No steps to display.',
  };

  return <>
    <Section labelledBy="routine-builder-title" rhythm="compact">
      <h1 id="routine-builder-title" className="m-0 font-display text-display-1 font-bold text-ink">{t.title}</h1>
      <p className="m-0 max-w-narrow text-body text-stone">{t.lead}</p>
      <div className="flex flex-wrap gap-2" role="group" aria-label={t.choose}>
        {(['SKIN', 'HAIR'] as const).map(value => <Button key={value} variant={domain === value ? 'ink' : 'linen'}
          aria-pressed={domain === value} onClick={() => { setDomain(value); setSelected([]); setResult(null); }}>
          {value === 'SKIN' ? t.skin : t.hair}</Button>)}
      </div>
      {domain === 'SKIN' ? <div className="flex gap-2" role="group" aria-label={locale === 'ar' ? 'وقت الروتين' : 'Routine time'}>
        {(['AM', 'PM'] as const).map(value => <Button key={value} variant={period === value ? 'ink' : 'linen'}
          aria-pressed={period === value} onClick={() => { setPeriod(value); setResult(null); }}>
          {value === 'AM' ? t.am : t.pm}</Button>)}
      </div> : null}
    </Section>
    <Section labelledBy="routine-choices" rhythm="compact" band>
      <SectionHeader title={t.choose} titleId="routine-choices" />
      {query.isPending ? <p role="status">{t.loading}</p> : query.isError ? <div role="alert"><p>{t.error}</p><Button onClick={() => void query.refetch()}>{t.retry}</Button></div>
        : choices.length === 0 ? <p>{t.empty}</p> : <div className="grid gap-3 md:grid-cols-2">
          {choices.map(choice => <Choice key={choice.skuId} choice={choice} checked={selected.includes(choice.skuId)}
            onToggle={() => toggle(choice.skuId)} locale={locale} labels={t} />)}
        </div>}
      {choices.length > 0 ? <div className="flex flex-wrap items-center gap-3">
        <span>{formatNumber(selected.length, locale)} {t.count}</span>
        <Button onClick={() => void build()} disabled={!selected.length || sequenceState === 'pending'} loading={sequenceState === 'pending'} pendingLabel={t.building}>{t.build}</Button>
      </div> : null}
      {sequenceState === 'error' ? <p role="alert">{t.buildError}</p> : null}
    </Section>
    {result ? <Section labelledBy="routine-result" rhythm="compact">
      <SectionHeader title={t.results} titleId="routine-result" />
      {result.steps.length ? <ol className="m-0 flex flex-col gap-3 p-0 list-none">{result.steps.map(step => {
        const choice = bySku.get(step.skuId);
        if (!choice) return null;
        return <li key={step.skuId} className={`${cardVariants()} flex items-center gap-3 p-3`}>
          <span className="font-display text-display-2 text-stone">{formatNumber(step.position, locale)}</span>
          <div className="min-w-0 flex-1"><p className="m-0 text-13 text-stone">{roleLabels[step.role ?? '']?.[locale] ?? step.role ?? ''}</p>
            <Link href={routes.product(choice.slug)} className="font-bold text-ink">{choice.brand} {choice.name}</Link>
            <p className="m-0 text-13 text-stone">{choice.price !== null && choice.currency ? formatEgp(choice.price, choice.currency, locale) : t.noPrice}</p>
          </div>
        </li>;
      })}</ol> : <p>{t.noSteps}</p>}
      {result.excluded.length ? <p role="status">{t.excluded} {result.excluded.map(item => item.name).join('، ')}</p> : null}
      {result.missing.length ? <p role="status">{t.missing}</p> : null}
      {result.steps.some(step => bySku.get(step.skuId)?.canOrder) ? <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => void addAll()} loading={cartState === 'pending'} pendingLabel={t.adding} disabled={cartState === 'pending'}>{cartState === 'success' ? t.added : t.add}</Button>
        {cartState === 'success' ? <Link href={routes.cart}>{t.viewCart}</Link> : null}
      </div> : null}
      {cartState === 'error' ? <p role="alert">{t.addError}</p> : null}
    </Section> : null}
  </>;
}

function Choice({ choice, checked, onToggle, locale, labels }: {
  choice: RoutineChoice; checked: boolean; onToggle: () => void; locale: 'ar' | 'en';
  labels: { noPrice: string; devPrice: string; derived: string; notOrderable: string };
}) {
  return <label className={`${cardVariants()} flex cursor-pointer items-center gap-3 p-3`}>
    <input type="checkbox" checked={checked} onChange={onToggle} className="size-5" aria-label={`${choice.brand} ${choice.name}`} />
    <ProductTile src={choice.imageUrl} alt={`${choice.brand} ${choice.name}`} name={choice.name} size="thumb" className="size-20 shrink-0" />
    <span className="min-w-0 flex-1"><span className="block font-bold text-ink">{choice.brand} {choice.name}</span>
      <span className="block text-13 text-stone">{formatPackSize(choice.size, choice.sizeUnit, locale) ?? choice.variantName} · {roleLabels[choice.role ?? '']?.[locale] ?? choice.role ?? ''}</span>
      <span className="block text-13 text-stone">{choice.price !== null && choice.currency ? formatEgp(choice.price, choice.currency, locale) : labels.noPrice}</span>
      {process.env.NODE_ENV !== 'production' && choice.price !== null ? <span className="block text-12 text-stone">{labels.devPrice}</span> : null}
      {choice.roleStatus === 'RULE_DERIVED' ? <span className="block text-12 text-stone">{labels.derived}</span> : null}
      {!choice.canOrder ? <span className="block text-12 text-stone">{labels.notOrderable}</span> : null}
    </span>
  </label>;
}
