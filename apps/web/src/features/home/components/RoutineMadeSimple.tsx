import { CalendarCheck, Moon, Sun } from 'lucide-react';

const steps = [
  { title: 'Morning Routine', copy: 'Cleanse, treat, moisturize and protect with SPF.', icon: Sun, className: 'morning-step' },
  { title: 'Evening Routine', copy: 'Cleanse, apply treatments and finish with moisturizer.', icon: Moon, className: 'evening-step' },
  { title: 'Stay Consistent', copy: 'Follow your routine regularly and give products time to work.', icon: CalendarCheck, className: 'consistent-step' },
];

export function RoutineMadeSimple() {
  return (
    <section className="routine-simple">
      <div className="routine-simple-title">
        <h2>Your Routine, Made Simple</h2>
        <p>Simple daily steps for healthier skin and hair.</p>
      </div>
      <div className="routine-simple-steps">
        {steps.map(({ title, copy, icon: Icon, className }) => (
          <article key={title} className={className}>
            <Icon aria-hidden="true" />
            <span><strong>{title}</strong><small>{copy}</small></span>
          </article>
        ))}
      </div>
    </section>
  );
}
