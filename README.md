# Booking Automation API

A small practice system mirroring a real business-automation pipeline: a Google Form booking request flows through Apps Script, a Node.js/TypeScript API, Supabase (Postgres), and Slack — built to get hands-on with the stack used in production automation systems (Google Apps Script, Node.js, Workspace APIs, Postgres/Supabase, Slack).

## Data Flow

1. User submits a **Google Form** (name, email, requested date)
2. An **Apps Script installable trigger** (`onFormSubmit`) fires, reading the submitted row
3. Apps Script calls this **Express/TypeScript API** via `UrlFetchApp.fetch()`, authenticated with a shared-secret header
4. The API validates the payload, converts the date format (DD/MM/YYYY → ISO), and inserts it into **Supabase (Postgres)**
5. A **unique constraint** on `(email, requested_date)` guarantees idempotency — duplicate submissions are detected and ignored, not re-inserted
6. On successful insert, the API posts a message to **Slack** via an Incoming Webhook; a `slack_notified` flag is updated on the row once confirmed
7. A `/health` endpoint reports system status: last booking received, bookings today, and whether the last Slack notification succeeded

## Why it's built this way

- **Fault isolation**: a Slack outage never blocks a booking from being recorded — the Slack call is wrapped separately and logged on failure, never thrown back to the user
- **Idempotency at the database level**, not just application logic, via a Postgres unique constraint — safe even under race conditions
- **Row Level Security enabled** on the `bookings` table; the API uses Supabase's `service_role` key server-side (bypasses RLS by design), so the table stays protected from any other access path
- **TypeScript** on the API layer to catch field-shape mismatches (e.g., a typo in a request field) at compile time rather than as a silent runtime failure

## Stack

Google Apps Script · Node.js · TypeScript · Express · Supabase (Postgres) · Slack Incoming Webhooks

## Local Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in your own Supabase project, Slack webhook, and shared secret
3. `npm run dev`
4. POST to `/bookings` with `{ name, email, date }` and an `x-api-key` header matching `SHARED_SECRET`

## Known limitations (practice project, not production)

- Shared-secret auth is a stand-in for proper OAuth
- No automated tests yet
- Apps Script execution-time and quota limits apply (6-minute max per trigger run)