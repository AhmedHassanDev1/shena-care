import { Suspense } from 'react';
import type { Metadata } from 'next';
import { RoutineBuilder } from '@/features/my-routines/components/RoutineBuilder';
import { StorefrontShell } from '@/features/shell/StorefrontShell';
import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';

export function generateMetadata(): Metadata {
  return { title: `${getMessages(getLocale()).rtBuildMeta} | ShinaCare` };
}

/** «اعمل روتينك»: build and save a routine from catalog products (/routines/build, optional ?product=<slug>). */
export default function BuildRoutinePage() {
  return (
    <StorefrontShell nav="routines" dock="routines">
      <Suspense>
        <RoutineBuilder />
      </Suspense>
    </StorefrontShell>
  );
}
