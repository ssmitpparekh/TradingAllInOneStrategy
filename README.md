# ALLINONEVIEW

Read-only market analysis platform for Indian markets, starting with FYERS market data.

## Phase 1
- Secure FYERS OAuth authorization-code flow
- Server-side token handling
- NIFTY 50 live quote test
- No order placement / no trading permissions

## Security
Never commit:
- FYERS App Secret
- access tokens
- refresh tokens
- passwords / PIN / OTP

Use `.env.local` for local credentials.
