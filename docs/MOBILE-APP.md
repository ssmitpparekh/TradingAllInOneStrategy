# ALLINONEVIEW Mobile App Path

ALLINONEVIEW must support both iOS and Android.

## Stage 1 — Installable PWA
The current Next.js application is made installable as a Progressive Web App:
- standalone home-screen launch
- app manifest
- service worker
- app icons
- mobile viewport and theme metadata
- same live market and analysis engine as the web version

This gives:
- iPhone/iPad: Safari → Share → Add to Home Screen
- Android: Chrome → Install app / Add to Home Screen
- desktop browsers that support PWA installation

Live market API routes and authentication are deliberately excluded from service-worker caching.

## Stage 2 — Production-hosted mobile backend
Before App Store / Google Play packaging:
- deploy ALLINONEVIEW on HTTPS
- move local FYERS session storage to secure production server-side storage
- use production OAuth redirect URLs
- verify SSE/WebSocket behavior behind the production host
- add push-ready alert architecture
- add exchange-session and holiday calendars

## Stage 3 — Native store packaging
Use a thin native shell around the same product, with the backend remaining server-side.

Preferred path:
- Capacitor-compatible iOS shell
- Capacitor-compatible Android shell
- same responsive web/chart code where practical
- native secure storage only for app-local non-sensitive preferences
- provider secrets/tokens remain on the server
- native deep links for OAuth callback where supported
- App Store and Google Play signing, screenshots, privacy declarations and review readiness

The mobile app remains read-only: no broker order placement or trade execution.
