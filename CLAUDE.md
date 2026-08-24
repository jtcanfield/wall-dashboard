# Wall Dashboard

An always-on 40" wall-mounted dashboard for the main room. Displays weather with
commute markers and window-airing ("luften") windows, three currency charts, a
news feed, household reminders, and Twitch live status. Runs 6am–10pm daily,
unattended.

The owner is a TypeScript developer (Node/Express background, learning NestJS).
Write idiomatic modern TS. Don't over-explain language basics.

---

## Hardware (decided, purchased)

| Component | Detail |
|---|---|
| Display | Pioneer PN40-R651-26U — 40", 1080p, direct-lit LED, **Roku TV** |
| Mount | Best Buy essentials BE-MSFM, full motion, VESA 75×75–400×400, 55 lb |
| Compute | Dell Wyse 5070 MFF — Pentium Silver J5005, 8GB RAM, 64GB SSD |
| PSU | Generic 65W, 19.5V / 3.34A (barrel tip size **unverified**) |

Wyse rear I/O (confirmed from photo): **3× DisplayPort, no HDMI**, gigabit
Ethernet, 4× USB 3.0, 2× DB9 serial, bare SMA WiFi antenna studs (antennas not
included).

Implications:
- A DP→HDMI adapter or cable is required. Direction matters — passive DP→HDMI
  works (DP++ dual-mode); passive HDMI→DP does not.
- No CEC path exists. DisplayPort carries no CEC line and DP→HDMI adapters don't
  bridge it. This rules out anything that depends on receiving TV remote input.
- Use wired Ethernet. WiFi antennas are missing anyway.
- Mount the Wyse behind the TV (fanless, <5W). Leave cable slack for the
  full-motion arm's travel.

---

## Power scheduling

The TV is turned on and off over the LAN using the **Roku ECP** HTTP API. This is
a Roku platform feature, free, no hardware needed.

```bash
0  6 * * * curl -d '' http://<TV_IP>:8060/keypress/PowerOn && \
           sleep 5 && curl -d '' http://<TV_IP>:8060/launch/tvinput.hdmi1
0 22 * * * curl -d '' http://<TV_IP>:8060/keypress/PowerOff
```

**Required TV settings** (all of these, or it breaks):
- Settings → System → Advanced → Control by mobile apps = **Enabled** (not "Limited")
- **Fast TV Start = On** — keeps the network stack alive while off, so PowerOn works
- Settings → System → Power → **Auto power savings = Off** — defaults to powering
  off after ~4 hours with no remote interaction, which would kill the display
  mid-afternoon every day
- Screen saver → **disabled**
- Drop backlight/brightness well below default
- Give the TV a DHCP reservation

**The Wyse never sleeps.** The TV controls power, not the OS:

```bash
xset s off        # no screensaver
xset +dpms        # DPMS enabled...
xset dpms 0 0 0   # ...but never triggers on its own
```

---

## Architecture

npm workspaces monorepo. No monorepo tooling.

```
wall-dashboard/
  server/    NestJS (Express platform), TypeScript
  client/    Vite + Preact + TypeScript
  shared/    types.ts — DashboardState, the one contract between the two
```

### Commits

Claude commits its own work, in small units, as it goes — not one batch at the
end. The owner pushes; **Claude never pushes**.

- One logical change per commit. Split a session's work into several.
- Every commit must leave the tree type-checking and the tests passing. Where
  a change spans files (a type in `shared/` plus both consumers), those files
  go in the same commit rather than producing an intermediate that fails.
- Conventional-commit prefixes: `feat`, `fix`, `docs`, `chore`, `refactor`,
  `test`, scoped by area — `fix(client):`, `feat(news):`, `docs(claude):`.
- The subject says what changed and, when it isn't obvious, why. Findings that
  cost real debugging time belong in the body.
- **No `Co-Authored-By` trailer and no tool attribution.** The owner's name is
  the only one on these commits.
- Run `npm run check` (format, lint, typecheck, tests) before committing.
  There is no pre-commit hook and no husky — the discipline is Claude's, not
  the tooling's.

### Code style

Prettier owns formatting, ESLint owns everything Prettier cannot express.

- **4-space indent, double quotes, 100 columns, trailing commas, semicolons.**
- **Braces on every branch.** No `if (!x) return;` on one line, ever.
- `npm run format` / `npm run lint:fix` do the mechanical work.

**Ordering trap in `eslint.config.mjs`:** `eslint-config-prettier` sets
`curly: 0` unconditionally, so putting it last — as its own README suggests —
silently disables the brace rule and lints clean over exactly the code it is
meant to reject. It sits *before* the project rules here. Only
`curly: "multi-line"` genuinely conflicts with Prettier; `"all"` does not.
Getting this wrong hid 67 violations.

Markdown is Prettier-ignored so this file keeps its hand-wrapped prose.

### Dev-loop gotchas, both already paid for

**Vite caches an empty module if it sees a file mid-write.** Truncating a
source file (a shell heredoc, an editor that writes in two steps) can be
caught by the watcher during the zero-byte window. Vite then serves an empty
transform *permanently* and the page dies with
`does not provide an export named 'X'` while the file on disk is perfectly
fine. Touching the file fixes it. Write via atomic replace where possible.

**`nest start --watch` and EADDRINUSE — half fixed.** Watch restarts are
solved and verified (six rapid restarts, zero failures): the outgoing process
closes on SIGINT/SIGTERM/SIGHUP, and the incoming one retries the bind for
~10s, dev only. What is *not* solved is an **orphaned** server still holding
:3000 from a killed terminal — that holder never exits, so the retry just
delays a raw unhandled-rejection stack dump. `server/src/port.ts` has a
best-effort port-holder lookup written for this (names the PID and process) but
is **not wired in**. Finishing that means catching the exhausted-retry case in
`main.ts` and printing something actionable instead of a stack.

**Commands** (all from the repo root):

