# Clicker

New accounts and profile resets start at 0. Existing balances are preserved.
Each validated click credits 0.05, capped at a balance of 10. Credits are rounded
to cents in SQLite and capped atomically, including concurrent requests.
There is no daily cap: spending below 10 makes the clicker available again.
Duplicate request IDs cannot credit twice, including across restarts.
The existing session, account eligibility and active-game checks still apply.

Registration requests default to 30 per IP per 15 minutes; CAPTCHA refreshes
default to 60 per IP per 15 minutes. Configure these with
REGISTRATION_RATE_LIMIT, REGISTRATION_CAPTCHA_RATE_LIMIT and
REGISTRATION_RATE_WINDOW_MS. The limiters use process memory, while active
CAPTCHA challenges are stored in SQLite and shared by backend instances.

Logout requires browser confirmation before sending the logout request.

Run node --test tests/clicker.test.js tests/clicker.integration.test.js.

Registration also requires a session-bound visual CAPTCHA from
GET /api/register/captcha. It returns a random challenge id and a dynamically
generated SVG image containing six high-contrast characters. Submit captchaId
and captchaAnswer to /api/register. Challenges expire after two minutes, are
stored as a keyed hash, and allow five incorrect attempts. Correct use consumes
the challenge atomically; requesting a replacement invalidates the previous
one. CAPTCHA requests are limited per IP by the configurable quota above.
