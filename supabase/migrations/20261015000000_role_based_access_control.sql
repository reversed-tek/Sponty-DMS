begin;

-- ============================================================
-- Role-based access control
-- ============================================================
-- UI intent:
--   receptionist -> Appointments + Billing
--   dentist      -> Dashboard + Patients + Appointments + Cases + Billing
--   admin        -> all application areas
--
-- Reception still needs limited supporting reads for patient/provider names
-- and active Case choices while booking/checking in appointments. Sensitive
-- clinical tables remain dentist/admin only.

-- ============================================================
-- Practice settings
-- ============================================================

drop policy if exists practice_settings_read on public.practice_settings;
create policy practice_settings_read
on public.practice_settings
for select
to authenticated
using (public.current_user_role() in ('admin', 'dentist', 'receptionist'));

-- Existing practice_settings_admin_write remains admin-only.

-- ============================================================
-- Patients
-- ============================================================

drop policy if exists patients_access on public.patients;
drop policy if exists patients_select_staff on public.patients;
drop policy if exists patients_insert_clinical on public.patients;
drop policy if exists patients_update_clinical on public.patients;
drop policy if exists patients_delete_clinical on public.patients;

-- Reception requires patient identity data for appointment and billing
-- selectors, but cannot create/edit/delete patient records.
create policy patients_select_staff
on public.patients
for select
to authenticated
using (public.current_user_role() in ('admin', 'dentist', 'receptionist'));

create policy patients_insert_clinical
on public.patients
for insert
to authenticated
with check (public.current_user_role() in ('admin', 'dentist'));

create policy patients_update_clinical
on public.patients
for update
to authenticated
using (public.current_user_role() in ('admin', 'dentist'))
with check (public.current_user_role() in ('admin', 'dentist'));

create policy patients_delete_clinical
on public.patients
for delete
to authenticated
using (public.current_user_role() in ('admin', 'dentist'));

-- ============================================================
-- Appointments
-- ============================================================

drop policy if exists appointments_access on public.appointments;
drop policy if exists appointments_select_access on public.appointments;
drop policy if exists appointments_insert_access on public.appointments;
drop policy if exists appointments_update_access on public.appointments;

create policy appointments_select_access
on public.appointments
for select
to authenticated
using (public.current_user_role() in ('admin', 'dentist', 'receptionist'));

create policy appointments_insert_access
on public.appointments
for insert
to authenticated
with check (public.current_user_role() in ('admin', 'dentist', 'receptionist'));

create policy appointments_update_access
on public.appointments
for update
to authenticated
using (public.current_user_role() in ('admin', 'dentist', 'receptionist'))
with check (public.current_user_role() in ('admin', 'dentist', 'receptionist'));

-- Direct DELETE stays intentionally unavailable. The safe delete RPC already
-- limits permanent appointment deletion to receptionist/admin.

-- ============================================================
-- Billing
-- ============================================================

drop policy if exists invoices_access on public.invoices;
drop policy if exists invoices_select_staff on public.invoices;
drop policy if exists invoices_admin_write on public.invoices;

create policy invoices_select_staff
on public.invoices
for select
to authenticated
using (public.current_user_role() in ('admin', 'dentist', 'receptionist'));

-- Normal invoice creation/payment is performed through trusted workflow
-- functions. Only admin receives direct table write access.
create policy invoices_admin_write
on public.invoices
for all
to authenticated
using (public.current_user_role() = 'admin')
with check (public.current_user_role() = 'admin');

drop policy if exists invoice_items_access on public.invoice_items;
drop policy if exists invoice_items_select_staff on public.invoice_items;
drop policy if exists invoice_items_admin_write on public.invoice_items;

create policy invoice_items_select_staff
on public.invoice_items
for select
to authenticated
using (public.current_user_role() in ('admin', 'dentist', 'receptionist'));

create policy invoice_items_admin_write
on public.invoice_items
for all
to authenticated
using (public.current_user_role() = 'admin')
with check (public.current_user_role() = 'admin');

-- ============================================================
-- Cases and clinical automation
-- ============================================================

