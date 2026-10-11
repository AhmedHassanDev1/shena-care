import { Sparkles } from 'lucide-react';
import Link from 'next/link';
import { routes } from '@/lib/routes';

export function AskAssistantButton() {
  return (
    <Link href={routes.routineBuilder} className="ask-assistant" aria-label="Ask the beauty assistant">
      <Sparkles aria-hidden="true" />
      <span>Ask</span>
    </Link>
  );
}
