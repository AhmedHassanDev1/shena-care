'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { getMessages, type Locale } from './messages';

const LocaleContext = createContext<Locale>('en');

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  return useContext(LocaleContext);
}

export function useMessages() {
  return getMessages(useLocale());
}
