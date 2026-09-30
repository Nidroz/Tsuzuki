# src/ui/components

Design-system primitives, the only place allowed to use NativeWind: layout (`Box`, `Stack`, `Row`, `Spacer`, `Screen`), content (`Text`, `Card`, `Chip`), controls (`Button`, `IconButton`, `Input`, `Pagination`) and states (`Spinner`, `EmptyState`, `ErrorState`).
Props take theme token names only, never raw numbers or colors. Components never call i18n: every label (visible text and accessibility labels) comes as a prop from the feature.
