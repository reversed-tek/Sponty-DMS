-- DESTRUCTIVE: removes the existing public application schema only.
-- Supabase Auth users are preserved because auth.users is not touched.
-- Review this file carefully before running it in the shared project.

begin;

 drop table if exists public.audit_events cascade;
 drop table if exists public.invoice_items cascade;
 drop table if exists public.invoices cascade;
 drop table if exists public.diagnoses cascade;
 drop table if exists public.treatments cascade;
 drop table if exists public.dental_chart_records cascade;
 drop table if exists public.medical_history cascade;
 drop table if exists public.clinical_notes cascade;
 drop table if exists public.appointments cascade;
 drop table if exists public.patients cascade;
 drop table if exists public.profiles cascade;
 drop table if exists public.practice_settings cascade;

drop function if exists public.current_user_role() cascade;
drop function if exists public.is_admin() cascade;
drop function if exists public.set_updated_at() cascade;

drop type if exists public.invoice_status cascade;
drop type if exists public.treatment_status cascade;
drop type if exists public.appointment_status cascade;
drop type if exists public.app_role cascade;

commit;

-- Run schema.sql immediately after this script.
