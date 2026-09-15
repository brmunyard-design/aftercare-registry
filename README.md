# Aftercare Registry — Cloudflare MVP

This is a Cloudflare Workers + React/Vite + D1 version of the Aftercare Registry concept.

## Repository layout

Upload the contents of this package directly to the repository root. The files
Cloudflare needs are deliberately at these root-relative paths:

```
src/              # React/Vite client
worker/index.ts   # Cloudflare Worker API entry point
db/schema.sql     # D1 schema
wrangler.jsonc    # Worker and D1 configuration
```

## What is included

- Public landing page
- Create a family registry
- Private family registry link
- QR-friendly registry URL
- Practical help tasks
- Supporter commitment form
- Optional phone/email
- Optional timing preference
- Recovery code for supporters
- Professional dashboard
- Status visibility
- Cloudflare D1 schema
- Single Worker API

## 1. Install

```bash
npm install
```

## 2. Create the D1 database

```bash
npx wrangler d1 create aftercare-registry-db
```

Copy the returned `database_id` into `wrangler.jsonc`.

Then apply the schema:

```bash
npx wrangler d1 execute aftercare-registry-db --remote --file=./db/schema.sql
```

For local development:

```bash
npx wrangler d1 execute aftercare-registry-db --local --file=./db/schema.sql
```

## 3. Run locally

```bash
npm run dev
```

## 4. Deploy

```bash
npm run deploy
```

Cloudflare's current recommended approach for new React full-stack applications is React + Vite + the Cloudflare Vite plugin deployed as a Worker with static assets. The project follows that structure.

## Important before real families use it

This MVP is deliberately simple. Before production use, add:

- Proper professional authentication
- Family/admin authentication rather than URL tokens alone
- Rate limiting and abuse protection
- Email/SMS notifications
- Audit logging
- Data retention/deletion rules
- Privacy policy and consent wording
- Backups/export process
- Stronger authorization around family information
- Production error monitoring

The current dashboard token is intended for a prototype, not as the final security model.

## Suggested next build

The next version should add:

1. Professional account login
2. Multiple families per organisation
3. Family edit access
4. QR code generation
5. Commitment status controls
6. "Needs professional fallback" queue
7. Notifications
8. Family-facing view showing what is covered
9. Supporter self-service via recovery code
10. Organisation branding
