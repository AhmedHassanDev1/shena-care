import { RedesignPlaceholder } from '@/components/redesign-placeholder';
import { StorefrontShell } from '@/features/shell/StorefrontShell';

/** No V18 board yet: SAHEL placeholder inside the browsing shell. */
export default function RoutineBuilderPage() {
  return (
    <StorefrontShell nav="routines">
      <RedesignPlaceholder route="/routine/builder" />
    </StorefrontShell>
  );
}
