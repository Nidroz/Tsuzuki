// minimum touch target of every pressable (material 48dp, above the 44pt of apple's guidelines)
export const TOUCH_TARGET = 48;

// ionicons glyph size of IconButton and TabBarIcon
export const ICON_SIZE = 24;

// opacity of disabled controls and of pressables while pressed
export const opacities = {
  disabled: 0.5,
  pressed: 0.7,
} as const;

// cover frames in density-independent pixels: 2:3 (width:height), the shape of catalog posters.
// sm for compact rows, md for the rows of a result list, lg for the detail screen
export const coverSizes = {
  sm: { width: 48, height: 72 },
  md: { width: 64, height: 96 },
  lg: { width: 120, height: 180 },
} as const;

export type CoverSize = keyof typeof coverSizes;
