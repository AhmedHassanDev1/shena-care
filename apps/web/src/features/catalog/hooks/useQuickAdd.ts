'use client';

import { useState } from 'react';
import { useCart } from '@/features/cart/hooks/useCart';
import type { CardModel } from '../lib/card-model';

export type QuickAddState = 'idle' | 'pending' | 'error';

/**
 * Quick Add for a product card or the hero's shoppable product (handoff §Transitions 1: "size is chosen first; the
 * header cart icon count updates"). One orderable variant → add it; several → the size picker opens first.
 * After adding, the card follows that cart line (its quantity, ±, remove at 0). Pending is a UI guard only; the
 * cart API is idempotent per owner + SKU.
 */
export function useQuickAdd(product: CardModel) {
  const { cart, addItem, updateItem, removeItem } = useCart();
  const [state, setState] = useState<QuickAddState>('idle');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [chosenSku, setChosenSku] = useState<string | null>(product.variants.length === 1 ? product.variants[0].skuId : null);
  const [qtyPending, setQtyPending] = useState(false);

  const multi = product.variants.length > 1;
  const line = chosenSku ? cart?.items.find((item) => item.skuId === chosenSku) : undefined;

  const add = async (skuId: string) => {
    setState('pending');
    try {
      await addItem({ skuId, quantity: 1 });
      setChosenSku(skuId);
      setState('idle');
      setPickerOpen(false);
    } catch {
      setState('error');
    }
  };

  const start = () => {
    if (state === 'pending') return;
    if (multi) setPickerOpen(true);
    else void add(product.variants[0].skuId);
  };

  const changeQuantity = async (next: number) => {
    if (!line) return;
    setQtyPending(true);
    try {
      if (next <= 0) await removeItem(line.skuId);
      else await updateItem({ skuId: line.skuId, quantity: next });
    } finally {
      setQtyPending(false);
    }
  };

  const closePicker = () => {
    setPickerOpen(false);
    if (state === 'error') setState('idle');
  };

  return { state, multi, line, pickerOpen, qtyPending, add, start, changeQuantity, closePicker };
}