```bash
npm run dev     # server on :3000 + Vite on :5173, both bound to 0.0.0.0
npm run lan     # preflight the desktop -> laptop LAN setup, print the URL
npm run build   # server then client
npm start       # production: Nest serves the built client on :3000
npm test        # luften unit tests
```

**How `shared/` is imported.** The client uses a `@shared/*` path alias, which
Vite resolves for free. The server uses a plain relative import, isolated in
`server/src/shared.ts` so exactly one file knows the path. Nest needs
`emitDecoratorMetadata` — so tsc, not esbuild — and making an alias resolve at
*runtime* under tsc means adding `tsc-alias` or `tsconfig-paths`. That is
monorepo tooling by another name, and this repo has deliberately gone without.

One consequence: the server's `rootDir` is the repo root so `shared/` compiles
alongside it, which means `server/src/x.ts` emits to `server/dist/server/src/x.js`
— one level deeper than expected. Resolve runtime paths through
`server/src/paths.ts`, never by counting `..` at the use site.

**Stack choices and why:**
- **NestJS** over bare Express — `@nestjs/schedule` handles the six polling
  cadences declaratively, `@nestjs/config` holds secrets, DI makes the luften
  calculation unit-testable. Six data sources map cleanly onto modules.
- **Preact** over React — ~4KB runtime with the same API. Six panels on a
  Celeron-class box; React's 45KB buys nothing here.
- **uPlot** over Chart.js — built for long-running dashboards, tiny, doesn't leak
  across a 16-hour uninterrupted session.

  **uPlot trap, already paid for once: never call `redraw()` with no argument.**
  The default (`rebuildPaths = true`) internally re-pins the x scale via
  `_setScale('x', scaleX.min, scaleX.max)`. uPlot converges scales
  *asynchronously*, so if a `redraw()` lands in the same commit as the
  `setData()` that supplied the data — which is exactly what happens when
  weather and luften arrive in the same SSE frame — it reads a still-null range
  and pins x to `null` permanently. The chart then renders correct axes, a
  correct y range, and no plotted series at all, with no console error. Use
  `redraw(false)` whenever only the overlay changed.
- **Luxon** for time. Server process pinned to `TZ=America/New_York`. Never
  hand-roll DST math.

**State flow — this is the core pattern:**

The `state` module owns a `BehaviorSubject<DashboardState>`. A `@Sse('/api/stream')`
controller returns it as an `Observable<MessageEvent>`. Because BehaviorSubject
replays its current value to new subscribers, a connecting client immediately
receives full current state and then every subsequent update through one code
path — no separate `GET /api/state` endpoint, no connected-but-empty gap.

Push the **entire state object** on every update. The client replaces state
wholesale. No partial updates, no per-widget subscription wiring.

SSE rather than WebSockets specifically because `EventSource` has automatic
reconnect with backoff built into the browser. For an unattended display that
reconnect behavior is the whole point.

Each source module injects the state service and pushes into it. **Sources never
talk to each other.**

### Cache contract — apply to every fetcher

```ts
interface CacheEntry<T> {
  data: T | null;
  fetchedAt: Date | null;
  error: string | null;
}
```

- A failed refresh **never clears previous data**. Serve stale indefinitely.
- Show a subtle age indicator when an entry is older than its expected interval.
- Snapshot the whole cache to `cache.json` on write; restore on boot so a restart
  repaints instantly instead of showing six empty panels for 90 seconds.
- **`breaking` is the one field excluded from the snapshot.** Stale-but-present
  is the right trade for exchange rates; it is the wrong one for an emergency.
  Restoring an alert whose warning expired hours ago paints a false
  shelter-in-place order across the wall until `AlertsService` recomputes. It
  is derived state and costs nothing to rebuild, so it starts null.

A panel silently showing yesterday's exchange rates is far better than one that
blanks because an upstream had a bad minute.

### Poll cadences

| Source | Interval |
|---|---|
| Weather | 15 min |
| News (RSS) | 10 min |
| Twitch | 90 sec |
| FX | 15 min |
| Collection schedule | daily |
| NWS alerts | 60 sec |

Alerts poll at a minute because the panel exists to say "this is happening
now"; a fifteen-minute cadence would routinely show a shelter-in-place order
that had already been lifted.

Stagger the initial run of each by a few seconds so boot doesn't fire five
simultaneous requests.

---

## Display and layout

Build at a fixed 1920×1080 and scale to fit the viewport, so dev and production
are pixel-identical regardless of monitor or Windows scaling:

```css
#stage { width: 1920px; height: 1080px; transform-origin: top left; }
```

```ts
const fit = () => {
  const s = Math.min(innerWidth / 1920, innerHeight / 1080);
  stage.style.transform = `scale(${s})`;
};
addEventListener('resize', fit); fit();
```

**Zones:**
- Top bar — full width, 104px. **Rotates between reminders and today's luften
  windows** on a 9-second interval with a `rotateX` flip. Both want the
  glance-first slot and neither fills it, so they take turns; a face with
  nothing to say drops out of the rotation, and a single remaining face holds
  rather than flipping against itself. Honours `prefers-reduced-motion`.
  The transition is a **split-flap**, like an old airport board: each item
  hinges at its top edge (`transform-origin: 50% 0%`), drops in from
  `rotateX(-90deg)` with a fade, overshoots ~12° and settles. The small
  overshoot is what reads as mechanical rather than as a plain fade. Items
  stagger left to right at 90ms each via a `--flap-index` custom property, so a
  multi-item face lands like a row of flaps rather than one card.

  Two things that will look broken if changed carelessly: the animation lives
  on `.topbar__item`, not on `.topbar__face`, and the `perspective` therefore
  has to sit on `.topbar__face` — its direct parent. Perspective on `.topbar`,
  two levels up, does not apply, and the flap renders as a flat vertical
  squash. Keep it short: this fires every nine seconds all day, and anything
  longer becomes the thing you look at.

  A 5px strip down the **left edge** fills over the rotation interval so the
  flip is telegraphed rather than sudden. Its duration is set inline from
  `ROTATE_MS`, and it is keyed by the rotation index so it restarts in step
  with the face. It is omitted entirely when there is only one face.

  The bar also carries a **world clock** — Berlin, Moscow, Yekaterinburg — in
  24-hour time, sitting between the rotating face and the local clock. 24-hour
  because it is read against a local 12-hour clock and an unlabelled "3:40"
  beside it invites exactly the wrong subtraction. A `+1` marker appears when
  the zone is already on tomorrow, which for all three is most of the evening
  here. Use IANA zone names, never fixed offsets: Berlin observes DST, Moscow
  and Yekaterinburg have not since 2014.
