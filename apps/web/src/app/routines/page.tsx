import type { Metadata } from 'next';
import { RoutineHubView } from '@/features/routine/components/RoutineHubView';
import { StorefrontShell } from '@/features/shell/StorefrontShell';
import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';

export function generateMetadata(): Metadata {
  const m = getMessages(getLocale());
  return { title: m.routinesMetaTitle, description: m.routinesMetaDescription };
}

export default function RoutinesPage() {
  return (
    <StorefrontShell nav="routines" dock="routines">
      <RoutineHubView />
    </StorefrontShell>
  );
}
