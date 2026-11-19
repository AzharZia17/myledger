# My Ledger

A lightweight personal ledger. Transactions and settings are stored in IndexedDB first, then synchronized with Google Sheets through Google Apps Script.

## Local development

```bash
bun install
cp .env.example .env.local
bun dev
```

Set `APP_ACCESS_PASSWORD` and `GOOGLE_APPS_SCRIPT_URL` in `.env.local`. The app uses Bun for package management and scripts.

## Google Sheets and Apps Script

1. Create a Google Spreadsheet.
2. Open **Extensions → Apps Script** and paste `google-apps-script/Code.gs`.
3. Under **Project Settings → Script properties**, add `SPREADSHEET_ID` with the spreadsheet ID.
4. Deploy as a Web App executing as **Me**, then configure its access and copy the `/exec` URL.
5. Add that URL as `GOOGLE_APPS_SCRIPT_URL`.

The script initializes `Transactions` and `Settings` sheets and their headers. When changing the backend code, update the existing deployment through **Deploy → Manage deployments → Edit → New version → Deploy**. The first request after this update migrates existing transaction amounts from integer cents to currency units, records a per-row migration marker, and formats the amount column to two decimal places. The migration resumes safely if interrupted.

**Transactions:** `id, type, amount, category, source_destination, description, transaction_date, created_at, updated_at, deleted`. Transaction `amount` values are stored as currency units (for example, `250.50`), not cents. The script appends an `amount_storage` marker column after existing columns, so additional user columns are preserved.

**Settings:** `key, value`, with `opening_balance`, `currency`, and `app_name` defaults. The `opening_balance` setting remains stored as integer cents.

## Offline storage and synchronization

- App startup fetches the latest transaction snapshot and settings into IndexedDB. For older Apps Script deployments without `get_snapshot`, the app falls back to `get_transactions` and `get_settings`. A clean device waits for the initial server read before showing an empty ledger; failures are logged and shown with their error message. While open, the app refreshes from Google Sheets when returning to the foreground and at most once per minute.
- Add, edit, delete, and settings changes commit to IndexedDB before the UI reports success. The dashboard recalculates from local records immediately.
- A durable local queue retries requests with exponential backoff; the `online` event triggers an immediate sync attempt. Reopening the app also resumes pending sync.
- UUIDs make retries idempotent. Updates and deletes include the last server `updated_at`; Apps Script rejects stale edits instead of silently overwriting another device's changes. Other open devices see server changes on their next foreground refresh (or within about one minute while active).
- Conflicts remain stored locally until the user chooses the local version or the Google Sheets version. If a local add collided with a different server record, keeping the local version creates a new UUID.
- The header distinguishes offline, pending, syncing, failed, and conflict states. A record is marked synced only after the backend confirms it.

IndexedDB is scoped to this browser/device. Offline changes remain there across app restarts, but do not appear in Google Sheets or on another device until synchronization succeeds. Browser storage can still be cleared by a user or reclaimed by the OS; the app requests persistent storage where supported.

## Installable PWA

The production app includes a web manifest, app icons, standalone display metadata, an offline fallback page, and a service worker that caches the app shell, static Next.js assets, and the dashboard/history/settings pages. Install from the browser's install prompt on supported Android/desktop browsers. On iOS Safari, use **Share → Add to Home Screen**.

Service workers require HTTPS in deployment (localhost is allowed for development). A first online visit is needed to download/cache the app shell and to sign in. Browser background execution is not guaranteed: if the app is closed while offline, queued changes sync the next time it is opened with a connection.

## Deployment

Import the repository into Vercel and set `APP_ACCESS_PASSWORD` and `GOOGLE_APPS_SCRIPT_URL` as server environment variables. Redeploy after changing environment variables or Apps Script deployments.

## Security limitations

Next.js protects app routes with the password session cookie and proxies API requests server-side. The Apps Script URL itself is not authenticated by this app: anyone who learns a publicly accessible `/exec` URL may call it directly. Choose Apps Script deployment access carefully and do not use this setup for sensitive data without adding backend-to-backend authentication.

## Verification checklist

- Set opening balance to Rs. 10,000; add Rs. 5,000 income; confirm Rs. 15,000.
- Add expenses of Rs. 1,000 and Rs. 2,000; confirm Rs. 12,000.
- Edit the Rs. 2,000 expense to Rs. 1,500; confirm Rs. 12,500.
- Delete it; confirm Rs. 14,000 after reload.
- Go offline, add income/expense, reload the app, and verify data is still present and pending.
- Reconnect and verify pending transactions sync exactly once.
- Test stale edits from two devices and choose a conflict resolution.
- Test install prompt, offline navigation, and layouts on mobile and desktop.
