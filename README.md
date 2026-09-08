# UCalgary Seat Watcher

Watches UCalgary course seat availability and alerts the moment a seat opens.

Two problems, one tool:

- **Decide** — when a course is full, is joining the waitlist worth it? Depends on your
  position, how fast the list moves, and how long until the deadlines. The portal shows you
  position and nothing else.
- **React** — when a seat does open, it goes first-come-first-served and nobody is watching.

## The rule this project is built around

**It never enrols you into a waitlisted course before that term's waitlist purge day.**

UCalgary's [Wait List policy](https://www.ucalgary.ca/registrar/registration/wait-list):
seats vacated before the purge day belong to the waitlist queue; only *after* the purge are
remaining seats first-come-first-served. Taking a pre-purge seat jumps a queue of students
waiting properly, so the tool does not do it.

Before the purge, it advises and notifies. After the purge — and for courses with no waitlist
at all — it can also help you enrol.

The gate lives in [`src/domain/purge.ts`](src/domain/purge.ts), it is evaluated when an alert
fires rather than when you configure a watch, and it **fails closed**: an unknown term, an
unpublished purge date, or an unknown waitlist state all mean "don't enrol".

## Status

The logic is built and tested; the extension builds and loads. Nothing has been run against
the live portal yet.

| Piece | State |
|---|---|
| Purge gate (`domain/purge.ts`) | ✅ built, tested |
| Term codes (`domain/terms.ts`) | ✅ built, tested |
| Transition detection (`domain/transitions.ts`) | ✅ built, tested |
| Adaptive cadence (`domain/schedule.ts`) | ✅ built, tested |
| Class Search parser (`peoplesoft/parse.ts`) | ✅ built, tested against a real capture |
| Session state machine (`peoplesoft/session.ts`) | ✅ built, tested |
| Poll orchestration (`watcher.ts`) | ✅ built, tested |
| Extension shell, popup, options | ✅ builds; **not yet run in Chrome** |
| Desktop + ntfy alerting | ✅ written; **not yet fired for real** |
| Class Detail parser (seat numbers) | ⬜ needs a capture |
| Assist mode (pre-fill enrolment) | ⬜ stubbed — logs instead of acting |
| Auto-enrol submit | ⬜ gate and rails exist; the submit does not |
| Waitlist advisor | ⬜ |

```bash
npm install
npm test          # 81 tests
npm run typecheck
npm run build     # -> .output/chrome-mv3
npm run dev       # WXT dev server with HMR
```

To load it: `chrome://extensions` → Developer mode → **Load unpacked** →
`.output/chrome-mv3`. Sign in to my.ucalgary.ca first; the extension has no login of its own
and polls using the session you already hold.

Note that assist and auto modes currently stop at the notification — the enrolment-page
plumbing is the next piece of work. The mode selector and the purge gate around it are real
and tested; what they gate is not built yet.

## How the portal actually works

Captured 2026-09-08 from a live session.

```
POST /psp/paprd/EMPLOYEE/SA/c/SA_LEARNER_SERVICES.CLASS_SEARCH.GBL
ICAction=CLASS_SRCH_WRK2_SSR_PB_CLASS_SRCH
CLASS_SRCH_WRK2_STRM$35$=2267          # Fall 2026
SSR_CLSRCH_WRK_SUBJECT_SRCH$0=GRST
SSR_CLSRCH_WRK_CATALOG_NBR$1=211       # omit for the whole subject
→ 200 text/xml
```

Three things about the response shape drive the design:

**Status is an icon filename, not text.** `PS_CS_STATUS_{OPEN,CLOSED,WAITLIST}_ICN`. There are
no seat numbers in search results at all — those live on the Class Detail page behind
`ICAction=MTG_CLASS_NBR$n`.

**One search covers a whole subject.** Drop the catalog number and you get every section.
Twelve watched CPSC courses cost one request, not twelve. This is why polling splits into a
fast status tier (the sniper's signal) and a slow detail tier (the advisor's data).

**`ICStateNum` makes the session strictly sequential.** It increments per request, the server
rejects stale values, and the next value arrives inside the response's onload script. No
parallel polling; `PsSession` funnels everything through one queue. A desync raises
`DesyncError` and demands an explicit re-sync rather than retrying — a retry storm against a
registration system is how accounts get locked.

Cloudflare (`cf_clearance`) sits in front of all this, which is a strong argument for running
inside the user's real browser rather than a headless poller.

## Security

**Never commit a raw capture.** DevTools exports contain `PS_TOKEN`, `PSJSESSIONID`,
`cf_clearance`, `ICSID`, and the account holder's name — live credentials for a UCalgary
account. `captures/`, `*.har`, and `*.raw.*` are gitignored. Fixtures under `tests/fixtures/`
are scrubbed by hand; `ICSID` is replaced with `REDACTED_SESSION_TOKEN=`.

When capturing: right-click the request → **Copy → Copy as fetch**, then delete the `cookie`
line before it goes anywhere.

The tool itself never sees your password. It rides a session you established by signing in
normally, which is also the only way to get past SSO + MFA.

## Layout

```
src/domain/       purge gate, term codes, transitions, cadence — no I/O, no browser
src/peoplesoft/   the wire protocol: request building, parsing, session state machine
src/watcher.ts    poll orchestration; decides notify vs assist vs auto
src/portal.ts     binds the protocol layer to fetch + the user's session
entrypoints/      background worker, offscreen timer, popup, options
tests/fixtures/   scrubbed real responses
```

`src/domain` and `src/watcher.ts` are deliberately free of browser and network dependencies —
every dependency is injected — so the rules that matter can be tested exhaustively without a
portal. `Watcher` takes a `SearchFn`; the tests hand it scripted responses.

### Why an offscreen document

MV3 service workers are torn down after ~30s idle and `chrome.alarms` will not fire faster
than every 30s, so neither can sustain a 10–20s poll. The offscreen document holds the real
timer (and gives us an audio context for the alert sound, which a service worker cannot have).
A 30s alarm acts as a resurrection heartbeat if both get torn down.
