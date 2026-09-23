# Quarantine App

Next.js 14, TypeScript, Tailwind CSS, and Prisma ORM 6 with SQLite for local development.

## Setup

```bash
npm install
Copy-Item .env.example .env
npx prisma generate
npx prisma migrate dev
npx prisma db seed
npm run dev
```

Copy `.env.example` to `.env` before setup. Keep `.env` private and set `SESSION_SECRET` to a long, random value outside local development.

## Demo authentication

The login page at [http://localhost:3000/login](http://localhost:3000/login) lets you choose one of the seeded identities: Demo Nurse, Demo Doctor, or Demo Admin. Sign-in intentionally has no password because this is demo authentication, not production identity verification. Login issues an eight-hour, HTTP-only, signed cookie. Protected API routes validate the signature and expiry, then load the user's current role from SQLite. Unauthenticated requests receive 401; signed-in users with a disallowed role receive 403.

To check role enforcement, sign in as **Demo Nurse** and open [http://localhost:3000/api/auth/admin-check](http://localhost:3000/api/auth/admin-check) in the same browser. It should return HTTP 403 with a clear role requirement. Sign in as **Demo Admin** and the same route returns HTTP 200. The admin-check route exists only to demonstrate this phase's role guard; no facility workflows are implemented yet.

The dashboard is at [http://localhost:3000/dashboard](http://localhost:3000/dashboard). Visiting `/` redirects there, and unauthenticated visitors are redirected to `/login`.

## Room admission (Admin)

Run `npx prisma db seed` to idempotently seed rooms 1 through 74 and the demo users. The Admin dashboard shows each room's availability and includes the patient admission form. `POST /api/patients` and `GET /api/rooms` require an Admin session. Run the isolated admission API suite with:

```bash
npm run test:integration
```

The integration suite uses a process-specific SQLite database, applies migrations, resets patient data between cases, and removes that test database on completion.

## Health check

[http://localhost:3000/api/health](http://localhost:3000/api/health) returns `{"status":"ok"}`.
