import { Suspense } from 'react';
import { ShinaChatView } from '@/features/shina/components/ShinaChatView';
import { StorefrontShell } from '@/features/shell/StorefrontShell';

export default function ShinaPage({
  searchParams,
}: {
  searchParams?: { q?: string; product?: string; concern?: string };
}) {
  return (
    <StorefrontShell nav="shina" hideFooter className="h-dvh overflow-hidden bg-chalk">
      <Suspense fallback={null}>
        <ShinaChatView initialQuery={searchParams?.q} contextProductSlug={searchParams?.product} />
      </Suspense>
    </StorefrontShell>
  );
}
