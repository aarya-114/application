# Quarantine App

Next.js 14, TypeScript, Tailwind CSS, and Prisma ORM 6 with SQLite for local development.

## Setup

```powershell
npm install
Copy-Item .env.example .env
```

```bash
npx prisma generate
npx prisma migrate dev
npx prisma db seed
npm run dev
```

Copy `.env.example` to `.env` before setup. Keep `.env` private and set `SESSION_SECRET` to a long, random value outside local development.

## Demo authentication

The login page at [http://localhost:3000/login](http://localhost:3000/login) lets you choose one of the seeded identities: Demo Nurse, Demo Doctor, or Demo Admin. Sign-in intentionally has no password because this is demo authentication, not production identity verification. Login issues an eight-hour, HTTP-only, signed cookie. Protected API routes validate the signature and expiry, then load the user's current role from SQLite. Unauthenticated requests receive 401; signed-in users with a disallowed role receive 403.

To check role enforcement, sign in as **Demo Nurse** and open [http://localhost:3000/api/auth/admin-check](http://localhost:3000/api/auth/admin-check) in the same browser. It should return HTTP 403 with a clear role requirement. Sign in as **Demo Admin** and the same route returns HTTP 200. The admin-check route exists only to demonstrate role enforcement.

The dashboard is at [http://localhost:3000/dashboard](http://localhost:3000/dashboard). Visiting `/` redirects there, and unauthenticated visitors are redirected to `/login`.

The authenticated `GET /api/dashboard` endpoint derives occupancy, today's temperature and visit workflow counts, current discharge backlog, discharge totals/rates, and UTC-date discharge history from current database records. Dashboard sections are role-specific: Nurses see temperature workflow counts, Doctors see visit workflow counts and threshold settings, and Admins see facility and discharge metrics. Mortality and success rates show insufficient data until at least one patient has been discharged.

## Room admission (Admin)

Run `npx prisma db seed` to idempotently seed rooms 1 through 74 and the demo users. The Admin dashboard shows each room's availability and includes the patient admission form. `POST /api/patients` and `GET /api/rooms` require an Admin session. Run the isolated admission API suite with:

```bash
npm run test:integration
```

The integration suite uses a process-specific SQLite database, applies migrations, resets patient data between cases, and removes that test database on completion.

## Fever threshold settings

Authenticated users can view `/settings/fever-threshold`; only a Doctor can add a new threshold. Each successful change creates a new historical setting and an audit record. The setting history is append-only through the application.

The assessment specifies that fever affects cure eligibility but does not define a numeric threshold. This prototype seeds a configurable default threshold of **38.0°C** as an implementation assumption, not an assessment requirement. Doctors can change it through the Fever Threshold Settings page. The default appears in history as a seeded prototype value; later rows identify the Doctor who changed the threshold.

The `npm run test:integration` suite also covers threshold view/change permissions, unauthenticated rejection, validation, append-only history, auditing, and idempotent threshold seeding.

## Nurse temperature recording

Nurses can record raw measurements on the [Daily temperatures page](http://localhost:3000/temperatures), opened from the dashboard. The needs-today and completed-today lists and duplicate detection use the UTC server calendar day: `[00:00 UTC, 00:00 UTC the next day)`. The UI also displays timestamps in UTC. Repeated same-day readings are allowed and preserved; the system does not classify them against the fever threshold in this phase.

Temperature input is restricted to 30–45°C inclusive as a prototype sanity-check assumption, not an assessment requirement. The Nurse-only `POST /api/patients/:id/temperature` endpoint enforces this range server-side. Authenticated users can query `GET /api/patients?filter=needsTemperatureToday`; `filter=completedTemperatureToday` returns today's readings as well. Per-patient raw history is available from `GET /api/patients/:id/temperature`.

The isolated integration suite covers the temperature recording workflow, UTC-day filtering, duplicate readings, role checks, validation, patient status checks, and history alongside the prior admission and threshold tests.

## Doctor visits and clinical review

Doctors can open the Doctor patient review from the dashboard. It shows active patients with visits pending today and visits already recorded today, along with the latest raw temperature for today, derived fever classification, current fever-free streak, and visit history. Both visit filters and visit creation use the same UTC calendar-day boundary as temperature recording. The list endpoints require a signed-in session; `POST /api/patients/:id/visit` and the Doctor page require the Doctor role server-side.

Fever classification on the Doctor review is derived from each day's most recent raw reading and the current Phase 4 threshold (`reading >= threshold` means fever). Changing the threshold can therefore change a derived classification without changing a stored temperature. Discharge eligibility uses the historical threshold effective at each reading's `recordedAt`; every reading on a day must be below its applicable threshold for that day to qualify. The discharge streak counts consecutive UTC days ending today, and a fever or missing reading ends the streak.

Doctor visits are allowed even when today's temperature is missing. The API returns `"Temperature not yet recorded today"`, and the Doctor UI highlights the missing reading for follow-up. Additional visits on the same day are allowed and retained; the response marks later visits with `duplicateToday: true`. The integration suite covers visit authorization, persistence, warnings, duplicates, filtering, threshold reclassification, streak boundaries, and inactive-patient rejection.

## Discharge review (Admin)

The Admin dashboard lists active patients for discharge review and shows the live fever-free streak, eligibility, and the readings/thresholds behind each day. `GET /api/patients/:id/discharge-status` is available to authenticated users; `GET /api/patients?filter=dischargeReview` supplies the Admin UI. Eligibility is derived each time and is never stored as a trusted flag. A CURED discharge requires at least three consecutive qualifying UTC days ending today; DECEASED discharge does not require the fever-free criterion. An Admin confirms the patient and selected outcome before discharge. The server rechecks eligibility, discharges the patient, clears `roomId`, and writes an audit log entry in one transaction. The released room is immediately available for admission.

## Patient details and audit history

Patient names in the temperature, Doctor review, room, and discharge-review lists link to `/patients/:id`. The authenticated patient-detail API returns the admission/room/status summary, raw temperature history with each reading's historically applicable threshold and derived fever classification, current UTC-day temperature/visit state, live fever-free streak and reasoning, Doctor notes, and audit history filtered on the server by role. Nurses see care events; Doctors also see threshold changes; Admins see room-operation events as well. Successful admission, temperature recording, Doctor visit, threshold change, and discharge each write their audit record in the same transaction as the operation. The application has no room-reassignment operation, so no room-change workflow was added.

## Health check

[http://localhost:3000/api/health](http://localhost:3000/api/health) returns `{"status":"ok"}`.
