# ADR-0013: Jikan-compatible instances and a namespaced media identity

- Status: Accepted
- Date: 2026-10-14
- Supersedes in part: ADR-0003 (Jikan as the provider, and the MyAnimeList id as the canonical media identifier). The adapter boundary of ADR-0003 stays.

## Context

- The public Jikan API (`api.jikan.moe`), the provider chosen in ADR-0003, shut down on 2026-10-01 (jikan-me/jikan-rest#613). The C-03 adapter was built against the published Jikan v4 OpenAPI spec and is not wired yet (C-04 wires its first consumer), so no build depends on it.
- Tenrai (`https://api.tenrai.org/v1`) serves the Jikan v4 schema unchanged: the same envelope and fields (`explicit_genres`, `titles`, `rating`, `aired.prop`), covers on `cdn.myanimelist.net`. This was verified with live requests on 2026-10-14, and the recorded fixtures confirm it. Its documented limits:
  - 4 requests per second and 120 per minute, per IP; a 429 carries `Retry-After` in seconds;
  - `limit` defaults to 25, maximum 100; pages go up to 20,000;
  - `q` is at most 300 characters; `genres` and `genres_exclude` take at most 25 ids each;
  - `type`, `status`, `rating` and `min_score` are supported.
- Tenrai terms (tenrai.org/terms): personal and commercial use allowed, storing and caching allowed, no SLA, can be discontinued at any time. Its privacy policy says it logs IP addresses and User-Agents for up to 90 days.
- Every Jikan v4 instance (Tenrai, a self-hosted Jikan) serves MyAnimeList ids. Until now the identity was `{ kind, malId }`, the database column `library_entries.mal_id`, and the catalog query keys carried a provider id (`jikan`, `CATALOG_PROVIDER_IDS`). A server is not an identity: two servers of the same ids must share the cache and the library rows, and a provider with other ids (AniList without a mapping) must not collide with MAL ids.
- There are no users and no released build: the library repository (A-03) does not exist and no catalog query has been persisted. Schema, routes and keys can change now without a data migration.

Options considered, provider (owner decision: Tenrai):

- **Tenrai**: drop-in Jikan v4, higher limits than the public Jikan, terms that allow this app's use and caching. No SLA.
- **Self-hosted Jikan**: full control and no third party logging user IPs, but a server to run (MyAnimeList scraping, its cache, hosting cost) before the app has users. Kept as a fallback.
- **AniList (GraphQL)**: well maintained, but another schema (a new adapter and a POST client), licence terms tied to revenue, and authorization pending. Kept as the preferred fallback.

Options considered, adapter shape:

- **A Tenrai adapter next to the Jikan one**: two copies of identical schemas, mapping and tests.
- **One Jikan-compatible adapter parameterized by an instance** (id, base URL, rate limit): one schema and mapper, limits per instance.

Options considered, instance configuration:

- **Code constant only**: switching instance needs a code change and a release.
- **Build-time env `EXPO_PUBLIC_JIKAN_BASE_URL`, validated by the app env schema (ADR-0012), Tenrai when unset**: per variant, no secret, switchable with an EAS env value and a build, or an update published with its environment.
- **Remote config**: no backend yet, and a catalog URL switchable remotely is a new attack surface (a compromised config would point every device at a hostile server). Rejected.

Options considered, media identity:

- **Keep `malId`, with a provider id in the query keys**: equivalent servers split the cache, and an AniList adapter must map every id to MAL or collide.
- **Key by server or instance**: same split, and switching server orphans library rows.
- **Namespaced key `{ namespace, kind, externalId }`**: the namespace says whose ids these are (`mal`), whatever server returned them. Chosen.

Options considered, sustained provider failures (no SLA):

- **Report every catalog error**: noise from offline devices and single 429s, and Sentry quota spent on it.
- **Report nothing**: an outage or a schema change of the provider stays invisible until users complain.
- **A monitor around the provider that reports a sustained streak, throttled**: chosen.

## Decision

### One Jikan-compatible adapter for every Jikan v4 instance

- The adapter folder stays `src/core/catalog/jikan/`. `jikan-instances.ts` defines `JikanInstance { id, baseUrl, rateLimit }`:
  - `TENRAI_INSTANCE`: id `tenrai`, base URL `https://api.tenrai.org/v1`, `TENRAI_RATE_LIMIT`; the default;
  - `selfHostedJikanInstance(baseUrl)`: id `jikan-self-hosted`, the given base URL, `SELF_HOSTED_JIKAN_RATE_LIMIT`;
  - `jikanInstanceFor(baseUrl | undefined)`: `undefined` gives Tenrai, a URL gives a self-hosted instance.
- `createJikanCatalogProvider(instance, options?)` returns a `CatalogProvider` with `namespace` `mal` and `instanceId` the instance id. It builds one catalog http client, hence one rate limiter and one dedup map, per provider instance, from `instance.rateLimit`; `options` stay the http client options without `rateLimit` (tests).
- Endpoints are relative to the instance base URL; paths, parameters and their order are unchanged (`ARCHITECTURE.md` §3).
- New input guards, a `RangeError` before any request, its message holding no value:
  - search text longer than 300 UTF-16 code units (Tenrai's `q` maximum);
  - more than 25 included or more than 25 excluded genre ids (Tenrai's maximum per list);
  - a detail key outside the `mal` namespace.
- The page size stays 25: the public Jikan maximum and Tenrai's default, accepted by every Jikan v4 instance. A larger Tenrai page would save requests but make paging depend on the instance.

### Rate limits per instance

`src/core/catalog/jikan/jikan-rate-limit.ts`. A token bucket grants at most `capacity + floor(W / refillIntervalMs)` requests in any window W (`ARCHITECTURE.md` §6).

| Policy | Buckets | Any 1 s window | Any 60 s window | Sustained | Source |
| --- | --- | --- | --- | --- | --- |
| `TENRAI_RATE_LIMIT` | `{ capacity 2, 1 per 750 ms }` | 3 (limit 4, 25 % margin) | 82 (limit 120, 32 % margin) | 80 per minute | Tenrai's documented limits |
| `SELF_HOSTED_JIKAN_RATE_LIMIT` (formerly `JIKAN_RATE_LIMIT`) | `{ 2, 750 ms }` and `{ 10, 1.5 s }` | 3 | 50 | 40 per minute | the public Jikan's documented 3 req/s and 60 req/min: the conservative default for an instance whose limits are unknown |

Tenrai's limits are per IP. Every device behind one NAT (carrier-grade NAT on mobile networks, shared Wi-Fi) shares them, which a per-device limiter cannot see. The 429 handling of the http client pauses the limiter for the `Retry-After`; sustained 429s are reported (below); the mitigations beyond that are a shared server-side cache ("Dedicated backend", `ARCHITECTURE.md` §11) or a self-hosted instance.

### Configuration

- A typed instance constant in the adapter folder, plus the optional build-time variable `EXPO_PUBLIC_JIKAN_BASE_URL`. `app.config.ts` validates it with the core schema `src/core/schemas/app-env.ts` (field `jikanBaseUrl`): https only, a host, an optional port and path, no query, fragment or userinfo; a trailing slash is stripped; an empty value counts as absent. It is passed in `extra.env` and re-parsed at startup like the other fields (ADR-0012).
- Unset means Tenrai; set means a self-hosted instance (`jikanInstanceFor`). One value, no code change.
- Why an env and not only a code constant: it is per variant (staging can try a self-hosted instance), it holds no secret, and switching needs only the EAS env value plus a build, or an update published with its environment (`pnpm update:publish <variant>`, which runs `eas update --environment`). When only JavaScript changes, switching needs no store release.
- Why not remote config: there is no backend yet, and a remotely switchable catalog URL would be a new attack surface.
- The env value is a URL, so it never becomes an instance id: ids are fixed constants (`tenrai`, `jikan-self-hosted`), safe as error report tags.

### Recorded facts (Tenrai, 2026-10-14)

Recorded responses, trimmed, live in `src/core/catalog/jikan/__fixtures__/tenrai/` with a README. They show:

- response `type` values capitalized as documented ("TV", "ONA", "Movie", "Manhwa"…); `titles[].type` values include `Default`, `Japanese`, `English`, `Synonym` and language names;
- no `null` anime status (a `null` status still fails the response);
- every item of search, top, season and detail carries the four genre arrays (`genres`, `explicit_genres`, `themes`, `demographics`) and, for anime, the `rating` key, so the fail-closed BR-06 inputs hold;
- `pagination` has extra keys (`current_page`, `items`), which are stripped;
- year filter: `start_date` bounds the start of airing and `end_date` bounds its end. One Piece (mal 21, airing since 1999-10-20) is missing from `start_date=1999-01-01&end_date=1999-12-31` and listed with `start_date` alone. `jikanYearRange` (year Y → `start_date=Y-01-01&end_date=Y-12-31`) therefore means "aired entirely within Y": it excludes titles still airing or spanning two years. C-05 decides the meaning of the year filter before exposing it; the mapping is unchanged until then.

### Media identity: an id namespace, not a server

- `src/core/domain/media.ts`: `MEDIA_ID_NAMESPACES = ['mal']`, `MediaIdNamespace`, `MediaKey { namespace, kind, externalId }`, and `EXTERNAL_ID_MAX` (formerly `MAL_ID_MAX`, the Postgres `integer` bound of `library_entries.external_id`). `mal` is the namespace of Tenrai and of any Jikan.
- `CatalogProvider` has `namespace` (of every key it returns and accepts; part of every catalog query key) and `instanceId` (a short non-personal id for error reports; never a URL, never in a key). `src/core/catalog/catalog-provider-id.ts` (`CATALOG_PROVIDER_IDS`) is removed.
- Query keys (`src/core/query/keys.ts`): `['media', namespace, kind, externalId]`, `['top', namespace, kind, page]`, `['season', namespace, page]`, `['genres', namespace, kind]`, `['search', namespace, ...normalized params]`, `['library', namespace, kind, externalId]`. Equivalent servers of one namespace share the cache. `CACHE_SCHEMA_VERSION` is not bumped: no catalog query was ever persisted.
- Route: `app/media/[namespace]/[kind]/[id].tsx`, deep link `tsuzuki://media/mal/anime/52991`. The namespace must be exactly one of `MEDIA_ID_NAMESPACES`; any other value shows the invalid-link error. The former two-segment path goes to not-found; it changed before any release, so no shipped link breaks.

### Database

New migration `supabase/migrations/<timestamp>_media_id_namespace.sql`. No users yet, so no data migration; the previous migration is not edited.

```sql
create type public.media_id_namespace as enum ('mal');

-- the column grants and the check follow the renamed column
alter table public.library_entries rename column mal_id to external_id;
alter table public.library_entries
  rename constraint library_entries_mal_id_check to library_entries_external_id_check;

-- the temporary default fills any existing row; dropped so that every write names its namespace
alter table public.library_entries
  add column id_namespace public.media_id_namespace not null default 'mal';
alter table public.library_entries alter column id_namespace drop default;

alter table public.library_entries drop constraint library_entries_user_media_key;
alter table public.library_entries add constraint library_entries_user_media_key
  unique (user_id, id_namespace, media_kind, external_id);

-- postgrest upserts list every payload column in do update set
grant insert (id_namespace), update (id_namespace) on public.library_entries to authenticated;
```

- RLS, the policies, the other grants, the triggers and the indexes are unchanged; the unique constraint's index serves lookups by key.
- The generated types `database.types.ts` are regenerated in the same commit.
- The rule "migrations stay compatible with installed binaries" (`ARCHITECTURE.md` §10) is not at stake: no built binary reads or writes `library_entries` (A-03 not done).

pgTAP cases for the `tester` (`supabase/tests/database/`):

1. Schema: `id_namespace` exists, is `not null`, of type `media_id_namespace`, with no default; `external_id` exists and `mal_id` does not.
2. An insert without `id_namespace` is rejected (`23502`); an insert with an unknown namespace (`'anilist'`) is rejected (`22P02`).
3. A second row with the same `(id_namespace, media_kind, external_id)` for one user is rejected (`23505`, `library_entries_user_media_key`); the same id for the other kind, and the same key for another user, are accepted.
4. `external_id` 0 is rejected by `library_entries_external_id_check`; the largest integer is accepted; a value above the integer range is rejected (the former `mal_id` cases, renamed).
5. An upsert as PostgREST sends it, as `authenticated`: `on conflict (user_id, id_namespace, media_kind, external_id) do update` with `id_namespace` and `external_id` in the `set` list, succeeds and keeps the row id.
6. Column privileges: `authenticated` has insert and update on `id_namespace`, `media_kind` and `external_id`, and still none on `id`, `user_id`, `created_at`, `updated_at`; `anon` has none (`010-privileges`, unchanged).
7. The owner CRUD, cross-user and anon denial cases of `030-library-entries` and the fixtures of `040-progress-events` use the new columns; `000-rls-enabled` and `010-privileges` pass unchanged.

The AniList cross-reference (AniList ids stored next to MAL ids) is deferred to the AniList fallback item. An AniList adapter uses its own namespace (`anilist`, a new enum value in a later migration) unless that item decides a mapping to MAL ids.

### Multi-provider requirements (enforced)

- Nothing provider-specific (field names, GraphQL documents, Jikan parameters, hosts) exists outside the adapter folder. Lint rejects `jikan.moe` and `tenrai.org` literals outside `src/core/catalog/jikan/`; the existing layer zones keep the implementation folders out of everything but `app/_layout.tsx`.
- One shared contract suite, `test/core/catalog-provider-contract.ts` (`describeCatalogProviderContract(harness)`), depending on the `CatalogProvider` interface only. Every adapter passes it, run per adapter and per instance: the Jikan adapter runs it for Tenrai and for a self-hosted instance. The harness creates the provider and serves the adapter's own payloads for the scenarios page, empty-page, detail, genres, adult-genre, adult-rating, server-error, rate-limited, malformed and hanging, and supplies its own predicate telling whether a request carries a content filter.
- One rate limiter per provider instance, with that instance's limits.
- The provider is selected only in the composition root (`app/_layout.tsx`). The wiring itself stays in C-04: `monitorCatalogProvider(createJikanCatalogProvider(jikanInstanceFor(appEnv.jikanBaseUrl)), { reporter })`, provided to the hooks through a React context in `src/core/hooks/`, guarded by the existing lint zones.
- ADR-0004 still holds: no request ever sends `sfw`, `sfw-strict`, `rating`, `unapproved` or `continuing`, though Tenrai supports `rating`; adult status comes from `isAdultMedia` over all four genre arrays and the rating.

### Sustained provider failures reported

- `src/core/catalog/catalog-failure-monitor.ts`: `monitorCatalogProvider(provider, { reporter, now? })`, platform-agnostic, with the clock and the `ErrorReporter` injected. It wraps any `CatalogProvider` and returns its results and errors unchanged.
- Counted kinds, `CATALOG_FAILURE_KINDS` in `src/core/errors/catalog-errors.ts`: `server_error` (HTTP 500 or above), `rate_limited` (429), `client_error` (any other non-2xx but 404), `timeout`, `malformed_response`. A failure is counted as the provider surfaces it, after the http client's own retries.
- Ignored, neither counted nor resetting the streak: a 404 (a normal answer for a missing title: gaps in MAL ids, a stale library row, a deep link to a missing id), network errors (an offline device would look like an outage until A-05 brings connectivity), aborts, input `RangeError`s and unknown errors. A success clears the streak. Accepted trade-off: a self-hosted base URL with a wrong path answers only 404s, so the monitor never reports it.
- Sustained: 3 counted failures since the last success, each within 2 minutes of the latest one. Reaching the threshold reports the kind of the failure that reached it, at most once per kind per 30 minutes per instance, and clears the streak.
- The report: `captureError(new CatalogProviderFailureError(kind), { source: 'catalog', tags: { instance: instanceId, kind } })`. The instance id and the kind only: never a URL, query, status code or response text.

### Terms, privacy and fallback

- Tenrai's terms allow this use and caching, with no SLA; the failure monitor makes an outage visible.
- The provider sees the IP address and User-Agent of every device, and the search text it is sent; Tenrai logs IPs and User-Agents for up to 90 days. The privacy policy (R-05) says so.
- Fallback order: AniList if authorized (C-09 "AniList adapter (pending authorization)"), else a self-hosted Jikan (C-10 "Self-hosted Jikan"). Switching to a self-hosted Jikan is one env value.
- AniList, for later: free under $150 per month of revenue, a commercial licence above, so any monetization triggers a review; the app name must not contain "AniList".

## Consequences

- Maintainability: one adapter serves every Jikan v4 instance; an instance is data (id, base URL, limits), not code. The contract suite fixes what any adapter must do, so a second provider (AniList) is held to the same behaviour. The namespace separates "whose ids" from "which server": switching server keeps the cache and the library rows, and a provider with other ids cannot collide. `CATALOG_PROVIDER_IDS` disappears; its role in query keys goes to `namespace`, in reports to `instanceId`.
- Security: the base URL is build-time only, validated twice by the app env schema (https, no userinfo, query or fragment), never switchable remotely. Instance ids are constants, so a configured URL never reaches an error tag. The image allowlist stays `cdn.myanimelist.net` for every instance, so a self-hosted base URL cannot widen it. The route namespace is an exact enum, and a link still never writes. Failure reports carry no URL, query, status or response text. Lint keeps provider hosts inside the adapter folder.
- Privacy: a third party (Tenrai) sees user IPs, User-Agents and search text and keeps logs for 90 days; disclosed in the privacy policy (R-05). A self-hosted instance or a shared server-side cache removes that third party.
- Performance: Tenrai's policy allows 80 requests per minute sustained, twice the former Jikan policy, with the same 3 per second burst. The limiter is per device while the provider counts per IP, so users behind one NAT can still hit 429s; the limiter pauses on them, and sustained 429s are reported. The monitor adds a few comparisons per call.
- Operations: Tenrai has no SLA and can stop at any time. Sustained failures reach Sentry, and the switch to a self-hosted Jikan is one EAS env value plus a build or an update. The year filter meaning (aired entirely within the year) is decided by C-05 before it is exposed.
- Database: one rename, one new enum and column, one rebuilt unique key, before any user data; every write must now name its namespace (no default).
- Future web app: the adapter, the instances, the monitor, the namespace and the env schema stay in `src/core/`. A web app reads `jikanBaseUrl` from its own build configuration. A browser calling the provider directly also depends on the instance's CORS policy, to check when the web app starts; the shared server-side cache avoids the question.
- ADR-0003 keeps the `CatalogProvider` boundary; its canonical identifier (the MAL id) becomes the namespaced key, and "Jikan is the first adapter" becomes the Jikan-compatible adapter with Tenrai by default. The "shared rate limiter" of ADR-0003 and ADR-0005 is one implementation with one instance per provider instance, as since C-02.
