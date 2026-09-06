-- Dental Office Manager: single-practice Supabase schema
-- Run in the Supabase SQL editor after creating a project.

create extension if not exists pgcrypto;

create type public.app_role as enum ('admin', 'dentist', 'receptionist');
create type public.appointment_status as enum ('scheduled', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show');
create type public.treatment_status as enum ('planned', 'in_progress', 'completed', 'cancelled');
create type public.invoice_status as enum ('pending', 'partial', 'paid', 'overdue', 'cancelled');

create table public.practice_settings (
  id boolean primary key default true check (id),
  name text not null default 'Dental Office',
  address text,
  city text,
  state text,
  postal_code text,
  phone text,
  email text,
  business_hours jsonb not null default '{"open":"08:00","close":"18:00"}'::jsonb,
  appointment_interval_minutes integer not null default 15 check (appointment_interval_minutes between 5 and 60),
  updated_at timestamptz not null default now()
);

insert into public.practice_settings (id) values (true) on conflict (id) do nothing;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text not null,
  role public.app_role not null default 'receptionist',
  phone text,
  is_active boolean not null default true,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.patients (
  id uuid primary key default gen_random_uuid(),
  patient_number text not null unique,
  first_name text not null,
  last_name text not null,
  date_of_birth date not null check (date_of_birth <= current_date),
  gender text check (gender in ('male', 'female', 'other', 'prefer_not_to_say')),
  email text,
  phone text,
  mobile text,
  address text,
  city text,
  state text,
  postal_code text,
  emergency_contact_name text,
  emergency_contact_phone text,
  insurance_provider text,
  insurance_policy_number text,
  allergies text,
  medical_notes text,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  provider_id uuid references public.profiles(id),
  appointment_date date not null,
  appointment_time time not null,
  duration_minutes integer not null default 30 check (duration_minutes between 5 and 480),
  appointment_type text not null,
  status public.appointment_status not null default 'scheduled',
  reason text,
  notes text,
  cancellation_reason text,
  outlook_event_id text,
  outlook_calendar_account text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.clinical_notes (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  appointment_id uuid references public.appointments(id) on delete set null,
  author_id uuid not null references public.profiles(id),
  visit_type text not null default 'follow_up' check (visit_type in ('initial', 'follow_up', 'emergency', 'consultation')),
  note_date date not null default current_date,
  subjective text,
  objective text,
  assessment text,
  plan text,
  is_private boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.medical_history (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  record_type text not null check (record_type in ('condition', 'medication', 'allergy')),
  name text not null,
  detail text,
  severity text,
  is_active boolean not null default true,
  start_date date,
  end_date date,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.dental_chart_records (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  tooth_number smallint not null check (tooth_number between 11 and 48),
  tooth_surface text,
  condition text not null,
  severity text,
  notes text,
  follow_up_required boolean not null default false,
  recorded_by uuid not null references public.profiles(id),
  recorded_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.treatments (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  appointment_id uuid references public.appointments(id) on delete set null,
  provider_id uuid references public.profiles(id),
  treatment_date date not null default current_date,
  tooth_number smallint,
  procedure_code text,
  procedure_name text not null,
  description text,
  cost numeric(10,2) not null default 0 check (cost >= 0),
  status public.treatment_status not null default 'planned',
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.diagnoses (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  provider_id uuid references public.profiles(id),
  diagnosis_date date not null default current_date,
  diagnosis_name text not null,
  diagnosis_code text,
  affected_tooth text,
  status text not null default 'active',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null unique,
  patient_id uuid not null references public.patients(id) on delete cascade,
  appointment_id uuid references public.appointments(id) on delete set null,
  invoice_date date not null default current_date,
  due_date date,
  subtotal numeric(10,2) not null default 0 check (subtotal >= 0),
  tax numeric(10,2) not null default 0 check (tax >= 0),
  discount numeric(10,2) not null default 0 check (discount >= 0),
  total numeric(10,2) not null default 0 check (total >= 0),
  amount_paid numeric(10,2) not null default 0 check (amount_paid >= 0),
  balance numeric(10,2) not null default 0 check (balance >= 0),
  status public.invoice_status not null default 'pending',
  payment_method text,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  treatment_id uuid references public.treatments(id) on delete set null,
  description text not null,
  quantity integer not null default 1 check (quantity > 0),
  unit_price numeric(10,2) not null default 0 check (unit_price >= 0),
  total numeric(10,2) not null default 0 check (total >= 0),
  created_at timestamptz not null default now()
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index patients_name_idx on public.patients (last_name, first_name);
create index appointments_date_idx on public.appointments (appointment_date, appointment_time);
create index appointments_provider_idx on public.appointments (provider_id, appointment_date);
create index clinical_notes_patient_idx on public.clinical_notes (patient_id, note_date desc);
create index medical_history_patient_idx on public.medical_history (patient_id, record_type);
create index dental_chart_patient_idx on public.dental_chart_records (patient_id, tooth_number);
create index invoices_patient_idx on public.invoices (patient_id, invoice_date desc);

create or replace function public.current_user_role()
returns public.app_role language sql stable security definer set search_path = public
as $$ select role from public.profiles where id = auth.uid() and is_active = true $$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce(public.current_user_role() = 'admin', false) $$;

create or replace function public.set_updated_at()
returns trigger language plpgsql security invoker
as $$ begin new.updated_at = now(); return new; end $$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles', 'practice_settings', 'patients', 'appointments',
    'clinical_notes', 'medical_history', 'dental_chart_records',
    'treatments', 'diagnoses', 'invoices', 'invoice_items', 'audit_events'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
  end loop;
end $$;

create policy profiles_self_or_admin on public.profiles for select to authenticated using (id = auth.uid() or public.is_admin());
create policy profiles_admin_write on public.profiles for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy practice_settings_read on public.practice_settings for select to authenticated using (true);
create policy practice_settings_admin_write on public.practice_settings for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy patients_access on public.patients for all to authenticated using (true) with check (true);
create policy appointments_access on public.appointments for all to authenticated using (true) with check (true);
create policy clinical_notes_access on public.clinical_notes for all to authenticated using (public.current_user_role() in ('admin', 'dentist') and (not is_private or author_id = auth.uid() or public.is_admin())) with check (public.current_user_role() in ('admin', 'dentist') and (not is_private or author_id = auth.uid() or public.is_admin()));
create policy medical_history_access on public.medical_history for all to authenticated using (public.current_user_role() in ('admin', 'dentist')) with check (public.current_user_role() in ('admin', 'dentist'));
create policy dental_chart_access on public.dental_chart_records for all to authenticated using (public.current_user_role() in ('admin', 'dentist')) with check (public.current_user_role() in ('admin', 'dentist'));
create policy treatments_access on public.treatments for all to authenticated using (public.current_user_role() in ('admin', 'dentist')) with check (public.current_user_role() in ('admin', 'dentist'));
create policy diagnoses_access on public.diagnoses for all to authenticated using (public.current_user_role() in ('admin', 'dentist')) with check (public.current_user_role() in ('admin', 'dentist'));
create policy invoices_access on public.invoices for all to authenticated using (true) with check (true);
create policy invoice_items_access on public.invoice_items for all to authenticated using (true) with check (true);
create policy audit_events_access on public.audit_events for select to authenticated using (actor_id = auth.uid() or public.is_admin());
create policy audit_events_insert on public.audit_events for insert to authenticated with check (actor_id = auth.uid());

create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger practice_settings_updated_at before update on public.practice_settings for each row execute function public.set_updated_at();
create trigger patients_updated_at before update on public.patients for each row execute function public.set_updated_at();
create trigger appointments_updated_at before update on public.appointments for each row execute function public.set_updated_at();
create trigger clinical_notes_updated_at before update on public.clinical_notes for each row execute function public.set_updated_at();
create trigger medical_history_updated_at before update on public.medical_history for each row execute function public.set_updated_at();
create trigger dental_chart_updated_at before update on public.dental_chart_records for each row execute function public.set_updated_at();
create trigger treatments_updated_at before update on public.treatments for each row execute function public.set_updated_at();
create trigger diagnoses_updated_at before update on public.diagnoses for each row execute function public.set_updated_at();
create trigger invoices_updated_at before update on public.invoices for each row execute function public.set_updated_at();

-- Add the first staff profile only after creating that user in Supabase Auth:
-- insert into public.profiles (id, email, full_name, role)
-- values ('AUTH_USER_UUID', 'admin@example.com', 'Practice Administrator', 'admin');
