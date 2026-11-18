# EV Charging Logger

A personal, offline-first PWA for logging EV charging sessions, cost and efficiency in ₹. Works fully offline on an iPhone home-screen app. Optional sync to **your own** Supabase project (free tier). No sign-in.

## What it does

- Logs charge sessions (date, charger type, odometer, kWh, ₹ cost, start/end SoC, notes) and maintenance entries.
- Calculates trip distance, energy used (SoC-delta method), km/kWh, and savings against a petrol benchmark, all from the raw fields.
- Dashboard: odometer, EV vs petrol spend, net savings, ₹/km, average efficiency, estimated full-charge range, breakdown by charger type, recent logs.
- Free charging: enter ₹0. The CSV importer can store ₹1 sessions as ₹0.
- CSV import with column mapping and a preview (duplicates and rejected rows are reported); CSV export with calculated columns; JSON backup. The backup reminder appears after 30 days or 10 new entries.
- Optional cloud sync to your own Supabase project, two-way, with last-write-wins on conflicts.

## Run it locally

```bash
npm install
npm run dev       # http://localhost:5173
npm test          # formula and CSV tests
npm run build     # production build into dist/
```

## Set up your own Supabase (free)

1. Create a free account at supabase.com and a new project. Save the database password.
2. Open **SQL Editor → New query**, paste the contents of `supabase/schema.sql`, and run it.
3. Open **Project Settings → API** and copy the **Project URL** and the **anon public** key.
4. In the app, go to **Settings → Cloud sync**, paste both, and tap **Connect & sync**.

Keep the anon key private. Anyone with it and the URL can read and write your project. Never use the service-role key in this app.

## Put it on GitHub Pages (free)

1. Create a repository (on a free account it must be **public**; the code contains no keys).
2. Push this folder to the `main` branch.
3. In the repo, go to **Settings → Pages**, and set **Source** to **GitHub Actions**.
4. The workflow in `.github/workflows/deploy.yml` builds and publishes on each push. The site will be at `https://<your-username>.github.io/<repo-name>/`.

## Install on iPhone

1. Open the site in **Safari**.
2. Tap **Share → Add to Home Screen**.
3. Open it from the home-screen icon, then connect your Supabase project in Settings.

Your friend follows the same steps with his own Supabase project. Each phone stores its own connection, so the two ledgers stay separate.

## Data and safety notes

- All logs live on the phone (IndexedDB). iOS may clear browser storage under pressure, so keep Supabase sync connected and export a backup now and then.
- Derived values are never stored. Changing battery, baseline or benchmark settings recalculates all history.
- Efficiency for the first trip, unlogged top-ups (next start SoC ≥ previous end SoC), and missing SoC is shown as N/A and excluded from averages.

## Project layout

```
src/calc.ts        formulas (pure functions, unit-tested)
src/csv.ts         CSV parsing, column mapping, import, export
src/db.ts          IndexedDB (Dexie) local store
src/sync.ts        Supabase push/pull
src/backup.ts      backup reminder logic, file save/share
src/App.tsx        app shell, tabs, sync scheduling
src/Dashboard.tsx  KPI cards and recent logs
src/LogSheet.tsx   add/edit entry form with live trip preview
src/SettingsView.tsx  vehicle settings, cloud connection, backup, CSV import
supabase/schema.sql   tables and policies for your Supabase project
```