- Weather chart — left column, 612px. **A fixed 36-hour window** (3 hours
  behind, 33 ahead) — long enough to carry tomorrow morning's commute marker
  and any overnight luften window, short enough that the hourly rain bars stay
  wide enough to read. Two overlaid series (temperature and
  dewpoint), hourly rain-chance bars behind them, commute markers and luften
  bands on top.
- Currency — left column, under the weather, 300px. Three pairs **side by
  side**, each ~347×162. Stacked in the right-hand column they were 466×69,
  which is a sparkline rather than a graph — too small to carry gridlines or a
  value axis.
- News feed — right column, full height.
- Twitch — right column, below news. Renders nothing at all when nobody is
  live and gives its height back to the feed.

There is no luften panel. It was a four-box lookahead strip, then a single
row, and is now folded into the top bar. The 3-day lookahead is still computed
and still travels in the state payload — nothing draws it.

**Kiosk runtime:**
```
chromium --kiosk --noerrdialogs --disable-infobars --incognito          --autoplay-policy=no-user-gesture-required http://localhost:3000
unclutter -idle 0
```

**`--autoplay-policy=no-user-gesture-required` is not optional** once the
Twitch player is in. Chromium blocks autoplay without a user gesture even when
the video is muted, and on a kiosk there is never going to be a gesture. The
failure is silent: a black player box and nothing in the console.

**Install `fonts-noto`** on the Wyse. Minimal Debian images lack Cyrillic coverage
and Russian headlines will render as tofu boxes.

**Never use localStorage or sessionStorage.**

---

## Data sources

### Weather — Open-Meteo

Free, no API key, no signup.

Request hourly: `temperature_2m`, `precipitation`, `precipitation_probability`,
`dew_point_2m`, `relative_humidity_2m`.

Pass `timezone=America/New_York` so the API returns local times — do not do UTC
offset math yourself. This makes the 8am/3pm markers survive DST for free.

Fallback: `api.weather.gov` (NWS, free, no key).

### Currency — Yahoo Finance, with daily-reference fallbacks

**The pairs are USD→EUR, USD→RUB, USD→CNY, in that order.** The order is the
owner's; it is not alphabetical and not a bug.

The panel exists to answer "should I exchange money now?", which a once-a-day
reference rate cannot support. Measured 2026-08-23 (a Sunday):

| Source | Freshness |
|---|---|
| Frankfurter (ECB reference) | still serving **Friday's** figures |
| open.er-api | one update per 24h |
| **Yahoo Finance chart API** | live price, minute-level `regularMarketTime` |

So the primary is `query1.finance.yahoo.com/v8/finance/chart/USD<QUOTE>=X`,
polled every **15 minutes**.

- Use the **direct USD-based symbols** (`USDEUR=X`, not `EURUSD=X`). All three
  exist. Inverting would need `1/x` and would quietly lose precision across the
  whole chart history.
- **`interval=1h&range=1mo`** — a month of hourly candles. Measured for
  `USDEUR=X` on 2026-08-23: 1h yields 506 points over 31 days, 30m yields 1010,
  1d only 22. The sparkline is ~347px wide, so hourly is already slightly
  oversampled and finer granularity would only cost payload.
- One request per pair covers history *and* the live rate, because
  `meta.regularMarketPrice` is present regardless of candle interval.
- **`FxPoint` is `{ t, rate }` where `t` is epoch seconds**, not a date string.
  Hourly data makes `YYYY-MM-DD` useless as a key, and seconds is what uPlot's
  time scale wants, so the client passes it through untouched.
- Candles with a `null` close are market closures, and are dropped rather than
  zeroed. That is what leaves the weekend as a real gap — expect a ~50h one
  every week, held flat by the stepped path, never drawn as a diagonal.
- Rates are rounded to **six significant figures**. Yahoo stores them as 32-bit
  floats, so a rate that is really `0.8665` arrives as `0.8665000200271606`.

**The payload cost is real and was accepted deliberately.** Hourly across three
pairs is ~40KB of the ~61KB SSE frame, and the whole DashboardState is pushed
on every update. On localhost and a home LAN that is nothing; it would not be
on a metered link. If it ever needs trimming, drop to `90m` (338 points, almost
exactly one per pixel) before touching the window length.
- `FxSeries.asOf` carries the market timestamp — not our fetch time. The panel
  shows it as "live 7:46 PM". Daily sources leave it null.
- Requires a browser-ish `User-Agent` or it 404s.

**It is undocumented and unversioned**, so it is wrapped, never trusted alone.
Failure falls through per-pair to Frankfurter, and RUB falls further to CBR.
Same posture as the ReCollect feed: use it, but never let it be the only thing
between the panel and a number.

#### Frankfurter — now the fallback

Free, no key, no quota. Multi-provider (84 central banks, 201 currencies).

```
https://api.frankfurter.dev/v2/rates?from=<YYYY-MM-DD>&base=USD&quotes=EUR,CNY,RUB
```

**Both v2 endpoints return flat arrays, not the keyed maps v1 used.** This is the
single easiest thing to get wrong here:

