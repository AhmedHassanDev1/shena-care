import plugin from 'tailwindcss/plugin';
import type { Config } from 'tailwindcss';
import tokens from './tokens.json';
import roles from './roles.json';
import extensions from './tokens.extensions.json';

/**
 * Tailwind view of the ShinaCare design system.
 *
 * Every entry is built from the NAMES in tokens.json / roles.json and points at the CSS custom
 * properties in src/styles/tokens.generated.css — values are never copied here. Adding a token to
 * tokens.json therefore creates its utility (bg-<name>, rounded-<name>, shadow-<name>, h-control-l…).
 */

type Named = { name: string; value: string };
const names = (group: { tokens: Named[] }, prefix = '') =>
  group.tokens.map((t) => t.name.replace(new RegExp(`^${prefix}`), ''));
const entries = (list: string[], prefix: string) => Object.fromEntries(list.map((n) => [n, `var(--${prefix}${n})`]));
const without = <T extends Record<string, unknown>>(obj: T) =>
  Object.fromEntries(Object.entries(obj).filter(([k]) => !k.startsWith('$'))) as Record<string, string>;

/** Hex colors with alpha (the scrim) cannot take /opacity, so they resolve to the plain custom property. */
const color = (token: Named) =>
  /^#[0-9a-f]{8}$/i.test(token.value) ? `var(--${token.name})` : `rgb(var(--${token.name}-rgb) / <alpha-value>)`;

/** A color token named like a type style (`price`) would make `text-price` ambiguous: it stays a CSS variable only. */
const typeNames = new Set(tokens.type.groups.flatMap((g) => g.styles.map((s) => s.name.replace(/^t-/, ''))));

const atmosphereRoles = ['surface', 'wash', 'accent', 'ink'] as const;

const colors: Record<string, string> = {
  ...Object.fromEntries([...tokens.color.tokens, ...extensions.color.tokens].filter((t) => !typeNames.has(t.name)).map((t) => [t.name, color(t)])),
  ...Object.fromEntries(Object.keys(without(roles.colorRoles)).map((r) => [r, `rgb(var(--${r}-rgb) / <alpha-value>)`])),
  // Campaign atmosphere (follows the nearest data-atmosphere attribute): bg-atm-wash, bg-atm-surface, text-atm-ink, bg-atm-accent.
  ...Object.fromEntries(atmosphereRoles.map((r) => [`atm-${r}`, `rgb(var(--atm-${r}-rgb) / <alpha-value>)`])),
};

const typeStyles = tokens.type.groups.flatMap((g) => g.styles);
const textUtility = (style: (typeof typeStyles)[number], family: string) => ({
  fontFamily: `var(--font-${family})`,
  fontSize: style.fontSize,
  lineHeight: style.lineHeight,
  fontWeight: String(style.fontWeight),
  ...('letterSpacing' in style && style.letterSpacing ? { letterSpacing: style.letterSpacing as string } : {}),
});

const screens = {
  sm: `${parseInt(tokens.layout.tokens.find((t) => t.name === 'bp-tablet')!.value)}px`,
  md: '768px',
  lg: tokens.layout.tokens.find((t) => t.name === 'bp-desktop')!.value,
  xl: '1280px',
  '2xl': tokens.layout.tokens.find((t) => t.name === 'bp-wide')!.value,
};

/** Tailwind owns rounded-s / rounded-l (side corners), so DS radii s, m, l surface as sm, md, lg (roles.json → radiusNames). */
const radiusNames = without(roles.radiusNames);
const radii = Object.fromEntries(
  names(tokens.radius, 'radius-')
    .filter((n) => !n.startsWith('arch'))
    .map((n) => [radiusNames[n] ?? n, `var(--radius-${n})`]),
);
const radiusAliases = Object.fromEntries(
  Object.entries(without(roles.radiusAliases)).map(([alias, target]) => [alias, `var(--radius-${target})`]),
);

const shadowAliases = {
  ...Object.fromEntries(roles.shadowAliases.flat.map((n) => [n, 'none'])),
  ...Object.fromEntries(roles.shadowAliases.float.map((n) => [n, 'var(--shadow-float)'])),
};

