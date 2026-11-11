# TeamForge — Race-Proof Team Formation

A full-stack implementation of **Hack4Hack Crew Hiring Challenge 2026, Problem Statement 1**.

## Tech stack

React + Vite frontend, Node.js/Express backend, PostgreSQL 16, JWT authentication, bcrypt, Zod validation, Server-Sent Events, GitHub Actions, k6.

## Run locally

Requirements: Node.js 22+, npm, Docker Desktop.

1. Start Docker Desktop.
2. Run:

    docker compose up -d
    cp .env.example .env
    npm install
    npm run dev

3. Open http://localhost:5173
4. Create two accounts (one in each of two browsers) and test team formation.

The server on port 4000 runs API routes. Vite on port 5173 proxies /api requests to it. For a single production service, run `npm run build` and then `npm start` (serves the frontend and API together).

## Functional features

- Secure registration and login with bcrypt and JWT.
- Teams of up to five members, with a minimum readiness threshold of two.
- Database-enforced one team per user per hackathon.
- Expiring, high-entropy invite codes stored as SHA-256 hashes.
- Leader-controlled acceptance, rejection and removal.
- Automatic leadership transfer when the leader leaves.
- Team deleted when the last member leaves.
- Exactly one winner when 50 users compete for the final seat.
- Idempotency keys for every authenticated mutation.
- Real-time update messages through Postgres LISTEN/NOTIFY and SSE.
- Audit logs for every team-changing operation.
- Teammate recommendations with documented scoring.
- Mobile-friendly, keyboard-accessible React UI.
- Input validation, authentication and rate limiting.

## How the final-seat race is prevented

Each join transaction locks the same `teams` database row with `SELECT ... FOR UPDATE`. After acquiring the lock it checks `member_count` and the membership uniqueness constraint. Successful joins update the count inside the same transaction. Waiting requests re-check the latest committed count and fail with HTTP 409 when full. The entire operation commits or rolls back together.

## Tests

    npm test

The integration test suite includes more than 20 API tests, a 50-concurrent-user final-seat race, idempotency, access controls, invites, leadership, audit logs and team lifecycle. Tests need a running PostgreSQL database.

## Seed the target scale

    npm run seed

Creates 10,000 local demo users and 2,000 teams. Do not run this seed script on a production deployment.

Seed passwords are intentionally identical for local testing only.

## Load testing

Install k6 locally, then:

    npm run seed
    k6 run load/board.js

This runs 100 concurrent virtual users against `/api/board`. Results are written to `load-results.json`. Use the results to complete `LOAD_REPORT.md`. Do not claim the p95 target is achieved unless measured.

## Deployment

Use a managed PostgreSQL database and deploy the entire application as one Node.js service. Build: `npm install && npm run build`. Start: `npm start`. Set `DATABASE_URL` and a strong `JWT_SECRET` in the hosting platform's private environment settings. Deploy to a provider with a supported free plan, if available. Test SSE support and SSL connections with your provider.

The code package does not include a deployed URL. You must deploy and verify it separately.

## Submission checklist

- Public GitHub repository
- Public live app URL
- Design document: DESIGN.md
- Actual load results and LOAD_REPORT.md
- Walkthrough video up to five minutes
- Run `npm test` and `npm run build` successfully
- Demonstrate the 50-user race test in your walkthrough

## Limitations

The current implementation assumes all team updates use this API and its transaction locking. It lacks distributed tracing, stronger session management, and full deployment hardening. In production, add more robust Redis-backed API rate limiting, database migration versioning, CSRF protections if moving to cookie sessions, and monitoring.

This project was AI-assisted. Review, run and understand all code before submitting. Hack4Hack requires individual participation and the ability to explain and modify your work.
# Build-race-proof-team-formation-platform
