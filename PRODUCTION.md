# Production Mobile Testing Runbook

This is the path to test CoupleOS on real iPhone and Android devices without running a local server.

## What is now production-ready enough to test

- Static app can be hosted on HTTPS.
- `/api/chat` can run as a Vercel serverless function.
- OpenAI API key stays on the host, not inside the browser app.
- Google OAuth and Calendar import can work from a stable HTTPS origin.
- Capacitor config is ready so the same web app can be wrapped for iOS TestFlight and Android internal testing.

## Recommended first production target

Use Vercel first. It gives you the fastest secure URL for iPhone, Android, Google OAuth, and OpenAI chat.

1. Push this repo to GitHub.
2. Go to Vercel and import `dickdang/CouplesOS`.
3. Framework preset: Other.
4. Build command: leave empty.
5. Output directory: leave empty.
6. Add environment variables:
   - `OPENAI_API_KEY`: your real OpenAI API key.
   - `OPENAI_MODEL`: `gpt-5` unless you intentionally change models.
7. Deploy.
8. Open the Vercel HTTPS URL on iPhone Safari and Android Chrome.

The app should call the hosted serverless endpoint at `/api/chat`, so no local Node server is needed.

## Google OAuth setup

In Google Cloud Console:

1. Enable Google Calendar API.
2. Configure the OAuth consent screen.
3. Create an OAuth 2.0 Client ID for Web application.
4. Add authorized JavaScript origins:
   - `https://YOUR-VERCEL-DOMAIN.vercel.app`
   - any custom production domain later, for example `https://app.couplesos.com`
5. Create an API key restricted to Google Calendar API.
6. In CoupleOS, paste the OAuth Client ID on the sign-in page.
7. After sign-in, go to Settings > Google and save the API key.

For native Capacitor builds, Google sign-in may need additional OAuth clients for iOS and Android once bundle IDs and SHA fingerprints are finalized.

## iPhone testing before TestFlight

Fastest path:

1. Open the Vercel URL in Safari.
2. Tap Share.
3. Tap Add to Home Screen.
4. Test login, chat, calendar import, tasks, projects, and offline shell behavior.

This validates most of the product UX before App Store/TestFlight overhead.

## iOS TestFlight path

Apple requires macOS and Xcode for TestFlight builds.

On a Mac:

```bash
cd CouplesOS
npm install
npm run cap:ios
npx cap open ios
```

Then in Xcode:

1. Set Team to your Apple Developer account.
2. Confirm bundle ID: `com.couplesos.app`.
3. Set signing automatically.
4. Archive the app.
5. Upload to App Store Connect.
6. Add internal testers in TestFlight.

After every web change:

```bash
npm run cap:sync
```

Then rebuild/archive in Xcode.

## Android internal testing path

On Windows or Mac with Android Studio:

```bash
cd CouplesOS
npm install
npm run cap:android
npx cap open android
```

Then in Android Studio:

1. Confirm application ID: `com.couplesos.app`.
2. Generate a signed app bundle.
3. Upload to Google Play Console internal testing.
4. Add testers.

## Release checklist for this prototype

Before inviting testers:

- Deploy HTTPS app to Vercel.
- Add `OPENAI_API_KEY` and confirm chat actions work.
- Add Google OAuth authorized origin for deployed URL.
- Confirm iPhone Safari login works.
- Confirm Android Chrome login works.
- Confirm task notes persist after reload.
- Confirm recurring project label persists after reload.
- Confirm no API keys are committed to GitHub.
- Confirm app is acceptable as a prototype: data is still local browser/device storage, not a production database.

## Known gaps before true production

These are not blockers for private TestFlight-style testing, but they are blockers for a real paid production launch:

- Real user accounts and household membership permissions.
- Server database instead of browser local storage.
- Secure backend Google Calendar sync with refresh tokens.
- Real email/SMS/phone reminder integrations.
- Subscription billing.
- Audit history for who created/changed tasks.
- Privacy policy, terms, deletion/export flow, and App Store privacy disclosures.
