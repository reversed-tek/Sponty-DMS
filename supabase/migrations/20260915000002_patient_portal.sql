-- Passwordless patient portal: one-time access links, short-lived sessions, invoices, and private storage.
-- Apply after the base schema and waitlist migrations.

create extension if not exists pgcrypto;

alter type public.invoice_status add value if not exists 'unpaid';
alter type public.invoice_status add value if not exists 'pending_verification';

alter table public.practice_settings
  add column if not exists bank_name text,
  add column if not exists bank_account_name text,
  add column if not exists bank_account_number text,
  add column if not exists portal_staff_email text;

create table if not exists public.access_tokens (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  token_hash text not null unique,
  purpose text not null default 'patient_portal',
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.portal_sessions (
  id uuid primary key default gen_random_uuid(),
  access_token_id uuid not null references public.access_tokens(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  session_hash text not null unique,
  expires_at timestamptz not null default now() + interval '30 minutes',
  created_at timestamptz not null default now()
);

create table if not exists public.payment_proofs (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  content_type text not null,
  uploaded_at timestamptz not null default now(),
  verified_at timestamptz,
  verified_by uuid references public.profiles(id)
);

create table if not exists public.patient_documents (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  content_type text not null,
  uploaded_at timestamptz not null default now()
);

create index if not exists access_tokens_hash_idx on public.access_tokens (token_hash, expires_at);
create index if not exists portal_sessions_hash_idx on public.portal_sessions (session_hash, expires_at);
create index if not exists payment_proofs_invoice_idx on public.payment_proofs (invoice_id, uploaded_at desc);
create index if not exists patient_documents_patient_idx on public.patient_documents (patient_id, uploaded_at desc);

alter table public.access_tokens enable row level security;
alter table public.portal_sessions enable row level security;
alter table public.payment_proofs enable row level security;
alter table public.patient_documents enable row level security;

drop policy if exists access_tokens_staff_access on public.access_tokens;
create policy access_tokens_staff_access on public.access_tokens for all to authenticated
  using (public.current_user_role() in ('admin', 'dentist', 'receptionist'))
  with check (public.current_user_role() in ('admin', 'dentist', 'receptionist'));
drop policy if exists portal_sessions_staff_access on public.portal_sessions;
create policy portal_sessions_staff_access on public.portal_sessions for all to authenticated
  using (public.current_user_role() in ('admin', 'dentist', 'receptionist'))
  with check (public.current_user_role() in ('admin', 'dentist', 'receptionist'));
drop policy if exists payment_proofs_staff_access on public.payment_proofs;
create policy payment_proofs_staff_access on public.payment_proofs for all to authenticated
  using (public.current_user_role() in ('admin', 'dentist', 'receptionist'))
  with check (public.current_user_role() in ('admin', 'dentist', 'receptionist'));
drop policy if exists patient_documents_staff_access on public.patient_documents;
create policy patient_documents_staff_access on public.patient_documents for all to authenticated
  using (public.current_user_role() in ('admin', 'dentist', 'receptionist'))
  with check (public.current_user_role() in ('admin', 'dentist', 'receptionist'));

insert into storage.buckets (id, name, public)
values ('payment-proofs', 'payment-proofs', false), ('patient-documents', 'patient-documents', false)
on conflict (id) do update set public = excluded.public;

create or replace function public.issue_patient_portal_token(
  p_patient_id uuid,
  p_expires_at timestamptz default now() + interval '24 hours'
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare raw_token text;
begin
  if public.current_user_role() is null then raise exception 'authenticated_profile_required'; end if;
  if not exists (select 1 from public.patients where id = p_patient_id and is_active) then raise exception 'patient_not_found'; end if;
  raw_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.access_tokens (patient_id, token_hash, expires_at, created_by)
  values (p_patient_id, encode(extensions.digest(raw_token, 'sha256'), 'hex'), p_expires_at, auth.uid());
  return raw_token;
end;
$$;
grant execute on function public.issue_patient_portal_token(uuid, timestamptz) to authenticated;

create or replace function public.consume_patient_portal_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare token_row public.access_tokens; raw_session text; patient_row public.patients;
begin
  select * into token_row from public.access_tokens
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and purpose = 'patient_portal' and consumed_at is null and expires_at > now()
  for update;
  if not found then raise exception 'portal_token_invalid_or_expired'; end if;
  update public.access_tokens set consumed_at = now() where id = token_row.id;
  raw_session := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.portal_sessions (access_token_id, patient_id, session_hash)
  values (token_row.id, token_row.patient_id, encode(extensions.digest(raw_session, 'sha256'), 'hex'));
  select * into patient_row from public.patients where id = token_row.patient_id;
  return jsonb_build_object('session_token', raw_session, 'patient_id', patient_row.id, 'patient_name', patient_row.first_name || ' ' || patient_row.last_name, 'expires_at', now() + interval '30 minutes');
end;
$$;
grant execute on function public.consume_patient_portal_token(text) to anon, authenticated;

create or replace function public.get_patient_portal_data(p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare session_row public.portal_sessions; patient_row public.patients; result jsonb;
begin
  select * into session_row from public.portal_sessions
  where session_hash = encode(extensions.digest(p_session_token, 'sha256'), 'hex') and expires_at > now();
  if not found then raise exception 'portal_session_invalid_or_expired'; end if;
  select * into patient_row from public.patients where id = session_row.patient_id;
  select jsonb_build_object(
    'patient_id', patient_row.id,
    'patient_name', patient_row.first_name || ' ' || patient_row.last_name,
    'invoices', coalesce((select jsonb_agg(i order by i.invoice_date desc) from public.invoices i where i.patient_id = session_row.patient_id and i.status in ('unpaid', 'pending', 'pending_verification', 'paid')), '[]'::jsonb),
    'documents', coalesce((select jsonb_agg(d order by d.uploaded_at desc) from public.patient_documents d where d.patient_id = session_row.patient_id), '[]'::jsonb),
    'bank', (select jsonb_build_object('bank_name', bank_name, 'account_name', bank_account_name, 'account_number', bank_account_number) from public.practice_settings where id = true)
  ) into result;
  return result;
end;
$$;
grant execute on function public.get_patient_portal_data(text) to anon, authenticated;

create or replace function public.mark_invoice_pending_verification(p_session_token text, p_invoice_id uuid, p_storage_path text, p_file_name text, p_content_type text)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare session_row public.portal_sessions;
begin
  select * into session_row from public.portal_sessions where session_hash = encode(extensions.digest(p_session_token, 'sha256'), 'hex') and expires_at > now();
  if not found then raise exception 'portal_session_invalid_or_expired'; end if;
  if not exists (select 1 from public.invoices where id = p_invoice_id and patient_id = session_row.patient_id) then raise exception 'invoice_not_found'; end if;
  insert into public.payment_proofs (invoice_id, patient_id, storage_path, file_name, content_type) values (p_invoice_id, session_row.patient_id, p_storage_path, p_file_name, p_content_type);
  update public.invoices set status = 'pending_verification', updated_at = now() where id = p_invoice_id and patient_id = session_row.patient_id;
  return true;
end;
$$;
grant execute on function public.mark_invoice_pending_verification(text, uuid, text, text, text) to anon, authenticated;

-- Storage is private. The portal upload edge function validates portal_sessions, then returns a short-lived signed upload URL.
-- Staff access remains governed by authenticated storage policies; service-role uploads from the edge function bypass these policies.
drop policy if exists payment_proofs_staff_storage on storage.objects;
create policy payment_proofs_staff_storage on storage.objects for all to authenticated
  using (bucket_id = 'payment-proofs' and public.current_user_role() in ('admin', 'dentist', 'receptionist'))
  with check (bucket_id = 'payment-proofs' and public.current_user_role() in ('admin', 'dentist', 'receptionist'));
drop policy if exists patient_documents_staff_storage on storage.objects;
create policy patient_documents_staff_storage on storage.objects for all to authenticated
  using (bucket_id = 'patient-documents' and public.current_user_role() in ('admin', 'dentist', 'receptionist'))
  with check (bucket_id = 'patient-documents' and public.current_user_role() in ('admin', 'dentist', 'receptionist'));
