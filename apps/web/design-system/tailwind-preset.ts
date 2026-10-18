import plugin from 'tailwindcss/plugin';
import type { Config } from 'tailwindcss';
import type { CSSRuleObject } from 'tailwindcss/types/config';
import tokens from './tokens.json';
import app from './tokens.app.json';

/**
 * Tailwind view of SAHEL V2 (the storefront's only design system).
 *
 * Built from the NAMES in tokens.json (canonical) and tokens.app.json (board values the canonical file lacks),
 * pointing at the custom properties in src/styles/tokens.generated.css. Colors, radii, shadows, font sizes,
 * line heights and screens REPLACE Tailwind's defaults instead of extending them, so raw palette classes
 * (bg-white, text-red-600) and stray scales do not exist in this app.
 */

const colorNames = [...tokens.color.tokens, ...app.color.tokens].map((t) => t.name);
const colors: Record<string, string> = {
  transparent: 'transparent',
  current: 'currentColor',
  inherit: 'inherit',
  ...Object.fromEntries(colorNames.map((n) => [n, `rgb(var(--${n}-rgb) / <alpha-value>)`])),
};

const radius = Object.fromEntries(tokens.radius.tokens.map((t) => [t.name.replace(/^radius-/, ''), `var(--${t.name})`]));

const boxShadow = {
  none: 'none',
  ...Object.fromEntries(tokens.shadow.tokens.map((t) => [t.name, `var(--${t.name})`])),
  ...Object.fromEntries(app.shadow.tokens.map((t) => [t.name, `var(--shadow-${t.name})`])),
};

const fontSize = Object.fromEntries(app.fontSize.values.map((v) => [v, `${v}px`]));
const lineHeight = { none: '1', ...Object.fromEntries(app.lineHeight.values.map((v) => [v, `${v}px`])) };

const sizes = Object.fromEntries(app.size.tokens.map((t) => [t.name, `var(--${t.name})`]));
const { $comment: _spaceNote, ...halfSteps } = app.spacing;

const { $comment: _bpNote, ...screens } = app.breakpoints;
const { $comment: _zNote, ...zIndex } = app.zIndex;

type Style = (typeof tokens.type.groups)[number]['styles'][number] & { letterSpacing?: string; fontStyle?: string };
const brandTracking = (tokens.type.groups.flatMap((g) => g.styles) as Style[]).find((s) => s.name === 'brand')?.letterSpacing ?? 'normal';
const mobile = app.typeMobile as Record<string, { fontSize: string; lineHeight: string } | string>;

const preset: Partial<Config> = {
  theme: {
    screens,
    colors,
    borderRadius: { none: '0', full: '9999px', ...radius, ...Object.fromEntries(app.radius.values.map((v) => [v, `${v}px`])) },
    boxShadow,
    fontSize,
    lineHeight,
    fontFamily: {
      display: ['var(--font-display)'],
      text: ['var(--font-text)'],
      serif: ['var(--font-serif)'],
    },
    extend: {
      spacing: { ...halfSteps, ...sizes },
      height: sizes,
      minHeight: sizes,
      width: sizes,
      maxWidth: { ...sizes, container: 'var(--container)', narrow: 'var(--container-narrow)' },
      zIndex: Object.fromEntries(Object.keys(zIndex).map((k) => [k, `var(--z-${k})`])),
      transitionDuration: Object.fromEntries(Object.keys(app.motion.duration).map((k) => [k, `var(--dur-${k})`])),
      transitionTimingFunction: { standard: 'var(--ease-standard)' },
      // tokens.json type.brand letterSpacing: Latin caps only, never Arabic.
      letterSpacing: { brand: brandTracking },
      keyframes: {
        'fade-in': { from: { opacity: '0' } },
        'rise-in': { from: { opacity: '0', transform: 'translateY(8px)' } },
        'sheet-in-bottom': { from: { transform: 'translateY(100%)' } },
        'sheet-in-end': { from: { transform: 'translateX(var(--sheet-from, -100%))' } },
        // Skeleton blocks breathe; never a spinner (Shutter Loading belongs to async buttons only).
        breathe: { '0%, 100%': { opacity: '1' }, '50%': { opacity: '.55' } },
      },
      animation: {
        'fade-in': 'fade-in var(--dur-base) var(--ease-standard)',
        'rise-in': 'rise-in var(--dur-base) var(--ease-standard)',
        'sheet-in-bottom': 'sheet-in-bottom var(--dur-base) var(--ease-standard)',
        'sheet-in-end': 'sheet-in-end var(--dur-base) var(--ease-standard)',
        breathe: 'breathe 1400ms ease-in-out infinite',
      },
    },
  },
  plugins: [
    plugin(({ addUtilities }) => {
      // text-<style>: the tokens.json type styles. Display sizes step down below lg (tokens.app.json typeMobile).
      const text: CSSRuleObject = {};
      for (const group of tokens.type.groups) {
        for (const style of group.styles as Style[]) {
          const small = mobile[style.name];
          const base = {
            fontFamily: `var(--font-${group.family})`,
            fontSize: typeof small === 'object' ? small.fontSize : style.fontSize,
            lineHeight: typeof small === 'object' ? small.lineHeight : style.lineHeight,
            fontWeight: String(style.fontWeight),
            ...(style.letterSpacing ? { letterSpacing: style.letterSpacing } : {}),
            ...(style.fontStyle ? { fontStyle: style.fontStyle } : {}),
          };
          text[`.text-${style.name}`] =
            typeof small === 'object'
              ? { ...base, [`@media (min-width: ${screens.lg})`]: { fontSize: style.fontSize, lineHeight: style.lineHeight } }
              : base;
        }
      }
      addUtilities(text);
    }),
  ],
};

export default preset;
