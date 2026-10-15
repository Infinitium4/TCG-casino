# Clicker

New accounts and profile resets start at 0. Existing balances are preserved.
Each validated click credits 0.05, capped at a balance of 10. Credits are rounded
to cents in SQLite and capped atomically, including concurrent requests.
There is no daily cap: spending below 10 makes the clicker available again.
Duplicate request IDs cannot credit twice, including across restarts.
The existing session, account eligibility and active-game checks still apply.

Registration allows five attempts per IP per 15 minutes, including failed
attempts, with HTTP 429, a French error and Retry-After on rejection.
The limiter uses process memory: restarting clears it and multiple server
instances would need a shared store.

Logout requires browser confirmation before sending the logout request.

Run node --test tests/clicker.test.js tests/clicker.integration.test.js.

Registration also requires a session-bound arithmetic challenge from GET
/api/register/captcha. Submit captchaId and captchaAnswer (a digit string)
to /api/register. Challenges expire after five minutes and are consumed
atomically on every attempt. Requesting a new challenge replaces the previous
one. Challenge requests are limited to 60 per IP per 15 minutes.
