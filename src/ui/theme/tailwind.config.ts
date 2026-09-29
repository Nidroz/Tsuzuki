import type { Config } from 'tailwindcss';
import nativewindPreset from 'nativewind/preset';

// tailwind scans only src/ui: className is used nowhere else (CONTRIBUTING.md section 4)
const config = {
  content: ['./src/ui/**/*.{ts,tsx}'],
  presets: [nativewindPreset],
  theme: {
    extend: {
      // TODO(F-05): replace the placeholder with the design tokens
      colors: { placeholder: '#123456' },
    },
  },
} satisfies Config;

// tailwind loads its config from the default export
export default config;
