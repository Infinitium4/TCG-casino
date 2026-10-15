# Clicker

Each validated click credits 1 chip only when the server balance is below 1000.
At 999 a click reaches 1000; new credits at 1000 or above are rejected.
There is no daily cap. After spending or losing chips, clicking is available
again. Initial account balances remain 1000.

Express sessions, SQLite, and existing UI components are reused. No dependency
was added. GET /api/clicker/state returns the balance and availability.
POST /api/clicker/click accepts a request ID, never a client-selected credit.
Balance validation, receipt insertion and credit run in BEGIN IMMEDIATE.
The UPDATE also requires chips < 1000. Failure rolls back the entire operation.
Duplicate IDs cannot credit twice for a given account, even across days,
profile resets or restarts. Existing clicker_gains records remain compatible;
the day column records the credit date but no longer imposes a daily cap.
An index on user_id/request_id supports lookup of old and new receipts.

The UI shows balance, progress toward 1000, and remaining chips before that
balance. It refreshes on entry and every five seconds while active.
Pending IDs persist locally to recover uncertain responses. The server remains
the authority. Sessions, bans and suspensions are checked. POST requires JSON
and rejects browser requests marked cross-site. Clicking during active table
games or infinite-money mode is blocked to avoid balance conflicts.

Automation can earn the permitted credits. This rule intentionally allows
repeated replenishment after losses or spending, per account. Receipts are
retained for idempotency, so storage grows with usage and requires operational
monitoring. This change is not a full casino security audit.
A pre-existing vulnerability remains in /api/result: roulette and slots gains
come from the client without server-side outcome calculation. Those games
require a separate migration to server-authoritative outcomes. Clicker does
not use that route.

Run npm test. Clicker coverage includes exact credits, threshold boundaries,
concurrent requests at 999, duplicates, rollback, persistence, account
isolation, profile reset, and more than 1000 credits on the same day.
