import type { Config } from 'tailwindcss';

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
        norya: {
          canvas: '#FAF6F3',
          surface: '#FFFFFF',
          warm: '#FFF9F6',
          muted: '#F6EFEA',
          primary: '#EE5D50',
          'primary-hover': '#D84E42',
          'primary-light': '#FEECE9',
          border: '#EAE0D8',
          'border-subtle': '#F3EAE3',
          stone: {
            900: '#1C1917',
            600: '#57534E',
            400: '#8C847E',
          },
          gold: '#C59A7C',
        },
        background: '#FAF6F3',
        foreground: '#1C1917',
        primary: {
          DEFAULT: '#EE5D50',
          foreground: '#FFFFFF',
        },
        secondary: {
          DEFAULT: '#F6EFEA',
          foreground: '#1C1917',
        },
        muted: {
          DEFAULT: '#EFE8E2',
          foreground: '#8C847E',
        },
        accent: {
          DEFAULT: '#F4ECE6',
          foreground: '#C59A7C',
        },
        destructive: {
          DEFAULT: '#DC2626',
          foreground: '#FFFFFF',
        },
        border: '#EAE0D8',
        input: '#EAE0D8',
        ring: '#EE5D50',
      },
      borderRadius: {
        lg: '16px',
        md: '12px',
        sm: '8px',
      },
      boxShadow: {
        card: '0 2px 8px rgba(34, 25, 20, 0.04)',
        floating: '0 -4px 20px rgba(34, 25, 20, 0.06)',
      },
    },
  },
  plugins: [],
};
export default config;
