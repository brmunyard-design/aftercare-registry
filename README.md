# Aftercare Registry — Cloudflare MVP

The live database is already wired in `wrangler.jsonc`:

- Binding: `DB`
- Database: `aftercare-registry-live`
- ID: `19f619ce-c7c8-44e7-8ce9-9404eb8f339f`

Tables are created automatically the first time `/api/*` is used. You do not need to run a separate migration command.

## Deploy

If this GitHub repo is connected to the Cloudflare Worker named `aftercare-registry`, a push to `main` rebuilds it.

In the Cloudflare dashboard, the D1 binding named `DB` must point at **aftercare-registry-live**, not `aftercare-registry-db` (that name does not exist).

## Local

```bash
npm install
npm run dev
```
