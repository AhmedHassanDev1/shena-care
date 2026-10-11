import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AuthShell } from '@/features/auth/components/AuthShell';
import { getMessages } from '@/lib/i18n/messages';
import { getLocale } from '@/lib/i18n/server';

export function generateMetadata(): Metadata {
  const m = getMessages(getLocale());
  return { title: m.authMetaTitle, description: m.authSubtitle };
}

export default function AuthLayout({ children }: { children: ReactNode }) {
  return <AuthShell>{children}</AuthShell>;
}
