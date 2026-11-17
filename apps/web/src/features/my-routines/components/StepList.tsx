'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Reorder, useDragControls } from 'motion/react';
import { Icon, type IconName } from '@/components/ui/icon';
import { ProductTile } from '@/components/ui/product-tile';
import { StatusChip } from '@/components/ui/status-chip';
import { useMessages } from '@/lib/i18n/LocaleProvider';
import { fillMessage } from '@/lib/i18n/messages';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import type { StepTiming } from '../api/personal-routines';
import type { DraftStep } from '../lib/draft';
import type { PickOption } from '../lib/catalog';
import { timingSentence } from '../lib/labels';

export interface StepListProps {
  steps: DraftStep[];
  mode: 'edit' | 'view';
  catalog: Map<string, PickOption>;
  /** Warning text per step (product not orderable, no longer in the catalog…); shown with words, never colour alone. */
  warningOf?: (step: DraftStep) => string | null;
  /** In view mode: extra content under a step (usage guidance). */
  detailsOf?: (step: DraftStep) => ReactNode;
  onReorder?: (orderedKeys: string[]) => void;
  onNudge?: (key: string, direction: -1 | 1) => void;
  onMove?: (key: string, to: StepTiming) => void;
  onEdit?: (key: string) => void;
  onReplace?: (key: string) => void;
  onRemove?: (key: string) => void;
  /** True when moving the step to `to` is refused (same product already there). */
  moveBlocked?: (key: string, to: StepTiming) => boolean;
}

/** Where a step goes with the one-tap move: the other time of day. As-needed steps go to Morning. */
export const otherTiming = (timing: StepTiming): StepTiming => (timing === 'AM' ? 'PM' : 'AM');

/** «01», «02»: the step number, Western digits, two places. */
const stepNumber = (index: number) => String(index + 1).padStart(2, '0');

const CARD =
  'relative rounded-card bg-linen/80 shadow-outline-hairline shadow-elevation-1 backdrop-blur-sm transition-shadow duration-base ease-standard';

function ToolButton({ icon, label, onClick, disabled, danger, bordered }: { icon: IconName; label: string; onClick?: () => void; disabled?: boolean; danger?: boolean; bordered?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-pill text-ink transition-[background-color,color,transform] duration-fast ease-standard active:scale-95',
        bordered ? 'size-10 bg-linen shadow-outline-control hover:bg-sand/70' : 'size-control-m hover:bg-sand/70',
        'disabled:cursor-not-allowed disabled:text-stone/50 disabled:hover:bg-transparent',
        danger && 'text-tomato-ink hover:bg-conflict'
      )}
    >
      <Icon name={icon} size={20} />
    </button>
  );
}

interface RowProps extends Omit<StepListProps, 'steps' | 'onReorder'> {
  step: DraftStep;
  index: number;
  total: number;
  /** Present when the card can be dragged (edit mode). */
  dragHandle?: { onPointerDown: (event: React.PointerEvent) => void };
}