```jsonc
// GET /v2/currencies
[{ "iso_code": "RUB", "name": "Russian Ruble", "start_date": "1993-01-04", "end_date": "..." }, ...]
// GET /v2/rates  — one row per date *per quote*
[{ "date": "2026-07-24", "base": "USD", "quote": "EUR", "rate": 0.87732 }, ...]
```

**The ruble was the problem case — verified resolved.** The ECB suspended its
EUR/RUB reference rate on 1 March 2022, so anything ECB-only has no RUB data at
all. Checked 2026-08-23: Frankfurter v2 **does** carry RUB from a non-ECB
provider, current through the same day as EUR and JPY. The startup probe
therefore checks `end_date` freshness, not just presence — a silently stalled
RUB series is the failure mode to expect, and that is what falls back to the
Central Bank of Russia's free XML feed at `cbr.ru` for that one pair.

v2 returns a value for weekends too, but ECB-sourced pairs can still gap. Step
the line; don't draw a straight diagonal across Saturday and Sunday.

### News — RSS, parsed server-side

Use `rss-parser`. Must be server-side: RSS feeds don't send CORS headers, so the
browser physically cannot fetch them.

**CNN is gone — do not put it back without checking freshness.** Every CNN RSS
endpoint is abandoned (measured 2026-08-23): `cnn_topstories` last published
April 2023, `cnn_allpolitics` June 2024, `cnn_world` September 2023.

The failure mode was worse than an empty feed. CNN's stale entries *are* dated,
so the age cutoff dropped them — while the `cnn-underscored` commerce pages are
**undated**, so they sailed straight through it. The panel degraded into
nothing but "50+ products to make your life easier" and Mother's Day gift
guides. An age filter alone inverts into a filler filter when a feed dies.

**Thirteen sources**, weighted US-first then EU then Russia. All verified
through `rss-parser` itself on 2026-08-24 — not by curl — and every one
returned items with 100% of them dated:

| Source | Feed | Scope |
|---|---|---|
| NPR | `feeds.npr.org/1014/rss.xml` | US politics |
| PBS | `pbs.org/newshour/feeds/rss/politics` | US politics |
| NYT | `rss.nytimes.com/services/xml/rss/nyt/Politics.xml` | US politics |
| The Hill | `thehill.com/rss/syndicator/19110` | US congress |
| Guardian | `theguardian.com/us-news/us-politics/rss` | US politics |
| BBC | `feeds.bbci.co.uk/news/world/rss.xml` | Global |
| DW | `rss.dw.com/xml/rss-en-eu` | EU |
| France 24 | `france24.com/en/rss` | EU / global |
| Euronews | `euronews.com/rss?level=theme&name=news` | EU |
| Al Jazeera | `aljazeera.com/xml/rss/all.xml` | Global |
| Новая | `novayagazeta.ru/feed/rss` | Russia, translated |
| Meduza | `meduza.io/rss/all` | Russia, translated |
| Moscow Times | `themoscowtimes.com/rss/news` | Russia, English |

**Also measured dead — do not retry without re-checking.** AP's
`apnews.com/index.rss` returns **401**, `feeds.reuters.com` no longer
resolves at all, Euractiv **403s** any non-browser client, and Politico's
`politics-news.xml` was ~40 hours stale on a Sunday night.

**Meduza's English edition is the stale one.** `meduza.io/rss/en/all` was three
days behind while `meduza.io/rss/all` was current to the hour. This is the
reverse of the obvious assumption, and it is why Meduza goes through the
translation pipeline rather than being taken in English.

**Euronews serves gzip unconditionally.** `rss-parser` decompresses it fine,
but a hand-check with curl and no `--compressed` returns a body of null bytes
and counts zero items — the feed looks dead when probed and is perfectly
healthy in the app. Probe through the parser, not through curl.

Each feed carries candidate URLs tried in order and the server remembers which
one worked. `maxAgeHours` is per-feed: Новая gets 48h because it published
exactly one item inside 24h on a Sunday, and a source that silently vanishes
reads as a bug.

**`MAX_PER_SOURCE` tracks the slot count in both directions.** It went 8 → 3
when the set went 4 → 13, then 3 → 5 when the panel went from 16 slots to 40.
It has to stay low enough that the high-volume feeds cannot take the panel
between them, and high enough to leave a pool bigger than `NEWS_COUNT` —
thirteen sources at 3 apiece is 39 candidates for 40 slots, which is not a
selection at all.

**The panel carries 40 headlines and scrolls slowly through them**, about
sixteen visible at a time. `NEWS_COUNT` is the set size, not the on-screen
count.

Continuous crawl rather than paging, because a page flip on a wall display
steals attention at a moment you did not choose — you look up because
something moved, not because you wanted to read. A slow crawl is ignorable
until you decide to read it. 14px/second, so forty headlines is a ~2,265px
track and a full cycle takes a little under three minutes.

**The track holds the list twice** and translates by exactly one copy's height,
so the wrap is seamless. This is why the items carry `margin-bottom` and the
container does **not** carry `gap`: a gap puts a seam between the two copies
that has to be added back into the distance by hand, and any drift there shows
up as a visible jump once per cycle. Measured: declared distance 2265px against
a measured copy height of 2265px, drift 0.

Duration is set inline from the measured height so the *speed* is constant
however tall the list turns out to be, and the measurement keys off the item
ids rather than the array identity — the array is rebuilt on every SSE frame
and would otherwise re-measure forever. The list stops scrolling on its own if
it already fits, which is what happens when the feed is cold or a Twitch player
has taken the column.

`.news--scrolling` fades **both** ends; a static list fades only the bottom,
because with a short list the top item is the newest thing on the panel and
must not be dimmed. The top fade is much shallower than the bottom one (6px
against 28px) and that asymmetry is deliberate — see the loop marker below.

