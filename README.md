# rti dhonbe

free open source software for submitting, tracking, and archiving Right to Information requests in the Maldives.

built for citizens, journalists, and civil society organisations who use RTI regularly.

**live at [rtidhonbe.com](https://rtidhonbe.com)**

## features

- **bulk RTI** -- send the same request to multiple government institutions at once
- **request tracking** -- view all your submitted requests and their status in one place, pulled live from ICOM
- **vault** -- public archive of RTI documents with hearts, sharing, flair categories, and search
- **saved profiles** -- optionally save applicant details so future requests are pre-filled and ready to send in seconds
- **guest mode** -- file one-time requests without creating a profile
- **template variables** -- use `{{RECIPIENT_NAME}}` to insert institution names, and custom placeholders like `{{YEAR}}` to personalise requests per institution even when sending in bulk

## how it works

rti dhonbe acts as a frontend to the [ICOM Mahoali](https://icom.mv) portal. you sign in with your existing Mahoali account - no separate registration required. your requests are submitted directly to ICOM on your behalf.

- no RTI message content is stored
- no passwords are stored - only the session token, which expires automatically
- saved profiles are stored server-side in a SQLite database
- a count of RTIs sent per institution is logged anonymously - no personal data attached

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

edit `.env` with your configuration:

```
PORT=3000
SESSION_SECRET=your-random-secret-here
MAX_SENDS_PER_HOUR=50
DELAY_MIN_MS=4000
DELAY_MAX_MS=9000
```

### run

```bash
# development (auto-restart on changes)
npm run dev

# production
npm start
```

the app runs on `http://localhost:3000` by default.

### production deployment

for production, place the app behind a reverse proxy (nginx) with HTTPS. the app includes:

- helmet security headers (CSP, HSTS, X-Frame-Options)
- rate limiting on login, send, and API endpoints
- session fixation protection
- CSRF protection via Origin header validation and SameSite strict cookies
- server-side input validation on all user-submitted fields
- profanity filtering on vault submissions

## project structure

```
rtidhonbe/
├── public/                    # frontend (vanilla HTML/CSS/JS)
│   ├── index.html             # landing page
│   ├── login.html/js          # login page
│   ├── app.html/js/css        # main app (compose, requests)
│   ├── vault.html/js/css      # vault (public RTI archive)
│   ├── profile.html/js/css    # profile management
│   └── faq.html               # FAQ page
├── server/
│   ├── index.js               # express server, middleware, routes
│   ├── lib/
│   │   ├── icom.js            # ICOM API client (login, submit, fetch)
│   │   ├── db.js              # SQLite database setup
│   │   ├── labelStore.js      # request-to-profile label mapping
│   │   ├── profanity.js       # profanity filter (Dhivehi + English)
│   │   └── submissionLog.js   # anonymous institution submission counter
│   ├── middleware/
│   │   ├── session.js         # session config and auth guard
│   │   └── rateLimit.js       # rate limiters
│   └── routes/
│       ├── auth.js            # login / logout
│       ├── send.js            # RTI submission (bulk, streamed progress)
│       ├── institutions.js    # institution list (cached)
│       ├── requests.js        # user's submitted requests
│       ├── profiles.js        # saved profile CRUD
│       └── vault.js           # vault post CRUD, hearts, admin
├── data/                      # runtime data (gitignored)
│   ├── mahoali.db             # SQLite database
│   ├── sessions/              # file-based sessions
│   └── *.txt                  # profanity word lists
├── .env.example               # environment variable template
└── package.json
```

## security

rti dhonbe is designed with security as a priority. see the [FAQ](https://rtidhonbe.com/faq) for user-facing security information.

if you find a security vulnerability, please report it to **rtidhonbe@proton.me**.

## disclaimer

rti dhonbe is not affiliated with, endorsed by, or associated with ICOM or the Government of the Maldives. it is an independent, third-party tool.

## license

[MIT](LICENSE)
