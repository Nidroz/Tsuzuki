# Recorded Tenrai responses

Responses of Tenrai (`https://api.tenrai.org/v1`), a Jikan v4 compatible instance, recorded on 2026-10-14 with plain GET requests, then trimmed for the repository.

| File | Request |
| --- | --- |
| `anime-search.json` | `/anime?q=frieren&limit=5` |
| `manga-search.json` | `/manga?q=solo%20leveling&type=manhwa&limit=5` |
| `search-empty.json` | `/anime?q=zzqxjvwkpt&limit=5` |
| `anime-detail-52991.json` | `/anime/52991` |
| `manga-detail-121496.json` | `/manga/121496` |
| `manga-detail-2.json` | `/manga/2` |
| `top-anime.json` | `/top/anime?page=1&limit=5` |
| `top-manga.json` | `/top/manga?page=1&limit=5` |
| `season-now.json` | `/seasons/now?page=1&limit=15` |
| `anime-genres.json` | `/genres/anime` |
| `manga-genres.json` | `/genres/manga` |
| `year-probe-bounded.json` | `/anime?q=one%20piece&start_date=1999-01-01&end_date=1999-12-31&limit=5` |
| `year-probe-open.json` | `/anime?q=one%20piece&start_date=1999-01-01&limit=5` |

## Trimming rules

- At most 3 items per list, kept in the recorded order. The set holds an anime with a null score and episode count (`anime-search`, mal 63816), One Piece (`year-probe-open`, mal 21), manga with null chapters (`manga-search` mal 172429, `top-manga` and `manga-detail-2` mal 2), an `On Hiatus` manga (`top-manga`, mal 656) and 3 genres per genre list, none adult.
- The envelope is unchanged (`data`, and `pagination` with all its keys), except `pagination.items.count`, set to the number of items kept.
- Every item key the adapter reads is unchanged, and so are the other descriptive keys.
- `synopsis` and `background` are replaced with `Placeholder synopsis.` and `Placeholder background.`; a `null` stays `null`.
- People, organizations and trailers are removed: `authors`, `serializations`, `producers`, `licensors`, `studios`, `trailer`.
- No adult title or cover. Adult cases (BR-06: a Hentai or Erotica genre, an Rx rating) are built synthetically in tests.
- Formatted with Prettier.
