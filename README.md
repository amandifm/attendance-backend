# DIFM Attendance Backend

Node.js, TypeScript, Express, Prisma, and PostgreSQL backend for the current DIFM Attendance mobile app.

This first backend slice matches the modules already built locally in the Expo app:

- Auth/session APIs
- Attendance policy acceptance
- Employees
- Shifts
- Attendance punch in/out and review
- Attendance GPS/geofence validation
- Foreground live location pings during active attendance
- Break start/end and net-hours calculations
- Monthly attendance history and correction approval workflow
- Payroll attendance CSV export with payable days, late deduction, and bonus eligibility fields
- Super Admin month lock/unlock after payroll review
- Live operations dashboard for Admin/HR/Manager
- Super Admin production dashboard
- Scoped API keys and webhook endpoints for external systems
- Basic rate limiting for login, punch-in, and public APIs
- Email delivery log with SendGrid adapter
- Face verification provider adapter with strict enforcement switch
- Punch-in selfie capture metadata
- Leave requests and decisions
- Reports summary
- Notifications
- Settings
- Audit log foundation

## Setup

```bash
cd backend
cp .env.example .env
npm install
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
npm run dev
```

Default seeded password for every account is `Password@123`.

## Endpoints

- `GET /health`
- `POST /auth/login`
- `POST /auth/refresh`
- `POST /auth/logout`
- `POST /auth/accept-policy`
- `GET /auth/me`
- `GET /employees`
- `POST /employees`
- `PATCH /employees/:id`
- `PATCH /employees/:id/status`
- `GET /shifts`
- `POST /shifts`
- `PATCH /shifts/:id/status`
- `GET /attendance/today`
- `POST /attendance/punch-in`
- `POST /attendance/punch-out`
- `POST /attendance/break-start`
- `POST /attendance/break-end`
- `POST /attendance/location-ping`
- `GET /attendance/history`
- `GET /attendance/corrections`
- `POST /attendance/:id/corrections`
- `PATCH /attendance/corrections/:id/decision`
- `GET /attendance`
- `GET /leave-requests`
- `POST /leave-requests`
- `PATCH /leave-requests/:id/decision`
- `GET /reports/attendance-summary`
- `GET /reports/live-dashboard`
- `GET /reports/payroll-export`
- `GET /reports/super-admin-dashboard`
- `GET /reports/email-deliveries`
- `GET /reports/month-locks`
- `POST /reports/month-locks/:month`
- `DELETE /reports/month-locks/:month`
- `GET /integrations/api-keys`
- `POST /integrations/api-keys`
- `PATCH /integrations/api-keys/:id/revoke`
- `GET /integrations/webhooks`
- `POST /integrations/webhooks`
- `PATCH /integrations/webhooks/:id/status`
- `GET /public-api/attendance-summary`
- `GET /public-api/shift-schedule`
- `GET /public-api/leave-status`
- `GET /notifications`
- `PATCH /notifications/:id/read`
- `GET /settings`
- `PATCH /settings`

All protected routes use:

```http
Authorization: Bearer <accessToken>
```

## Current Scope

This backend intentionally covers the current mobile behavior first. Punch-in now requires current policy acceptance, stores a camera selfie/private photo key, can enforce an external biometric face/liveness provider, and applies basic rate limiting. GPS/geofence enforcement, foreground live location pings, break sessions, correction approvals, monthly history, payroll CSV export, Super Admin month locking, scoped external APIs, email delivery logs, and webhooks now have first-pass production APIs. Final deployment still needs real provider credentials, distributed security controls, TLS/cert pinning, and native background/spoof-detection hardening.
