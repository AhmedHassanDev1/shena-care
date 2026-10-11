import Link from 'next/link';
import { RECOMMENDED_ROUTINES } from '../data/home-content';
import { RoutineCard } from './RoutineCard';

export function RecommendedRoutines() {
  return (
    <section className="home-section">
      <div className="section-heading">
        <div><h2>Recommended Routines</h2><p>Expert-curated routines for your top concerns.</p></div>
        <Link href="/routine/builder">
          View All <span aria-hidden="true">→</span>
        </Link>
      </div>

      <div className="routine-card-row">
        {RECOMMENDED_ROUTINES.map((routine) => (
          <RoutineCard key={routine.id} routine={routine} />
        ))}
      </div>
    </section>
  );
}
