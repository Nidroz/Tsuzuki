# Tsuzuki — Product Specification

Status: MVP scope, v1.0 of this document.

## 1. Vision

Tsuzuki (続き, "what comes next") lets people who follow many series at once keep track of where they are in their anime, manga, manhwa and manhua, in two taps. Existing trackers (MyAnimeList, AniList) are web-first and heavy for a simple "+1 chapter"; Tsuzuki is mobile-first, fast, and treats manhwa and manhua as first-class content.

Targets: Android and iOS, published on Google Play and the App Store.

## 2. Glossary

| Term | Meaning |
| --- | --- |
| Media | A catalog title, identified by `(kind, providerId)` |
| Kind | `anime` or `manga` (manga covers manhwa, manhua, novels…) |
| Format | Provider subtype: TV, Movie, OVA, ONA, Special, Music for anime; Manga, Manhwa, Manhua, Light Novel, Novel, One-shot, Doujinshi, OEL for manga |
| Unit | Episode (anime) or chapter (manga) |
| Library entry | A media saved by a user, with status, progress, score, notes, favorite flag |
| Guest | A user without an account; data lives on the device only |

## 3. Functional requirements (MVP)

### Search & discovery

| ID | Requirement |
| --- | --- |
| FR-01 | Search bar with debounced queries (~400 ms) and cancellation of outdated requests |
| FR-02 | Recent searches history (local, max 10, clearable) |
| FR-03 | Filters: kind, format, genres included, genres excluded, status (airing/publishing, finished, upcoming), year, minimum score, sort field + direction |
| FR-04 | Interactive pagination: page numbers window, previous/next, jump to a page, current page and scroll position kept when navigating back |
| FR-05 | Discovery tab: top anime, top manga (with format chips incl. manhwa/manhua), current season |
| FR-06 | Media detail: cover, titles (default + English + native), synopsis, genres, format, status, total units, score, year |

### Library

| ID | Requirement |
| --- | --- |
| FR-10 | Add/remove a media to/from the library |
| FR-11 | Statuses: `current` (Watching/Reading), `planned`, `completed`, `paused`, `dropped` |
| FR-12 | Progress: current unit, `+1` button from the list and the detail screen, manual edit |
| FR-13 | Personal score (integer 1–10, optional) and free-text notes |
| FR-14 | Library list grouped/filterable by status and kind, sortable by last update, title, score |
| FR-15 | Favorites: star toggle on detail and list rows, dedicated Favorites tab |

### Account & sync

| ID | Requirement |
| --- | --- |
| FR-20 | Guest mode: full library features stored locally |
| FR-21 | Sign up / sign in with email + password, Google, Apple |
| FR-22 | On first sign-in, guest data is merged into the account (see BR-08) |
| FR-23 | Library synced across devices |
| FR-24 | In-app account deletion, removing all user data |
| FR-25 | Sign out purges local user data and caches |

### Settings

| ID | Requirement |
| --- | --- |
| FR-30 | Theme: system / light / dark |
| FR-31 | Language: system / English / French (catalog data stays in provider language) |
| FR-32 | Adult content toggle (off by default, see BR-06) |

## 4. Business rules

| ID | Rule |
| --- | --- |
| BR-01 | Progress is an integer ≥ 0. If the media total is known, progress ≤ total. If unknown (ongoing), no upper bound |
| BR-02 | First progress change on a `planned` entry sets status to `current` and `started_at` to today |
| BR-03 | Reaching the known total sets status to `completed` and `finished_at` to today (user can revert) |
| BR-04 | Setting status to `completed` with a known total sets progress to the total |
| BR-05 | Favoriting a media that is not in the library adds it with status `planned` |
| BR-06 | Adult content = genres Hentai or Erotica, or anime rating Rx. It is never filtered in provider requests: everything is fetched, and the app hides it when the setting is off (search, discovery, detail, library). Pages may therefore show fewer items than the provider page size |
| BR-07 | Notes max 2,000 characters; score null or 1–10. Enforced client-side and by database constraints |
| BR-08 | Guest → account merge: each local entry is upserted; on conflict the most recent `updated_at` wins; local guest store is cleared after a successful merge |
| BR-09 | Every write updates `updated_at`; rapid `+1` taps are applied optimistically and coalesced into one write |

## 5. Non-functional requirements

| Area | Target |
| --- | --- |
| Performance | Cold start < 2 s on a mid-range Android device; lists at 60 fps; cached screens render instantly |
| Offline | Library and previously viewed media readable offline; writes queued and synced on reconnect |
| Provider limits | Never exceed the catalog provider rate limit (Jikan: ~3 req/s, ~60 req/min) |
| Security | OWASP MASVS L1 baseline; see `docs/ARCHITECTURE.md` §Security |
| Privacy | GDPR: minimal data (email, library), privacy policy, account deletion, no advertising or analytics trackers (crash reporting only, without personal data) |
| Accessibility | Screen reader labels on all controls, dynamic font size support, WCAG AA contrast |
| i18n | All UI strings in translation files, EN fallback |

## 6. Out of scope for MVP (later)

Saved filters, MAL/AniList import, statistics, notifications (new episode/chapter), "where to read/watch" links, social features, home-screen widgets, web version (Next.js), monetization.
