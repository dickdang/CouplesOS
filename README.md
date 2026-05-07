# Household Assistant

A local-first prototype for a ChatGPT-style personal and executive assistant system for a couple.

Open `index.html` in a browser. The app stores profiles, commitments, and preference notes in local browser storage on this machine.

## What it includes

- A ChatGPT-like workspace with a left-side chat list and central conversation.
- A simplified Codex-style left rail: New Chat, Search, Tasks, and Settings.
- One chat per task, with a renameable chat name and dedicated supporting agent.
- Shared task chats for two separate partner sign-ins, with message attribution like a lightweight group chat.
- Settings groups onboarding, learned preferences, plugins such as Google, mobile install status, and planning tools.
- A right-side task context panel for status, owner, due date, definition of done, and agent stance.
- Overdue reminder drafts for email, text, or AI phone call scripts that ask whether the owner needs help or is just behind.
- A planning page that turns large projects, including a wedding, into multiple task chats with owners, dates, and agents.
- Google Calendar prototype workflows for reviewing availability, comparing proximity, recommending who should handle a pickup/errand/meeting, and drafting calendar events.
- Mobile web app metadata and responsive phone-first layouts for using CoupleOS from a home-screen web app.
- Cross-platform PWA support for iOS and Android with a web app manifest, icon, safe-area styling, install status screen, and offline app shell.
- Separate onboarding profiles for each partner.
- Preference learning from onboarding, tasks, disagreements, and manual notes.
- Accountability tasks with owner, due date, finish line, status, and coaching hints.
- Natural chat guidance for disagreements that keeps the mood light, protects both people's interests, and turns the next step back into an accountable task.

This is coaching support and relationship organization, not couples therapy, medical advice, or crisis support.

Reminder outreach is drafted and logged locally in this prototype. It does not actually send email, send SMS, or place calls yet.

Google Suite integration is also prototype-local for now. A production version would connect Google OAuth, Google Calendar, Gmail, Contacts, and Maps/Routes APIs before syncing real events or using real location data.

Partner sign-in is prototype-local too. A production version would replace the local switcher with real authentication, private user accounts, shared household permissions, and audit history for who sent each message.

## Mobile

CoupleOS is set up as a progressive web app for iOS and Android. For install and offline behavior, serve it from `https` or `localhost`; browsers do not enable service workers from a `file://` URL.

- iOS: open in Safari, use Share, then Add to Home Screen.
- Android: open in Chrome, use Install app or Add to Home screen.
- Native app path: the same frontend can later be wrapped with Capacitor for App Store and Play Store builds.

## Source notes

The chat guidance for disagreements is inspired by public Gottman Institute material on the Four Horsemen, antidotes, softened or gentle startup, repair attempts, and taking breaks when flooded. Useful starting points:

- https://www.gottman.com/blog/the-four-horsemen-recognizing-criticism-contempt-defensiveness-and-stonewalling/
- https://www.gottman.com/blog/the-four-horsemen-the-antidotes/


## Local Phone Testing

From PowerShell, run:

```powershell
cd path\to\CouplesOS
node server.mjs 5173
```

Then open these URLs:

- On this computer: http://localhost:5173
- On iPhone or Android on the same Wi-Fi: http://YOUR-LAN-IP:5173

Keep the PowerShell window open while testing. If the phone cannot connect, allow Node.js through Windows Defender Firewall for private networks, then reload the phone browser.

For real home-screen install and offline service worker behavior on phones, deploy the same folder to an HTTPS host such as Netlify, Vercel, Cloudflare Pages, or a private HTTPS tunnel. Browsers do not allow service workers from a plain `http://YOUR-LAN-IP:5173` phone URL.


## OpenAI API Chat

CoupleOS now includes a local server endpoint for live OpenAI chat with app actions. The browser sends chat context to the local server, and the server uses the OpenAI Responses API with function tools for:

- creating task chats
- creating project chats with subtasks
- drafting calendar events
- updating local calendar drafts

Set your API key before starting the server:

```powershell
cd path\to\CouplesOS
$env:OPENAI_API_KEY="sk-your-key-here"
$env:OPENAI_MODEL="gpt-5"
node server.mjs 5173
```

Then open `http://localhost:5173` on desktop or `http://YOUR-LAN-IP:5173` on your phone. OpenAI chat will not run from the `file://` URL because the browser needs the local `/api/chat` endpoint.

Calendar actions are local drafts at this stage. They appear in Settings > Google and can be promoted into real Google Calendar sync once write-scoped OAuth and approval rules are added.


## Real Google Calendar Import

CouplesOS now supports live Google Calendar imports in the browser using Google Identity Services and the Google Calendar API.

1. In Google Cloud Console, enable the Google Calendar API for your project.
2. Configure the Google Auth consent screen.
3. Create an OAuth 2.0 Client ID for a Web application.
4. Create an API key restricted to the Google Calendar API.
5. Add authorized JavaScript origins for where you run the app. For local desktop testing, add `http://localhost:5173`.
6. Open CoupleOS, go to Settings > Google, paste the OAuth Client ID and API key, and save.
7. Connect/import Partner A, then connect/import Partner B. Each person must choose and approve their own Google account.

The app imports upcoming events from each primary calendar. Events are treated as shared when they appear on both imports with the same Google iCalUID, or when the event attendee list includes both connected emails.

Important: Google OAuth is usually limited to authorized origins and generally requires HTTPS outside localhost. Testing OAuth from `http://YOUR-LAN-IP:5173` on a phone may not work unless Google accepts that origin for your OAuth client. For reliable iPhone/Android OAuth testing, deploy to an HTTPS URL or use an HTTPS tunnel, then add that origin in Google Cloud.

