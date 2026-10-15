# Business staff authentication

Scope: the ShinaCare Business app (`apps/business`, `/login`) and the `accounts` module of the API.
Authentication only identifies a person; **roles, supplier scope and hub assignments are decided by the API**
(`Customer.roles`, guards, `/workspace/me`) and are never chosen, inferred or granted at sign-in.

## Methods

| Method | Status | Notes |
|---|---|---|
| Email + password | **Primary, live** | Existing `POST /accounts/login`; bcrypt (12 rounds); per-IP limit 5 / 5 min. |
| Phone code | **Secondary, live where a delivery channel exists** | New `/accounts/staff/otp/*` routes. Needs a provisioned phone and an SMS provider (see blocker). |
| Google / social | Out of scope | Not offered. |
| Public sign-up | None | Accounts are provisioned by the owner: `npm run staff:provision`. |

A valid account with **no staff role** (for example a shopper) is signed out again immediately by the app
(`NotAuthorizedError` → `POST /accounts/logout`); the person sees a neutral message, never a role name.

## Phone sign-in contract

- `GET  /accounts/staff/auth-options` → `{ password, phone: { available, reason?, codeLength, expiresInSeconds, resendCooldownSeconds } }`.
  The UI offers the phone option only from this; `available:false` renders a truthful disabled state.
- `POST /accounts/staff/otp/send { phoneNumber }` → `201 { sent, expiresInSeconds, resendCooldownSeconds, codeLength }`.
  - `400 INVALID_PHONE` · `503 OTP_UNAVAILABLE` (no delivery channel: **no code is created and nothing is claimed as sent**)
  - `429 OTP_COOLDOWN { retryAfterSeconds }` (60 s per number) · `429 OTP_RATE_LIMITED` (5 per number per hour) · `429 RATE_LIMITED` (per IP)
- `POST /accounts/staff/otp/verify { phoneNumber, code }` → `201 { token, expiresAt }`
  - `401 OTP_INVALID { attemptsRemaining }` · `401 OTP_EXPIRED` (5 min) · `401 OTP_LOCKED` (3 wrong guesses)
- Numbers are normalised to `+201XXXXXXXXX` server-side (010/011/012/015 only; Arabic-Indic digits accepted).
- Codes are 6 digits from `crypto.randomInt`, stored only as a SHA-256 fingerprint bound to the challenge and number,
  compared in constant time, counted atomically, and **single use** (claimed with a conditional update).
- **No enumeration:** a number that is not a staff phone gets the same `201`, the same cooldown and the same
  `OTP_INVALID` on verify (a decoy challenge that can never match). Nothing is delivered for it.
- **No account creation:** only an existing `PHONE` identity on an account holding a staff role can sign in. The
  storefront OTP flow is separate (`purpose = LOGIN`); staff challenges (`purpose = STAFF_LOGIN`) can never satisfy it.

## Delivery channel — current blocker

No SMS provider is integrated (the WhatsApp adapter is a mock). `StaffOtpTransport` therefore reports
available **only when `NODE_ENV` is `development` or `test`**, where it writes the code to the API log (the same
dev-only convention as the storefront). In every other environment phone sign-in answers `OTP_UNAVAILABLE`.

To enable it for real: implement the provider call behind `StaffOtpTransport.deliver()` / `isAvailable()` (credentials via
environment, never in code). Nothing else changes.

## Provisioning

```
STAFF_PASSWORD='…' npm run staff:provision -- --email ops@example.com --name "Ops" --role ADMIN --phone 01012345678
```

`--phone` attaches the number to that account (refused if it belongs to another account). There is still no HTTP
route that grants roles.

## Sessions

Sessions are the API's: opaque UUID token, 30 days, invalidated by `POST /accounts/logout`, rejected once expired or
revoked. The app keeps the token in `localStorage`, drops it on any authenticated `401` and then shows
"your session ended" on the sign-in page. There is **no "remember this device" option** because the real policy is a
fixed 30-day session; the screen makes no such promise.

## Redirects

`/login?next=/path` is honoured only when it is a same-origin path inside a workspace the signed-in roles may use
(`lib/auth/safe-redirect.ts`); anything else falls back to the role home.

## Password recovery

There is no self-service reset in the API. The screen's "Forgot password?" tells the person to ask the system
administrator (who re-runs the provisioning command). A real reset flow needs an email channel and is not built.

## Background image

`apps/business/public/auth/README.md`. The approved logistics photograph was not in the repository; until it is added the
screen uses a neutral amber atmosphere (no stand-in photo).

## Tests

- API: `test/unit/staff-phone.spec.ts`, `test/integration/staff-auth.e2e-spec.ts` (runs through the production error filter).
- Business: `tests/auth-flow.test.cjs` (redirect safety, phone helpers, error copy, contrast of the sign-in palette).
