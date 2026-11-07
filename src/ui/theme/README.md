# src/ui/theme

Design tokens (colors for light and dark, spacing, radii, typography, sizes), the single source of the Tailwind scales in `tailwind.config.ts`, and `ThemeProvider`, which switches the palette between system, light and dark.
Theme values live here only; no magic values elsewhere.
Every color token is contrast-checked in `colors.test.ts`, including the `scrim` behind a sheet, drawn at the `scrim` opacity (`sizes.ts`).
