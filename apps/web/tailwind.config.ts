import type { Config } from 'tailwindcss';
import designSystem from './design-system/tailwind-preset';

/**
 * No design values live here. Colors, type, radii, shadows, motion, breakpoints and control sizes come
 * from design-system/tokens.json through the preset (see design-system/README in CLAUDE.md).
 */
const config: Config = {
  presets: [designSystem as Config],
  content: [
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/features/**/*.{js,ts,jsx,tsx,mdx}',
    './src/lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  plugins: [],
};
export default config;
