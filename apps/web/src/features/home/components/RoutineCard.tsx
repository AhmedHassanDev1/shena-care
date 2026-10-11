import Link from 'next/link';
import Image from 'next/image';
import { RoutineSnippet } from '../types/home.types';
import { ArrowRight, Sun } from 'lucide-react';

interface RoutineCardProps {
  routine: RoutineSnippet;
}

export function RoutineCard({ routine }: RoutineCardProps) {
  return (
    <article className={'routine-card routine-' + routine.id}>
      <Link href={'/routine/builder?concern=' + encodeURIComponent(routine.id)} aria-label={'Explore ' + routine.name}>
        <div className="routine-card-image">
          <Image
            src={routine.imageUrl}
            alt=""
            fill
            sizes="(max-width: 767px) 72vw, 25vw"
          />
        </div>
        <div className="routine-meta">
          <span>{routine.concern}</span>
          <span>{routine.stepCount} Steps</span>
          <span><Sun aria-hidden="true" />{routine.timeOfDay}</span>
        </div>
        <h3>{routine.name}</h3>
        <p>{routine.description}</p>
        <strong>Explore <ArrowRight aria-hidden="true" /></strong>
      </Link>
    </article>
  );
}
