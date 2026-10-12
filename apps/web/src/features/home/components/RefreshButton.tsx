'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

/** Re-runs the server render of the current route (used after a failed data load). */
export function RefreshButton({ label }: { label: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button type="button" variant="outline" loading={pending} onClick={() => startTransition(() => router.refresh())}>
      {label}
    </Button>
  );
}
