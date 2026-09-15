-- One-click waitlist claiming prerequisites
-- Apply after supabase/schema.sql.

alter type public.appointment_status add value if not exists 'open';
alter type public.appointment_status add value if not exists 'booked';

alter table public.appointments
  alter column patient_id drop not null;
