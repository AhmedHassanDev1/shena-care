import { RoutineDetailView } from '@/features/routine/components/RoutineDetailView';
import { StorefrontShell } from '@/features/shell/StorefrontShell';
import { getCuratedRoutineBySlug, CURATED_ROUTINES } from '@/features/routine/data/curatedRoutines';

export function generateStaticParams() {
  return CURATED_ROUTINES.map((r) => ({ slug: r.slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }) {
  const routine = getCuratedRoutineBySlug(params.slug);
  return {
    title: routine ? `${routine.titleAr} | ShinaCare` : 'الروتين | ShinaCare',
    description: routine?.descriptionAr ?? 'تفاصيل بروتوكول العناية المعتمد.',
  };
}

export default function RoutineDetailPage({ params }: { params: { slug: string } }) {
  return (
    <StorefrontShell nav="routines">
      <RoutineDetailView slug={params.slug} />
    </StorefrontShell>
  );
}
