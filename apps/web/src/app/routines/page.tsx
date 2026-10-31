import { RoutineHubView } from '@/features/routine/components/RoutineHubView';
import { StorefrontShell } from '@/features/shell/StorefrontShell';

export const metadata = {
  title: 'دليل الروتينات والعناية | ShinaCare',
  description: 'استكشفي بروتوكولات العناية الجاهزة المُعدة بواسطة خبراء العناية وفق مستحضرات الكتالوج الحقيقية، أو ابني روتينك المخصص.',
};

export default function RoutinesPage() {
  return (
    <StorefrontShell nav="routines" dock="routines">
      <RoutineHubView />
    </StorefrontShell>
  );
}
