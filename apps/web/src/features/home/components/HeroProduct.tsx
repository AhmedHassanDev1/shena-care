'use client';

import Link from 'next/link';
import { Icon } from '@/components/ui/icon';
import { ProductTile } from '@/components/ui/product-tile';
import { QuantityStepper } from '@/components/ui/quantity-stepper';
import { SizePicker } from '@/features/catalog/components/SizePicker';
import { useQuickAdd } from '@/features/catalog/hooks/useQuickAdd';
import type { CardModel } from '@/features/catalog/lib/card-model';
import { MAX_LINE_QUANTITY } from '@/lib/cart';
import { currencyLabel, formatAmount, formatNumber } from '@/lib/i18n/format';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { fillMessage } from '@/lib/i18n/messages';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';

/**
 * The hero's shoppable product (Main / Mobile hero): linen card with the product tile (desktop), brand caps, name,
 * «من» price and a 44px round blue «+». Same Quick Add as the product card: size first when there are several.
 */
export function HeroProduct({ product, compact = false }: { product: CardModel; compact?: boolean }) {
  const m = useMessages();
  const locale = useLocale();
  const { state, multi, line, pickerOpen, qtyPending, add, start, changeQuantity, closePicker } = useQuickAdd(product);
  const href = routes.product(product.slug);

  return (
    <div
      className={cn(
        'relative flex items-center bg-linen text-night shadow-elevation-3',
        compact ? 'gap-2.5 rounded-16 p-1.5' : 'w-[352px] gap-3 rounded-card p-2.5'
      )}
    >
      {compact ? null : (
        <Link href={href} tabIndex={-1} aria-hidden="true" className="flex-none">
          <ProductTile size="thumb" className="h-20 w-16" src={product.imageUrl} alt="" name={product.name} />
        </Link>
      )}
      <Link href={href} className={cn('flex min-w-0 flex-1 flex-col gap-px text-night no-underline', compact && 'ps-2')}>
        <span lang="en" dir="ltr" className="truncate text-10.5 font-semibold leading-13 tracking-brand text-ink-2 text-match-parent lg:text-11">
          {product.brandName.toUpperCase()}
        </span>
        <span dir="auto" className="truncate text-13 font-semibold leading-19 text-match-parent">
          {product.name}
        </span>
        {product.price ? (
          <span className="text-14 font-bold leading-19 tabular-nums lg:text-15 lg:leading-20">
            {product.priceIsFrom ? <span className="me-[3px] text-11 font-medium text-ink-2">{m.cardFrom}</span> : null}
            <bdi>{formatAmount(product.price.amount, locale)}</bdi>
            <span className="ms-[3px] text-11 font-medium text-ink-2">{currencyLabel(locale)}</span>
          </span>
        ) : null}
      </Link>
      {line ? (
        <QuantityStepper
          tone="commerce"
          value={line.quantity}
          displayValue={formatNumber(line.quantity, locale)}
          min={0}
          max={MAX_LINE_QUANTITY}
          pending={qtyPending}
          onChange={changeQuantity}
          labels={{ group: m.cardQtyGroup, increase: m.qtyIncrease, decrease: m.qtyDecrease }}
        />
      ) : product.unavailable ? null : (
        <button
          type="button"
          onClick={start}
          aria-label={state === 'pending' ? m.cardAdding : fillMessage(multi ? m.cardChooseAddLabel : m.cardAddLabel, { name: product.name })}
          aria-haspopup={multi ? 'dialog' : undefined}
          aria-expanded={multi ? pickerOpen : undefined}
          aria-busy={state === 'pending' && !multi ? true : undefined}
          className="sl flex size-control-s flex-none items-center justify-center rounded-full bg-blue text-white shadow-action hover:bg-blue-hover"
        >
          <Icon name={state === 'error' && !multi ? 'retry' : 'plus'} size={compact ? 18 : 20} strokeWidth={2.25} />
        </button>
      )}
      {multi && pickerOpen ? (
        <div className="absolute inset-x-0 bottom-full mb-2">
          <SizePicker product={product} pending={state === 'pending'} failed={state === 'error'} onAdd={add} onClose={closePicker} />
        </div>
      ) : null}
      {state === 'error' && !multi ? (
        <p role="alert" className="sr-only">
          {m.cardAddFailed}
        </p>
      ) : null}
    </div>
  );
}
