import { CatalogRoutineBuilderView } from '@/features/routine/components/CatalogRoutineBuilderView';
import { StorefrontShell } from '@/features/shell/StorefrontShell';

export const metadata = { title: 'بناء روتين | ShinaCare' };

export default function BuildRoutinePage() {
  return <StorefrontShell nav="routines"><CatalogRoutineBuilderView /></StorefrontShell>;
}
