# India Racing Cycles

**DISCOVER | SHARE | RACE**

A Material Design 3-inspired cycling events, archive and news site. This project lives in the `india-racing-cycles/` folder of the existing `learndhairyash.github.io` GitHub Pages repository, so the existing portfolio homepage is not replaced.

## Website

Once the existing GitHub Pages site serves the repository's `main` branch, the site path is:

`https://learndhairyash.github.io/india-racing-cycles/`

Pages:
- `index.html` — upcoming events
- `past.html` — searchable event archive
- `news.html` — cycling news and announcements

The site uses plain HTML, CSS and JavaScript. No build step or frontend framework is required. Event and news cards are loaded from `data/events.json` and `data/news.json`. The browser can optionally use a Cloudflare Worker API by setting `window.IRC_CONFIG.apiBase` in the page HTML.

## Launch dataset

Two upcoming events were checked against their official event pages on 4 November 2026:
- Bajaj Pune Grand Tour 2027 — 26–31 January 2027. Official website: https://punegrandtour.in/
- Tour of Thekkady 2027 — 30 January 2027. Official website: https://www.tourofthekkady.com/ and registration: https://www.novarace.in/events/tour-of-thekkady-2027

Two past-event entries are clearly labelled as transcribed from the community-admin PDF screenshots. Their original post URLs were not visible in the supplied screenshots. The website does not pretend those missing links exist.

## What works in the static release

- Three separate, responsive pages with shared navigation and Material 3-style components.
- Upcoming/past event separation based on event end date.
- Search and filters for events, archive year and news.
- Original source and registration/contact links where confirmed.
- Dark/light theme preference.
- Honest poster placeholders when an original poster URL was not confirmed.
- Newsletter form correctly reports that it is not connected until a backend URL is configured. It does not claim to subscribe people without sending a confirmation email.

## Daily collection automation

The repository workflow at `.github/workflows/india-racing-cycles-daily.yml` runs once daily. The Python collector:
1. Reads configured public source pages and Google News RSS search feeds.
2. Adds cycling-relevant RSS headlines with the original link and publisher.
3. Can use Gemini to extract event/news candidates from fetched source pages.
4. Requires a source URL and date for an event; uncertain changes are sent to a review queue instead of being published.
5. Keeps existing curated entries and avoids duplicate links/IDs.

### Required GitHub Actions secrets for AI extraction

- `GEMINI_API_KEY` — Gemini API key. Without it, the RSS headline collector still runs, but AI extraction from web pages is skipped.
- Optional `IRC_ADMIN_EMAIL` — recipient for a future review digest. No review email is sent by the current static collector.

The workflow only updates JSON files when content changes. It does not log API keys.

**Important source access:** Facebook Groups, most Instagram content and LinkedIn posts do not provide unrestricted public read APIs. This project uses permitted public pages, RSS and search feeds. Do not add browser-login cookies or bypass access controls. For Meta/LinkedIn integrations, use only approved API access and required permissions.

## Cloudflare Worker backend (newsletter + database)

The Worker source is in `worker/`. It provides:
- `GET /api/events` and `GET /api/news`
- `POST /api/subscribe` — sends a double opt-in confirmation email
- `GET /api/confirm?token=...` — activates a subscriber
- `GET /api/unsubscribe?token=...` — unsubscribes a confirmed recipient
- `POST /api/admin/newsletter` — sends a newsletter to confirmed subscribers (requires a secret)

### Deploy backend

1. Install Node.js and Wrangler: `npm install -g wrangler`.
2. Create a Cloudflare D1 database named `india-racing-cycles`.
3. Copy its database ID into `worker/wrangler.toml`.
4. Run `wrangler d1 execute india-racing-cycles --remote --file worker/schema.sql`.
5. From the `india-racing-cycles/worker` folder, run `wrangler deploy`.
6. Set Worker secrets: `wrangler secret put RESEND_API_KEY`, `wrangler secret put FROM_EMAIL`, `wrangler secret put SITE_URL`, and `wrangler secret put ADMIN_API_TOKEN`.
7. Set `window.IRC_CONFIG.apiBase` in each HTML page to the deployed Worker URL.
8. Configure the Worker route/allowed origin for the GitHub Pages site and test confirmation and unsubscribe from a real mailbox.

The database ID and secrets are intentionally blank/not committed. Do not put API keys in frontend JavaScript or this public repository.

## Newsletter and monthly report

The Worker stores subscription status, confirmation and unsubscribe tokens. Only confirmed subscribers receive admin newsletter sends. A production sender domain must be verified with Resend before emails can be delivered reliably.

The monthly report can be produced from the generated JSON plus GitHub Actions run history. The initial build does not send a monthly report because no admin email or delivery channel has been configured.

## Manual test

Open the three HTML pages locally or from GitHub Pages. Test search, category/state filters, archive year filter, news filter and theme toggle. Check the original event source links. Newsletter submission should show a setup-required message until the Worker is deployed and configured.

## Source directory

- Cycling Federation of India: https://www.cfiindia.in/
- CFI event calendar: https://www.cfiindia.in/about-3
- Odisha Cycling Association events: https://odishacyclingassociation.in/events/
- Indian Cycling News: https://indiancyclingnews.com/
- Orisports: https://www.orisports.com/
- Bajaj Pune Grand Tour: https://punegrandtour.in/
- Tour of Thekkady: https://www.tourofthekkady.com/

Always check the organiser's latest notice before travel or payment.