# src/core/domain

Entities and the business rules (BR-xx from `SPEC.md`), including the adult content filter, written as pure functions with exhaustive unit tests.
No React, no I/O: domain code never calls a provider, a repository or storage.
`src/core/` never imports React Native, Expo modules or NativeWind.
