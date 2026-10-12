export const messages = {
  en: {
    loading: 'Loading…',
    unexpectedError: 'Something went wrong',
    unexpectedErrorDescription: 'We encountered an unexpected issue. Please try again.',
    errorId: 'Error ID',
    tryAgain: 'Try again',
    english: 'English',
    arabic: 'العربية',
    switchLanguage: 'Switch language',
    authTooMany: 'Too many attempts. Please wait a moment and try again.',
    authNetwork: 'Cannot reach the server. Check your connection and try again.',
  },
  ar: {
    loading: 'جارٍ التحميل…',
    unexpectedError: 'حدث خطأ',
    unexpectedErrorDescription: 'واجهتنا مشكلة غير متوقعة. حاول مرة أخرى.',
    errorId: 'معرّف الخطأ',
    tryAgain: 'حاول مرة أخرى',
    english: 'English',
    arabic: 'العربية',
    switchLanguage: 'تغيير اللغة',
    authTooMany: 'محاولات كثيرة. انتظر قليلًا ثم حاول مرة أخرى.',
    authNetwork: 'تعذر الاتصال بالخادم. تحقق من اتصالك وحاول مرة أخرى.',
  },
} as const;

export type Locale = keyof typeof messages;

/** Cookie holding the chosen locale; read on the server and written by the language switch. */
export const LOCALE_COOKIE_NAME = 'shena-locale';

export function isLocale(value: string | undefined): value is Locale {
  return value === 'en' || value === 'ar';
}

export function getMessages(locale: Locale) {
  return messages[locale];
}

export type Messages = ReturnType<typeof getMessages>;
