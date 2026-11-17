'use client';

import { useCallback, useState } from 'react';
import type { Draft } from '../lib/draft';

const LIMIT = 50;

/**
 * The routine being edited plus a stack of its previous states, so every structural change (add, remove, move, reorder,
 * replace, step edit) can be undone one by one. Typing the routine title is not a structural change and never enters the stack.
 */
export function useDraftHistory(initial: Draft) {
  const [state, setState] = useState<{ draft: Draft; past: Draft[] }>({ draft: initial, past: [] });

  /** Applies an operation; a no-op (same object back) is not recorded. */
  const apply = useCallback((operation: (draft: Draft) => Draft) => {
    setState((current) => {
      const next = operation(current.draft);
      return next === current.draft ? current : { draft: next, past: [...current.past.slice(-(LIMIT - 1)), current.draft] };
    });
  }, []);

  const setTitle = useCallback((title: string) => setState((current) => ({ ...current, draft: { ...current.draft, title } })), []);

  const undo = useCallback(() => {
    setState((current) => {
      const previous = current.past[current.past.length - 1];
      return previous ? { draft: { ...previous, title: current.draft.title }, past: current.past.slice(0, -1) } : current;
    });
  }, []);

  /** Replaces the draft outright (load, discard, start over) and forgets the history. */
  const reset = useCallback((draft: Draft) => setState({ draft, past: [] }), []);

  return { draft: state.draft, canUndo: state.past.length > 0, apply, setTitle, undo, reset };
}
