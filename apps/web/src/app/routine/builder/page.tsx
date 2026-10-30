import { RoutineReviewApproval } from '@/features/routine/components/RoutineReviewApproval';
import { StorefrontShell } from '@/features/shell/StorefrontShell';

export default function RoutineBuilderPage() {
  return (
    <StorefrontShell nav="routines">
      <RoutineReviewApproval />
    </StorefrontShell>
  );
}