**The loop marker.** Each copy of the list is headed by a `Latest` label and a
rule. It sits *inside* the copy so it travels with the headlines and comes back
around with them, which is the entire point: a seamless loop is otherwise
indistinguishable from an endless feed, and you cannot tell a new headline from
one you read two minutes ago.

Its resting place is the very top of the viewport, which is why the top fade is
only 6px. At 28px the label was dimmed at precisely the moment it exists to be
read — the fix is a shallow fade rather than padding tuned to the fade depth,
so the two are not coupled.

Every child of a copy carries `margin-bottom`, including the last, and the
copies themselves carry none. That keeps the gap between the final headline of
one copy and the `Latest` of the next identical to the gap everywhere else; a
copy margin stacked on a child margin would double the space at exactly the
seam. Verified: seam gap and ordinary gap both 6.7px, drift 0.

**The cycle progress bar** counts down to the moment `Latest` is back at the
top. It shares the scroll's duration and mounts in the same commit, so the two
stay in phase with no coordination — the track is at `translateY(0)` exactly
when the bar is empty, and both take a duration change identically when a new
headline resizes the track.

It is **horizontal**, where the top bar's is vertical, on the same principle:
the indicator runs *perpendicular* to the content it times. It also avoids a
trap — a vertical strip down the side of a scrolling list reads as a scrollbar,
and a scrollbar that shrinks instead of moving is a broken scrollbar.

**The track is measured with a `ResizeObserver`, not just on item change.** The
headline ids are not the only thing that changes its height: a late webfont, a
stylesheet edit, or the Twitch player shrinking the column all resize the track
while the ids stay put. A stale distance does not merely look wrong once — the
loop no longer lands where the track repeats, so it drifts by that error *every
cycle*.

### Filler filtering — `sources/news/filter.ts`

Three independent rules, because any one alone leaks:

1. **Undated items are dropped outright.** This is the decisive rule: real
   reporting is always dated, evergreen commerce pages usually are not.
2. **Section path match.** Tokens of the *first two path segments only*, split
   on hyphens, checked against a set (`underscored`, `deals`, `sport`,
   `lifestyle`, …). Deliberately not a substring match over the whole path — a
   naive one rejects `/news/transport-strike` for containing "sport" and
   `/politics/trump-deals-with-congress` for "deals". There is a test for this.
3. **Headline shape.** Listicles, gift guides, price/deal language, and
   first-person advocacy (`we tested…`, `…and you should too`), which is a
   reliable commerce tell — news desks report in the third person.

BBC files everything under `/news/`, so its occasional culture piece is not
path-separable. That leak is accepted.

### Translation — MyMemory

Russian headlines are machine translated to English. `novayagazeta.eu`
publishes in Russian too, so switching editions would not have avoided this.

`api.mymemory.translated.net` — free, no key, good quality. Every Lingva and
LibreTranslate public instance tried returned 500 or a Cloudflare challenge.

- **Fail-open.** Any error, quota exhaustion, or malformed response leaves the
  original Cyrillic in place. Same principle as the cache contract: stale or
  untranslated beats blank.
- Results are cached forever and translation runs *after* filtering and
  capping, so the quota is never spent on headlines that were never going to be
  shown.
- 5,000 chars/day anonymous, 50,000 with a contact address in `MYMEMORY_EMAIL`.
  Opt-in only — that address is sent with every request.
- **There are two Russian sources now, not one.** Новая plus Meduza roughly
  doubles the translated volume, which puts the anonymous 5,000-char tier
  within reach of a busy news day. The forever-cache is what keeps it viable —
  only genuinely new headlines cost anything. Set `MYMEMORY_EMAIL` if the
  panel starts showing untranslated Cyrillic in the evenings; that is the
  fail-open path reporting quota exhaustion, working as designed.
- The client marks translated headlines with a small `RU` badge and keeps the
  original in `titleOriginal`. Machine translation should be visible as such.

Display **headline + source + timestamp only**. No article bodies — space, and
republishing full text isn't ours to do. The timestamp is the absolute publish
time (`3:34 PM`), with a weekday prefix for anything not from today.

**Ordering is strictly newest-first across all sources.** The top line is the
newest thing that has happened, full stop.

A round-robin interleave was tried and **deliberately reverted** — don't
reintroduce it without asking. On a wall display, an item's position should
mean "how recent", not "whose turn it is".

**Regional floors, added when the set reached thirteen sources.** The problem
the interleave was trying to solve got worse: measured on a Sunday night, the
sixteen visible slots held eight sources and *no* Russian one, because Новая's
newest item was 17.8h old and Meduza's 8.7h against a wall of fresher US and EU
headlines. The source with an entire translation pipeline behind it would
essentially never appear.

`REGION_MINIMUMS` guarantees EU six slots and Russia four, out of forty. The
critical property, and the reason this is not the reverted interleave under a
new name:

> **The floors decide membership. They never decide order.**

`selectVisible()` reserves in one pass and then renders the chosen set strictly
newest-first, so a reserved 17-hour-old Новая headline lands at the *bottom* of
the panel. Nothing jumps the queue; the top line is still the newest thing that
has happened. There are tests for both halves.

US gets a floor of zero — it dominates on recency anyway, so reserving for it
would change nothing. The floors must sum to well under `NEWS_VISIBLE` or they
become the whole panel.

`NEWS_VISIBLE` lives in `shared/types.ts` because **the server does the
selecting**. Balancing representation is only meaningful against the set that
is actually displayed; sending 40 items and letting the client slice to 16
would throw the balance away in the slice. `MAX_PER_SOURCE` still caps the pool
each feed contributes before any of this runs.

Compare instants, not ISO strings. Two feeds can report the same moment with
different UTC offsets, and a lexical compare then sorts by the offset.

### Breaking news alerts — NWS civil emergencies + cross-source velocity

The red-bar case: something is happening *now* and the panel should say so
above everything else.

