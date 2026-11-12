'use client';

import { AsyncButton, Button, type AsyncState } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useMessages } from '@/lib/i18n/LocaleProvider';

export interface DeleteAddressDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void> | void;
  deleting: boolean;
}

/** Accessible destructive confirmation dialog for deleting a saved delivery address. */
export function DeleteAddressDialog({
  open,
  onOpenChange,
  onConfirm,
  deleting,
}: DeleteAddressDialogProps) {
  const m = useMessages();
  const state: AsyncState = deleting ? 'pending' : 'idle';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={m.profileAddressCancel}>
        <DialogHeader>
          <DialogTitle>{m.profileAddressDeleteTitle}</DialogTitle>
          <DialogDescription>{m.addressBookDeleteConfirm}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <AsyncButton
            variant="tomato"
            size="m"
            state={state}
            pendingLabel={m.profileAddressDeleting}
            onClick={onConfirm}
          >
            {m.addressBookDelete}
          </AsyncButton>
          <Button
            type="button"
            variant="ghost"
            size="m"
            onClick={() => onOpenChange(false)}
            disabled={deleting}
          >
            {m.profileAddressCancel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
