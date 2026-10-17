# Production Readiness Standard

ALLINONEVIEW is developed mobile-first and production-first. Mobile and production hardening are not deferred to the end.

## Required on every feature

- Desktop layout remains usable.
- iPhone layouts remain usable down to 320 px width.
- Android phone layouts remain usable.
- Touch targets are approximately 44 px or larger where practical.
- Horizontal toolbars scroll instead of overflowing.
- The chart supports touch pan, pinch zoom and responsive height.
- Fullscreen respects safe-area insets.
- Loading, disconnected, empty and runtime-error states are usable.
- TypeScript passes.
- Next.js production build passes.
- Production-server smoke tests pass.
- Provider credentials and tokens remain server-side.
- Live/authenticated market API responses are not cached by the service worker.

## App strategy

ALLINONEVIEW uses one shared product codebase.

- iOS/iPadOS: installable PWA via Safari Add to Home Screen.
- Android: installable PWA via Chromium Install app / Add to Home Screen.
- Future App Store / Google Play distribution should use a thin native shell around the same production application unless a native-only requirement demands otherwise.

## Launch gate

Do not call the project finished until the repository completion checklist is satisfied and production CI passes.
