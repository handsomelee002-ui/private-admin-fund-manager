# Authentication and Authorization Implementation Plan

> **For agentic workers:** Execute this plan task-by-task without Git operations; the project owner explicitly excluded staging and commits from this work.

**Goal:** Add password-authenticated admin access and revocable read-only investor portal links while supporting local execution now and Vercel deployment later.

**Architecture:** Public pages live outside the admin shell and expose only login and opaque-link investor statements. Administrative pages and actions use a signed admin session cookie validated on the server, while each investor portal link resolves a cryptographically generated `portal_access_id` to one read-only statement.

**Tech Stack:** Next.js 16 App Router, TypeScript, React server actions, `@vercel/postgres`, Node `crypto`, Zod, local `.env.local` configuration followed by Vercel environment configuration.

---

## File Map

| File | Responsibility |
| --- | --- |
| `src/lib/auth.ts` | Admin credential verification, signed cookie sessions, route guard, portal ID generation. |
| `src/actions/auth.ts` | Admin login/logout server actions and validation responses. |
| `src/app/layout.tsx` | Root HTML/theme only, with no protected navigation. |
| `src/app/(admin)/layout.tsx` | Authenticated admin shell rendering `Sidebar` and `Navbar`. |
| `src/app/(admin)/**/page.tsx` | Existing protected pages moved into the admin route group without changing URLs. |
| `src/app/(public)/admin/login/page.tsx` | Public admin login page. |
| `src/app/(public)/login/page.tsx` | Public investor access-ID entry page. |
| `src/app/(public)/portal/[portal_access_id]/page.tsx` | Public read-only portal page using opaque access lookup. |
| `src/actions/investors.ts` | Admin-only investor access ID generation/rotation actions. |
| `src/components/PortalAccessControl.tsx` | Admin UI for viewing and rotating an investor portal link. |
| `src/lib/fundDb.ts` | Investor table columns and read-only lookup by portal access ID. |
| `src/actions/{capital,fixedSavings,profitClaims,settings,trading}.ts` | Missing server-side admin guards for protected operations and reads. |
| `src/app/api/init-db/route.ts` | Remove obsolete GET-based database mutation endpoint. |
| `.env.example` | Non-secret documentation for local and Vercel auth variables. |
| `scripts/generate-auth-config.mjs` | Local-only generator for password hash and session secret values. |

## Local-First Configuration Decision

- Local development must use real admin login once this feature is enabled; the existing automatic `NODE_ENV !== "production"` admin bypass must be removed.
- Local secrets belong in ignored `.env.local`, using the same names that will later be entered in Vercel project settings.
- Investor portal pages remain bearer-link access by explicit decision: an opaque link is read-only but can be shared by its recipient.
- No third-party auth service or runtime authentication dependency is required.

### Task 1: Replace the placeholder authorization core

**Files:**
- Modify: `src/lib/auth.ts`
- Create: `scripts/generate-auth-config.mjs`
- Create: `.env.example`

- [ ] **Step 1: Define authentication configuration and session primitives in `src/lib/auth.ts`**

Replace token comparison and development bypass logic with server-only helpers:

```ts
import "server-only";
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const ADMIN_COOKIE = "fund_admin_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12;

type AdminSession = {
  role: "admin";
  expiresAt: number;
};

function requiredEnv(name: "ADMIN_LOGIN_ID" | "ADMIN_PASSWORD_HASH" | "AUTH_SESSION_SECRET") {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required authentication configuration: ${name}.`);
  return value;
}

function sign(payload: string) {
  return createHmac("sha256", requiredEnv("AUTH_SESSION_SECRET")).update(payload).digest("base64url");
}

export function verifyAdminPassword(password: string) {
  const configured = requiredEnv("ADMIN_PASSWORD_HASH");
  const [scheme, salt, expected] = configured.split("$");
  if (scheme !== "scrypt" || !salt || !expected) return false;
  const actual = scryptSync(password, Buffer.from(salt, "base64url"), 64);
  const expectedBytes = Buffer.from(expected, "base64url");
  return expectedBytes.length === actual.length && timingSafeEqual(actual, expectedBytes);
}

export function validateAdminCredentials(loginId: string, password: string) {
  const expectedId = requiredEnv("ADMIN_LOGIN_ID");
  const submitted = Buffer.from(loginId);
  const expected = Buffer.from(expectedId);
  const idMatches = submitted.length === expected.length && timingSafeEqual(submitted, expected);
  return idMatches && verifyAdminPassword(password);
}

export async function createAdminSession() {
  const session: AdminSession = {
    role: "admin",
    expiresAt: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  (await cookies()).set(ADMIN_COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_TTL_SECONDS,
    path: "/",
  });
}

