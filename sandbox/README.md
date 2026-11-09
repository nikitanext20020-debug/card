# Ironclad Stripe Sandbox v4

Load the extension from **C:/Users/USER/Desktop/ironclad**, not the older `extension/` directory.

## Start

1. Install Node.js 22 or later. No npm dependencies.
2. Open PowerShell and run `& 'C:\Users\USER\Desktop\ironclad\sandbox\start.ps1'`.
3. Enter your **Sandbox secret key**, beginning `sk_test_`. The secret stays in the local process, not the extension. The launcher restores the previous environment variable (or removes the temporary one) when the process exits.
4. Load/reload the root directory using Chrome/Edge > Extensions > Developer mode > Load unpacked.
5. Paste the **Local access token** printed by the server into the popup. Use “Тестовый набор”, set delay, then “Запустить”.
6. “Стоп” prevents further scenarios and interrupts the waiting interval. An in-flight request is allowed to resolve; a network timeout is **unknown**, never success. No automatic retries. Inspect unknown PaymentIntents in your sandbox Dashboard using `metadata.ironclad_run`.
7. “Журнал JSON” exports the displayed results. Copy it before restarting the server: up to 10 runs are retained in memory, not persisted to disk. Closing the popup does not stop the server queue. Browser session storage keeps only the local token and run ID; delay is a local setting.

One run at a time, 1–20 scenarios, 500–30000 ms after each completed response. No delay after the final scenario. New runs also respect a minimum 500 ms from the previous API request. Each request creates and confirms a **100-cent USD Sandbox PaymentIntent**; this is a test payment scenario, not mere card-format validation. Expected card declines continue the run. Non-card errors, 3DS/action-required, rate limits and ambiguous network outcomes stop with `needs_attention`.

Accepted lines: `visa`, `mastercard`, `declined`, `insufficient_funds`; their official `pm_card_*` values; or the four corresponding official test PANs with optional `|MM|YYYY|CVC`. Expiry/CVC are ignored; only a fixed scenario name goes to the local server, and only its test PaymentMethod goes to Stripe. JSON arrays of strings or objects with `scenario`/`card` are accepted. TXT/CSV means one supported entry per line using the pipe format, not arbitrary column-separated bank data.

No random PAN generator is included. “Тестовый набор” inserts the four published scenarios. Live API keys, arbitrary PANs, arbitrary PaymentMethod IDs and extra request fields are rejected. No checkout content script, CAPTCHA component, broad host permissions, remote scripts, customer records or real-payment workflow is active in v4. The old unreferenced files and older nested extension are not changed or included in the distribution ZIP.

## Verification

`node --test` is not required. Run `node sandbox/tests.cjs`. Tests use a local mock of Stripe; no keys or external requests are used. An authenticated Sandbox call requires your Sandbox key and was not performed during delivery.

## Sources

- https://docs.stripe.com/testing (official test PaymentMethods instead of raw PANs)
- https://docs.stripe.com/api/payment_intents/create (create and confirm)

## Rollback

The maintenance directory contains the original byte-for-byte files, SHA256 manifest, patch, verification and executable ROLLBACK.sh. Rollback was tested on a separate copy; the v4 working files remain modified.