drop policy if exists cases_access on public.cases;
drop policy if exists cases_clinical_access on public.cases;

create policy cases_clinical_access
on public.cases
for all
to authenticated
using (public.current_user_role() in ('admin', 'dentist'))
with check (public.current_user_role() in ('admin', 'dentist'));

drop policy if exists case_events_read on public.case_events;
create policy case_events_read
on public.case_events
for select
to authenticated
using (public.current_user_role() in ('admin', 'dentist'));

drop policy if exists case_assignments_read on public.case_assignments;
create policy case_assignments_read
on public.case_assignments
for select
to authenticated
using (public.current_user_role() in ('admin', 'dentist'));

drop policy if exists treatment_plan_items_access on public.treatment_plan_items;
create policy treatment_plan_items_access
on public.treatment_plan_items
for all
to authenticated
using (public.current_user_role() in ('admin', 'dentist'))
with check (public.current_user_role() in ('admin', 'dentist'));

drop policy if exists case_tasks_access on public.case_tasks;
create policy case_tasks_access
on public.case_tasks
for all
to authenticated
using (public.current_user_role() in ('admin', 'dentist'))
with check (public.current_user_role() in ('admin', 'dentist'));

drop policy if exists patient_recalls_access on public.patient_recalls;
create policy patient_recalls_access
on public.patient_recalls
for all
to authenticated
using (public.current_user_role() in ('admin', 'dentist'))
with check (public.current_user_role() in ('admin', 'dentist'));

-- ============================================================
-- Patient portal staff-side data
-- ============================================================

drop policy if exists access_tokens_staff_access on public.access_tokens;
create policy access_tokens_staff_access
on public.access_tokens
for all
to authenticated
using (public.current_user_role() in ('admin', 'dentist'))
with check (public.current_user_role() in ('admin', 'dentist'));

drop policy if exists portal_sessions_staff_access on public.portal_sessions;
create policy portal_sessions_staff_access
on public.portal_sessions
for all
to authenticated
using (public.current_user_role() in ('admin', 'dentist'))
with check (public.current_user_role() in ('admin', 'dentist'));

-- Payment proof metadata is billing-related, so reception may access it.
drop policy if exists payment_proofs_staff_access on public.payment_proofs;
create policy payment_proofs_staff_access
on public.payment_proofs
for all
to authenticated
using (public.current_user_role() in ('admin', 'dentist', 'receptionist'))
with check (public.current_user_role() in ('admin', 'dentist', 'receptionist'));

drop policy if exists patient_documents_staff_access on public.patient_documents;
create policy patient_documents_staff_access
on public.patient_documents
for all
to authenticated
using (public.current_user_role() in ('admin', 'dentist'))
with check (public.current_user_role() in ('admin', 'dentist'));

drop policy if exists payment_proofs_staff_storage on storage.objects;
create policy payment_proofs_staff_storage
on storage.objects
for all
to authenticated
using (
  bucket_id = 'payment-proofs'
  and public.current_user_role() in ('admin', 'dentist', 'receptionist')
)
with check (
  bucket_id = 'payment-proofs'
  and public.current_user_role() in ('admin', 'dentist', 'receptionist')
);

drop policy if exists patient_documents_staff_storage on storage.objects;
create policy patient_documents_staff_storage
on storage.objects
for all
to authenticated
using (
  bucket_id = 'patient-documents'
  and public.current_user_role() in ('admin', 'dentist')
)
with check (
  bucket_id = 'patient-documents'
  and public.current_user_role() in ('admin', 'dentist')
);

-- ============================================================
-- Limited Case directory for reception appointment workflows
-- ============================================================

