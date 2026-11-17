import { Suspense } from 'react';
import type { Metadata } from 'next';
import { RoutineDetailsView } from '@/features/my-routines/components/RoutineDetailsView';
import { StorefrontShell } from '@/features/shell/StorefrontShell';
import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';

export function generateMetadata(): Metadata {
  return { title: `${getMessages(getLocale()).rtDetailMeta} | ShinaCare` };
}

/** One saved routine: Morning/Evening steps, usage guidance, and in-page editing (/account/routine/[id], ?edit=1 opens the editor). */
export default function RoutineDetailsPage({ params }: { params: { id: string } }) {
  return (
    <StorefrontShell nav="routines" dock="routines">
      <Suspense>
        <RoutineDetailsView id={params.id} />
      </Suspense>
    </StorefrontShell>
  );
}
