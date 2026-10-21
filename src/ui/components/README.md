# src/ui/components

Design-system primitives, the only place allowed to use NativeWind: layout (`Box`, `Stack`, `Row`, `Spacer`, `Screen`), content (`Text`, `Card`, `Chip`, `CoverImage` over `expo-image`, `Fact`), lists (`List` over FlashList, `MediaListItem`), controls (`Button`, `IconButton`, `Input`, single-line or a multiline text area, `Pagination`), overlays (`Sheet` over the react native `Modal`) and states (`Spinner`, `EmptyState`, `ErrorState` for a whole screen, `InlineError` inside content).
Props take theme token names only, never raw numbers or colors. Components never call i18n: every label (visible text and accessibility labels) comes as a prop from the feature.