create or replace function public.list_patient_active_cases_for_staff(
  p_patient_id uuid
)
returns table (
  id uuid,
  case_number text,
  title text,
  status text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role public.app_role;
begin
  caller_role := public.current_user_role();

  if caller_role is null
     or caller_role not in ('admin', 'dentist', 'receptionist') then
    raise exception 'staff_profile_required';
  end if;

  return query
  select
    c.id,
    c.case_number,
    c.title,
    c.status,
    c.updated_at
  from public.cases c
  where c.patient_id = p_patient_id
    and c.status in ('open', 'in_treatment', 'treatment_complete')
  order by c.updated_at desc;
end;
$$;

revoke all on function public.list_patient_active_cases_for_staff(uuid) from public;
grant execute on function public.list_patient_active_cases_for_staff(uuid) to authenticated;

-- ============================================================
-- Protect security-definer clinical automation RPCs
-- ============================================================

create or replace function public.upsert_case_task(
  p_case_id uuid,
  p_task_type text,
  p_title text,
  p_description text default null,
  p_priority text default 'normal',
  p_due_at timestamptz default null,
  p_appointment_id uuid default null,
  p_dedupe_key text default null,
  p_source text default 'automated'
)
returns public.case_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  task_row public.case_tasks;
  existing_task_id uuid;
  caller_role public.app_role;
begin
  caller_role := public.current_user_role();

  if caller_role is null or caller_role not in ('admin', 'dentist') then
    raise exception 'dentist_or_admin_required';
  end if;

  if p_case_id is null then
    raise exception 'case_id_required';
  end if;

  if p_priority not in ('low', 'normal', 'high', 'urgent') then
    raise exception 'invalid_task_priority';
  end if;

  if p_source not in ('manual', 'automated') then
    raise exception 'invalid_task_source';
  end if;

  if p_dedupe_key is not null then
    select id
    into existing_task_id
    from public.case_tasks
    where case_id = p_case_id
      and dedupe_key = p_dedupe_key
      and status = 'open'
    limit 1
    for update;
  end if;

  if existing_task_id is not null then
    update public.case_tasks
    set
      task_type = p_task_type,
      title = p_title,
      description = p_description,
      priority = p_priority,
      due_at = p_due_at,
      appointment_id = coalesce(p_appointment_id, appointment_id),
      updated_at = now()
    where id = existing_task_id
    returning * into task_row;

    return task_row;
  end if;

  insert into public.case_tasks (
    case_id,
    appointment_id,
    task_type,
    title,
    description,
    priority,
    source,
    dedupe_key,
    due_at,
    assigned_provider_id,
    created_by
  )
  select
    p_case_id,
    p_appointment_id,
    p_task_type,
    p_title,
    p_description,
    p_priority,
    p_source,
    p_dedupe_key,
    p_due_at,
    c.assigned_provider_id,
    auth.uid()
  from public.cases c
  where c.id = p_case_id
  returning * into task_row;

  perform public.add_case_event(
    p_case_id,
    'task_created',
    'Task created',
    p_title,
    p_appointment_id,
    jsonb_build_object(
      'task_id', task_row.id,
      'task_type', p_task_type,
      'priority', p_priority,
      'source', p_source
    )
  );

  return task_row;
end;
$$;

create or replace function public.complete_case_task(p_task_id uuid)
returns public.case_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  task_row public.case_tasks;
  caller_role public.app_role;
begin
  caller_role := public.current_user_role();

  if caller_role is null or caller_role not in ('admin', 'dentist') then
    raise exception 'dentist_or_admin_required';
  end if;

  update public.case_tasks
  set
    status = 'completed',
    completed_by = auth.uid(),
    completed_at = now(),
    updated_at = now()
  where id = p_task_id
    and status = 'open'
  returning * into task_row;

  if not found then
    raise exception 'open_task_not_found';
  end if;

  perform public.add_case_event(
    task_row.case_id,
    'task_completed',
    'Task completed',
    task_row.title,
    task_row.appointment_id,
    jsonb_build_object('task_id', task_row.id, 'task_type', task_row.task_type)
  );

  return task_row;
end;
$$;

create or replace function public.schedule_patient_recall(
  p_patient_id uuid,
  p_case_id uuid default null,
  p_interval_months integer default 6,
  p_recall_type text default 'preventive',
  p_notes text default null,
  p_source text default 'automated'
)
returns public.patient_recalls
language plpgsql
security definer
set search_path = public
as $$
declare
  recall_row public.patient_recalls;
  caller_role public.app_role;
begin
  caller_role := public.current_user_role();

  if caller_role is null or caller_role not in ('admin', 'dentist') then
    raise exception 'dentist_or_admin_required';
  end if;

  if p_interval_months is null or p_interval_months <= 0 then
    raise exception 'recall_interval_must_be_positive';
  end if;

  if p_recall_type not in ('preventive', 'follow_up') then
    raise exception 'invalid_recall_type';
  end if;

  if p_source not in ('manual', 'automated') then
    raise exception 'invalid_recall_source';
  end if;

  if p_case_id is not null then
    select *
    into recall_row
    from public.patient_recalls
    where case_id = p_case_id
      and recall_type = p_recall_type
      and status in ('open', 'scheduled')
    limit 1
    for update;
  else
    select *
    into recall_row
    from public.patient_recalls
    where patient_id = p_patient_id
      and case_id is null
      and recall_type = p_recall_type
      and status in ('open', 'scheduled')
    order by due_date
    limit 1
    for update;
  end if;

  if recall_row.id is not null then
    update public.patient_recalls
    set
      due_date = (current_date + make_interval(months => p_interval_months))::date,
      interval_months = p_interval_months,
      notes = coalesce(p_notes, notes),
      status = 'open',
      related_appointment_id = null,
      updated_at = now()
    where id = recall_row.id
    returning * into recall_row;

    return recall_row;
  end if;

  insert into public.patient_recalls (
    patient_id,
    case_id,
    recall_type,
    due_date,
    interval_months,
    status,
    source,
    notes,
    created_by
  )
  values (
    p_patient_id,
    p_case_id,
    p_recall_type,
    (current_date + make_interval(months => p_interval_months))::date,
    p_interval_months,
    'open',
    p_source,
    p_notes,
    auth.uid()
  )
  returning * into recall_row;

  if p_case_id is not null then
    perform public.add_case_event(
      p_case_id,
      'recall_scheduled',
      'Recall scheduled',
      'Recall due ' || recall_row.due_date::text,
      null,
      jsonb_build_object(
        'recall_id', recall_row.id,
        'recall_type', recall_row.recall_type,
        'due_date', recall_row.due_date,
        'interval_months', recall_row.interval_months
      )
    );
  end if;

  return recall_row;
end;
$$;

-- Patient portal issuance is a Patients-module action, so reception cannot call
-- the security-definer RPC directly.
create or replace function public.issue_patient_portal_access(
  p_patient_id uuid,
  p_expires_at timestamptz default now() + interval '24 hours'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  raw_token text;
  raw_code text;
  code_bytes bytea;
  code_value integer;
  token_id uuid;
  caller_role public.app_role;
begin
  caller_role := public.current_user_role();

  if caller_role is null or caller_role not in ('admin', 'dentist') then
    raise exception 'dentist_or_admin_required';
  end if;

  if not exists (
    select 1
    from public.patients
    where id = p_patient_id
      and is_active
  ) then
    raise exception 'patient_not_found';
  end if;

  raw_token := encode(extensions.gen_random_bytes(32), 'hex');

  code_bytes := extensions.gen_random_bytes(3);
  code_value :=
      get_byte(code_bytes, 0) * 65536
    + get_byte(code_bytes, 1) * 256
    + get_byte(code_bytes, 2);
  raw_code := lpad((code_value % 1000000)::text, 6, '0');

  insert into public.access_tokens (
    patient_id,
    token_hash,
    verification_code_hash,
    purpose,
    expires_at,
    created_by
  )
  values (
    p_patient_id,
    encode(extensions.digest(raw_token, 'sha256'), 'hex'),
    encode(extensions.digest(raw_code, 'sha256'), 'hex'),
    'patient_portal',
    p_expires_at,
    auth.uid()
  )
  returning id into token_id;

  return jsonb_build_object(
    'token', raw_token,
    'verification_code', raw_code,
    'expires_at', p_expires_at
  );
end;
$$;

-- Legacy unverified portal-token issuance is not used by the current frontend.
-- Remove direct authenticated access so RBAC cannot be bypassed through it.
revoke execute on function public.issue_patient_portal_token(uuid, timestamptz)
  from authenticated;

commit;
