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

    // Auth — phone
    authMetaTitle: 'Sign in | ShinaCare',
    authMetaDescription: 'Sign in to ShinaCare with your mobile number.',
    authHome: 'ShinaCare home',
    authPhoneTitle: 'Your care starts here',
    authPhoneDescription: 'Enter your mobile number so we can continue together.',
    authPhoneLabel: 'Mobile number',
    authPhonePlaceholder: '01xxxxxxxxx',
    authPhoneInvalid: 'Enter a valid 11-digit Egyptian mobile number starting with 01.',
    authContinue: 'Continue',
    authPhoneHelper: 'We use your number to verify your account.',
    authSendFailed: "We couldn't send the verification code right now. Please try again shortly.",

    // Auth — verification code
    authOtpTitle: 'Confirm your mobile number',
    authOtpDescription: 'Enter the verification code sent to your number.',
    authOtpSentTo: 'Code requested for',
    authChangeNumber: 'Change number',
    authOtpLabel: 'Verification code',
    authOtpLengthHint: '{n} digits',
    authVerifyCta: 'Confirm and continue',
    authCodeNotReceived: "Didn't get the code?",
    authResend: 'Resend code',
    authResendIn: 'You can request a new code in {time} s.',
    authResent: 'We requested a new code for your number.',
    authCodeIncomplete: 'Enter the full {n}-digit code.',
    authCodeInvalid: "That code isn't correct. Check it and try again.",
    authCodeExpired: 'This code is no longer valid. Request a new one.',
    authResendWait: 'A code was requested a moment ago. Wait a minute, then try again.',
    authVerifyFailed: "We couldn't verify the code right now. Please try again.",
    authResendFailed: "We couldn't request a new code right now. Please try again shortly.",
    authSigningIn: 'Signing you in…',
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

    // Auth — phone
    authMetaTitle: 'تسجيل الدخول | ShinaCare',
    authMetaDescription: 'سجّل دخولك إلى ShinaCare برقم موبايلك.',
    authHome: 'الصفحة الرئيسية لـ ShinaCare',
    authPhoneTitle: 'عنايتك تبدأ من هنا',
    authPhoneDescription: 'اكتب رقم موبايلك علشان نكمل مع بعض.',
    authPhoneLabel: 'رقم الموبايل',
    authPhonePlaceholder: '01xxxxxxxxx',
    authPhoneInvalid: 'اكتب رقم موبايل مصري صحيح من ١١ رقم يبدأ بـ 01.',
    authContinue: 'متابعة',
    authPhoneHelper: 'هنستخدم رقمك علشان نتحقق من حسابك.',
    authSendFailed: 'مقدرناش نبعت رمز التحقق دلوقتي. حاول تاني بعد شوية.',

    // Auth — verification code
    authOtpTitle: 'أكّد رقم موبايلك',
    authOtpDescription: 'اكتب رمز التحقق اللي وصل لرقمك.',
    authOtpSentTo: 'الرمز مطلوب للرقم',
    authChangeNumber: 'تغيير الرقم',
    authOtpLabel: 'رمز التحقق',
    authOtpLengthHint: '{n} أرقام',
    authVerifyCta: 'تأكيد ومتابعة',
    authCodeNotReceived: 'ماوصلكش الرمز؟',
    authResend: 'إعادة إرسال الرمز',
    authResendIn: 'تقدر تطلب رمز جديد بعد {time} ثانية.',
    authResent: 'طلبنا رمز جديد لرقمك.',
    authCodeIncomplete: 'اكتب الرمز كامل ({n} أرقام).',
    authCodeInvalid: 'الرمز مش صحيح. راجعه وجرّب تاني.',
    authCodeExpired: 'الرمز ده مبقاش صالح. اطلب رمز جديد.',
    authResendWait: 'طلبت رمز من شوية. استنى دقيقة وجرّب تاني.',
    authVerifyFailed: 'مقدرناش نتحقق من الرمز دلوقتي. حاول تاني.',
    authResendFailed: 'مقدرناش نطلب رمز جديد دلوقتي. حاول تاني بعد شوية.',
    authSigningIn: 'بنسجّل دخولك…',
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

/** Replaces `{name}` placeholders in a message with the given values. */
export function fillMessage(message: string, values: Record<string, string | number>): string {
  return message.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));
}
