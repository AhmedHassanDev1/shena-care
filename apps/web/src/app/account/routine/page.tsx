import type { Metadata } from 'next';
import { MyRoutinesView } from '@/features/my-routines/components/MyRoutinesView';
import { StorefrontShell } from '@/features/shell/StorefrontShell';
import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';

export function generateMetadata(): Metadata {
  return { title: `${getMessages(getLocale()).rtMineMeta} | ShinaCare` };
}

/** «روتيناتي»: the signed-in customer's saved routines (/account/routine). */
export default function MyRoutinesPage() {
  return (
    <StorefrontShell nav="routines" dock="routines">
      <MyRoutinesView />
    </StorefrontShell>
  );
}
