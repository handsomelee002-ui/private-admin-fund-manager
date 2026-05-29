# Private Admin Fund Manager

Private Admin Fund Manager is a self-hosted Next.js application for administering a private unit-based fund. It tracks weekly NAV snapshots, investor units, deposits, withdrawals, fixed-savings liabilities, platform trading records, profit claims, performance fees, backups, audit events, and read-only investor portal links.

This project is operational software for private fund administration. It is not investment advice, tax advice, legal advice, a public fundraising platform, or a regulated custody product.

## Features

- Weekly unit-based NAV accounting with draft and locked NAV weeks.
- Investor unit balances, market value, ownership percentage, and statement history.
- Deposits and withdrawals settled against the latest locked weekly NAV.
- Fixed-savings deposits and withdrawals tracked outside equity NAV.
- Trading platform, account, asset, transaction, and performance tracking.
- Profit claim locking and settlement with configurable brokerage/performance fee.
- Audit log and reversal workflows for supported financial records.
- Read-only investor portal links with rotation and access logging.
- Manual JSON backup export, validation, and restore.
- Development-only schema initialization and destructive seed/reset tools.
- Repeatable unit, DB feature, browser E2E, lint, typecheck, and build verification scripts.

## Accounting Model

- Equity investors own fund units.
- Weekly locked NAV is the equity accounting source of truth.
- Deposits issue units at the latest locked NAV per unit.
- Withdrawals redeem units at the latest locked NAV per unit.
- Investor ownership is current investor units divided by total active fund units.
- Fixed savings is treated as a liability book and excluded from equity NAV ownership.
- Performance fees and profit claims are tracked separately from investor unit ownership.
- Late investors do not receive gains earned before their unit issuance.

Default operating cycle:

1. Create a draft weekly NAV using Friday close valuation.
2. Review platform snapshots, gross assets, liabilities, and adjustments.
3. Lock the weekly NAV.
4. Settle deposits and withdrawals against the locked NAV.
5. Review investor statements, fees, claims, and audit logs.

## Access Model

| Path | Access | Purpose |
| --- | --- | --- |
| `/admin/login` | Public | Administrator login using configured credentials. |
| `/login` | Public | Investor portal access entry. |
| `/portal/[portal_access_id]` | Private bearer link | Read-only investor statement for the matching portal access ID. |
| `/`, `/investors`, `/nav`, `/capital`, `/trading`, `/claims`, `/fixed-savings`, `/reports`, `/settings`, `/admin-logs`, `/development` | Admin session | Administrative fund operations. |

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
- Rotate any credentials ever committed, shared, logged, or used in local testing.
- Set strong production values for all authentication and database environment variables.
- Keep `.env.local` and production secrets out of git.
- Keep `NODE_ENV=production` in production.
- Confirm destructive development tools are unavailable in production.
- Restrict database credentials to the minimum required privilege.
- Put the app behind additional network controls if possible.
- Back up the database before schema changes, restores, or releases.
- Treat portal URLs as sensitive secrets.

Do not expose this application as a multi-tenant public SaaS without redesigning authorization, tenancy, rate limiting, monitoring, data isolation, and operational controls.

## Environment Variables

Minimum database configuration uses Vercel Postgres or a compatible Neon/Postgres connection:

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

Generate the password hash and session secret locally:

```bash
node scripts/generate-auth-config.mjs "a-private-password-of-at-least-12-characters"
```

In `.env.local`, escape each `$` in `ADMIN_PASSWORD_HASH` as `\$` because Next.js expands unescaped dollar sequences in environment files. In hosted environment variable settings, use the raw hash without backslashes unless the provider explicitly requires escaping.

## Installation

Install dependencies:

```bash
npm install
```

Run the development server:

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

## First-Time Setup

1. Configure database environment variables.
2. Configure `ADMIN_LOGIN_ID`, `ADMIN_PASSWORD_HASH`, and `AUTH_SESSION_SECRET`.
3. Start the app.
4. Sign in at `/admin/login`.
5. Open `/development`.
6. Run `Initialize Database`.
7. Optionally run `Import Dummy Data` for local testing only.
8. Review `/nav`, `/capital`, `/investors`, `/trading`, `/claims`, `/fixed-savings`, `/reports`, and `/settings`.

The `/development` tools are destructive and are blocked in production.

## Investor Portal Workflow

1. Create or open an investor from `/investors`.
2. Generate or rotate the investor portal access link.
3. Share only the intended read-only portal URL with the investor.
4. Rotate the link immediately if it is exposed to the wrong person.

Portal access is not a password login. It is a private bearer link.

## Verification

Run unit tests:

```bash
npm test
```

Run destructive DB-backed feature tests:

```bash
npm run test:feature
```

Run browser E2E tests:

```bash
npm run test:e2e
```

Run lint:

```bash
npm run lint
```

Run TypeScript checks:

```bash
npm run typecheck
```

Run production build:

```bash
npm run build
```

Run the full verification suite:

```bash
npm run verify
```

`test:feature` and `test:e2e` intentionally reset, insert, update, and restore data in the configured database. Do not run them against data you need to preserve.

## Release Checklist

- `npm run verify` passes.
- Production database has a fresh backup.
- Production secrets are configured in the hosting provider.
- Local/test credentials are not reused in production.
- Anonymous admin routes redirect to `/admin/login`.
- Invalid admin credentials do not create a session.
- A valid admin can complete required operational workflows.
- Investor portal links show only the matching read-only statement.
- Rotated portal links no longer resolve.
- Development tools are blocked in production.
- Backup export and restore process is documented for the operator.

## Main Modules

- Dashboard: AUM, NAV per unit, total units, liabilities, fees, and investor summary.
- Weekly NAV: Draft, review, and lock weekly NAV snapshots.
- Investors: Investor directory, unit balances, portal links, and statements.
- Capital: Deposits and withdrawals settled against locked NAV.
- Fixed Savings: Liability ledger for fixed-savings deposits and withdrawals.
- Trading: Platform directory, transactions, assets, accounts, and performance.
- Claims: Profit claim settlement and outstanding balances.
- Brokerage: Fee configuration and bonus/payment workflows.
- Reports: Fund-level trends and summary reporting.
- Settings: Protected backup and operational tools.
- Admin Logs: Audit trail and supported reversal controls.
- Development: Local-only schema and seed/reset utilities.

## Technical Stack

- Next.js 16 App Router
- React 19
- TypeScript
- Vercel Postgres / Neon-compatible Postgres
- Tailwind CSS
- shadcn-style UI components
- Node.js built-in test runner
- Headless Chromium/Edge browser E2E harness through Chrome DevTools Protocol

## Production Limitations

- No multi-tenant isolation.
- No public self-registration.
- No payment processor integration.
- No investor password accounts.
- No formal compliance workflow.
- No automated tax reporting.
- No guarantee of regulatory suitability.

These are deliberate boundaries. Expanding beyond private administration requires a separate security and compliance design.

## License

Add a license before publishing publicly. Without a license, public source code remains copyrighted and reuse rights are unclear.
