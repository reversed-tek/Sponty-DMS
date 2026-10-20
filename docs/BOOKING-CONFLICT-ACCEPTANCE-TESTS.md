# Dentist appointment scheduling conflict checks

## Deployment

1. Apply `supabase/migrations/20261020000002_prevent_dentist_appointment_overlaps.sql` in your existing Supabase project.
2. Review migration success before deploying the updated frontend.
3. Merge the accompanying PR to `main` and allow Vercel to deploy it.
4. Use a test patient and a test dentist to complete the cases below.

The new trigger guards **insertions and scheduling edits from all application paths**, including the patient waitlist claiming workflow. It uses per-dentist transactional advisory locks so concurrent bookings for the same provider are checked in sequence (under the standard PostgreSQL READ COMMITTED isolation level).

## Acceptance checklist

- [ ] Save an 08:00–09:00 appointment for Dentist A.
- [ ] Try to book Dentist A for 08:00–08:30 on that date. It must fail with a clear inline warning in **New Appointment**.
- [ ] Try 08:30–09:00 for Dentist A. It must fail: overlapping duration is blocked.
- [ ] Try 09:00–09:30 for Dentist A. It must succeed: back-to-back appointments are valid.
- [ ] Try 08:30–09:00 for Dentist B on the same date. It must succeed.
- [ ] Try reassigning an 08:30–09:00 appointment from Dentist B to Dentist A through **Appointment Details**. Saving must be blocked with an inline warning, and the existing dentist should remain assigned.
- [ ] Mark Dentist A's first appointment **cancelled** (or **no_show**) and repeat the booking. The time should now be available.
- [ ] Leave an available waitlist placeholder in status **open**; it should not block a confirmed booking, while claiming that placeholder must re-check the actual slot.
- [ ] Try to book a long appointment that extends past midnight into the next date. Another appointment for the same dentist in the overlapping next-day period must be blocked.
- [ ] In two separate reception sessions, save the same slot simultaneously. Exactly one booking should be accepted, and the other should get a conflict error (the database is authoritative).
- [ ] Confirm a failed booking keeps the entered patient, dentist, date, time, duration and case selection so reception can change only the conflicting field.
- [ ] Check that editing an appointment's chief complaint or notes still works normally.
- [ ] Verify cancelled and no-show appointments are not treated as occupied; completed appointments remain historical occupied slots.

## Existing double-bookings

This migration does **not** delete or silently reschedule legacy overlaps. They remain visible for manual review. Progressing an existing scheduled visit to checked-in or completed does not, by itself, turn it into a new reservation.

Run this read-only query in **Supabase SQL Editor** to find conflicts that were already present:

```sql
select a.id as appointment_a, b.id as appointment_b,
       a.provider_id, a.appointment_date,
       a.appointment_time as start_a, a.duration_minutes as minutes_a,
       b.appointment_date as date_b,
       b.appointment_time as start_b, b.duration_minutes as minutes_b
from public.appointments a
join public.appointments b
  on a.provider_id = b.provider_id and a.id < b.id
where a.provider_id is not null
  and a.status::text in ('scheduled','booked','confirmed','in_progress','completed')
  and b.status::text in ('scheduled','booked','confirmed','in_progress','completed')
  and (a.appointment_date + a.appointment_time)
      < (b.appointment_date + b.appointment_time + b.duration_minutes * interval '1 minute')
  and (b.appointment_date + b.appointment_time)
      < (a.appointment_date + a.appointment_time + a.duration_minutes * interval '1 minute')
order by a.appointment_date;
```

The results include existing historical conflicts. Review clinically important bookings with clinic staff before changing or cancelling any of them.

## Scope

- The rule is scoped **per dentist**, based on provider ID, date/time and duration.
- It blocks `scheduled`, `booked`, `confirmed`, `in_progress`, and `completed` overlaps.
- It excludes `cancelled`, `no_show`, and unclaimed waitlist `open` slots.
- Existing conflicts are retained rather than automatically deleted.
- Frontend checks improve error clarity, but the database trigger is the definitive protection against concurrent submissions.
