# Authentication and Authorization Design

## Goal

Deploy the private fund manager on Vercel for one administrator and a small set of friends while keeping administration authenticated and exposing each investor statement only through a revocable opaque access link.

This design deliberately treats investor portal access as possession of a private link, not identity authentication. Anyone who receives an investor's portal access ID can view that investor's read-only statement until the ID is rotated.

## Roles and Access

| Role | Authentication | Allowed Access |
| --- | --- | --- |
| Anonymous | None | `/login`, `/admin/login`, and a valid investor portal link |
| Investor link holder | Possesses a valid opaque `portal_access_id` | Read-only statement for the linked investor only |
| Admin | Admin login ID and password | All dashboard views and all financial management actions |

All fund-wide pages are admin-only, including the current dashboard, investor management, NAV, capital, trading, claims, fixed savings, settings, logs, reports, and development tools.

## User Journeys

### Admin

1. Admin visits `/admin/login`.
2. Admin submits the configured admin login ID and password.
3. The server validates the credentials and creates an expiring signed admin session cookie.
4. Admin accesses existing fund management pages and manages investor portal access IDs from the investor administration workflow.
5. Admin may rotate an investor portal access ID when a link is exposed.
6. Admin logs out, clearing the session cookie.

### Friend

1. Admin sends a friend either a private statement link or the portal access ID.
2. Friend visits `/portal/[portal_access_id]`, or enters the ID at `/login` and is redirected there.
3. The server resolves the opaque access ID to exactly one investor.
4. Friend sees only that investor's read-only statement.
5. If the link is rotated, the old URL no longer exposes the statement.

## Architecture

### Public Routes

- `/login`: accepts a portal access ID and redirects to the corresponding portal page when it exists.
- `/admin/login`: accepts the admin login ID and password and creates the admin session.
- `/portal/[portal_access_id]`: displays a read-only statement resolved by portal access ID.

The public portal route must not accept the database investor UUID as its public identifier.

### Admin Routes

The existing admin UI remains the administrative application. All existing fund-wide pages must require an admin session before fetching or rendering financial data. Because the current root layout renders administrative navigation globally, implementation must separate public/login/portal rendering from authenticated admin layout rendering so public visitors do not receive admin navigation or protected page chrome.

### Server Authorization

Authorization must be performed on the server, not only through hidden buttons or redirects:

- Every admin-only page calls a shared admin-session guard before data access.
- Every create, update, delete, settle, reverse, import, reset, and configuration server action calls the same admin-session guard.
- Data-fetching functions reachable from public pages expose only the single statement resolved from a valid portal access ID.
- Investor portal URLs do not grant access to administrative APIs or actions.

## Authentication and Session Logic

### Admin Credentials

Admin credentials are deployment configuration, not editable application records:

- `ADMIN_LOGIN_ID`: the non-secret login identifier.
- `ADMIN_PASSWORD_HASH`: a salted slow password hash produced before deployment.
- `AUTH_SESSION_SECRET`: a high-entropy signing key.

The password must never be stored or compared in plaintext. Verification occurs only on the server.

### Admin Session

After successful authentication, the server issues an admin session cookie with these properties:

- `HttpOnly`
- `Secure` in production
- `SameSite=Lax`
- `Path=/`
- Explicit expiration
- Signed using `AUTH_SESSION_SECRET`

The signed payload contains only the role and expiry required to authorize the admin request. Failed or expired signatures are treated as anonymous access.

### Investor Portal Access

Investor portal access does not create an authenticated role. The opaque portal access ID functions as a revocable bearer secret embedded in, or entered to reach, the portal URL.

The ID must be generated with cryptographically secure randomness and contain enough entropy to make enumeration impractical. It must not contain an investor name, sequential number, or database UUID.

## Data Model

Add fields to `investors`:

| Field | Purpose |
| --- | --- |
| `portal_access_id` | Unique opaque public lookup ID for the statement portal |
| `portal_access_rotated_at` | Timestamp recording issuance or rotation |

Requirements:

- `portal_access_id` is unique and non-null once an investor has portal access enabled.
- Existing investors receive generated portal access IDs through a controlled migration or admin initialization path.
- Rotation replaces the previous value atomically, immediately invalidating the old link.
- Portal lookups return no investor statement when the ID does not match an active record.

## Admin Configuration UI

Extend the existing admin-only investor management workflow rather than adding a separate settings subsystem:

- Display each investor's portal link to admin.
- Provide a generate action for any investor without a portal access ID.
- Provide a rotate action with confirmation because it invalidates an existing shared link.
- Do not expose portal access controls on any public or investor-visible page.

Creating an investor may generate a portal access ID immediately, provided it is displayed only in the authenticated admin workflow.

## Error and State Handling

- Invalid investor portal ID: show a generic unavailable/not-found response without exposing whether an investor record exists.
- Invalid admin credentials: show a generic login failure without distinguishing identifier from password failure.
- Missing production environment configuration: reject admin login and protected admin access with a server-side configuration error; do not fall back to open access.
- Expired admin session: redirect to `/admin/login`.
- Portal access rotation: old links fail immediately and the newly generated link is shown to admin.

## Security Constraints

- Investor portal access intentionally provides confidentiality only as long as the private link remains private.
- Administrative access requires password authentication and cannot be granted through a portal access ID.
- All authorization checks must occur before financial data is fetched or mutated.
- Development bypass behavior must never activate in Vercel production.
- Portal identifiers must be rate-limited or otherwise resistant to high-volume guessing if the deployed platform adds repeated invalid lookup traffic.
- Secrets are configured in Vercel environment variables and must not be committed to source control.

## Implementation Scope

The implementation plan must cover:

- Authentication/session helpers replacing production placeholder token logic in `src/lib/auth.ts`.
- Admin login and logout actions/pages.
- Public investor access entry and portal lookup by `portal_access_id`.
- Protected admin layout/routes that no longer expose fund-wide UI before authorization.
- Server-side admin enforcement for all protected reads and mutations.
- Investor portal access generation and rotation in the admin investor workflow.
- Database migration/initialization changes for portal access fields.
- Production configuration documentation for Vercel.

## Verification Requirements

Implementation verification must demonstrate:

- Anonymous access to each management page redirects or rejects access before data renders.
- Invalid admin credentials do not create a session.
- A valid admin session can access protected management workflows and mutations.
- A valid portal access ID opens only its corresponding read-only statement.
- Invalid and rotated portal access IDs no longer return statements.
- A portal visitor cannot invoke any admin mutation.
- Production mode does not permit the development authorization bypass.

