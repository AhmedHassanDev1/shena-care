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
 * Sahel «اختار الحجم» (Size Picker)
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
    <div role="radiogroup" aria-label={m.sizeGroup} className="grid grid-cols-2 gap-2 font-display">
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
              'flex h-control-m cursor-pointer items-center justify-center gap-1.5 rounded-pill text-15',
              checked
                ? 'bg-cobalt text-chalk font-bold shadow-e1'
                : 'bg-linen font-medium text-ink shadow-outline-control hover:bg-chalk'
            )}
          >
            {checked ? <Icon name="check" size={16} strokeWidth={2.5} className="text-chalk" /> : null}
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
        variant="cobalt"
        size={compact ? 's' : 'l'}
        className={cn('w-full', !compact && 'h-12.5 text-16')}
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
        <p role="alert" className="m-0 flex items-start gap-2 text-13 font-semibold leading-relaxed text-tomato-ink">
          <span aria-hidden="true" className="mt-1 flex size-3.5 flex-none items-center justify-center rounded-full bg-tomato text-10 font-bold text-ink">!</span>
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
      className="absolute inset-x-2.5 top-[30%] z-20 flex flex-col gap-3 rounded-card bg-linen p-4 border border-ink/14 shadow-e3 motion-safe:animate-rise-in font-display"
    >
      <span className="flex items-center justify-between">
        <span className="text-16 font-bold leading-tight text-ink">{m.sizeChoose}</span>
        <button type="button" aria-label={m.close} onClick={onClose} className="-m-2 flex size-control-s items-center justify-center text-ink hover:text-cobalt">
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
      <SheetContent side="bottom" closeLabel={m.close} className="rounded-t-24 pb-safe font-display">
        <span aria-hidden="true" className="mt-2 h-1 w-10 self-center rounded-4 bg-dune" />
        <div className="flex items-center px-4 pb-2 pt-1 border-b border-ink/14">
          <SheetTitle className="flex h-control-s items-center font-display text-20 font-bold leading-none text-ink">{m.sizeChoose}</SheetTitle>
        </div>
        <div className="flex flex-col gap-3.5 px-4 pt-3">
          <span className="flex items-center gap-3">
            <ProductTile size="thumb" className="h-17.5 w-14 flex-none rounded-image" src={product.imageUrl} alt="" name={product.name} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span lang="en" dir="ltr" className="font-serif italic text-14 text-stone text-start">
                {product.brandName}
              </span>
              <span dir="auto" className="text-15 font-bold leading-tight text-ink text-start mt-0.5">
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
