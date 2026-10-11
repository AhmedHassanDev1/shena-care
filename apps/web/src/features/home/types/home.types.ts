import type { LucideIcon } from 'lucide-react';
import type { MessageKey } from '@/lib/i18n/messages';

export interface ConcernLink {
  id: string;
  labelKey: MessageKey;
  icon: LucideIcon;
}

export interface RoutineTrack {
  id: 'skin' | 'hair';
  titleKey: MessageKey;
  /** Questions the routine builder asks, in order. */
  questionKeys: MessageKey[];
  href: string;
}

export interface SkinCareSequence {
  id: 'morning' | 'evening';
  labelKey: MessageKey;
  stepKeys: MessageKey[];
}
