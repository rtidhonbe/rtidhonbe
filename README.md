# rti dhonbe

Free, open-source tool for filing Right to Information requests in the Maldives via the [ICOM Mahoali](https://icom.mv) portal.

Built for citizens, journalists, and civil society organisations who use RTI regularly.

## Why rti dhonbe?

The Mahoali portal requires you to manually fill in your personal details for every request and only supports submitting to one institution at a time. rti dhonbe removes that friction.

## Features

- **Bulk RTI** -- send the same request to multiple government institutions simultaneously. On Mahoali, this means repeating the entire form for each institution
- **Saved profiles** -- store your name, phone, and address once. Every future request is pre-filled and ready to send in seconds -- no retyping
- **Request tracking** -- search, filter, and view all your submitted requests in one dashboard with live status updates pulled from ICOM
- **Template variables** -- use `{{RECIPIENT_NAME}}` and custom placeholders to automatically personalise each request per institution
- **Guest mode** -- file one-time requests without creating a profile. Details are not saved
- **Open source** -- fully transparent codebase. Verify exactly what the app does with your data

## How it works

rti dhonbe acts as a frontend to the ICOM Mahoali portal. You sign in with your existing Mahoali account -- no separate registration required. Your requests are submitted directly to ICOM on your behalf.

- No RTI message content is stored
- No passwords are stored -- only the session token, which expires automatically
- Saved profiles are stored server-side in a SQLite database
- A count of RTIs sent per institution is logged anonymously -- no personal data attached

## Setup

### Prerequisites

- Node.js 18+
- npm

### Install

git clone https://github.com/rtidhonbe/rtidhonbe.git
cd rtidhonbe
npm install
cp .env.example .env

Edit `.env` with your configuration:

PORT=3000
SESSION_SECRET=your-random-secret-here
MAX_SENDS_PER_HOUR=50
DELAY_MIN_MS=4000
DELAY_MAX_MS=9000

### Run

# Development (auto-restart on changes)
npm run dev

# Production
npm start

The app runs on `http://localhost:3000` by default.

### Production deployment

For production, place the app behind a reverse proxy (nginx) with HTTPS. The app includes:

- Helmet security headers (CSP, HSTS, X-Frame-Options)
- Rate limiting on login and send endpoints
- Session fixation protection
- CSRF protection via Origin header validation and SameSite strict cookies
- Server-side input validation on all user-submitted fields

## Project structure

rtidhonbe/
├── public/                  # Frontend (vanilla HTML/CSS/JS)
│   ├── app.html             # Main app (home, compose, requests, FAQ)
│   ├── app.js               # App logic
│   ├── app.css              # App styles
│   ├── login.html           # Login page
│   ├── login.js             # Login logic
│   ├── profile.html         # Profile management page
│   ├── profile.js           # Profile logic
│   └── ...
├── server/
│   ├── index.js             # Express server, middleware, routes
│   ├── lib/
│   │   ├── icom.js          # ICOM API client (login, submit, fetch)
│   │   ├── db.js            # SQLite database setup
│   │   ├── labelStore.js    # Request-to-profile label mapping
│   │   └── submissionLog.js # Anonymous institution submission counter
│   ├── middleware/
│   │   ├── session.js       # Session config and auth guard
│   │   └── rateLimit.js     # Rate limiters
│   └── routes/
│       ├── auth.js          # Login / logout
│       ├── send.js          # RTI submission (bulk, streamed progress)
│       ├── institutions.js  # Institution list (cached)
│       ├── requests.js      # User's submitted requests
│       └── profiles.js      # Saved profile CRUD
├── .env.example             # Environment variable template
└── package.json

## Security

rti dhonbe is designed with security as a priority. See the FAQ on the [live site](https://rtidhonbe.com) for user-facing security information.

If you find a security vulnerability, please report it to **rtidhonbe@proton.me**.

## Disclaimer

rti dhonbe is not affiliated with, endorsed by, or associated with ICOM or the Government of the Maldives. It is an independent, third-party tool.

## License

[MIT](LICENSE)