**There is no free real-time breaking-news push API.** This was researched
properly on 2026-08-24 and the answer is genuinely no. Every aggregator that
markets itself that way — NewsData, Currents, Mediastack, TheNewsAPI,
NewsAPI.org — is key-gated and quota-capped at 100–600 requests/day, which a
60-second poll exhausts before lunch. NewsAPI.org's free tier additionally
delays articles 24 hours, the exact inverse of the requirement.

Two plausible-looking options were tested and **rejected on measurement**:

- **GDELT DOC 2.0** (free, no key, 15-minute updates) returned **HTTP 429 on
  three attempts spread over several minutes** from a residential IP, with a
  notice asking for one request per five seconds. Its rate limiting appears to
  be shared-pool. Not something to hang an alert path on.
- **Google News RSS `when:1h`** works, but `when:` is a *filter* and not a
  query — `q=when:1h` alone returns an empty feed, so it needs a keyword. And
  searching `breaking` matches the word, not the event class. Live results at
  the time of testing: an MLB playoff bracket, a Santa Clara county fire, an
  Arlington apartment blaze. Useless as a trigger.

So the trigger is two local signals rather than one remote one:

**1. NWS alerts — `api.weather.gov/alerts/active`.** Free, no key, and already
this project's weather fallback. It carries **111 event types, 13 of them
civil emergencies rather than weather**, sourced from IPAWS:

> Civil Danger Warning · Shelter In Place Warning · Law Enforcement Warning ·
> Evacuation Immediate · Child Abduction Emergency · Local Area Emergency ·
> Hazardous Materials Warning · 911 Telephone Outage · Nuclear Power Plant
> Warning · Radiological Hazard Warning · Fire Warning · Civil Emergency
> Message · Administrative Message

That is exactly the "active shooting → shelter in place" category, from the
authoritative source. Severe weather rides the same poll: gate on
`severity` ∈ {Extreme, Severe} rather than maintaining a hand-written list of
weather event names, so a Tornado Warning qualifies and a Special Weather
Statement (Moderate) does not.

- Filter by zone, not state. `?zone=NCZ041` is Wake County and the API confirms
  it in the response title; `?area=NC` returns Hatteras Island fishing
  advisories.
- **`/alerts/stream` is a 404 — the old SSE endpoint is gone.** This polls.

**2. Cross-source velocity over the feeds already polled.** When several of the
thirteen sources publish overlapping headlines inside a short window, that is a
breaking event. No new dependency, no key, no quota, and it gets *better* as
sources are added rather than more expensive.

A test event in JSON, toggled by an env var, drives the **same code path** as a
real alert. It is not a separate render path — otherwise the thing that only
ever runs during a real emergency is the thing that was never exercised.

```bash
BREAKING_TEST=1 npm run dev     # forces server/config/breaking-test.json
NWS_ZONE=NCZ041                 # Wake County; the one thing that moves
```

**Measured against live data, 2026-08-24.** All 242 active alerts nationwide:
42 would raise a bar, **82.6% suppressed** — the bulk of them Small Craft
Advisories (101 of them), Heat Advisories, and Special Weather Statements.
Scoped to one inland zone the real-world rate is near zero on a normal day,
which is the intent.

**One of those 242 had `status: "Test"`.** That is not hypothetical: NWS
publishes Test and Exercise alerts on the live endpoint, and the `status`
check is the only thing standing between a drill and a red bar. Do not remove
it.

`AlertsService` reads *published state* to get the news items rather than
calling `NewsService`. That keeps "sources never talk to each other" true — it
consumes the same stream the client does.

A velocity surge has no upstream "it's over" signal, so it expires on a
45-minute TTL. NWS alerts carry their own `ends`/`expires`.

**Ranking: emergency > weather > developing.** Only one bar shows. The
`developing` bar is amber and says "Developing", not red and "Breaking" —
several outlets converging is weaker evidence than an IPAWS alert and should
not claim the same certainty.

**Breaking is a face in the rotation, not a replacement for it.** It leads and
takes a double turn (18s against 9s), but the reminders and the luften windows
still get theirs. An alert that held the bar permanently would silently cancel
the trash reminder for as long as it ran, and the top bar is the only place
those live. It flips in on the same split-flap as every other face — arriving
by the same mechanism is what keeps the bar reading as one object rather than
two overlapping ones.

`useRotation` therefore takes an **array of dwell times**, one per face, and
chains `setTimeout` rather than using `setInterval` — the delay has to change
between ticks. The progress strip reads its duration from the current face, so
a breaking face counts down over 18s and takes the tone's colour; a red bar
counting itself down in accent blue looks like a bug.

### Collection schedule — ReCollect

Raleigh's calendar runs on ReCollect (Routeware). Area code `CityofRaleighNC`.

```
https://api.recollect.net/api/places/{PLACE_ID}/services/{SERVICE_ID}/events
```

Append `.en-US.ics` for iCal instead of JSON. Get both IDs once from the iCal
subscribe link in the Raleigh Reuse tool; the `client_id` query param can be
stripped.

This resolves holiday shifts and Schedule A/B recycling parity **at the source**,
so no hand-maintained holiday table is needed. (For reference: only Thanksgiving
affects Raleigh collection in 2026.)

**`nomerge=1` returns one event object per flag, not per day.** Verified
2026-08-23 with the real place/service IDs: `2026-08-25` came back twice, once
`garbage` and once `yardwaste`. Group by date before building reminders or the
bar says "Trash out" and "Yard waste out" as two separate lines for the same
morning. Flags that classify as `other` are ReCollect's own markers — holiday
notices and the like — and are dropped.

Caveat: undocumented endpoint. Poll daily, cache, and keep a hardcoded weekly
fallback so a schema change doesn't blank the reminder bar.

### Twitch — Helix API

Register an app at dev.twitch.tv. Use the **client_credentials** flow for an app
access token — read-only public stream state needs no user login. Client ID and
secret via `@nestjs/config`, never in the client bundle.

