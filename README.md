# rti dhonbe

free, open-source tool for filing Right to Information requests in the Maldives via the [ICOM Mahoali](https://icom.mv) portal.

built for citizens, journalists, and civil society organisations who use RTI regularly.

## features

- **saved profiles** -- store your name, phone, and address so every request is pre-filled and ready to send in seconds
- **bulk RTI** -- send the same request to multiple government institutions at once
- **request tracking** -- view all your submitted requests and their status in one place, pulled live from ICOM
- **guest mode** -- file one-time requests without creating a profile
- **template variables** -- use `{{RECIPIENT_NAME}}` and custom placeholders to personalise requests per institution

## how it works

rti dhonbe acts as a frontend to the ICOM Mahoali portal. You sign in with your existing Mahoali account -- no separate registration required. Your requests are submitted directly to ICOM on your behalf.

- no RTI message content is stored
- no passwords are stored -- only the session token, which expires automatically
- saved profiles are stored server-side in a SQLite database
- a count of RTIs sent per institution is logged anonymously -- no personal data attached

## setup

### prerequisites

- node.js 18+
- npm

### install

```bash
git clone https://github.com/rtidhonbe/rtidhonbe.git
cd rtidhonbe
npm install
cp .env.example .env
```

Edit `.env` with your configuration:

```
PORT=3000
SESSION_SECRET=your-random-secret-here
MAX_SENDS_PER_HOUR=50
DELAY_MIN_MS=4000
DELAY_MAX_MS=9000
```

### Run

```bash
# Development (auto-restart on changes)
npm run dev

# Production
npm start
```

the app runs on `http://localhost:3000` by default.

### production deployment

for production, place the app behind a reverse proxy (nginx) with HTTPS. The app includes:

- helmet security headers (CSP, HSTS, X-Frame-Options)
- rate limiting on login and send endpoints
- session fixation protection
- CSRF protection via Origin header validation and SameSite strict cookies
- server-side input validation on all user-submitted fields

## project structure

```
rtidhonbe/
├── public/                 # Frontend (vanilla HTML/CSS/JS)
│   ├── app.html            # Main app (home, compose, requests, FAQ)
│   ├── app.js              # App logic
│   ├── app.css             # App styles
│   ├── login.html          # Login page
│   ├── login.js            # Login logic
│   ├── profile.html        # Profile management page
│   ├── profile.js          # Profile logic
│   └── ...
├── server/
│   ├── index.js            # Express server, middleware, routes
│   ├── lib/
│   │   ├── icom.js         # ICOM API client (login, submit, fetch)
│   │   ├── db.js           # SQLite database setup
│   │   ├── labelStore.js   # Request-to-profile label mapping
│   │   └── submissionLog.js # Anonymous institution submission counter
│   ├── middleware/
│   │   ├── session.js      # Session config and auth guard
│   │   └── rateLimit.js    # Rate limiters
│   └── routes/
│       ├── auth.js         # Login / logout
│       ├── send.js         # RTI submission (bulk, streamed progress)
│       ├── institutions.js # Institution list (cached)
│       ├── requests.js     # User's submitted requests
│       └── profiles.js     # Saved profile CRUD
├── .env.example            # Environment variable template
└── package.json
```

## security

rti dhonbe is designed with security as a priority. See the FAQ on the [live site](https://rtidhonbe.com) for user-facing security information.

if you find a security vulnerability, please report it to **rtidhonbe@proton.me**.

## disclaimer

rti dhonbe is not affiliated with, endorsed by, or associated with ICOM or the Government of the Maldives. It is an independent, community-built tool.

## license

[MIT](LICENSE)
