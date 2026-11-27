# Deploying GG Attention to ggattention.app

GG runs as one Node service plus a PostgreSQL database. The service serves the API
(`/api`), the marketplace (`/`) and the brand site (`/ggs-brand-site/`). Any host that
runs a Docker container and offers Postgres works (Railway, Render, Fly.io, a VPS).

## 1. What you need

- A host that builds from the `Dockerfile` in this repo.
- A PostgreSQL database (most hosts offer one; copy its connection string).
- Access to the DNS settings of ggattention.app at your domain registrar.

## 2. Environment variables

Set these on the host as secrets. `.env.example` lists every name.

| Name | Value |
| --- | --- |
| `DATABASE_URL` | Postgres connection string from your host |
| `SESSION_SECRET` | New random string, `openssl rand -hex 32` |
| `PRIVY_APP_ID` | `cmuy2gr1500570dl5gzd38b44` |
| `PRIVY_ADMIN_USER_IDS` | `did:privy:cmuy3rkr102130cl6zr8nvo6x` (add more, comma separated) |
| `FRONTEND_ORIGINS` | `https://ggattention.app` (add `https://www.ggattention.app` if used) |
| `TRUST_PROXY_HOPS` | `1` |
| `CELO_REWARD_POOL_*` | Copy from `.env.example` (test network values) |
| `PORT` | Whatever port the host expects. The image defaults to 8080 |

Build argument (not a runtime variable): `VITE_PRIVY_APP_ID=cmuy2gr1500570dl5gzd38b44`.
On most hosts this is set in the same place as environment variables, flagged as a
build variable. It is public by design.

## 3. First deploy

1. Create the service from this GitHub repo (it detects the `Dockerfile`).
2. Add the Postgres database and set `DATABASE_URL`.
3. Add the variables above and the build argument, then deploy.
4. Create the tables once, from the host's shell or a one-off command:
   `pnpm --filter @workspace/db run push`
5. Check `https://<host-url>/api/healthz` returns OK, then open the host URL.

## 4. Point ggattention.app at it

1. In the host, add the custom domain `ggattention.app`. It shows the DNS records to create.
2. At the registrar, remove the old records that point to Replit, then add the records the host gave you (usually a CNAME for `www` and an A/ALIAS record for the root).
3. Wait for DNS and the HTTPS certificate (minutes to a few hours).

## 5. Privy settings for the new domain

In the Privy dashboard for the app, add `https://ggattention.app` to the allowed
domains/origins. If Google login is on, add the new domain's redirect URL to the Google
OAuth client. Sign-in fails until this is done.

## 6. Data from Replit

If the old Replit database is still reachable, export it before it goes away:
`pg_dump "$OLD_DATABASE_URL" > gg-backup.sql`, then load it into the new database with
`psql "$DATABASE_URL" < gg-backup.sql` before step 4. If it is not reachable, the app
starts with an empty database. Campaigns on the test network can be recreated.

## 7. Notes

- Everything on the CELO side is Celo Sepolia (test network). Mainnet pools are not deployed and the contract is not audited.
- The container is stateless. All data is in Postgres, so redeploys are safe.
- Keep secrets out of the repo. Rotate `SESSION_SECRET` if it is ever exposed.