export async function clearAdminSession() {
  (await cookies()).delete(ADMIN_COOKIE);
}

export async function isAdminSessionValid() {
  const raw = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!raw) return false;
  const [payload, signature] = raw.split(".");
  if (!payload || !signature) return false;
  const submitted = Buffer.from(signature);
  const expected = Buffer.from(sign(payload));
  if (submitted.length !== expected.length || !timingSafeEqual(submitted, expected)) return false;
  const session = JSON.parse(Buffer.from(payload, "base64url").toString()) as AdminSession;
  return session.role === "admin" && session.expiresAt > Math.floor(Date.now() / 1000);
}

export async function requireAdmin() {
  if (!(await isAdminSessionValid())) redirect("/admin/login");
  return { id: "admin", role: "admin" as const, name: "Admin" };
}

export function generatePortalAccessId() {
  return randomBytes(24).toString("base64url");
}
```

- [ ] **Step 2: Add a local configuration generator**

Create `scripts/generate-auth-config.mjs` using only Node built-ins so credentials are not hand-hashed:

```js
import { randomBytes, scryptSync } from "node:crypto";

const password = process.argv[2];
if (!password || password.length < 12) {
  console.error("Usage: node scripts/generate-auth-config.mjs <admin-password-of-at-least-12-characters>");
  process.exit(1);
}

const salt = randomBytes(16);
const hash = scryptSync(password, salt, 64);
console.log(`ADMIN_PASSWORD_HASH=scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`);
console.log(`AUTH_SESSION_SECRET=${randomBytes(32).toString("base64url")}`);
```

- [ ] **Step 3: Document non-secret configuration names**

Create `.env.example` without actual credentials:

```dotenv
POSTGRES_URL=
ADMIN_LOGIN_ID=
ADMIN_PASSWORD_HASH=
AUTH_SESSION_SECRET=
```

- [ ] **Step 4: Manually prepare local credentials**

Run locally when implementing:

```powershell
node scripts/generate-auth-config.mjs "choose-a-private-admin-password"
```

Expected: output contains one `ADMIN_PASSWORD_HASH=` line and one `AUTH_SESSION_SECRET=` line; put generated values plus `ADMIN_LOGIN_ID` into ignored `.env.local`, never into `.env.example`.

### Task 2: Add admin login and logout flows

**Files:**
- Create: `src/actions/auth.ts`
- Create: `src/app/(public)/admin/login/page.tsx`
- Modify: `src/components/Navbar.tsx`

- [ ] **Step 1: Add validated auth actions**

Create `src/actions/auth.ts`:

```ts
"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import {
  clearAdminSession,
  createAdminSession,
  validateAdminCredentials,
} from "@/lib/auth";

type LoginState = { error?: string };

const loginSchema = z.object({
  loginId: z.string().trim().min(1),
  password: z.string().min(1),
});

export async function loginAdmin(_: LoginState, formData: FormData): Promise<LoginState> {
  const result = loginSchema.safeParse({
    loginId: formData.get("loginId"),
    password: formData.get("password"),
  });
  if (!result.success || !validateAdminCredentials(result.data.loginId, result.data.password)) {
    return { error: "Invalid administrator credentials." };
  }
  await createAdminSession();
  redirect("/");
}

export async function logoutAdmin() {
  await clearAdminSession();
  redirect("/admin/login");
}
```

- [ ] **Step 2: Implement `/admin/login` as a public accessible form**

Create a client form page using `useActionState(loginAdmin, {})`, labeled inputs for `loginId` and `password`, disabled submit state, and generic error rendering. It must render without `Sidebar` or `Navbar`.

- [ ] **Step 3: Add logout to authenticated navigation**

Add a small form in `Navbar` posting to `logoutAdmin` so a valid session can be explicitly cleared.

- [ ] **Step 4: Manually check admin login locally**

With local auth environment values configured, check:

```text
/admin/login with incorrect password -> generic error and remains logged out
/admin/login with correct credentials -> redirect to /
Logout -> redirect to /admin/login and / no longer loads without signing in
```

### Task 3: Separate protected admin UI from public UI

**Files:**
- Modify: `src/app/layout.tsx`
- Create: `src/app/(admin)/layout.tsx`
- Move: `src/app/page.tsx` to `src/app/(admin)/page.tsx`
- Move: `src/app/{admin-logs,capital,claims,development,fixed-savings,investors,nav,reports,settings,trading}/**/page.tsx` to matching `src/app/(admin)/...` paths
- Keep/Create: `src/app/(public)/admin/login/page.tsx`
- Move: `src/app/portal/[investor_id]/page.tsx` to `src/app/(public)/portal/[portal_access_id]/page.tsx`

- [ ] **Step 1: Reduce the root layout to shared document concerns**

Remove `Sidebar` and `Navbar` from `src/app/layout.tsx`; retain metadata, font, global CSS, theme provider, and the page `children`.

- [ ] **Step 2: Introduce the authenticated admin shell**

Create `src/app/(admin)/layout.tsx`:

```tsx
import { Navbar } from "@/components/Navbar";
import { Sidebar } from "@/components/Sidebar";
import { requireAdmin } from "@/lib/auth";

