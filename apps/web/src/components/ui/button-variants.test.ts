import { buttonVariants } from './button-variants';

describe('buttonVariants', () => {
  it('gives every size a token height so all calls to action line up', () => {
    expect(buttonVariants({ size: 'xs' })).toContain('h-control-s');
    expect(buttonVariants({ size: 'm' })).toContain('h-control-m');
    expect(buttonVariants({ size: 'l' })).toContain('h-control-l');
  });

  it('keeps one set of interaction states on the base', () => {
    const base = buttonVariants({});
    expect(base).toContain('enabled:hover:-translate-y-px');
    expect(base).toContain('disabled:bg-sand');
    expect(base).toContain('aria-busy:cursor-progress');
  });

  it('covers destructive, success and error looks', () => {
    expect(buttonVariants({ variant: 'danger' })).toContain('bg-tomato-ink');
    expect(buttonVariants({ state: 'success' })).toContain('bg-ok');
    expect(buttonVariants({ state: 'error' })).toContain('text-tomato-ink');
  });
});
