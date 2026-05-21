# Private Admin Fund Manager

Private Admin Fund Manager is a Next.js admin application for managing a private fund with weekly unit-based NAV accounting, investor unit balances, fixed-savings liabilities, and development-only seed/reset utilities.

The current accounting model is a fresh start. Legacy capital-ratio records, monthly NAV assumptions, profit-claim IOUs, and platform-ledger ownership calculations are no longer the source of truth.

## Core Accounting Model

- Equity investors own fund units.
- Weekly NAV is the only equity accounting source of truth.
- Deposits issue units at a locked weekly NAV per unit.
- Withdrawals redeem units at a locked weekly NAV per unit.
- Investor ownership is calculated from current unit balance divided by total fund units.
- Fixed savings is a liability book and is excluded from equity NAV ownership.
- Performance fees are tracked separately from investor unit ownership.

Default operating cycle:

1. Admin creates a draft weekly NAV using Friday close valuation.
2. Admin reviews gross assets, liabilities, and adjustments.
3. Admin locks the weekly NAV.
4. Deposits and withdrawals settle against the locked NAV, normally on Monday.

## Main Modules

- `Dashboard`: Latest AUM, NAV per unit, total units, fixed-savings liability, and investor unit balances.
- `Weekly NAV`: Create, review, and lock weekly NAV snapshots.
- `Investors`: Manage investors and review unit ownership.
- `Capital`: Settle deposits and withdrawals against locked NAV weeks.
- `Fixed Savings`: Record fixed-savings deposits and withdrawals as liabilities.
- `Reports`: NAV trend, AUM, units, fees, and fixed-savings liability.
- `Development`: Import dummy data or clean all financial/configuration data in development.
- `Investor Portal`: Investor-facing statement for unit balance, market value, ownership, and fixed savings.

## Fresh Schema

The application creates and uses these fresh-model tables:

- `investors`
- `nav_weeks`
- `investor_unit_ledger`
- `cash_movements`
- `fixed_savings_accounts`
- `fixed_savings_ledger`
- `performance_fees`
- `audit_events`

Legacy tables may still exist in an old development database, but they are not the accounting source of truth for the redesigned pages and are included in the development cleaner.

## Development Data Tools

The `Development` page contains bootstrap and destructive data utilities:

- `Initialize Database`: Creates the required schema and restores baseline configuration without running schema checks during normal page renders.
- `Import Dummy Data`: Deletes all resettable financial/configuration data and seeds sample investors, NAV weeks, unit ledgers, fixed-savings records, and fee examples.
- `Clean All Data`: Deletes fresh-model records, legacy capital/trading records, profit claims, bonus logs, platform records, cash balances, audit events, and brokerage-fee configuration, then restores the default brokerage fee.

These actions are blocked unless:

- `NODE_ENV !== "production"`, or
- `ALLOW_DEV_DATA_TOOLS=true`

They also require admin authorization and a typed confirmation phrase:

- `IMPORT DUMMY DATA`
- `INITIALIZE DATABASE`
- `DELETE ALL FUND DATA`

Never expose these tools in production without an explicit operational reason.

## Security Requirements

This application handles financial records. Treat Server Actions as public mutation endpoints.

Required controls:

- Rotate any database credentials previously stored in `.env.local`.
- Use role-based authentication for production admin and investor access.
- Authorize every financial mutation server-side.
- Enforce investor-level authorization on `/portal/[investor_id]`.
- Keep development seed/reset tools disabled in production.
- Do not rely on obscured URLs as access control.

The current development fallback allows local admin access when `NODE_ENV !== "production"` to keep local workflows usable. Production deployments must provide real session/auth integration and secrets.

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

Optional development flag:

```env
ALLOW_DEV_DATA_TOOLS=true
```

Optional production admin token fallback:

```env
ADMIN_ACCESS_TOKEN=replace-with-secure-random-token
```

Do not commit real credentials.

## Local Development

Install dependencies:

```bash
npm install
```

Run the app:

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

Recommended first local workflow:

1. Open `/development`.
2. Type `INITIALIZE DATABASE`.
3. Click `Initialize Database`.
4. Type `IMPORT DUMMY DATA`.
5. Click `Import Dummy Data`.
6. Review `/nav`, `/capital`, `/investors`, and `/reports`.

## Verification

Run accounting tests:

```bash
npm test
```

Run lint:

```bash
npm run lint
```

Run production build:

```bash
npm run build
```

Expected verification at the time of this redesign:

- Accounting tests cover unit issuance, unit redemption, full exit, negative NAV, late-investor isolation, rounding, and fixed-savings interest.
- Lint passes for active application code.
- Production build passes under Next.js 16.

## Accounting Examples

Deposit:

```text
Locked NAV per unit: RM 1.250000
Investor deposit: RM 5,000.00
Units issued: 4,000.000000
```

Withdrawal:

```text
Locked NAV per unit: RM 1.250000
Investor requests: RM 3,125.00
Units redeemed: 2,500.000000
Cash paid: RM 3,125.00
```

Late investor protection:

```text
Founder deposits RM 10,000.00 at NAV 1.000000 and receives 10,000 units.
Fund rises to RM 12,000.00, so NAV becomes 1.200000.
Late investor deposits RM 6,000.00 and receives 5,000 units.
Late investor does not receive the founder's prior RM 2,000.00 gain.
```

## Technical Stack

- Next.js 16 App Router
- React 19
- TypeScript
- Vercel Postgres / Neon-compatible Postgres
- Tailwind CSS
- shadcn-style UI components
- Node.js built-in test runner

## Production Notes

- Replace the development auth fallback with real role-based sessions before handling real investor data.
- Review every Server Action when adding new financial workflows.
- Keep destructive data tools behind production gates.
- Use database backups before any schema reset or destructive operation.
- Maintain audit events for NAV locks, cash movements, fixed-savings records, seed imports, and data wipes.
- Run schema initialization explicitly from `/development` or a deployment bootstrap job; normal page renders do not create or alter tables.
- Financial pages are forced to dynamic rendering so database-backed views are resolved at request time instead of being prerendered during `next build`.
