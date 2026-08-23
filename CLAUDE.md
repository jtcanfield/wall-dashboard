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

A panel silently showing yesterday's exchange rates is far better than one that
blanks because an upstream had a bad minute.

### Poll cadences

| Source | Interval |
|---|---|
| Weather | 15 min |
| News (RSS) | 10 min |
| Twitch | 90 sec |
| FX | daily |
| Collection schedule | daily |

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
- Reminder bar — full width, top. Glance-first item; full width absorbs variable
  text length without reflowing anything else.
- Weather chart — left ~60%, full remaining height. Largest because it carries two
  overlaid series plus markers and bands.
- FX panels — right column, three stacked sparklines: USD/EUR, USD/CNY,
  USD/RUB over a rolling 30-day window.
- News feed — right column, below FX.
- Twitch panel — placement TBD (see open decisions).

**Kiosk runtime:**
```
chromium --kiosk --noerrdialogs --disable-infobars --incognito http://localhost:3000
unclutter -idle 0
```

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

### Currency — Frankfurter

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

Current sources, all verified fresh and 100% dated:

| Source | Feed | Scope |
|---|---|---|
| NPR | `feeds.npr.org/1014/rss.xml` | US politics |
| PBS | `pbs.org/newshour/feeds/rss/politics` | US politics |
| BBC | `feeds.bbci.co.uk/news/world/rss.xml` | Global |
| Новая | `novayagazeta.ru/feed/rss` | Russia, translated |

Each feed carries candidate URLs tried in order and the server remembers which
one worked. `maxAgeHours` is per-feed: Новая gets 48h because it published
exactly one item inside 24h on a Sunday, and a source that silently vanishes
reads as a bug.

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
- The client marks translated headlines with a small `RU` badge and keeps the
  original in `titleOriginal`. Machine translation should be visible as such.

Display **headline + source + timestamp only**. No article bodies — space, and
republishing full text isn't ours to do. The timestamp is the absolute publish
time (`3:34 PM`), with a weekday prefix for anything not from today.

**Ordering is round-robin across sources, not merged recency.** BBC World
publishes several times an hour and the others do not, so a flat recency sort
gave BBC six of the nine visible slots and Новая zero — the source with an
entire translation pipeline behind it never appeared. The queues are seeded by
their freshest item, so the top slot is still the newest headline overall and
only the slots beneath it are shared out.

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

---

## Feature specs

### Commute markers

Vertical lines on the weather chart at **08:00** and **15:00** local time.

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