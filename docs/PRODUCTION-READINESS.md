# Production Readiness Standard

ALLINONEVIEW is developed mobile-first and production-first. Mobile and production hardening are not deferred to the end.

## Required on every feature

- Desktop layout remains usable.
- iPhone-sized layouts remain usable down to 320 px width.
- Android-sized layouts remain usable.
- Touch targets are approximately 44 px or larger where practical.
- Horizontal toolbars scroll rather than overflow the viewport.
- The chart supports touch pan / pinch zoom and responsive height.
- Fullscreen remains usable with safe-area insets.
- Loading, empty, disconnected and runtime-error states remain usable.
- TypeScript passes.
- Next.js production build passes.
- Production server smoke tests pass.
- API credentials, access tokens and secrets remain server-side.
- Live and authenticated market API responses are never cached by the service worker.

## iOS and Android app strategy

### Current
ALLINONEVIEW is an installable Progressive Web App from the shared Next.js codebase.

- Android: Chromium browsers can offer Install App / Add to Home Screen.
- iOS/iPadOS: Safari users can use Share -> Add to Home Screen.
- Installed mode uses standalone display and safe-area support.

### Store distribution path
If App Store and Google Play distribution are desired later, package the same hosted production application with a thin native shell after the production domain, authentication and push-notification requirements are finalized. Do not fork the analysis UI into separate iOS and Android implementations unless a native-only requirement makes it necessary.

## PWA data policy

The service worker may cache only non-sensitive application shell resources.

It must never cache:

- /api/fyers/*
- /api/kraken/*
- authentication callbacks
- access/session tokens
- live quotes, candles, OI or option-chain responses

All /api/* traffic remains network-only.

## Launch gate

The project is not finished until the repository's Required before project completion checklist is satisfied and the current production branch passes the CI production smoke test.
