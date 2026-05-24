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
- `Investor Portal`: Read-only investor-facing statement accessed through a private opaque link.

## Authentication And Authorization

The application implements two access paths:

| Path | Access | Behavior |
| --- | --- | --- |
| `/admin/login` | Public login page | Accepts the configured administrator ID and password and creates a signed admin session. |
| `/login` | Public portal entry page | Accepts an investor portal access ID and navigates to its statement link. |
| `/portal/[portal_access_id]` | Possession-based read access | Shows only the statement associated with a valid opaque portal access ID. |
| `/`, `/investors`, `/nav`, `/capital`, `/trading`, `/claims`, `/fixed-savings`, `/reports`, `/settings`, `/admin-logs`, `/development` | Admin session only | Redirects unauthenticated visitors to `/admin/login`. |

Administrative authentication:

- The administrator signs in with `ADMIN_LOGIN_ID` and the plaintext password originally used to generate `ADMIN_PASSWORD_HASH`.
- The server verifies the password against its `scrypt` hash and creates an expiring signed `HttpOnly` session cookie.
- All financial read and mutation server actions require the administrator session, not merely the visible dashboard layout.
- The navigation bar includes `Log out`, which clears the administrator session.

Investor statement access:

- A new investor is assigned a random `portal_access_id` when created from the administrator interface.
- Existing investors can be assigned a link with `Generate` in the `Portal` column on `/investors`.
- `Copy` supplies the private read-only link to send to the friend; `Open` previews it.
- `Rotate` invalidates the previous link and generates a replacement.
- Portal links are not user authentication: anyone holding a valid link can view that statement.

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

The `investors` table also stores:

- `portal_access_id`: a unique opaque identifier for a read-only statement link.
- `portal_access_rotated_at`: the last issue/rotation timestamp for that link.

Legacy tables may still exist in an old development database, but they are not the accounting source of truth for the redesigned pages and are included in the development cleaner.

## Development Data Tools

The `Development` page contains bootstrap and destructive data utilities:

- `Initialize Database`: Creates the required schema and restores baseline configuration without running schema checks during normal page renders.
- `Import Dummy Data`: Deletes all resettable financial/configuration data and seeds sample investors, NAV weeks, unit ledgers, fixed-savings records, and fee examples.
- `Clean All Data`: Deletes fresh-model records, legacy capital/trading records, profit claims, bonus logs, platform records, cash balances, audit events, and brokerage-fee configuration, then restores the default brokerage fee.

These actions are blocked whenever `NODE_ENV=production`.

They also require admin authorization and a typed confirmation phrase:

- `IMPORT DUMMY DATA`
- `INITIALIZE DATABASE`
- `DELETE ALL FUND DATA`

Never expose these tools in production without an explicit operational reason.

## Security Requirements

This application handles financial records. Treat Server Actions as public mutation endpoints.

Required controls:

- Rotate any database credentials previously stored in `.env.local`.
- Use password-authenticated administrator sessions for all administrative access.
- Authorize every financial mutation server-side.
- Treat `/portal/[portal_access_id]` as a read-only private bearer link and rotate it if exposed.
- Keep development seed/reset tools disabled in production.
- Do not send portal links to anyone who should not view the associated statement.

Local and production administration require the same signed-session authentication configuration; there is no development authorization bypass.

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

Administrator authentication configuration:

```env
ADMIN_LOGIN_ID=your-private-admin-login-id
ADMIN_PASSWORD_HASH=scrypt\$generated-salt\$generated-hash
AUTH_SESSION_SECRET=generated-session-signing-secret
```

`ADMIN_LOGIN_ID` is a private identifier chosen by the administrator. Generate the password hash and signing-secret values locally:

```bash
node scripts/generate-auth-config.mjs "a-private-password-of-at-least-12-characters"
```

Example `.env.local` structure:

```env
ADMIN_LOGIN_ID=admin-inxcllee
ADMIN_PASSWORD_HASH=scrypt\$<generated-salt>\$<generated-hash>
AUTH_SESSION_SECRET=<generated-random-secret>
```

The password entered at `/admin/login` is the same plaintext password supplied to `generate-auth-config.mjs`; do not save that plaintext password in the environment file. In `.env.local`, each `$` in `ADMIN_PASSWORD_HASH` must be escaped as `\$` because Next.js expands unescaped dollar sequences in environment files. Place the generated local values and `ADMIN_LOGIN_ID` in ignored `.env.local`; when entering `ADMIN_PASSWORD_HASH` directly in Vercel project environment settings, use the raw hash without the two backslashes.

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

1. Configure `ADMIN_LOGIN_ID`, `ADMIN_PASSWORD_HASH`, and `AUTH_SESSION_SECRET` in `.env.local`.
2. Open `/admin/login` and sign in.
3. Open `/development`.
4. Type `INITIALIZE DATABASE`.
5. Click `Initialize Database`.
6. Type `IMPORT DUMMY DATA` when sample local data is required.
7. Click `Import Dummy Data`.
8. Review `/nav`, `/capital`, `/investors`, and `/reports`.

From `/investors`, generate or rotate an investor's portal link and send that private read-only link to the intended friend; possession of that link grants statement visibility until rotation.

Example portal workflow:

1. Admin creates `Alice Tan` from `/investors`.
2. The app stores an opaque portal identifier, such as `0wGnPq...`, against Alice's record.
3. Admin uses `Copy` and sends a URL shaped like `http://localhost:3000/portal/0wGnPq...`.
4. Alice sees only the read-only investor statement for the record tied to that URL.
5. Admin uses `Rotate` if the link is shared accidentally; the former link no longer resolves.

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

Required verification before deployment:

- Confirm anonymous visits to admin pages redirect to `/admin/login`.
- Confirm invalid administrator credentials do not create a session.
- Confirm a valid administrator session can use required dashboard operations and can log out.
- Confirm a generated investor portal link opens its corresponding read-only statement.
- Confirm a rotated investor portal link invalidates the previous link.
- Confirm `npm test`, `npm run lint`, and `npm run build` pass before deploying.

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

- Review every Server Action when adding new financial workflows.
- Keep destructive data tools behind production gates.
- Use database backups before any schema reset or destructive operation.
- Maintain audit events for NAV locks, cash movements, fixed-savings records, seed imports, and data wipes.
- Run schema initialization explicitly from `/development` or a deployment bootstrap job; normal page renders do not create or alter tables.
- Financial pages are forced to dynamic rendering so database-backed views are resolved at request time instead of being prerendered during `next build`.
