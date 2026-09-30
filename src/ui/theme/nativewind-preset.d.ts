// nativewind ships an empty declaration file for its tailwind preset (a commonjs module): this
// ambient declaration takes precedence and types the preset for tailwind.config.ts
declare module 'nativewind/preset' {
  import type { Config } from 'tailwindcss';

  const preset: Partial<Config>;
  export = preset;
}
