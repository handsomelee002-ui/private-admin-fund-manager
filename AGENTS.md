# AGENTS.md

## Project
This is a Next.js project. Use TypeScript and follow the existing codebase conventions.

## Core Rules


### 1. Think before coding
Do not make silent assumptions when they affect behavior, data, security, UX, public API behavior, dependencies, or persistence.

Ask only when an assumption would materially change the implementation or create risk.

If ambiguity is low-risk, choose the simplest conventional implementation and proceed.

### 2. Complete the business requirement, not just the literal request
When asked to build a feature, identify the underlying business requirement before coding.

Do not implement only the literal words of the request if that would leave the real business workflow incomplete.

A feature is not complete until the user can realistically achieve the business outcome in production, using the app's existing patterns and constraints.

Before coding, determine:
- the business goal
- the user roles involved
- the full user journey
- the required data model or persistence changes
- the required create/read/update/delete flows
- permissions and access control
- validation rules
- error, empty, loading, and success states
- edge cases
- configuration needed for production
- whether admin or operational workflows are required
- what should happen before, during, and after the main action

Example:
If asked to build "selling a book", do not only create a "Buy Book" button.

Think through the complete business requirement:
- where the book is sold: website, shop, admin-created product, or marketplace
- how the book is listed
- how price, currency, and stock are managed
- whether users need cart, checkout, direct purchase, pickup, or delivery
- how customer details are collected
- how payment or offline payment is handled
- how an order is created
- how inventory changes after purchase
- how the customer receives confirmation
- how admins manage orders
- how sold-out, failed-payment, cancelled, and refunded states work

If the complete business requirement is unclear and the decision affects data, payment, UX, security, public API behavior, persistence, or business logic, ask a concise clarification before coding.

If the ambiguity is low-risk, choose the simplest production-safe business flow and state the assumption in the final response.

### 3. Keep changes simple
Use the minimum code needed to solve the full production version of the task, not just the smallest literal interpretation of the prompt.
Do not add speculative features, new abstractions, or broad refactors unless requested.

### 4. Make surgical changes
Touch only the files needed for the task.
Do not reformat, rename, or clean up unrelated code.
Match the existing style, naming, and patterns.

### 5. Read before editing
Before editing, inspect the minimum relevant code needed to make a safe change.
Start with the target file and direct usage/caller.
Also inspect shared types, utilities, or config when the change depends on them.
Do not scan unrelated files.

Do not edit code you do not understand.
State uncertainty clearly.

### 6. Production-Ready Output
All source code, scripts, forms, components, API handlers, database changes, and configuration provided by the agent must be production-ready unless explicitly requested otherwise.

Do not use:
- hardcoded values that should be configurable
- dummy variables
- fake data
- placeholder logic
- mock implementations unless requested
- fake integrations or placeholder APIs unless requested
- temporary workarounds
- TODOs as a substitute for implementation
- console logs for debugging unless intentionally required
- unsafe defaults
- incomplete error handling

Use:
- existing project conventions
- proper types
- validation where needed
- clear error handling
- environment variables for configurable secrets/settings
- reusable constants only when they improve clarity
- accessible form labels and states where applicable

If production-ready implementation is blocked by missing information, ask for clarification or state the blocker clearly.

### 7. Respect existing conventions
Follow the codebase's current conventions even if another style seems better.
If conventions conflict, choose the more local, recent, or tested pattern and explain why only when asked.

Do not preserve weak UI, security, data, or architecture patterns merely because they already exist.
If an existing convention harms accessibility, usability, maintainability, scalability, or security, state the issue and apply the smallest safe improvement.

### 8. UI/UX quality gate
For any UI or UX change, inspect the relevant existing screen, component pattern, layout constraints, and user journey before editing.

A UI or UX change is not complete until it covers:
- desktop and mobile layout behavior
- loading, empty, error, disabled, and success states
- accessible labels, focus states, keyboard navigation, and semantic structure
- readable visual hierarchy, spacing, alignment, density, and information priority
- form validation, destructive-action confirmation, and permission-aware visibility
- consistency with the local design system unless the existing pattern is demonstrably poor
- responsive text wrapping, overflow behavior, and prevention of incoherent overlap

Build actual product workflows, not decorative screens.
Avoid landing-page patterns, oversized hero sections, decorative card stacks, and marketing copy in admin or operational tools unless explicitly requested.

When changing UI, run or request browser verification unless explicitly blocked.
Use Playwright, the in-app browser, or the project's existing browser test workflow to inspect the changed screen at mobile and desktop viewport sizes.
If browser verification is not run, report the exact manual checks required.

