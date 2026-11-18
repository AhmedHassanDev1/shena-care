'use client';

import { AsyncButton, Button, type AsyncState } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { MessageBox } from '@/components/ui/message-box';
import { useMessages } from '@/lib/i18n/LocaleProvider';
import { fillMessage } from '@/lib/i18n/messages';

/** Permanent delete of one saved routine. Names the routine and says it cannot be undone before anything is deleted. */
export function DeleteRoutineDialog({ name, state, error, onConfirm, onCancel }: {
  /** The routine to delete; null keeps the dialog closed. */
  name: string | null;
  state: AsyncState;
  error: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const m = useMessages();
  return (
    <Dialog open={name !== null} onOpenChange={(open) => !open && state !== 'pending' && onCancel()}>
      <DialogContent closeLabel={m.rtCancel}>
        <DialogHeader>
          <DialogTitle>{fillMessage(m.rtDeleteTitle, { name: name ?? '' })}</DialogTitle>
          <DialogDescription>{m.rtDeleteBody}</DialogDescription>
        </DialogHeader>
        {error ? <MessageBox tone="err">{m.rtDeleteFailed}</MessageBox> : null}
        <DialogFooter>
          <AsyncButton variant="danger" size="m" state={state} pendingLabel={m.rtDeleting} onClick={onConfirm}>
            {m.rtDelete}
          </AsyncButton>
          <Button type="button" variant="ghost" size="m" disabled={state === 'pending'} onClick={onCancel}>
            {m.rtCancel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
