# Amounts in euros

All game wagers accept cents (minimum default 0.01, at most two decimals).
The browser and server share underground/js/money.js. Payout ratios use
integer cents and BigInt, rounded to the nearest cent (half a cent rounds up),
instead of truncating whole euros. Multipliers and probabilities are unchanged.
Table operations and SQLite balance changes normalize to two decimals.
Poker splits integer cents and awards remainder cents clockwise from the dealer.
Bank settlements and histories use the same precision.

Balances and API fields retain their existing euro units, including historical
records: no balance rescaling is needed. SQLite's non-STRICT INTEGER columns
accept decimal amounts. Existing 1-euro default minimums are upgraded once;
other custom limits and later administrator changes are preserved.
Maximum supported balance is capped so cents fit within a safe JS integer.

UI defaults use 0.05 and inputs step by 0.01. Displayed monetary amounts have
two decimal places. Tests cover five-cent wagers, exact payouts, invalid
sub-cent amounts, poker remainder conservation and database bank settlements.
