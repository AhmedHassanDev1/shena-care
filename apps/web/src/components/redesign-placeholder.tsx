import { getLocale } from '@/lib/i18n/server';

interface RedesignPlaceholderProps {
  route: string;
}

const copy = {
  ar: {
    eyebrow: 'إعادة تصميم واجهة شينا كير',
    title: 'هذه الصفحة غير مكتملة مؤقتًا',
    description:
      'تمت إزالة الواجهة السابقة مع الاحتفاظ بالخدمات والتكاملات والمنطق الوظيفي. سيُعاد بناء هذه الرحلة ضمن التصميم المخصص القادم.',
    route: 'المسار المحفوظ',
  },
  en: {
    eyebrow: 'ShinaCare interface reset',
    title: 'This page is temporarily incomplete',
    description:
      'The previous presentation was removed while services, integrations, and application logic were preserved. This journey will return with the separately directed custom design.',
    route: 'Preserved route',
  },
} as const;

export function RedesignPlaceholder({ route }: RedesignPlaceholderProps) {
  const locale = getLocale();
  const content = copy[locale];

  return (
    <section
      data-ui-status="redesign-pending"
      aria-labelledby="redesign-pending-title"
      className="mx-auto flex min-h-[70vh] max-w-2xl flex-col justify-center px-6 py-16"
    >
      <p className="text-support font-semibold text-primary">{content.eyebrow}</p>
      <h1 id="redesign-pending-title" className="mt-3 text-h1 font-semibold text-foreground">
        {content.title}
      </h1>
      <p className="mt-4 text-body text-muted-foreground">{content.description}</p>
      <dl className="mt-8 border-s-2 border-border ps-4">
        <dt className="text-caption text-muted-foreground">{content.route}</dt>
        <dd className="mt-1 font-mono text-support text-foreground" dir="ltr">
          {route}
        </dd>
      </dl>
    </section>
  );
}
