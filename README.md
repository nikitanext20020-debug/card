# Ironclad Stripe Sandbox

Chrome/Edge extension and a local Node.js server for sequential **Stripe Sandbox** integration scenarios.

## Features

- Four official test scenarios: Visa, Mastercard, generic decline, insufficient funds.
- One run at a time, up to 20 scenarios, 500–30000 ms pause after each response.
- TXT / pipe-delimited CSV / JSON import and a JSON result journal.
- Stop interrupts the wait; an already submitted request can still finish.
- Ambiguous outcomes are never reported as success. No automatic retries.
- Queue continues while the popup is closed, as long as the local server stays running.
- Server restart does not resume a previous run; results are in memory only.

## Requirements

Node.js 22+, Chrome or Edge, and a Stripe Sandbox secret key (`sk_test_...`). No npm packages are required.

## Start on Windows

1. Clone this repository and open PowerShell in the repository directory.
2. Run `& .\sandbox\start.ps1` and enter the Sandbox secret key at the hidden prompt.
3. In `chrome://extensions` or `edge://extensions`, enable Developer mode and choose **Load unpacked**. Select the repository root.
4. Paste the **Local access token** printed by the server into the popup.
5. Click **Тестовый набор**, set the delay, then **Запустить**.
6. Use **Журнал JSON** to export results before stopping the server.

The server binds only to `127.0.0.1:8765`. The Stripe secret is never entered into or stored by the extension. The local access token and run ID use browser session storage; only the delay is persisted as a setting.

Each scenario creates and confirms a **100-cent USD Sandbox PaymentIntent**. Expected test declines continue the run; non-card errors, authentication requirements, rate limits and uncertain outcomes stop it for inspection.

## Supported input

```text
visa
mastercard
declined
insufficient_funds
```

Official corresponding test PaymentMethod IDs or test PANs are also accepted. An optional `|MM|YYYY|CVC` suffix is ignored: only the fixed test scenario name reaches the local server. Arbitrary card details, live keys and arbitrary PaymentMethod IDs are rejected.

## Verification

```powershell
node .\sandbox\tests.cjs
```

Expected result:

```text
PASS 142 checks (mocked Stripe; no external requests)
```

These are local HTTP and simulated-popup tests using a mocked Stripe transport, not a browser UI test or an authenticated Stripe Sandbox run. Delivery testing did not include an authenticated Stripe call.

The repository intentionally includes only the Sandbox implementation. Legacy checkout/CAPTCHA scripts, local backups, maintenance artifacts and machine-specific workspace files are excluded. References to original local maintenance artifacts in `sandbox/README.md` apply only to the originating workspace, not a fresh clone.

## Official documentation

- [Stripe testing and official test PaymentMethods](https://docs.stripe.com/testing)
- [Create and confirm a PaymentIntent](https://docs.stripe.com/api/payment_intents/create)
