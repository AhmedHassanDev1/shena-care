import { ActiveRoutineTracker } from '@/features/routine/components/ActiveRoutineTracker';
import { StorefrontShell } from '@/features/shell/StorefrontShell';

export default function MyRoutinePage() {
  return (
    <StorefrontShell nav="routines">
      <ActiveRoutineTracker />
    </StorefrontShell>
  );
}