```
GET /helix/streams?user_login=a&user_login=b   (up to 100 logins per call)
```

Offline streamers are simply absent from the response array — that's the offline
signal. Token lasts ~60 days; catch a 401 and re-fetch rather than tracking
expiry. Thumbnail URLs contain `{width}`/`{height}` placeholders to substitute.

#### Embedded player — production only, by measurement

The panel is to autoplay the stream muted when someone is live, and expand to
fullscreen on a click. Researched 2026-08-24.

`player.twitch.tv/?channel=<x>&parent=<host>&autoplay=true&muted=true`, and
Chromium needs `--autoplay-policy=no-user-gesture-required` in the kiosk flags
or the muted autoplay is still blocked.

**The `parent` parameter is the constraint that decides where this can run.**
Twitch rejects raw IP addresses outright, and the docs state plainly that
"domains that use Twitch embeds must use SSL certificates".

| | `parent` | Works? |
|---|---|---|
| Production (Wyse kiosk → `http://localhost:3000`) | `localhost` | Yes — localhost is a browser secure context |
| LAN dev rig (laptop → `http://192.168.1.225:5173`) | *(an IP)* | **No** — fails the IP rule and the SSL rule at once |

**Decided: build it prod-only.** Verification happens on the Wyse itself. The
panel degrades to the existing thumbnail card wherever the embed is refused, so
the LAN dev rig stays usable — the video simply doesn't appear there. Making it
work in dev would mean a hosts-file entry on the laptop plus a self-signed cert
for Vite, which is a lot of moving parts for a preview.

Two further notes for whoever builds it:

- **The JS embed API has no fullscreen method.** Set `allowfullscreen` on the
  iframe and call `requestFullscreen()` on the element yourself.
- **An iframe swallows clicks**, so click-to-fullscreen needs a transparent
  overlay div above the player. That collides with `cursor: none` and
  `unclutter -idle 0`, and with open decision 6 — no input device is chosen
  yet, so nothing can click this today.

Decode is not a concern: Twitch delivers H.264 and the J5005's UHD 605 handles
that in hardware.

**Built 2026-08-24.** `canEmbed()` tests the host rather than assuming it — an
IP address has no letters in it, which is the whole check. On a host Twitch
will refuse, the panel falls back to the thumbnail card rather than showing a
dead grey box across the room with an error message too small to read from the
sofa. Probed with `parent=localhost` on the running dev page: the player
document booted a nested frame and produced no CSP or frame-ancestors console
error, so localhost is accepted.

**Only the first live stream gets a player.** Two autoplaying 1080p streams is
not a reasonable ask of a Pentium Silver, and two moving images in the corner
of a room is not a reasonable ask of a person. Anyone else live is a one-line
mention.

**The player costs the news feed about six headlines.** The right column is
928px; a 400x225 embed plus its chrome takes roughly 300 of them. Rather than
couple news selection to Twitch state — which would mean a source reading
another source — `.news` carries a bottom fade mask, so a clipped list reads as
"there is more" instead of as a rendering fault. Every 100px of embed height is
worth about two headlines if that trade ever needs revisiting.

---

## Feature specs

### Commute markers

Vertical lines on the weather chart at **08:00** and **15:00** local time.

Each carries a small **readout box** with the temperature and rain chance at
that hour. The chart answers "what is the shape of the day"; the readout
answers "so what is it actually going to be when I walk out of the door", which
is the only reason those two lines exist.

Values come from the **nearest hourly sample, never interpolated**. These are
hourly forecasts; inventing a between-hours precision they do not have would be
false confidence. If the closest sample is more than 30 minutes away the marker
sits in a gap and the box is skipped rather than guessed. The box also clamps
to the plot's right edge so a marker near the end of the window doesn't push it
off-canvas.

### Luften (window airing)

**Relative humidity is the wrong metric — use dewpoint.** RH is relative to
temperature, so 60°F air at 90% RH holds less water than 75°F air at 60% RH.
Gating on RH will regularly import moisture while appearing to remove it. What
dries the house is outdoor dewpoint below indoor dewpoint.

Two distinct signals, not one:

**1. Air-exchange window (year-round).** German *Stoßlüften* — windows fully open
5–10 minutes, cross-draft if possible. For a burst that short, outdoor temperature
barely matters; dry cold winter air is the best drying agent available.
- Outdoor dewpoint ≥ 5°F below indoor dewpoint
- No precipitation
- Outdoor temp roughly 40–80°F

**2. Windows-open-all-day window (spring/fall).** The above, **plus** outdoor temp
in the 67–75°F band. This is the one the owner is picturing.

Implementation notes:
- **Interpolate linearly between hourly points** to find band-crossing times.
  Report "10:40–13:20", not "11:00–13:00".
- **Do not interpolate precipitation.** Open-Meteo reports hourly precipitation
  as a *preceding-hour sum* — it is an interval quantity, not a point sample.
  Interpolating it puts the end of a window a couple of minutes into the rain.
  Temperature and dewpoint interpolate; precipitation snaps to the hour. The
  NWS fallback's periods run the other way (a period at T covers T..T+1h), so
  its precipitation is shifted one slot to match before anything downstream
  sees it.
- Indoor dewpoint requires indoor data — see open decisions.
- Magnus formula converts indoor temp + RH to dewpoint (~6 lines).
- Render an explicit **"no window today"** state. In a Raleigh summer the 67–75°F
  band is empty most days; a blank chart reads as a bug.
- Consider a 3-day lookahead strip so the panel stays informative in summer.

### Reminders

Small JSON rules config evaluated server-side per render. Trash weekly, recycling
biweekly — but prefer the ReCollect feed over computed parity wherever possible.

```json
{ "id": "trash", "days": ["Mon", "Tue"], "before": "12:00",
  "text": "Trash out — pickup Tuesday morning" }
```

---

## Dev environment

There are **two deployments with deliberately different shapes**, and the split
is driven by `NODE_ENV` (set by the npm scripts, not by hand):

