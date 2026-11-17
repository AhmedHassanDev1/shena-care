'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Reorder, useDragControls } from 'motion/react';
import { Icon, type IconName } from '@/components/ui/icon';
import { ProductTile } from '@/components/ui/product-tile';
import { StatusChip } from '@/components/ui/status-chip';
import { formatNumber } from '@/lib/i18n/format';
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
  /** Warning text per step key (product not orderable, no longer in the catalog…); shown with words, never colour alone. */
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

function ToolButton({ icon, label, onClick, disabled, danger }: { icon: IconName; label: string; onClick?: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex size-control-m shrink-0 items-center justify-center rounded-pill text-ink transition-colors duration-fast ease-standard',
        'hover:bg-sand/70 disabled:cursor-not-allowed disabled:text-stone/60 disabled:hover:bg-transparent',
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
  /** Present when the row can be dragged (edit mode). */
  dragHandle?: { onPointerDown: (event: React.PointerEvent) => void };
}

function Row({ step, index, total, mode, catalog, warningOf, detailsOf, onNudge, onMove, onEdit, onReplace, onRemove, moveBlocked, dragHandle }: RowProps) {
  const m = useMessages();
  const option = catalog.get(step.product.skuId);
  const image = option?.imageUrl ?? step.product.imageUrl ?? null;
  const slug = option?.slug ?? step.product.slug ?? null;
  const warning = warningOf?.(step) ?? (option && !option.canOrder ? m.rtStateUnavailable : null);
  const target = otherTiming(step.timing);
  const blocked = moveBlocked?.(step.key, target) ?? false;
  const productParts = [step.product.brand, step.product.name, step.product.variant].filter((part): part is string => !!part);

  return (
    <div className="flex flex-col gap-2.5 py-4">
      <div className="flex items-start gap-3.5">
        <span aria-hidden="true" className="w-5 shrink-0 pt-0.5 text-center font-serif text-24 italic leading-none text-cobalt tabular-nums">
          {formatNumber(index + 1)}
        </span>
        <ProductTile src={image} alt="" name={step.product.name} size="thumb" className="size-16 shrink-0 rounded-image" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="m-0 flex flex-wrap items-center gap-x-2 font-display text-17 font-bold leading-24 text-ink">
            <span className="min-w-0 break-words">{step.title}</span>
            {step.isOptional ? <StatusChip tone="gray">{m.rtOptional}</StatusChip> : null}
          </p>
          <p className="m-0 font-display text-14 leading-20 text-stone">
            <bdi>{productParts.join(" · ")}</bdi>
          </p>
          {step.instructions ? <p className="m-0 mt-1 font-display text-14 leading-20 text-ink">{step.instructions}</p> : null}
          {warning ? (
            <p className="m-0 mt-1 flex items-center gap-1.5 font-display text-13 font-semibold leading-20 text-tomato-ink">
              <Icon name="alert" size={16} />
              {warning}
            </p>
          ) : null}
        </div>
      </div>

      {mode === 'view' ? (
        <div className="ps-8.5 flex flex-col gap-2">
          {detailsOf?.(step)}
          {slug ? (
            <Link href={routes.product(slug)} className="link-quiet self-start font-display text-14 font-semibold text-cobalt">
              {m.rtViewProduct}
            </Link>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-x-1 gap-y-1">
          <div className="flex items-center">
            <button
              type="button"
              aria-label={fillMessage(m.rtDragHandle, { name: step.title })}
              title={fillMessage(m.rtDragHandle, { name: step.title })}
              onPointerDown={dragHandle?.onPointerDown}
              className="inline-flex size-control-m shrink-0 cursor-grab touch-none items-center justify-center rounded-pill text-stone transition-colors duration-fast ease-standard hover:bg-sand/70 active:cursor-grabbing"
            >
              <Icon name="grip-vertical" size={20} />
            </button>
            <ToolButton icon="chevron-up" label={m.rtMoveUp} disabled={index === 0} onClick={() => onNudge?.(step.key, -1)} />
            <ToolButton icon="chevron-down" label={m.rtMoveDown} disabled={index === total - 1} onClick={() => onNudge?.(step.key, 1)} />
          </div>
          <div className="flex items-center">
            <ToolButton
              icon={target === 'PM' ? 'evening' : 'sun'}
              label={blocked ? fillMessage(m.rtMoveToBlocked, { period: timingSentence(m, target) }) : fillMessage(m.rtMoveTo, { period: timingSentence(m, target) })}
              disabled={blocked}
              onClick={() => onMove?.(step.key, target)}
            />
            <ToolButton icon="swap" label={m.rtReplaceProduct} onClick={() => onReplace?.(step.key)} />
            <ToolButton icon="pencil" label={m.rtEditStep} onClick={() => onEdit?.(step.key)} />
            <ToolButton icon="trash" label={fillMessage(m.rtRemoveStep, { name: step.title })} danger onClick={() => onRemove?.(step.key)} />
          </div>
        </div>
      )}
    </div>
  );
}

function DraggableRow(props: RowProps) {
  const controls = useDragControls();
  return (
    <Reorder.Item
      value={props.step.key}
      as="li"
      dragListener={false}
      dragControls={controls}
      className="relative list-none border-b border-ink/10 bg-transparent last:border-b-0"
      whileDrag={{ scale: 1.01, zIndex: 2 }}
      transition={{ duration: 0.18 }}
    >
      <Row {...props} dragHandle={{ onPointerDown: (event) => controls.start(event) }} />
    </Reorder.Item>
  );
}

/**
 * One time of day's steps, in order. Edit mode: drag by the handle, or use the arrows; both write the same order, so the
 * keyboard and touch paths are equal. View mode: read-only with the usage guidance the page passes in.
 */
export function StepList(props: StepListProps) {
  const { steps, mode, onReorder } = props;
  const [live, setLive] = useState('');
  const m = useMessages();
  const keys = steps.map((step) => step.key);

  if (mode === 'view') {
    return (
      <ol className="m-0 flex list-none flex-col p-0">
        {steps.map((step, index) => (
          <li key={step.key} className="border-b border-ink/10 last:border-b-0">
            <Row {...props} step={step} index={index} total={steps.length} />
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
          if (step) setLive(fillMessage(m.rtReorderAnnounce, { name: step.title, n: formatNumber(moved + 1), total: formatNumber(next.length) }));
        }}
        className="m-0 flex list-none flex-col p-0"
      >
        {steps.map((step, index) => (
          <DraggableRow
            key={step.key}
            {...props}
            step={step}
            index={index}
            total={steps.length}
            onNudge={(key, direction) => {
              props.onNudge?.(key, direction);
              const to = index + direction;
              if (to >= 0 && to < steps.length) setLive(fillMessage(m.rtReorderAnnounce, { name: step.title, n: formatNumber(to + 1), total: formatNumber(steps.length) }));
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
