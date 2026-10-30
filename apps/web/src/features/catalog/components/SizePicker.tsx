'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { ProductTile } from '@/components/ui/product-tile';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { formatEgp } from '@/lib/i18n/format';
import { useLocale, useMessages } from '@/lib/i18n/LocaleProvider';
import { cn } from '@/lib/utils';
import type { CardModel } from '../lib/card-model';

interface SizePickerProps {
  product: CardModel;
  pending: boolean;
  failed: boolean;
  onAdd: (skuId: string) => void;
  onClose: () => void;
}

/**
 * «اختار الحجم» (ProductCard variant-open; PLPStates «موبايل ٣٩٠ — الشيتات»): size is chosen before adding.
 * Desktop: a dialog over the card's own image. Phone: a bottom sheet with the product row. A radiogroup of the
 * orderable sizes (selected = bottle-tint + 2px bottle ring + check, 700), then «أضف للسلة · price» for the chosen size.
 */
export function SizePicker(props: SizePickerProps) {
  const [desktop, setDesktop] = useState<boolean | null>(null);
  useEffect(() => {
    const query = window.matchMedia('(min-width: 1024px)');
    const update = () => setDesktop(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  if (desktop === null) return null;
  return desktop ? <PickerPopover {...props} /> : <PickerSheet {...props} />;
}

function useSizeChoice(product: CardModel) {
  const [selected, setSelected] = useState(product.variants[0]?.skuId ?? null);
  return { selected, setSelected, variant: product.variants.find((v) => v.skuId === selected) ?? null };
}

function SizeOptions({ product, selected, onSelect }: { product: CardModel; selected: string | null; onSelect: (skuId: string) => void }) {
  const m = useMessages();
  const refs = useRef<Array<HTMLSpanElement | null>>([]);
  const move = (event: KeyboardEvent, index: number) => {
    const keys: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, ArrowLeft: 1, ArrowRight: -1 };
    if (!(event.key in keys)) return;
    event.preventDefault();
    const next = (index + keys[event.key] + product.variants.length) % product.variants.length;
    onSelect(product.variants[next].skuId);
    refs.current[next]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={m.sizeGroup} className="grid grid-cols-2 gap-2">
      {product.variants.map((variant, index) => {
        const checked = variant.skuId === selected;
        return (
          <span
            key={variant.skuId}
            ref={(el) => {
              refs.current[index] = el;
            }}
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => onSelect(variant.skuId)}
            onKeyDown={(event) => {
              if (event.key === ' ' || event.key === 'Enter') {
                event.preventDefault();
                onSelect(variant.skuId);
              } else move(event, index);
            }}
            className={cn(
              'flex h-control-m cursor-pointer items-center justify-center gap-1.5 rounded-image text-14 text-night',
              checked ? 'bg-bottle-tint font-bold shadow-outline-bottle' : 'bg-linen font-medium shadow-outline-control'
            )}
          >
            {checked ? <Icon name="check" size={16} strokeWidth={2.5} className="text-bottle" /> : null}
            {variant.label}
          </span>
        );
      })}
    </div>
  );
}

function AddButton({ product, skuId, pending, failed, onAdd, compact }: { product: CardModel; skuId: string | null; pending: boolean; failed: boolean; onAdd: (skuId: string) => void; compact?: boolean }) {
  const m = useMessages();
  const locale = useLocale();
  const variant = product.variants.find((v) => v.skuId === skuId);
  const price = variant?.price ? formatEgp(variant.price.amount, variant.price.currency, locale) : null;
  return (
    <>
      <Button
        variant="bottle"
        size={compact ? 's' : 'l'}
        className={cn('w-full', !compact && 'h-12.5 text-15')}
        loading={pending}
        pendingLabel={m.cardAdding}
        disabled={!skuId}
        onClick={() => skuId && onAdd(skuId)}
      >
        {failed ? <Icon name="retry" size={16} strokeWidth={2} /> : null}
        {m.sizeAddToCart}
        {price ? (
          <>
            <span aria-hidden="true" className="size-[3px] flex-none rounded-full bg-white/70" />
            <bdi>{price}</bdi>
          </>
        ) : null}
      </Button>
      {failed ? (
        <p role="alert" className="m-0 flex items-start gap-2 text-12.5 leading-19 text-err">
          <span aria-hidden="true" className="mt-1.5 size-1.75 flex-none rounded-full bg-err" />
          {m.cardAddFailed}
        </p>
      ) : null}
    </>
  );
}

function PickerPopover({ product, pending, failed, onAdd, onClose }: SizePickerProps) {
  const m = useMessages();
  const { selected, setSelected } = useSizeChoice(product);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role="radio"][tabindex="0"]')?.focus();
  }, []);
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={m.sizeChoose}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
      className="absolute inset-x-2.5 top-[34%] z-20 flex flex-col gap-2.5 rounded-16 bg-linen p-3.5 shadow-elevation-3 motion-safe:animate-rise-in"
    >
      <span className="flex items-center justify-between">
        <span className="text-14 font-bold leading-22">{m.sizeChoose}</span>
        <button type="button" aria-label={m.close} onClick={onClose} className="-m-2.5 -ms-1.5 flex size-control-s items-center justify-center text-night">
          <Icon name="close" size={18} strokeWidth={2} />
        </button>
      </span>
      <SizeOptions product={product} selected={selected} onSelect={setSelected} />
      <AddButton product={product} skuId={selected} pending={pending} failed={failed} onAdd={onAdd} compact />
    </div>
  );
}

function PickerSheet({ product, pending, failed, onAdd, onClose }: SizePickerProps) {
  const m = useMessages();
  const { selected, setSelected } = useSizeChoice(product);
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="bottom" closeLabel={m.close} className="rounded-t-24 pb-safe">
        <span aria-hidden="true" className="mt-2 h-1 w-10 self-center rounded-4 bg-dune" />
        <div className="flex items-center px-4 pb-1.5 pt-1 shadow-hairline-bottom">
          <SheetTitle className="flex h-control-s items-center font-display text-22 font-bold leading-28">{m.sizeChoose}</SheetTitle>
        </div>
        <div className="flex flex-col gap-3.5 px-4 pt-3">
          <span className="flex items-center gap-3">
            <ProductTile size="thumb" className="h-17.5 w-14 flex-none rounded-10" src={product.imageUrl} alt="" name={product.name} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span lang="en" dir="ltr" className="text-brand text-ink-2 text-match-parent">
                {product.brandName.toUpperCase()}
              </span>
              <span dir="auto" className="text-14 font-semibold leading-22 text-match-parent">
                {product.name}
              </span>
            </span>
          </span>
          <SizeOptions product={product} selected={selected} onSelect={setSelected} />
        </div>
        <div className="flex flex-col gap-2 px-4 pb-5 pt-3">
          <AddButton product={product} skuId={selected} pending={pending} failed={failed} onAdd={onAdd} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
