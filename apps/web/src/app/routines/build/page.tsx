import { Suspense } from 'react';
import { RoutineBuilderView } from '@/features/routine/components/RoutineBuilderView';
import { StorefrontShell } from '@/features/shell/StorefrontShell';

export const metadata = {
  title: 'أداة بناء الروتين المخصص | ShinaCare',
  description: 'ابني روتينك المخصص للبشرة أو الشعر خطوة بخطوة وفق مستحضرات الكتالوج الحقيقية.',
};

export default function RoutineBuilderPage() {
  return (
    <StorefrontShell nav="routines">
      <Suspense fallback={<div className="py-20 text-center">جارٍ تجهيز أداة بناء الروتين...</div>}>
        <RoutineBuilderView />
      </Suspense>
    </StorefrontShell>
  );
}
