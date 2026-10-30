import { RoutineDraftAssistant } from '@/features/routine/components/RoutineDraftAssistant';
import { StorefrontShell } from '@/features/shell/StorefrontShell';

export default function ShinaPage() {
  return (
    <StorefrontShell nav="shina">
      <RoutineDraftAssistant />
    </StorefrontShell>
  );
}
