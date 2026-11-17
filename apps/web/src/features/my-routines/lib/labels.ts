import type { Messages } from '@/lib/i18n/messages';
import type { StepTiming } from '../api/personal-routines';

/** «صباحًا» / «مساءً» / «عند الحاجة»: the short label of a time of day (switches, chips). */
export function timingLabel(m: Messages, timing: StepTiming): string {
  return timing === 'AM' ? m.rtMorning : timing === 'PM' ? m.rtEvening : m.rtAsNeeded;
}

/** «الصباح» / «المساء»: the form that reads inside a sentence («انقل إلى المساء»). */
export function timingSentence(m: Messages, timing: StepTiming): string {
  return timing === 'AM' ? m.rtMorningLong : timing === 'PM' ? m.rtEveningLong : m.rtAsNeededLong;
}

/** «خطوة واحدة» / «خطوتان» / «٣ خطوات»: Arabic number agreement, Western digits. */
export function stepsLabel(m: Messages, count: number, formatNumber: (n: number) => string): string {
  if (count === 0) return m.rtStepsZero;
  if (count === 1) return m.rtStepsOne;
  if (count === 2) return m.rtStepsTwo;
  return m.rtStepsCount.replace('{n}', formatNumber(count));
}

export function productStateLabel(m: Messages, state: string): string | null {
  switch (state) {
    case 'AVAILABLE':
      return null;
    case 'UNAVAILABLE':
      return m.rtStateUnavailable;
    case 'UNPUBLISHED':
      return m.rtStateUnpublished;
    case 'INACTIVE':
      return m.rtStateInactive;
    default:
      return m.rtStateMissing;
  }
}

export function originLabel(m: Messages, origin: string): string {
  return origin === 'COPY' ? m.rtOriginCopy : origin === 'AI' ? m.rtOriginAi : m.rtOriginUser;
}

export const areaLabel = (m: Messages, area: string): string => (area === 'hair' ? m.rtAreaHair : area === 'body' ? m.rtAreaBody : m.rtAreaSkin);
