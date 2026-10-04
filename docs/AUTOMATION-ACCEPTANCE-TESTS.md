# PR9 Automation Acceptance Tests

Run after applying `20261004000002_treatment_planning_tasks_recalls.sql`.

## Treatment planning

1. Open an active Case.
2. Add three treatment plan items with estimated costs.
3. Accept two items and defer one.
4. Confirm the Case Treatment Plan shows:
   - total estimated plan value;
   - accepted value;
   - progress;
   - individual status.
5. With no future appointment linked to the Case, accept a plan item.
6. Confirm an automated **Schedule next treatment visit** task appears.
7. Book a new appointment and link it to the existing Case.
8. Confirm the scheduling task completes automatically.
9. Check the patient in and hand the visit to the dentist.
10. From Treatment Plan, choose **Start in Selected Visit** for an accepted item.
11. Confirm a real treatment record is created for that visit.
12. Complete the visit.
13. Confirm:
    - the real treatment becomes completed;
    - the plan item becomes completed;
    - only performed treatment appears on that visit's invoice.

## Multi-visit treatment plan

1. Keep at least one accepted/proposed plan item after Visit 1.
2. Complete Visit 1.
3. Confirm the Case remains **In treatment**.
4. Confirm an automated follow-up scheduling task exists if no future appointment is booked.
5. Book Visit 2 and link it to the Case.
6. Confirm the follow-up scheduling task completes.
7. Perform and complete the remaining accepted plan item.
8. Resolve/cancel/defer any remaining proposed work.
9. Confirm Case can reach **Treatment complete**.

## Case tasks

1. Add a manual Case task with due date and priority.
2. Confirm it appears in Tasks and Dashboard.
3. Complete it from the Case.
4. Confirm:
   - status becomes completed;
   - a task-completed Case event is written.
5. Create conditions for an automated scheduling task.
6. Confirm the automated task is not duplicated if the same condition is evaluated more than once.

## Clinical Case closure + recall

1. Finish all active appointments, treatments, and non-deferred plan work.
2. Choose a recall interval, e.g. 6 months.
3. Close the Case.
4. Confirm:
   - Case becomes Closed;
   - open Case tasks are cancelled;
   - a preventive recall is created for the patient;
   - recall due date is approximately six months from closure;
   - Case Activity records the recall.
5. Repeat with **No recall** and confirm no recall is created.

## Recall workflow

1. Open Patient > Recalls.
2. Add a manual preventive recall.
3. Confirm its source is Manual.
4. Book a checkup or cleaning.
5. Confirm the open preventive recall becomes Scheduled.
6. Complete that appointment.
7. Confirm the recall becomes Completed.

For a Follow-up recall:
1. Add a manual Follow-up recall.
2. Book the next appointment.
3. Confirm the follow-up recall becomes Scheduled.
4. Complete the appointment.
5. Confirm the recall becomes Completed.

## Dashboard

Confirm Dashboard shows:
- Open Case tasks;
- Recalls due within 14 days;
- overdue tasks as urgent;
- overdue recalls as urgent;
- existing appointment, Case, and Billing metrics.

## Safety checks

Confirm the normal UI does not allow:
- performing a treatment plan item before it is accepted;
- performing a plan item without an active handed-over visit;
- closing a Case with active appointments;
- closing a Case with active treatment;
- closing a Case with proposed/accepted/in-progress plan items;
- billing an unperformed treatment-plan item;
- duplicate automated scheduling tasks for the same Case.
