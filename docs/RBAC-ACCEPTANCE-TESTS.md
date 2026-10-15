# RBAC Acceptance Tests

Apply `supabase/migrations/20261015000000_role_based_access_control.sql` before testing.

## Expected module access

| Role | Dashboard | Patients | Appointments | Cases | Billing | User Settings |
| --- | --- | --- | --- | --- | --- | --- |
| Receptionist | Yes | No | Yes | No | Yes | No |
| Dentist | Yes | Yes | Yes | Yes | Yes | No |
| System Administrator | Yes | Yes | Yes | Yes | Yes | Yes |

## Receptionist

1. Sign in with an active receptionist profile.
2. Confirm the sidebar shows **Dashboard, Appointments, Billing** only.
3. Confirm the initial page is **Dashboard**.
4. Confirm the receptionist Dashboard shows appointment and billing workload, but does not show clinical Case, task, or recall metrics.
5. Confirm Dashboard actions only open Appointments or Billing.
6. Confirm **Tools / User Settings** is not shown.
7. Book an appointment and confirm patient and dentist selectors still work.
8. Link a follow-up appointment to an active Case and confirm the Case selector works inside the appointment workflow.
9. Check in a patient and hand the appointment over to the assigned dentist.
10. Confirm there is no **Open Case** action in the receptionist appointment view.
11. Open Billing and confirm pending/paid invoices can be viewed and payments can be recorded.
12. Attempt direct table access as the receptionist:
    - Patient create/update/delete must be denied.
    - Cases, clinical notes, treatments, treatment plans, Case tasks, recalls, Case events, and Case assignments must be denied.
    - Appointments and invoice reads must remain available.

## Dentist

1. Sign in with an active dentist profile.
2. Confirm the sidebar shows **Dashboard, Patients, Appointments, Cases, Billing**.
3. Confirm **User Settings** and the **Tools** administration action are not shown.
4. Confirm Patient CRUD, clinical notes, dental chart, treatments, treatment plans, Case tasks, recalls, Case close/reopen, Appointments, and Billing continue to work.
5. Confirm patient portal access can still be issued from a patient record.
6. Attempt to read or write other users' profiles and confirm the operation is denied.

## System Administrator

1. Sign in with an active admin profile.
2. Confirm the sidebar shows all current application modules, including **User Settings**.
3. Confirm staff profile administration works.
4. Confirm Dashboard, Patients, Appointments, Cases, and Billing remain functional.
5. Confirm Practice Settings remains admin-write only.

## Inactive accounts

1. Deactivate a staff profile while its Microsoft identity still exists.
2. Confirm the application blocks normal access.
3. Confirm RLS-protected table access also fails because `current_user_role()` returns no active role.

## Regression checks

- Appointment safe delete remains receptionist/admin only.
- Complete Visit, treatment planning, Case close/reopen, Case tasks, and recall scheduling remain dentist/admin only.
- Reception can still check in and hand over appointments through trusted workflow functions.
- Booking an appointment linked to a Case still resolves scheduling tasks automatically.
- Booking/completing appointments still synchronises recall state.
- Billing payment changes billing state only and does not close the clinical Case.