const preset: Partial<Config> = {
  theme: {
    screens,
    extend: {
      colors,
      fontFamily: {
        sans: ['var(--font-text)'],
        text: ['var(--font-text)'],
        display: ['var(--font-display)'],
      },
      borderRadius: { none: '0', ...radii, ...radiusAliases },
      boxShadow: {
        ...Object.fromEntries(
          names(tokens.shadow, 'shadow-').map((n) => [n, `var(--shadow-${n})`]),
        ),
        ...shadowAliases,
      },
      spacing: {
        // Controls and icons: h-control-m, size-icon-s, pb-bottom-nav-h …
        ...entries(names(tokens.size), ''),
      },
      maxWidth: { container: 'var(--container-max)' },
      width: {
        'col-filter-rail': 'var(--col-filter-rail)',
        'col-purchase': 'var(--col-purchase)',
      },
      transitionDuration: {
        ...Object.fromEntries(names(tokens.duration, 'dur-').map((n) => [n, `var(--dur-${n})`])),
        ...Object.fromEntries(Object.entries(without(roles.durationAliases)).map(([a, t]) => [a, `var(--${t})`])),
      },
      transitionTimingFunction: {
        ...Object.fromEntries(names(tokens.easing, 'ease-').map((n) => [n, `var(--ease-${n})`])),
        ...Object.fromEntries(Object.entries(without(roles.easeAliases)).map(([a, t]) => [a, `var(--${t})`])),
      },
      zIndex: {
        ...Object.fromEntries(names(tokens.zIndex, 'z-').map((n) => [n, `var(--z-${n})`])),
        ...Object.fromEntries(Object.entries(without(roles.zAliases)).map(([a, t]) => [a, `var(--${t})`])),
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' } },
        'dialog-in': { from: { opacity: '0', transform: 'translateY(8px) scale(0.98)' } },
        'slide-in-from-right': { from: { transform: 'translateX(100%)' } },
        'slide-in-from-left': { from: { transform: 'translateX(-100%)' } },
        'slide-in-from-bottom': { from: { transform: 'translateY(100%)' } },
        'slide-in-from-top': { from: { transform: 'translateY(-100%)' } },
        bead: {
          '0%, 100%': { opacity: '0.25', transform: 'translateY(0)' },
          '40%': { opacity: '1', transform: 'translateY(-3px)' },
        },
        pulse: { '0%, 100%': { opacity: '1' }, '50%': { opacity: '0.55' } },
      },
      animation: {
        'fade-in': 'fade-in var(--dur-settle) var(--ease-out)',
        'dialog-in': 'dialog-in var(--dur-settle) var(--ease-out)',
        'sheet-in-right': 'slide-in-from-right var(--dur-sheet) var(--ease-out)',
        'sheet-in-left': 'slide-in-from-left var(--dur-sheet) var(--ease-out)',
        'sheet-in-bottom': 'slide-in-from-bottom var(--dur-sheet) var(--ease-out)',
        'sheet-in-top': 'slide-in-from-top var(--dur-sheet) var(--ease-out)',
        bead: 'bead 900ms var(--ease-in-out) infinite',
        pulse: 'pulse 1400ms var(--ease-in-out) infinite',
      },
    },
  },
  plugins: [
    plugin(({ addUtilities, addComponents }) => {
      // text-<style>: the 12 DS type styles plus the legacy names from roles.json (one rule per name).
      const text: Record<string, Record<string, string>> = {};
      const byName = new Map<string, ReturnType<typeof textUtility>>();
      for (const group of tokens.type.groups) {
        for (const style of group.styles) byName.set(style.name.replace(/^t-/, ''), textUtility(style, group.family));
      }
      for (const [name, utility] of byName) text[`.text-${name}`] = utility;
      for (const [alias, target] of Object.entries(without(roles.textAliases))) text[`.text-${alias}`] = byName.get(target)!;
      addUtilities(text);

      // Arch niche: the shape every product image stands in (50% horizontal / radius-arch vertical, top corners only).
      const arch = (token: string) =>
        `50% 50% var(--radius-xs) var(--radius-xs) / var(${token}) var(${token}) var(--radius-xs) var(--radius-xs)`;
      addComponents({
        '.shape-arch': { borderRadius: arch('--radius-arch') },
        '.shape-arch-l': { borderRadius: arch('--radius-arch-l') },
        // Card link: the anchor's ::after covers the nearest `relative` ancestor, and keyboard focus rings the whole card.
        '.stretched-link': {
          '&::after': { content: '""', position: 'absolute', inset: '0', borderRadius: 'var(--stretched-link-radius, var(--radius-s))' },
          '&:focus-visible': { boxShadow: 'none' },
          '&:focus-visible::after': { boxShadow: 'var(--focus-ring)' },
        },
        // Bottom padding that keeps the last section clear of the fixed phone navigation (only below bp-desktop).
        '.pb-nav-safe': { paddingBlockEnd: 'calc(var(--bottom-nav-h) + env(safe-area-inset-bottom) + var(--space-4))' },
        [`@media (min-width: ${screens.lg})`]: { '.pb-nav-safe': { paddingBlockEnd: '0' } },
      });
    }),
  ],
};

export default preset;
