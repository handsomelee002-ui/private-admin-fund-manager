# Private Admin Fund Manager

Private Admin Fund Manager is a self-hosted Next.js application for administering a private unit-based investment fund. It supports event-driven NAV accounting, platform valuations, investor units and equity performance, capital movements, fixed-savings liabilities, trading platform records, profit claims, profit performance fees, brokerage reconciliation, audit logs, JSON backups, and read-only investor portal links.

This repository is operational software for private administration. It is not investment advice, tax advice, legal advice, a public fundraising platform, a payment processor, or a regulated custody product.

## Contents

- [Features](#features)
- [Accounting Model](#accounting-model)
- [Access Model](#access-model)
- [Security Notes](#security-notes)
- [Requirements](#requirements)
- [Environment Variables](#environment-variables)
- [Installation](#installation)
- [First-Time Setup](#first-time-setup)
- [Available Scripts](#available-scripts)
- [Testing and Verification](#testing-and-verification)
- [Backup and Restore](#backup-and-restore)
- [Investor Portal](#investor-portal)
- [Project Structure](#project-structure)
- [Production Checklist](#production-checklist)
- [Limitations](#limitations)
- [License](#license)

## Features

- Event-driven unit-based NAV accounting with draft and locked NAV records.
- Platform valuations recorded independently of the NAV cycle, carried forward with staleness tracking.
- Per-platform tracking modes: `CASHFLOW` (record money in/out plus periodic value marks) and `POSITION` (value computed from holdings and latest prices).
- Investor directory with unit balances, ownership, market value, equity P&L, equity return percentage, fixed-savings balance, and statement history.
- Capital deposits and withdrawals settled against the latest locked NAV per unit.
- Fixed-savings deposits, withdrawals, interest accrual, base rates, and promotional rate periods outside equity NAV.
- Trading platform, account, asset, transaction, funding allocation, NAV snapshot, realized profit, and unrealized P&L tracking.
- Profit claim creation and settlement with configurable profit performance fee handling.
- Brokerage account reconciliation for non-equity investment P&L, profit performance fees, accrued fixed-savings interest, and bonuses.
- Audit log with supported reversal workflows and guardrails against unsafe historical mutation.
- Read-only investor portal links with rotation and access logging.
- Manual JSON backup export, validation, preview, and restore.
- Development-only schema initialization, cleanup, table drop, and high-volume dummy data import.
- Pagination and sorting across admin and portal tables.
- Unit, database feature, browser E2E, lint, typecheck, build, and full verification scripts.

## Accounting Model

- Equity investors own fund units.
- Locked NAV is the source of truth for equity unit pricing.
- Deposits issue units at the latest locked NAV per unit **on or before the movement date**.
- Withdrawals redeem units at the latest locked NAV per unit **on or before the movement date**.
- A withdrawal larger than the investor's redeemable equity is rejected, not silently reduced. Use "withdraw all" to redeem a full balance.
- Financial records may be backdated but never post-dated.
- Investor ownership is calculated from current investor units divided by total active fund units.
- Equity P&L is calculated as current equity market value minus remaining investor equity cost basis.
- Equity return percentage is calculated from equity P&L divided by remaining investor equity cost basis.
- Late investors do not receive gains from periods before their unit issuance.
- Fixed savings is treated as a liability book and excluded from equity NAV ownership.
- Fixed-savings interest accrues independently from equity units.
- Fixed-savings principal and accrued interest remain contractual liabilities even when fixed-savings-funded capital is used in platform investments.
- Platform funding can be attributed to equity, fixed savings, and brokerage sources.
- Equity-funded platform P&L flows into equity NAV.
- Fixed-savings-funded and brokerage-funded platform P&L is reported as non-equity investment P&L and reconciled through the brokerage workflow.
- Profit claims and profit performance fees are tracked separately from investor unit ownership.
- Profit claims are capped at the investor's attributable equity profit less profit already locked in existing claims.
- Locked NAV records are immutable by design.

### Platform Valuation

A platform's value is resolved for a NAV date in this order:

| Tracking mode | Source | Behaviour |
| --- | --- | --- |
| `POSITION` | `COMPUTED` | Holdings × latest price × FX, plus cash. Never stale. |
| `POSITION` | `RECORDED_FALLBACK` | Used when a held asset has no price, so a missing price never silently undervalues the platform. |
| `CASHFLOW` | `RECORDED` | A valuation dated exactly on the NAV date. |
| `CASHFLOW` | `CARRIED_FORWARD` | The most recent valuation on or before the NAV date, with its age reported. |
| Either | `NET_INVESTED_FALLBACK` | No valuation ever recorded; assumed flat rather than inventing a gain. |

Valuations dated after the NAV date are never used, so a historical NAV cannot see a future mark.

A valuation older than **30 days** is flagged stale. A platform that is both stale and **10% or more** of the fund is *material*: NAV can still be created and locked for reporting, but settling any deposit or withdrawal against it is rejected until the valuation is refreshed. Stale-but-immaterial and fresh-but-small platforms never block settlement.

Recording a valuation dated on or before an already-locked NAV is rejected, because that NAV has already priced the period.

### Operating cycle

NAV is event-driven: create one when you need to price something, not on a fixed calendar.

1. Record platform transactions as they happen (money in/out at minimum).
2. Record platform values whenever convenient — one number per `CASHFLOW` platform, prices per held asset for `POSITION` platforms.
3. When a deposit, withdrawal, or reporting date arrives, open the NAV review screen and pick the valuation date.
4. Review resolved values, staleness badges, gross assets, and adjustments. Override individual platforms only where needed.
5. Save the draft and lock it.
6. Settle deposits, withdrawals, fixed-savings movements, claims, and bonuses.
7. Review investor statements, equity performance, reports, brokerage reconciliation, and audit logs.

## Access Model

| Path | Access | Purpose |
| --- | --- | --- |
| `/admin/login` | Public | Administrator login. |
| `/login` | Public | Investor portal access ID entry. |
| `/portal/[portal_access_id]` | Private bearer link | Read-only investor statement for the matching access ID. |
| `/` | Admin session | Dashboard. |
| `/investors` | Admin session | Investor directory and portal link management. |
| `/investors/[id]` | Admin session | Investor statement and activity ledger. |
| `/nav` | Admin session | Platform values and NAV register. |
| `/capital` | Admin session | Equity cash movement ledger. |
| `/fixed-savings` | Admin session | Fixed-savings liability ledger. |
| `/fixed-savings-rates` | Admin session | Fixed-savings base and promotional rates. |
| `/trading` | Admin session | Trading platform directory, realized profit, unrealized P&L, and portfolio value. |
| `/trading/[platformId]` | Admin session | Platform transactions, snapshots, funding allocation, and performance. |
| `/claims` | Admin session | Profit claims and settlement workflow. |
| `/brokerage` | Admin session | Profit performance fee settings and non-equity reconciliation workflow. |
| `/reports` | Admin session | Fund reports, profit performance fees, platform performance, and NAV trends. |
| `/settings` | Admin session | Backup and protected data tools. |
| `/admin-logs` | Admin session | Audit history and supported reversals. |
| `/development` | Admin session | Development tooling route. |

Administrative access uses:

- `ADMIN_LOGIN_ID`
- `ADMIN_PASSWORD_HASH`
- `AUTH_SESSION_SECRET`
- Signed `HttpOnly` session cookies
- Server-side authorization checks on administrative reads and mutations

Portal links are possession-based bearer links. Anyone with a valid portal URL can view that investor's read-only statement until the link is rotated.

## Security Notes

This application handles sensitive financial records. Do not deploy it casually.

Required before public exposure:

- Use HTTPS only.
- Use a dedicated production database.
- Use production-only admin credentials and session secrets.
- Rotate any credential ever committed, shared, logged, or used in local testing.
- Keep `.env.local` and all secret files out of git.
- Confirm `NODE_ENV=production` in production.
- Confirm development data tools are unavailable in production.
- Restrict database credentials to the minimum privilege required.
- Put the app behind additional network controls where possible.
- Back up the database before schema changes, restores, imports, or releases.
- Treat backup JSON files and portal URLs as sensitive secrets.
- Review audit logs after operational changes.

Do not expose this application as a multi-tenant public SaaS without redesigning authorization, tenancy, rate limiting, monitoring, data isolation, incident response, and compliance controls.

## Requirements

- Node.js 20 or newer.
- npm.
- Vercel Postgres, Neon, or a compatible Postgres database.
- A Chromium-compatible browser for E2E tests.

The browser E2E script currently looks for Microsoft Edge or Google Chrome in common Windows install locations.

## Environment Variables

Database configuration:

```env
POSTGRES_URL=postgresql://...
POSTGRES_URL_NON_POOLING=postgresql://...
POSTGRES_USER=...
POSTGRES_HOST=...
POSTGRES_PASSWORD=...
POSTGRES_DATABASE=...
```

Administrator authentication:

```env
ADMIN_LOGIN_ID=your-private-admin-login-id
ADMIN_PASSWORD_HASH=scrypt\$generated-salt\$generated-hash
AUTH_SESSION_SECRET=generated-session-signing-secret
```

Generate the password hash and session secret:

```bash
node scripts/generate-auth-config.mjs "a-private-password-of-at-least-12-characters"
```

For `.env.local`, escape each `$` in `ADMIN_PASSWORD_HASH` as `\$` because Next.js expands unescaped dollar sequences in environment files. In hosted environment variable settings, use the raw hash without backslashes unless the provider explicitly requires escaping.

## Installation

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

On PowerShell systems that block `npm.ps1`, use `npm.cmd`:

```powershell
npm.cmd run dev
```

## First-Time Setup

1. Create and configure the Postgres database.
2. Configure the database environment variables.
3. Generate and configure `ADMIN_LOGIN_ID`, `ADMIN_PASSWORD_HASH`, and `AUTH_SESSION_SECRET`.
4. Start the app with `npm run dev`.
5. Sign in at `/admin/login`.
6. Open `/settings`.
7. Enter the admin password in the protected settings gate.
8. Run `Initialize Database`.
9. Optionally run `Import Dummy Data` for local development only.
10. Add each trading platform and choose its tracking mode (`CASHFLOW` unless you want per-asset attribution).
11. Record a starting value for every `CASHFLOW` platform.
12. Create and lock an opening NAV before recording any capital movement.
13. Review `/nav`, `/capital`, `/investors`, `/trading`, `/claims`, `/fixed-savings`, `/fixed-savings-rates`, `/brokerage`, `/reports`, `/admin-logs`, and `/settings`.

The protected data tools can delete records, drop tables, initialize schema, and import dummy data. They are destructive and are blocked in production.

## Available Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Next.js development server with hot reload. |
| `npm run build` | Build the production application. |
| `npm run start` | Start the production server from an existing build. |
| `npm test` | Run Node unit tests in `src/**/*.test.js` and `src/**/*.test.mjs`. |
| `npm run test:feature` | Run destructive database-backed feature tests with one transient DB retry. |
| `npm run test:e2e` | Run destructive browser E2E tests with one transient DB retry. |
| `npm run typecheck` | Run TypeScript type checking. |
| `npm run lint` | Run ESLint. |
| `npm run verify` | Run unit tests, feature tests, lint, typecheck, build, and E2E tests. |
| `node scripts/generate-auth-config.mjs "<password>"` | Generate admin password hash and session secret. |

Use `npm run dev` while developing. Use `npm run build` followed by `npm run start` to smoke-test production server behavior.

## Testing and Verification

Run unit tests:

```bash
npm test
```

Run database-backed feature tests:

```bash
npm run test:feature
```

Run browser E2E tests:

```bash
npm run test:e2e
```

Run the full verification suite:

```bash
npm run verify
```

`test:feature`, `test:e2e`, and `verify` are destructive. They reset, seed, insert, update, restore, and mutate the configured database. Run them only against a disposable development or test database.

The feature and E2E scripts use `scripts/run-with-retry.cjs` to retry once on transient Neon/WebSocket database failures such as unexpected connection termination.

## Backup and Restore

The Settings page provides manual JSON backup tooling:

- Export backup JSON.
- Validate a backup file before restore.
- Preview table row counts.
- Restore a validated backup with explicit confirmation.

Backup files contain financial records, investor names, portal identifiers, NAV history, claims, trading records, and audit events. Store them as secrets.

The current backup schema version is **3**. Version 2 files still restore: `platform_valuations` and `platform_transaction_allocations` come back empty, and the never-created `platform_performance` table that v2 exported is ignored.

Schema version 3 added `platform_valuations` and — importantly — `platform_transaction_allocations`, which version 2 omitted. Restoring a v2 backup therefore loses per-transaction funding-source splits, and affected platforms fall back to the legacy single-`funding_source` attribution. Re-enter allocations after restoring a v2 file if you relied on split funding.

## Investor Portal

Investor portal access is not a password login. It is a private bearer-link workflow:

1. Open an investor from `/investors`.
2. Generate or rotate the investor portal access ID.
3. Share only the intended `/portal/[portal_access_id]` URL with the investor.
4. Rotate the link immediately if it is exposed to the wrong person.

The portal renders a read-only statement for the matching investor.

## Project Structure

```text
src/app/                  Next.js App Router routes
src/actions/              Server actions for mutations and protected workflows
src/components/           UI components and forms
src/components/ui/        Shared UI primitives
src/lib/                  Accounting, database, auth, backup, sorting, and pagination utilities
scripts/                  Verification, E2E, auth config, and test runtime scripts
public/                   Static assets
```

Primary modules:

- Dashboard: fund overview, NAV per unit, units, equity P&L, equity return, fixed-savings liability, and investor summary.
- Valuations & NAV: record platform values, review resolved values with staleness, draft, lock, and list NAV records.
- Investors: directory, equity P&L, equity return, balances, portal links, and investor statements.
- Capital: equity deposits and withdrawals.
- Fixed Savings: liability ledger and interest-bearing savings activity.
- Fixed Savings Rates: base rates and promotions.
- Trading: platforms, accounts, assets, transactions, funding allocation, realized profit, unrealized P&L, snapshots, and performance.
- Claims: profit claim settlement and outstanding balances.
- Brokerage: profit performance fee configuration, non-equity investment P&L reconciliation, fixed-savings interest liability, and bonus workflows.
- Reports: platform performance, profit performance fees, and NAV history.
- Settings: protected backup and data tools.
- Admin Logs: audit trail and supported reversal controls.

## Technical Stack

- Next.js 16 App Router
- React 19
- TypeScript
- Vercel Postgres / Neon-compatible Postgres
- Tailwind CSS
- Base UI / shadcn-style components
- Recharts
- Node.js built-in test runner
- Headless Chromium/Edge E2E harness through Chrome DevTools Protocol

## Production Checklist

- `npm run verify` passes against a disposable test database.
- Production database has a fresh backup.
- Production secrets are configured in the hosting provider.
- Local and test credentials are not reused in production.
- Anonymous admin routes redirect to `/admin/login`.
- Invalid admin credentials do not create a session.
- A valid admin can complete required operational workflows.
- Investor portal links show only the matching read-only statement.
- Rotated portal links no longer resolve.
- Development tools are blocked in production.
- Backup export and restore procedure is understood by the operator.
- Database credentials have least-privilege access.
- Monitoring and backup retention are configured outside the app.

## Limitations

- No multi-tenant isolation.
- No public self-registration.
- No payment processor integration.
- No investor password accounts.
- No formal compliance workflow.
- No automated tax reporting.
- No automated market data ingestion.
- No guarantee of regulatory suitability.

These boundaries are deliberate. Expanding beyond private administration requires a separate security, compliance, and operations design.

## License

No license is currently declared. Without a license, public source code remains copyrighted and reuse rights are unclear.
