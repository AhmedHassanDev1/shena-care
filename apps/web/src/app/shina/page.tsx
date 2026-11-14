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
        <ShinaChatView
          initialQuery={searchParams?.q}
          contextProductSlug={searchParams?.product}
          contextConcernSlug={searchParams?.concern && /^[a-z0-9][a-z0-9-]{0,79}$/.test(searchParams.concern) ? searchParams.concern : undefined}
        />
      </Suspense>
    </StorefrontShell>
  );
}
