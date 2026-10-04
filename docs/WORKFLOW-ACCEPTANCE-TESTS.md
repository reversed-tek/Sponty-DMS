# Workflow Stabilization Acceptance Tests

Run these tests after applying `20261004000001_workflow_stabilization.sql` and deploying PR #8.

## 1. New patient visit / new Case

1. Book an appointment with a dentist.
2. Check the patient in.
3. Choose **Create a new case**.
4. Confirm the Case appears in Cases.
5. Confirm the appointment shows **Scheduled → Checked in** progress.
6. Handover to the dentist.
7. Confirm the Case is assigned to that dentist and becomes **In treatment**.
8. Open the Case and select the handed-over visit.
9. Add a clinical note.
10. Add at least one planned treatment.
11. Complete the visit.
12. Confirm:
   - only that appointment becomes **Completed**;
   - its treatments become **Completed**;
   - one invoice is generated for that appointment;
   - the Case billing status becomes **Pending**;
   - the Case remains clinically open/in treatment if another active visit exists;
   - the Case becomes **Treatment complete** if no other active visit/treatment remains.

## 2. Multi-visit Case

1. Add a second future appointment to the same patient.
2. At check-in, choose **Continue an existing case**.
3. Confirm the second appointment is linked to the original Case.
4. Complete the current visit.
5. Confirm the future appointment remains scheduled and is not modified.
6. Complete the second visit later.
7. Confirm a second invoice is created for the second appointment.
8. Confirm both invoices appear in the Case Billing tab.

## 3. Clinical close vs billing

1. Complete all visits and treatments.
2. Close the Case while an invoice still has a balance.
3. Confirm:
   - clinical Case status is **Closed**;
   - billing status remains **Pending** or **Partial**;
   - payment does not reopen or otherwise change clinical status.
4. Record the remaining payment in Billing.
5. Confirm billing status becomes **Paid** while clinical status remains **Closed**.

## 4. Case reopening

1. Open a closed Case.
2. Click **Reopen Case**.
3. Confirm clinical status becomes **Open** (or In treatment when an active dentist visit exists).
4. Book/check in another appointment and continue the Case.
5. Confirm the new appointment appears in the Case visit history.

## 5. Patient record integrity

1. Open Patients and choose a patient.
2. Confirm the patient record shows:
   - Cases;
   - read-only visit history;
   - Dental Chart.
3. Open a Case from the Patient record.
4. Confirm it opens the same Case workspace used by the Cases module.
5. Confirm no treatment or clinical-note entry form exists in the Patient appointment/history view.

## 6. Appointment workflow

Verify an appointment visibly progresses:

`Scheduled → Checked in → Handed over → Visit complete`

Confirm payment status does not alter this progress.

## 7. Billing queue

1. Open Billing with no patient filter.
2. Confirm all invoices are visible.
3. Filter by one patient.
4. Clear the filter with **Show all**.
5. Record a partial payment and confirm Case billing status becomes **Partially paid**.
6. Record the balance and confirm Case billing status becomes **Paid**.
7. Confirm the clinical Case status does not change due to payment.

## 8. Activity and assignment audit

For a Case, confirm Activity contains events for:
- check-in;
- handover / assignment;
- clinical note;
- treatment;
- visit completion;
- payment;
- Case close/reopen.

Reassign a handed-over appointment to another dentist and confirm the Case Activity shows the reassignment.

## 9. Safety regression

Confirm the following are not possible through the normal UI:
- clinical entry on a scheduled/non-handed-over appointment;
- completing a visit with no treatment;
- closing a Case with an active appointment;
- closing a Case with incomplete planned treatment;
- completing one visit and accidentally completing a future appointment;
- payment automatically closing a clinical Case.

## 10. Build checks

Before merge:

```bash
npm run build
npm run lint
```
