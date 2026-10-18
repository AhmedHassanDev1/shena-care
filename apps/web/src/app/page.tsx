import type { Metadata } from 'next';
import { HomePage } from '@/features/home/components/HomePage';
import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';

export function generateMetadata(): Metadata {
  const m = getMessages(getLocale());
  return { title: m.homeMetaTitle, description: m.homeMetaDescription };
}

export default function Page() {
  return <HomePage />;
}
