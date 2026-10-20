begin;

-- Existing double-bookings are left untouched; this protection applies to
-- NEW reservations or changes to an existing reservation.
-- A regular unique index cannot detect partial overlaps or crossing midnight.
-- Serialize changes per dentist, then check the full reserved time interval.
create or replace function public.prevent_dentist_appointment_overlap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  old_lock bigint;
  new_lock bigint;
  new_start timestamp without time zone;
  new_end timestamp without time zone;
  overlapping_appointment uuid;
begin
  -- No booking fields changed? Other appointment edits must still work.
  if tg_op = 'UPDATE'
     and new.provider_id is not distinct from old.provider_id
     and new.appointment_date is not distinct from old.appointment_date
     and new.appointment_time is not distinct from old.appointment_time
     and new.duration_minutes is not distinct from old.duration_minutes
     and (
       new.status is not distinct from old.status
       or (new.status::text in ('scheduled', 'booked', 'confirmed', 'in_progress', 'completed')
           and old.status::text in ('scheduled', 'booked', 'confirmed', 'in_progress', 'completed'))
     )
  then
    return new;
  end if;

  -- A provider move must acquire both provider locks in deterministic order.
  -- Release/cancel transitions are also serialized with new bookings.
  if tg_op = 'UPDATE' and old.provider_id is not null then
    old_lock := hashtextextended(old.provider_id::text, 0);
  end if;
  if new.provider_id is not null then
    new_lock := hashtextextended(new.provider_id::text, 0);
  end if;

  if old_lock is not null and new_lock is not null and old_lock <> new_lock then
    perform pg_advisory_xact_lock(least(old_lock, new_lock));
    perform pg_advisory_xact_lock(greatest(old_lock, new_lock));
  elsif old_lock is not null then
    perform pg_advisory_xact_lock(old_lock);
  elsif new_lock is not null then
    perform pg_advisory_xact_lock(new_lock);
  end if;

  -- An unassigned appointment, an open waitlist slot, cancellation, or no-show
  -- does not reserve time for a dentist.
  if new.provider_id is null
     or new.status::text in ('cancelled', 'no_show', 'open')
  then
    return new;
  end if;

  new_start := new.appointment_date + new.appointment_time;
  new_end := new_start + new.duration_minutes * interval '1 minute';

  select a.id into overlapping_appointment
  from public.appointments a
  where a.provider_id = new.provider_id
    and a.id is distinct from new.id
    and a.status::text in ('scheduled', 'booked', 'confirmed', 'in_progress', 'completed')
    and (a.appointment_date + a.appointment_time) < new_end
    and ((a.appointment_date + a.appointment_time)
      + a.duration_minutes * interval '1 minute') > new_start
  limit 1;

  if overlapping_appointment is not null then
    raise exception 'dentist_appointment_time_conflict'
      using errcode = '23P01',
            detail = 'This dentist already has an appointment within the selected date and time range.',
            hint = 'Choose another date, time, or dentist.';
  end if;

  return new;
end;
$$;

revoke all on function public.prevent_dentist_appointment_overlap() from public;

drop trigger if exists appointments_prevent_dentist_overlap on public.appointments;
create trigger appointments_prevent_dentist_overlap
before insert or update of provider_id, appointment_date, appointment_time,
  duration_minutes, status
on public.appointments
for each row execute function public.prevent_dentist_appointment_overlap();

-- Read-only diagnostic for existing legacy conflicts (no patient details).
-- Existing clashes aren't deleted or modified by this migration:
--
-- select a.id as appointment_a, b.id as appointment_b,
--        a.provider_id, a.appointment_date
-- from public.appointments a
-- join public.appointments b on a.provider_id = b.provider_id and a.id < b.id
-- where a.status::text in ('scheduled','booked','confirmed','in_progress','completed')
--   and b.status::text in ('scheduled','booked','confirmed','in_progress','completed')
--   and a.appointment_date + a.appointment_time <
--         b.appointment_date + b.appointment_time + b.duration_minutes * interval '1 minute'
--   and b.appointment_date + b.appointment_time <
--         a.appointment_date + a.appointment_time + a.duration_minutes * interval '1 minute';

commit;
