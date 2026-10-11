import type { Config } from 'tailwindcss';

/** Semantic color role backed by a CSS variable in src/styles/tokens.css (supports `/opacity`). */
const role = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  darkMode: 'class',
  content: [
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/features/**/*.{js,ts,jsx,tsx,mdx}',
    './src/lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        background: role('background'),
        foreground: role('foreground'),
        card: { DEFAULT: role('card'), foreground: role('card-foreground') },
        popover: { DEFAULT: role('popover'), foreground: role('popover-foreground') },
        muted: { DEFAULT: role('muted'), foreground: role('muted-foreground') },
        primary: {
          DEFAULT: role('primary'),
          hover: role('primary-hover'),
          foreground: role('primary-foreground'),
          subtle: role('primary-subtle'),
        },
        secondary: {
          DEFAULT: role('secondary'),
          hover: role('secondary-hover'),
          foreground: role('secondary-foreground'),
        },
        accent: { DEFAULT: role('accent'), foreground: role('accent-foreground') },
        destructive: {
          DEFAULT: role('destructive'),
          foreground: role('destructive-foreground'),
          subtle: role('destructive-subtle'),
        },
        success: { DEFAULT: role('success'), foreground: role('success-foreground'), subtle: role('success-subtle') },
        warning: { DEFAULT: role('warning'), foreground: role('warning-foreground'), subtle: role('warning-subtle') },
        info: { DEFAULT: role('info'), foreground: role('info-foreground'), subtle: role('info-subtle') },
        disabled: { DEFAULT: role('disabled'), foreground: role('disabled-foreground') },
        overlay: role('overlay'),
        border: { DEFAULT: role('border'), subtle: role('border-subtle') },
        input: role('input'),
        ring: role('ring'),

        /**
         * @deprecated Legacy prototype palette. Kept only as aliases onto semantic roles so existing
         * screens follow the active theme. Do not use in new code; migrate screen by screen.
         */
        norya: {
          canvas: role('background'),
          surface: role('card'),
          warm: role('muted'),
          muted: role('muted'),
          primary: role('primary'),
          'primary-hover': role('primary-hover'),
          'primary-light': role('primary-subtle'),
          border: role('border'),
          'border-subtle': role('border-subtle'),
          gold: role('accent-foreground'),
          stone: {
            50: role('muted'),
            100: role('secondary'),
            200: role('border'),
            300: role('input'),
            400: role('muted-foreground'),
            500: role('muted-foreground'),
            600: role('muted-foreground'),
            700: role('foreground'),
            800: role('foreground'),
            900: role('foreground'),
          },
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
      },
      /* Semantic type scale. Line heights come from tokens so Arabic gets more leading automatically. */
      fontSize: {
        display: ['clamp(2rem, 1.55rem + 2.2vw, 3rem)', { lineHeight: 'var(--leading-heading)', fontWeight: '600' }],
        h1: ['clamp(1.75rem, 1.5rem + 1.25vw, 2.25rem)', { lineHeight: 'var(--leading-heading)', fontWeight: '600' }],
        h2: ['clamp(1.5rem, 1.38rem + 0.6vw, 1.75rem)', { lineHeight: 'var(--leading-heading)', fontWeight: '600' }],
        h3: ['1.25rem', { lineHeight: 'var(--leading-heading)', fontWeight: '600' }],
        'body-lg': ['1.125rem', { lineHeight: 'var(--leading-body)' }],
        body: ['1rem', { lineHeight: 'var(--leading-body)' }],
        support: ['0.875rem', { lineHeight: 'var(--leading-body)' }],
        caption: ['0.8125rem', { lineHeight: 'var(--leading-body)' }],
      },
      /* The whole radius scale resolves to three tokens, so legacy rounded-xl/2xl follow the system. */
      borderRadius: {
        none: '0',
        sm: 'var(--radius-sm)',
        DEFAULT: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-lg)',
        '2xl': 'var(--radius-lg)',
        '3xl': 'var(--radius-lg)',
      },
      boxShadow: {
        sm: 'var(--shadow-raised)',
        DEFAULT: 'var(--shadow-raised)',
        md: 'var(--shadow-raised)',
        lg: 'var(--shadow-overlay)',
        xl: 'var(--shadow-overlay)',
        raised: 'var(--shadow-raised)',
        overlay: 'var(--shadow-overlay)',
        card: 'var(--shadow-raised)',
        floating: 'var(--shadow-overlay)',
      },
      /* Stacking layers: sticky page chrome stays below anything modal. */
      zIndex: {
        chrome: '40',
        overlay: '100',
      },
      transitionDuration: {
        fast: 'var(--duration-fast)',
        base: 'var(--duration-base)',
      },
      transitionTimingFunction: {
        standard: 'var(--ease-standard)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' } },
        'dialog-in': { from: { opacity: '0', transform: 'translateY(8px) scale(0.98)' } },
        'slide-in-from-right': { from: { transform: 'translateX(100%)' } },
        'slide-in-from-left': { from: { transform: 'translateX(-100%)' } },
        'slide-in-from-bottom': { from: { transform: 'translateY(100%)' } },
        'slide-in-from-top': { from: { transform: 'translateY(-100%)' } },
      },
      animation: {
        'fade-in': 'fade-in var(--duration-base) var(--ease-standard)',
        'dialog-in': 'dialog-in var(--duration-base) var(--ease-standard)',
        'sheet-in-right': 'slide-in-from-right 280ms var(--ease-standard)',
        'sheet-in-left': 'slide-in-from-left 280ms var(--ease-standard)',
        'sheet-in-bottom': 'slide-in-from-bottom 280ms var(--ease-standard)',
        'sheet-in-top': 'slide-in-from-top 280ms var(--ease-standard)',
      },
    },
  },
  plugins: [],
};
export default config;