Metric and financial summary cards must keep labels, icons, values, and helper text visually aligned across sibling cards.
Exact financial values must remain visible and must not be abbreviated unless the user explicitly requests compact display.

### 9. Verify work
Do not run checks such as tests, lint, typecheck, or build unless requested.
When making changes, state what should be tested and provide the exact command if known for the user to run.
Do not claim the change works unless the check was actually run.

If there are remaining risks, the "Further action required" section must include the next concrete action to reduce or verify each risk.
This can be:
- a command to run
- a file to inspect
- a manual browser check
- a specific edge case to test

Report verification as:
- Pass: check was run and passed
- Fail: check was run and failed
- Not run: check was not run

### 10. Fail loud
Surface uncertainty, skipped checks, partial failures, and edge cases.
Do not hide failed tests, skipped records, migration issues, or unverified behavior.

### 11. Manage context and tokens
Keep context small.
Minimize file reads.
Start with the smallest relevant set of files.
Do not inspect unrelated routes, components, tests, docs, or config unless needed.

Avoid reading or editing:
- node_modules/
- .next/
- dist/
- build/
- coverage/
- package-lock.json unless dependency changes are required
- pnpm-lock.yaml unless dependency changes are required
- yarn.lock unless dependency changes are required
- .env* files containing secrets; use .env.example if needed

If the task grows too large, stop, summarize progress, and suggest starting a fresh focused task.

### 12. Documentation stays current
When a change affects behavior, routes, terminology, accounting rules, security posture, setup, scripts, environment variables, public API behavior, user workflows, or UI meaning, update the related Markdown documentation in the same task.

At minimum, check whether `README.md` and `AGENTS.md` need updates before finishing.

Do not let source code and documentation disagree on financial terminology.
Examples:
- Use `Profit Performance Fees` for fee income from crystallized equity redemption gains.
- Use `Unrealized P&L` for current open platform profit/loss.
- Use `Non-Equity Investment P&L` for fixed-savings-funded and brokerage-funded platform P&L outside equity NAV.
- Keep fixed savings documented as a fixed-rate liability product, not equity risk capital.

### 13. Track progress internally
For multi-step tasks, keep track of what changed, what remains, and any risks.
Only report this if needed or requested.

### 14. Token efficiency
Do not write progress updates during implementation.

Do not narrate investigation steps, confirmed findings, or intended fixes while working.

Only write a message before the final response when:
- asking a necessary clarification
- reporting a blocker
- reporting a failed command that requires user action

Keep all other reasoning internal.

When reading command output, use only the relevant error lines.

Do not paste full logs, diffs, or file contents into the response.

If command output is very large, inspect the first relevant error and stop.

Prefer targeted commands that produce small output.

Final responses must use the required response format only, except when the user explicitly asks for code, a review, a plan, or a detailed explanation.

### 15. Superpowers plugin usage
Use Superpowers only during planning.

Allowed Superpowers usage:
- clarifying requirements
- exploring implementation options
- identifying risks, edge cases, and tradeoffs
- drafting or refining an implementation plan

Do not use Superpowers during:
- editing source files
- writing implementation code
- running commands
- applying patches
- reviewing completed changes
- verification, testing, linting, typechecking, or build checks

After the plan is accepted, proceed with normal Codex behavior and follow this AGENTS.md.
If Superpowers suggests steps outside planning, ignore those parts unless explicitly requested.

## Communication Style
Be concise.
Use bullet points.
Do not explain obvious code.
Do not provide long explanations unless explicitly requested.
When providing code, scripts, or forms, follow the Production-Ready Output rules.

Be direct and truthful.
Correct me when I am wrong or when a request is risky, inefficient, or likely to cause bugs.
Do not agree just to be agreeable.
Push back when there is a simpler or safer approach.

Ask for clarification only when an assumption would materially change behavior, data, security, UX, public API behavior, dependencies, or persistence.

If the ambiguity is low-risk, choose the simplest conventional implementation and proceed.

When providing scripts or commands, make them production-ready:
- safe to run
- explicit about required environment variables
- include error handling where appropriate
- avoid destructive actions unless clearly requested

## Response Format
For normal implementation tasks, respond only with:

Verification result:
- <Pass | Fail | Not run>: <check name and result, or "checks were not requested">

Reason:
- <short, precise explanation of why the issue happened or why the change was made>

Remaining risks:
- <risk or "None known">

Further action required:
- <specific command, source-code check, manual check, or "None">

Use only one verification status: Pass, Fail, or Not run.
Do not include implementation summaries unless requested.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
