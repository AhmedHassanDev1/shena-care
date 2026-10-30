import { messages } from './messages';

describe('message dictionaries', () => {
  it('have the same keys in Arabic and English, so no screen shows a missing string', () => {
    const en = Object.keys(messages.en).sort();
    const ar = Object.keys(messages.ar).sort();
    expect(ar.filter((k) => !en.includes(k))).toEqual([]);
    expect(en.filter((k) => !ar.includes(k))).toEqual([]);
  });

  it('keep placeholders ({name}) identical across languages', () => {
    const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
    for (const key of Object.keys(messages.en) as Array<keyof typeof messages.en>) {
      const a = messages.en[key];
      const b = (messages.ar as Record<string, unknown>)[key as string];
      if (typeof a === 'string' && typeof b === 'string') expect(`${key}:${placeholders(b)}`).toBe(`${key}:${placeholders(a)}`);
    }
  });
});