| | Development | Production (the Wyse) |
|---|---|---|
| Processes | Nest :3000 + Vite :5173 | Nest :3000 only |
| Who serves the client | Vite, with HMR | Nest, from `client/dist` |
| Network | desktop → laptop over LAN | none, all localhost |
| Command | `npm run dev` | `npm run build && npm start` |
| Browser points at | `http://<desktop-ip>:5173` | `http://localhost:3000` |

**In dev the API deliberately does not serve the client.** `client/dist` is
whatever was built last, so serving it on :3000 alongside Vite's live copy on
:5173 would mean two URLs running two different versions of the app with
nothing to tell you which you were looking at. In dev, `GET :3000/` is a 404 on
purpose.

### The LAN setup (desktop hosts, laptop displays)

Server and client run on the **desktop** (Ethernet, `192.168.1.225`). The
**laptop** (WiFi) is connected to the living room TV and views it over the LAN,
simulating the final display. Both are Windows 11 on the same network.

**Run the preflight first** — every failure mode below is invisible from the
laptop, where the symptom is only ever "the page doesn't load":

```bash
npm run lan
```

It checks the network profile, the firewall, and whether each server is bound
to `0.0.0.0` rather than localhost, then prints the exact URL to open.

**One-time Windows setup:**
- Network profile must be **Private** (Settings → Network & Internet → Ethernet).
  On Public, Windows blocks inbound and no Private-profile rule will help.
- The firewall rule, in an **elevated** PowerShell. Note that any pre-existing
  `node.exe` allow rules may be scoped to a *different* node binary (an nvm
  install rather than `C:\Program Files\nodejs`), in which case they do nothing
  for you — which is why the rule is by port:
  ```powershell
  New-NetFirewallRule -DisplayName "Wall dashboard dev" -Direction Inbound `
    -LocalPort 3000,5173 -Protocol TCP -Action Allow -Profile Private
  ```
- DHCP reservation for the desktop so its IP stops moving.

**Laptop kiosk test:**
```
chrome.exe --kiosk --noerrdialogs --disable-infobars http://192.168.1.225:5173
```
Set TV output to 1080p at 100% Windows scaling. Also stop the laptop sleeping
and blanking, or it will do exactly what the Wyse is configured never to do.

**SSE survives the Vite proxy** — verified: `text/event-stream`, no content
encoding, no buffering, connection stays open across pushes. The proxy has
`timeout: 0` / `proxyTimeout: 0` set because the stream is open for the life of
the page.

**HMR host is pinned automatically** to the detected LAN address. Without it
the HMR websocket can resolve to a host the laptop cannot reach, and page loads
keep working while HMR silently stops — a genuinely annoying thing to diagnose
from across the house. Override the detected address with
`DASHBOARD_DEV_HOST=<ip>` if the machine has several NICs and it picks wrong.

**If ping fails but both machines have internet:** router client/AP isolation
between wired and wireless clients (common on mesh systems), or the laptop is on a
guest SSID (separate VLAN, no LAN route).

---

## Decided

1. **Server host — entirely on the Wyse.** No auth on the SSE endpoint, and the
   dashboard survives an internet outage by serving cached panels. In production
   the Nest server also serves the built client, which is why the kiosk command
   points at `localhost:3000` rather than at Vite.
2. **Novaya Gazeta — `novayagazeta.ru`,** the original outlet, not the `.eu`
   exile publication.
3. **Indoor sensor — (a), the assumed 70°F / 50% RH constant** (≈50.5°F
   dewpoint), behind an `IndoorService` interface. A real sensor drops in later
   by POSTing `{ tempF, relativeHumidity }` to `/api/indoor`; readings older
   than 30 minutes fall back to the constant, and nothing in the luften
   calculation changes either way.

## Open decisions

4. **Additional news sources and the time window** to display. Currently a
   24-hour cutoff, 30 items cached, 9 shown.
5. **Twitch panel placement** in the 1920×1080 layout, and which streamers.
   Provisionally bottom of the right column: it renders nothing at all when
   nobody is live and gives its height back to the news feed above it.
6. **Remote interaction** (deferred, nice-to-have) — expand a panel to fullscreen
   and back. Use a **USB HID remote** (~$10–15; Rii i8, MX3, or similar 2.4GHz
   mini keyboard). It enumerates as a standard keyboard, so arrow/Enter/Escape
   arrive in Chromium as ordinary `keydown` events. Auto-collapse any expanded
   panel after 60s of no input.
7. **PSU barrel tip** — verify 4.5mm vs 7.4mm against the Wyse's jack on arrival.
   Ordered from a Hong Kong seller, so a return is impractical; buy locally if
   wrong. It's a generic, so watch for the Dell "AC adapter type cannot be
   determined" POST warning — that can require a keypress to boot, which would
   break unattended recovery after a power cut. BIOS POST Behavior section can
   disable the warning. Default Wyse BIOS password is `Fireport`.

---

## Rejected — don't revisit

- **Raspberry Pi / Banana Pi / Orange Pi / any ARM SBC.** Vendor-forked kernels,
  stale images, and Mali GPUs with no working accelerated Chromium path. x86 +
  stock Debian is the reason the Wyse was chosen.
- **HDMI-CEC for TV power.** Roku ECP does it over the LAN for free.
- **Pulse-Eight USB-CEC adapter (~$50) for remote input.** A $12 USB remote is
  cheaper and better. Also moot — the Wyse is DisplayPort-only.
- **The Roku remote driving the dashboard.** ECP is send-only; there's no endpoint
  to subscribe to button presses. Combined with no CEC path, it's not reachable.
- **Article bodies in the news panel.** Headlines and links only.
- **localStorage / sessionStorage.**
- **MagicMirror², Grafana, Home Assistant, DAKboard.** Every one would need custom
  modules for these specific widgets anyway, so the framework is pure overhead.