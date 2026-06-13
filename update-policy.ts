import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function run() {
  const defaultText = `# Company Policy
How we manage attendance, leave, and compliance
Effective date: Jan 1, 2026 - Last updated: Jan 1, 2026

## Overview
DIFM operates a strict attendance management platform. This Company Policy explains the rules and regulations around shifts, geofencing, and payroll.

This policy applies to all users of the DIFM platform — including HR personnel, Managers, and Employees. By using the app, you agree to the practices described here.

## Shifts & Attendance
We enforce a structured shift schedule to ensure adequate coverage.

### Standard Rules
- Employees must punch in and out using the DIFM App.
- GPS location is recorded to verify you are within the authorized geofence.
- Facial recognition is mandatory for all punches to prevent buddy punching.

## Grace Period & Late Marks
Punctuality is a core value. We allow a brief grace period before penalties apply.

### Thresholds
- **0-5 mins late:** Within grace period (No penalty).
- **5-15 mins late:** Records a Late Mark.
- **> 15 mins late:** Triggers a Warning to HR and may lead to a half-day deduction.
- Accumulating 3 Late Marks in a month equals one absent day.

## Payroll & Leaves
Your attendance directly impacts your payroll calculation.

### Deductions
- A missed punch-out will result in the shift being marked incomplete.
- Unapproved absences result in a full-day deduction.
- Approved leaves must be submitted 48 hours in advance.

## Storage & Security
Your biometric and location data is encrypted and securely stored.

### Data Types
- **Biometric Data:** Face embeddings are used solely for verification. Raw images are not stored.
- **Location Data:** GPS coordinates are captured only at the exact moment of a punch event. We do not track you continuously.`;

  await prisma.companySettings.updateMany({
    data: { attendancePolicyText: defaultText },
  });
  console.log("Updated");
}

run();
