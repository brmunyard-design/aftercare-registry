# Put Aftercare on Cloudflare (Pages)

This is **not** the old Worker that failed with `database_id`. It is a **Pages** site: static pages + Functions + the D1 database you already created (`aftercare-registry-live`).

## One-time setup (dashboard, no terminal)

1. In Cloudflare, open **Workers & Pages**.
2. If a Worker named `aftercare-registry` is still connected to GitHub and failing, open it → **Settings** → disconnect Git, or delete that Worker. Leave the D1 database alone.
3. **Create application** → **Pages** → **Connect to Git** → `brmunyard-design/aftercare-registry` → branch `main`.
4. Build settings:
   - Framework preset: **None**
   - Build command: `npm run build`
   - Build output directory: `public`
5. **Save and deploy**.

## After the first deploy

1. Project **Settings** → **Functions** (or **Bindings**) → add D1:
   - Variable name: `DB`
   - Database: `aftercare-registry-live`
2. **Settings** → **Variables and Secrets** (Production):
   - `DIRECTOR_PIN` = a short PIN coordinators type (pilot example: `246810`)
   - `SESSION_SECRET` = a long random string (anything long and private)
3. Redeploy once so the binding and secrets attach.
4. Optional: **Settings** → run the SQL from `schema.sql` against `aftercare-registry-live` if tables are still empty (Query / Execute). `CREATE TABLE IF NOT EXISTS` is safe to run twice.

Open the `*.pages.dev` URL. **Coordinator sign in** uses the PIN. Helpers use the QR / recover page.

Do **not** use “Workers” + `wrangler deploy` for this repo.