export default async function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await requireAdmin();

  return (
    <div className="min-h-screen bg-background flex">
      <Sidebar />
      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        <Navbar />
        <div className="flex-1 overflow-y-auto p-8">{children}</div>
      </main>
    </div>
  );
}
```

- [ ] **Step 3: Move current management pages under the route group**

Move existing admin page modules into `(admin)` with their same URL segments; Next.js route groups do not alter public URLs, so `/trading` remains `/trading` while it is now protected by the admin layout.

- [ ] **Step 4: Confirm public rendering boundaries**

Check locally:

```text
/admin/login -> renders login UI without admin sidebar
/portal/<valid-id> -> renders portal UI without admin sidebar
/ -> redirects to /admin/login when no session exists
```

### Task 4: Add opaque investor portal IDs and portal access flow

**Files:**
- Modify: `src/lib/fundDb.ts`
- Modify: `src/actions/investors.ts`
- Create: `src/app/(public)/login/page.tsx`
- Modify: `src/app/(public)/portal/[portal_access_id]/page.tsx`

- [ ] **Step 1: Extend database initialization for portal access**

In the existing investor table initialization flow in `src/lib/fundDb.ts`, add columns and a unique index:

```ts
await sql`ALTER TABLE investors ADD COLUMN IF NOT EXISTS portal_access_id TEXT`;
await sql`ALTER TABLE investors ADD COLUMN IF NOT EXISTS portal_access_rotated_at TIMESTAMPTZ`;
await sql`
  CREATE UNIQUE INDEX IF NOT EXISTS investors_portal_access_id_key
  ON investors (portal_access_id)
  WHERE portal_access_id IS NOT NULL
`;
```

Portal IDs remain nullable until the admin generates them for existing local investors.

- [ ] **Step 2: Resolve portal access IDs without exposing internal UUID routes**

Add `getInvestorStatementByPortalAccessId(portalAccessId: string)`:

```ts
export async function getInvestorStatementByPortalAccessId(portalAccessId: string) {
  const result = await sql`
    SELECT id
    FROM investors
    WHERE portal_access_id = ${portalAccessId}
    LIMIT 1
  `;
  const investorId = result.rows[0]?.id;
  return investorId ? getInvestorStatement(investorId) : null;
}
```

- [ ] **Step 3: Add admin-only generation and rotation actions**

In `src/actions/investors.ts`, import `generatePortalAccessId` and add:

```ts
export async function rotateInvestorPortalAccess(id: string) {
  await requireAdmin();
  const portalAccessId = generatePortalAccessId();
  await sql`
    UPDATE investors
    SET portal_access_id = ${portalAccessId}, portal_access_rotated_at = NOW()
    WHERE id = ${id}
  `;
  revalidatePath("/investors");
  revalidatePath(`/investors/${id}`);
  return { success: true, portalAccessId };
}
```

When adding a new investor, generate and insert `portal_access_id` in the same insert operation so each newly created record has immediate portal access.

- [ ] **Step 4: Implement access-ID entry page**

Create `/login` with a labeled `portalAccessId` input. On submission, normalize with `trim()`, then redirect to `/portal/${encodeURIComponent(portalAccessId)}`; the portal page handles invalid IDs with a generic not-found state.

- [ ] **Step 5: Switch portal rendering to opaque lookup**

In the moved portal page, remove `requireInvestorAccess(investor_id)` and direct UUID lookup, then load:

```ts
const { portal_access_id } = await params;
const statement = await getInvestorStatementByPortalAccessId(portal_access_id);
if (!statement) notFound();
```

The portal page remains display-only and imports no admin actions or mutation components.

### Task 5: Add portal-link controls to investor administration

**Files:**
- Create: `src/components/PortalAccessControl.tsx`
- Modify: `src/app/(admin)/investors/page.tsx`
- Modify: `src/app/(admin)/investors/[id]/page.tsx`
- Modify: `src/lib/fundDb.ts`

- [ ] **Step 1: Include portal access metadata in admin investor reads**

Extend the admin investor query result with `portal_access_id` and `portal_access_rotated_at`; do not add either field to portal statement output.

- [ ] **Step 2: Add a focused admin component**

Create `PortalAccessControl` that:

- Builds `${window.location.origin}/portal/${portalAccessId}` only in the client for displaying the shareable URL.
- Renders `Generate link` when the record has no access ID.
- Renders `Rotate link` with a confirmation message when a link exists.
- Calls `rotateInvestorPortalAccess` and updates the visible result only after success.

- [ ] **Step 3: Render controls only in admin investor pages**

Add the component in the authenticated investor list or detail view; it must not appear in the public portal.

- [ ] **Step 4: Manually validate rotation**

Check:

```text
Generate/rotate link as admin -> newly shown link opens the correct statement
Open the previous link after rotation -> generic not-found state
Open an access link while logged out as admin -> statement is still read-only and has no admin controls
```

### Task 6: Enforce server-side admin authorization across financial operations

**Files:**
- Modify: `src/actions/capital.ts`
- Modify: `src/actions/fixedSavings.ts`
- Modify: `src/actions/profitClaims.ts`
- Modify: `src/actions/settings.ts`
- Modify: `src/actions/trading.ts`
- Modify: `src/actions/adminLogs.ts`
- Delete: `src/app/api/init-db/route.ts`

- [ ] **Step 1: Guard exported admin data reads**

At the start of exported functions used only by management pages, add:

```ts
await requireAdmin();
```

This applies to fund-wide capital, fixed-savings, claim, setting, trading, platform-detail, and audit-log reads. Do not apply it to the new read-only portal statement lookup.

- [ ] **Step 2: Guard every unprotected mutation**

Add `await requireAdmin()` before validation or database writes in unguarded operations, including:

```text
addCapitalRecord
deleteCapitalRecord
addFixedSavingsRecord
addProfitClaim
settleClaim
deleteClaim
updateBrokerageFeeRate
addBonusPayment
addPlatform
updatePlatformName
deletePlatform
addPlatformTransaction
```

Existing guarded actions remain guarded exactly once.

- [ ] **Step 3: Remove GET-based database initialization**

Remove `src/app/api/init-db/route.ts`; schema initialization remains available only through the existing authenticated Development-page server action because retaining a state-changing `GET` endpoint permits cross-site trigger requests from an authenticated browser.

- [ ] **Step 4: Review direct SQL in pages**

Move any SQL still executed directly in authenticated pages, such as settings report queries, behind server helpers that call `requireAdmin()`, or ensure the page itself calls `requireAdmin()` before query execution even though the parent layout is protected.

### Task 7: Local and Vercel deployment guidance

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document local operation**

Add concise setup instructions:

```powershell
node scripts/generate-auth-config.mjs "<private-admin-password>"
npm run dev
```

Document that `ADMIN_LOGIN_ID`, the generated `ADMIN_PASSWORD_HASH`, and `AUTH_SESSION_SECRET` are entered in ignored `.env.local`, along with the existing Postgres configuration.

- [ ] **Step 2: Document Vercel environment setup**

State that the same three variables must be set in Vercel environment settings before deployment, and that no plaintext admin password is configured in Vercel or source control.

- [ ] **Step 3: Document investor privacy limitation**

State directly that portal access is read-only private-link access: anyone with a link can view its associated statement until the admin rotates the link.

### Task 8: Verification After Implementation

**Files:**
- No source changes expected unless a verification failure identifies a defect.

- [ ] **Step 1: Run static and existing project checks only when execution is authorized**

Commands:

```powershell
npm run lint
npm test
npm run build
```

Expected: each exits successfully; `npm run build` confirms the new App Router route groups and server-only imports compile for deployment.

- [ ] **Step 2: Perform local authorization checks**

Check in a local browser:

```text
Anonymous /, /investors, /trading, /settings, /admin-logs and /api/init-db do not reveal or mutate financial data.
Wrong admin ID/password produces only a generic error.
Correct admin login permits dashboard reads and a chosen safe admin workflow.
Logout invalidates subsequent admin access.
Generated investor link returns only its linked statement.
Rotated investor link invalidates the old link.
Portal pages contain no mutation controls and cannot submit admin actions.
```

- [ ] **Step 3: Confirm production-mode bypass removal**

Search:

```powershell
rg -n "ALLOW_DEV_DATA_TOOLS|NODE_ENV !== \"production\"|admin_access_token|investor_id" src
```

Expected: no automatic authorization bypass or obsolete identity-cookie implementation remains; any development-tool environment condition controls only whether the development feature exists after admin authorization.