function StepCard({ step, index, total, mode, catalog, warningOf, detailsOf, onNudge, onMove, onEdit, onReplace, onRemove, moveBlocked, dragHandle }: RowProps) {
  const m = useMessages();
  const option = catalog.get(step.product.skuId);
  const image = option?.imageUrl ?? step.product.imageUrl ?? null;
  const slug = option?.slug ?? step.product.slug ?? null;
  const warning = warningOf?.(step) ?? (option && !option.canOrder ? m.rtStateUnavailable : null);
  const target = otherTiming(step.timing);
  const blocked = moveBlocked?.(step.key, target) ?? false;
  const productParts = [step.product.brand, step.product.name, step.product.variant].filter((part): part is string => !!part);
  const editing = mode === 'edit';
  const moveLabel = fillMessage(blocked ? m.rtMoveToBlocked : m.rtMoveTo, { period: timingSentence(m, target) });

  return (
    <div className={cn(CARD, 'grid grid-cols-[auto_auto_minmax(0,1fr)] items-start gap-x-3.5 gap-y-3 p-4 md:grid-cols-[auto_auto_minmax(0,1fr)_auto] md:items-center md:gap-x-4')}>
      {/* Step number and drag handle, on the card's leading edge. */}
      <div className="flex flex-col items-center gap-1.5 self-stretch">
        <span aria-hidden="true" className="font-serif text-34 italic leading-none text-cobalt tabular-nums">
          {stepNumber(index)}
        </span>
        {editing ? (
          <button
            type="button"
            aria-label={fillMessage(m.rtDragHandle, { name: step.title })}
            title={fillMessage(m.rtDragHandle, { name: step.title })}
            onPointerDown={dragHandle?.onPointerDown}
            className="mt-auto inline-flex size-control-m shrink-0 cursor-grab touch-none items-center justify-center rounded-pill text-stone transition-colors duration-fast ease-standard hover:bg-sand/70 hover:text-ink active:cursor-grabbing"
          >
            <Icon name="grip-vertical" size={22} />
          </button>
        ) : null}
      </div>

      <ProductTile src={image} alt="" name={step.product.name} size="thumb" className="size-20 shrink-0 rounded-image md:size-24" />

      <div className="flex min-w-0 flex-col gap-1">
        <p className="m-0 flex flex-wrap items-center gap-x-2 font-display text-18 font-bold leading-24 text-ink">
          <span className="min-w-0 break-words">{step.title}</span>
          {step.isOptional ? <StatusChip tone="gray">{m.rtOptional}</StatusChip> : null}
        </p>
        <p className="m-0 font-display text-14 leading-20 text-stone">
          <bdi>{productParts.join(' · ')}</bdi>
        </p>
        {step.instructions ? <p className="m-0 font-display text-14 leading-20 text-ink">{step.instructions}</p> : null}
        {warning ? (
          <p className="m-0 flex items-center gap-1.5 font-display text-13 font-semibold leading-20 text-tomato-ink">
            <Icon name="alert" size={16} />
            {warning}
          </p>
        ) : null}
        {editing ? (
          <div className="mt-1 flex items-center gap-2">
            <ToolButton bordered icon="chevron-up" label={m.rtMoveUp} disabled={index === 0} onClick={() => onNudge?.(step.key, -1)} />
            <ToolButton bordered icon="chevron-down" label={m.rtMoveDown} disabled={index === total - 1} onClick={() => onNudge?.(step.key, 1)} />
          </div>
        ) : null}
      </div>

      {editing ? (
        <div className="col-span-3 flex items-center justify-end border-t border-ink/10 pt-2 md:col-span-1 md:border-t-0 md:pt-0">
          <ToolButton icon={target === 'PM' ? 'evening' : 'sun'} label={moveLabel} disabled={blocked} onClick={() => onMove?.(step.key, target)} />
          <ToolButton icon="swap" label={m.rtReplaceProduct} onClick={() => onReplace?.(step.key)} />
          <ToolButton icon="pencil" label={m.rtEditStep} onClick={() => onEdit?.(step.key)} />
          <ToolButton icon="trash" label={fillMessage(m.rtRemoveStep, { name: step.title })} danger onClick={() => onRemove?.(step.key)} />
        </div>
      ) : (
        <div className="col-span-3 flex flex-col gap-2 border-t border-ink/10 pt-3 empty:hidden md:col-span-4">
          {detailsOf?.(step)}
          {slug ? (
            <Link href={routes.product(slug)} className="link-quiet self-start font-display text-14 font-semibold text-cobalt">
              {m.rtViewProduct}
            </Link>
          ) : null}
        </div>
      )}
    </div>
  );
}

function DraggableCard(props: RowProps) {
  const controls = useDragControls();
  return (
    <Reorder.Item
      value={props.step.key}
      as="li"
      dragListener={false}
      dragControls={controls}
      className="relative list-none"
      whileDrag={{ scale: 1.015, zIndex: 3 }}
      transition={{ duration: 0.18 }}
    >
      <StepCard {...props} dragHandle={{ onPointerDown: (event) => controls.start(event) }} />
    </Reorder.Item>
  );
}

/**
 * One time of day's steps as numbered cards. Edit mode: drag by the handle, or use the arrows; both write the same order, so the
 * keyboard and touch paths are equal and the numbers follow immediately. View mode: read-only, with the usage guidance the page passes in.
 */
export function StepList(props: StepListProps) {
  const { steps, mode, onReorder } = props;
  const [live, setLive] = useState('');
  const m = useMessages();
  const keys = steps.map((step) => step.key);
  const announce = (name: string, position: number, total: number) =>
    setLive(fillMessage(m.rtReorderAnnounce, { name, n: String(position), total: String(total) }));

  if (mode === 'view') {
    return (
      <ol className="m-0 flex list-none flex-col gap-3 p-0">
        {steps.map((step, index) => (
          <li key={step.key}>
            <StepCard {...props} step={step} index={index} total={steps.length} />
          </li>
        ))}
      </ol>
    );
  }

  return (
    <>
      <Reorder.Group
        as="ol"
        axis="y"
        values={keys}
        onReorder={(next: string[]) => {
          onReorder?.(next);
          const moved = next.findIndex((key, i) => key !== keys[i]);
          const step = moved >= 0 ? steps.find((candidate) => candidate.key === next[moved]) : undefined;
          if (step) announce(step.title, moved + 1, next.length);
        }}
        className="m-0 flex list-none flex-col gap-3 p-0"
      >
        {steps.map((step, index) => (
          <DraggableCard
            key={step.key}
            {...props}
            step={step}
            index={index}
            total={steps.length}
            onNudge={(key, direction) => {
              props.onNudge?.(key, direction);
              const to = index + direction;
              if (to >= 0 && to < steps.length) announce(step.title, to + 1, steps.length);
            }}
          />
        ))}
      </Reorder.Group>
      <p role="status" aria-live="polite" className="sr-only">
        {live}
      </p>
    </>
  );
}
