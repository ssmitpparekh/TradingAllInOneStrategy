# Phase 1 — FYERS market-data foundation

## Goal
Connect the personal, non-trading FYERS app to ALLINONEVIEW and prove that the backend can fetch a NIFTY 50 quote.

No order-placement endpoints are implemented.

## FYERS app settings
Use the existing non-trading app with this exact redirect URI:

`http://127.0.0.1:8080/callback`

The local Next.js server is deliberately configured to run on `127.0.0.1:8080`.

## Local setup

1. Install Node.js (current LTS).
2. Clone this repository.
3. Run:
   `npm install`
4. Copy:
   `.env.example` → `.env.local`
5. Fill in the App ID and Secret ID from the FYERS API Dashboard.
6. Run:
   `npm run dev`
7. Open:
   `http://127.0.0.1:8080`
8. Click **Connect FYERS**.
9. Complete FYERS authentication.
10. After redirecting back, click **Test live quote**.

## Security design
- App Secret remains only in `.env.local`.
- OAuth `state` is cryptographically random and stored in an HttpOnly cookie for the short login flow.
- Access and refresh tokens are written server-side to `.data/fyers-session.json`.
- `.env.local` and `.data/` are ignored by Git.
- The frontend never receives the App Secret or access token.
- The project contains no order-placement route or API call.

The file-backed token store is for local Phase 1 development only. Production will use encrypted server-side storage.

## FYERS endpoints used

- Generate authorization code:
  `GET https://api-t1.fyers.in/api/v3/generate-authcode`
- Exchange authorization code:
  `POST https://api-t1.fyers.in/api/v3/validate-authcode`
- Quote snapshot:
  `GET https://api-t1.fyers.in/data/quotes?symbols=NSE:NIFTY50-INDEX`

Authenticated market-data requests send:
`Authorization: <app_id>:<access_token>`

## Phase 2
After the NIFTY quote is confirmed:
1. historical candles
2. Data WebSocket
3. charting
4. Fib / Trend Fib
5. BOS / CHoCH
6. Order Blocks and FVG
7. volume profile / VWAP on futures
8. futures and options OI / ΔOI
9. confluence and reversal-score engine
