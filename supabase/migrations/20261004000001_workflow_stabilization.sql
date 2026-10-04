begin;

-- ============================================================
-- PR8: Workflow stabilization and case-centric operations
-- ============================================================
-- Cases now track clinical state independently from billing state.
-- A case may contain multiple appointments and therefore multiple invoices.

alter table public.cases
  add column if not exists billing_status text not null default 'not_billed',
  add column if not exists priority text not null default 'normal',
  add column if not exists last_activity_at timestamptz not null default now();

alter table public.cases
  drop constraint if exists cases_status_check;

update public.cases
set status = 'treatment_complete'
where status = 'awaiting_payment';

alter table public.cases
  add constraint cases_status_check
  check (status in ('open', 'in_treatment', 'treatment_complete', 'closed'));

alter table public.cases
  drop constraint if exists cases_billing_status_check;

alter table public.cases
  add constraint cases_billing_status_check
  check (billing_status in ('not_billed', 'pending', 'partial', 'paid'));

alter table public.cases
  drop constraint if exists cases_priority_check;

alter table public.cases
  add constraint cases_priority_check
  check (priority in ('low', 'normal', 'high', 'urgent'));

-- One Case may span several visits. Keep one invoice per appointment, but
-- remove the previous one-invoice-per-case restriction.
drop index if exists public.invoices_case_unique;

create index if not exists cases_priority_activity_idx
  on public.cases (status, priority, last_activity_at desc);

-- ============================================================
-- Case event timeline
-- ============================================================

create table if not exists public.case_events (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  appointment_id uuid references public.appointments(id) on delete set null,
  actor_id uuid references public.profiles(id) on delete set null,
  event_type text not null,
  title text not null,
  detail text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists case_events_case_created_idx
  on public.case_events (case_id, created_at desc);

alter table public.case_events enable row level security;

drop policy if exists case_events_read on public.case_events;
create policy case_events_read
on public.case_events
for select
to authenticated
using (true);

-- Writes are intentionally performed through trusted workflow functions/triggers.
drop policy if exists case_events_write on public.case_events;

-- ============================================================
-- Case assignment history
-- ============================================================

create table if not exists public.case_assignments (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  provider_id uuid references public.profiles(id) on delete set null,
  assigned_by uuid references public.profiles(id) on delete set null,
  assigned_at timestamptz not null default now(),
  unassigned_at timestamptz,
  reason text
);

create index if not exists case_assignments_case_idx
  on public.case_assignments (case_id, assigned_at desc);

create unique index if not exists case_assignments_one_active_idx
  on public.case_assignments (case_id)
  where unassigned_at is null;

alter table public.case_assignments enable row level security;

drop policy if exists case_assignments_read on public.case_assignments;
create policy case_assignments_read
on public.case_assignments
for select
to authenticated
using (true);

drop policy if exists case_assignments_write on public.case_assignments;

insert into public.case_assignments (
  case_id,
  provider_id,
  assigned_by,
  assigned_at,
  reason
)
select
  c.id,
  c.assigned_provider_id,
  c.created_by,
  coalesce(c.updated_at, c.created_at),
  'Backfilled current assignment'
from public.cases c
where c.assigned_provider_id is not null
  and not exists (
    select 1
    from public.case_assignments ca
    where ca.case_id = c.id
      and ca.unassigned_at is null
  );

-- ============================================================
-- Case event helper
-- ============================================================

create or replace function public.add_case_event(
  p_case_id uuid,
  p_event_type text,
  p_title text,
  p_detail text default null,
  p_appointment_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  event_id uuid;
begin
  if p_case_id is null then
    return null;
  end if;

  insert into public.case_events (
    case_id,
    appointment_id,
    actor_id,
    event_type,
    title,
    detail,
    metadata
  )
  values (
    p_case_id,
    p_appointment_id,
    auth.uid(),
    p_event_type,
    p_title,
    p_detail,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into event_id;

  update public.cases
  set last_activity_at = now()
  where id = p_case_id;

  return event_id;
end;
$$;

revoke all on function public.add_case_event(uuid, text, text, text, uuid, jsonb) from public;

-- ============================================================
-- Billing state is derived independently from clinical state
-- ============================================================

create or replace function public.refresh_case_billing_status(p_case_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  invoice_count integer;
  total_paid numeric(12,2);
  total_balance numeric(12,2);
  next_status text;
begin
  if p_case_id is null then
    return null;
  end if;

  select
    count(*),
    coalesce(sum(amount_paid), 0),
    coalesce(sum(balance), 0)
  into invoice_count, total_paid, total_balance
  from public.invoices
  where case_id = p_case_id
    and status <> 'cancelled';

  next_status :=
    case
      when invoice_count = 0 then 'not_billed'
      when total_balance = 0 then 'paid'
      when total_paid > 0 then 'partial'
      else 'pending'
    end;

  update public.cases
  set billing_status = next_status,
      updated_at = now()
  where id = p_case_id;

  return next_status;
end;
$$;

revoke all on function public.refresh_case_billing_status(uuid) from public;

do $$
declare
  c record;
begin
  for c in select id from public.cases loop
    perform public.refresh_case_billing_status(c.id);
  end loop;
end;
$$;

-- Payment must never determine appointment completion or clinical case state.
drop trigger if exists invoices_complete_paid_appointment on public.invoices;
drop trigger if exists invoices_sync_case_status on public.invoices;

create or replace function public.sync_case_from_invoice()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_case_id uuid;
begin
  target_case_id :=
    case
      when tg_op = 'DELETE' then old.case_id
      else new.case_id
    end;

  if target_case_id is not null then
    perform public.refresh_case_billing_status(target_case_id);
    update public.cases
    set last_activity_at = now()
    where id = target_case_id;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

create trigger invoices_sync_case_status
after insert or update of status, balance, amount_paid, total or delete
on public.invoices
for each row execute function public.sync_case_from_invoice();

-- ============================================================
-- Appointment event + assignment tracking
-- ============================================================

create or replace function public.track_case_from_appointment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.case_id is null then
    return new;
  end if;

  if old.checked_in_at is null and new.checked_in_at is not null then
    perform public.add_case_event(
      new.case_id,
      'patient_checked_in',
      'Patient checked in',
      coalesce(new.reason, 'Appointment checked in'),
      new.id,
      jsonb_build_object('appointment_status', new.status::text)
    );
  end if;

  if old.handed_over_at is null and new.handed_over_at is not null then
    update public.case_assignments
    set unassigned_at = now()
    where case_id = new.case_id
      and unassigned_at is null
      and provider_id is distinct from new.provider_id;

    if new.provider_id is not null
       and not exists (
         select 1
         from public.case_assignments
         where case_id = new.case_id
           and provider_id = new.provider_id
           and unassigned_at is null
       ) then
      insert into public.case_assignments (
        case_id,
        provider_id,
        assigned_by,
        reason
      )
      values (
        new.case_id,
        new.provider_id,
        auth.uid(),
        'Appointment handover'
      );
    end if;

    perform public.add_case_event(
      new.case_id,
      'case_assigned',
      'Case handed to dentist',
      'Appointment handover completed',
      new.id,
      jsonb_build_object('provider_id', new.provider_id)
    );
  end if;

  return new;
end;
$$;

drop trigger if exists appointments_track_case_events on public.appointments;
create trigger appointments_track_case_events
after update of checked_in_at, handed_over_at
on public.appointments
for each row execute function public.track_case_from_appointment();

-- Keep Case assignment aligned if the assigned dentist changes after handover.
create or replace function public.sync_case_assignment_from_appointment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.case_id is not null
     and new.provider_id is distinct from old.provider_id
     and new.handed_over_at is not null then

    update public.case_assignments
    set unassigned_at = now()
    where case_id = new.case_id
      and unassigned_at is null;

    if new.provider_id is not null then
      insert into public.case_assignments (
        case_id,
        provider_id,
        assigned_by,
        reason
      )
      values (
        new.case_id,
        new.provider_id,
        auth.uid(),
        'Appointment dentist changed'
      );
    end if;

    update public.cases
    set assigned_provider_id = new.provider_id,
        updated_at = now(),
        last_activity_at = now()
    where id = new.case_id
      and status <> 'closed';

    perform public.add_case_event(
      new.case_id,
      'case_reassigned',
      'Case reassigned',
      'Assigned dentist changed',
      new.id,
      jsonb_build_object(
        'old_provider_id', old.provider_id,
        'new_provider_id', new.provider_id
      )
    );
  end if;

  return new;
end;
$$;

-- Existing trigger name is reused from PR6.
drop trigger if exists appointments_sync_case_assignment on public.appointments;
create trigger appointments_sync_case_assignment
after update of provider_id
on public.appointments
for each row execute function public.sync_case_assignment_from_appointment();

-- ============================================================
-- Clinical activity timeline
-- ============================================================

create or replace function public.touch_case_from_clinical_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_case_id uuid;
  target_appointment_id uuid;
  target_title text;
  target_detail text;
  target_event text;
begin
  target_case_id :=
    case when tg_op = 'DELETE' then old.case_id else new.case_id end;

  target_appointment_id :=
    case when tg_op = 'DELETE' then old.appointment_id else new.appointment_id end;

  if target_case_id is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_table_name = 'clinical_notes' then
    target_event := 'clinical_note_' || lower(tg_op);
    target_title :=
      case tg_op
        when 'INSERT' then 'Clinical note added'
        when 'UPDATE' then 'Clinical note updated'
        else 'Clinical note removed'
      end;
    target_detail :=
      case when tg_op = 'DELETE' then old.visit_type else new.visit_type end;
  else
    target_event := 'treatment_' || lower(tg_op);
    target_title :=
      case tg_op
        when 'INSERT' then 'Treatment added'
        when 'UPDATE' then 'Treatment updated'
        else 'Treatment removed'
      end;
    target_detail :=
      case when tg_op = 'DELETE' then old.procedure_name else new.procedure_name end;
  end if;

  update public.cases
  set
    status = case
      when status in ('closed', 'treatment_complete') then status
      else 'in_treatment'
    end,
    last_activity_at = now(),
    updated_at = now()
  where id = target_case_id;

  perform public.add_case_event(
    target_case_id,
    target_event,
    target_title,
    target_detail,
    target_appointment_id,
    jsonb_build_object('source_table', tg_table_name)
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists clinical_notes_touch_case on public.clinical_notes;
create trigger clinical_notes_touch_case
after insert or update or delete
on public.clinical_notes
for each row execute function public.touch_case_from_clinical_activity();

drop trigger if exists treatments_touch_case on public.treatments;
create trigger treatments_touch_case
after insert or update or delete
on public.treatments
for each row execute function public.touch_case_from_clinical_activity();

-- ============================================================
-- Complete one visit, not the entire Case
-- ============================================================

create or replace function public.complete_case_visit(
  p_case_id uuid,
  p_appointment_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  case_row public.cases;
  appointment_row public.appointments;
  invoice_row public.invoices;
  treatment_count integer;
  remaining_active_appointments integer;
  remaining_active_treatments integer;
  calculated_total numeric(10,2);
  calculated_balance numeric(10,2);
  next_invoice_status public.invoice_status;
  next_case_status text;
  caller_role public.app_role;
  generated_invoice_number text;
begin
  caller_role := public.current_user_role();

  if caller_role is null or caller_role not in ('admin', 'dentist') then
    raise exception 'dentist_or_admin_required';
  end if;

  select *
  into case_row
  from public.cases
  where id = p_case_id
  for update;

  if not found then
    raise exception 'case_not_found';
  end if;

  if case_row.status = 'closed' then
    raise exception 'closed_case_must_be_reopened_before_work';
  end if;

  select *
  into appointment_row
  from public.appointments
  where id = p_appointment_id
    and case_id = p_case_id
  for update;

  if not found then
    raise exception 'appointment_not_found_in_case';
  end if;

  if appointment_row.status not in ('in_progress', 'completed') then
    raise exception 'appointment_must_be_handed_to_dentist_first';
  end if;

  select count(*)
  into treatment_count
  from public.treatments
  where case_id = p_case_id
    and appointment_id = p_appointment_id
    and status <> 'cancelled';

  if treatment_count = 0 then
    raise exception 'at_least_one_treatment_required_for_visit';
  end if;

  update public.treatments
  set status = 'completed'
  where case_id = p_case_id
    and appointment_id = p_appointment_id
    and status in ('planned', 'in_progress');

  generated_invoice_number :=
    'INV-' || to_char(current_date, 'YYYYMMDD') || '-' ||
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));

  insert into public.invoices (
    invoice_number,
    patient_id,
    appointment_id,
    case_id,
    subtotal,
    total,
    amount_paid,
    balance,
    status,
    notes,
    created_by
  )
  values (
    generated_invoice_number,
    case_row.patient_id,
    p_appointment_id,
    p_case_id,
    0,
    0,
    0,
    0,
    'pending',
    'Auto-generated for visit ' || p_appointment_id::text ||
      ' in case ' || case_row.case_number,
    auth.uid()
  )
  on conflict (appointment_id) where appointment_id is not null
  do update set
    patient_id = excluded.patient_id,
    case_id = excluded.case_id
  returning * into invoice_row;

  insert into public.invoice_items (
    invoice_id,
    treatment_id,
    description,
    quantity,
    unit_price,
    total
  )
  select
    invoice_row.id,
    t.id,
    t.procedure_name,
    1,
    t.cost,
    t.cost
  from public.treatments t
  where t.case_id = p_case_id
    and t.appointment_id = p_appointment_id
    and t.status <> 'cancelled'
  on conflict (invoice_id, treatment_id) where treatment_id is not null
  do update set
    description = excluded.description,
    quantity = excluded.quantity,
    unit_price = excluded.unit_price,
    total = excluded.total;

  delete from public.invoice_items ii
  where ii.invoice_id = invoice_row.id
    and ii.treatment_id is not null
    and not exists (
      select 1
      from public.treatments t
      where t.id = ii.treatment_id
        and t.case_id = p_case_id
        and t.appointment_id = p_appointment_id
        and t.status <> 'cancelled'
    );

  select coalesce(sum(ii.total), 0)::numeric(10,2)
  into calculated_total
  from public.invoice_items ii
  where ii.invoice_id = invoice_row.id;

  calculated_balance :=
    greatest(calculated_total - invoice_row.amount_paid, 0)::numeric(10,2);

  if calculated_total > 0 and calculated_balance = 0 then
    next_invoice_status := 'paid';
  elsif invoice_row.amount_paid > 0 then
    next_invoice_status := 'partial';
  elsif invoice_row.status::text = 'pending_verification' then
    next_invoice_status := 'pending_verification';
  else
    next_invoice_status := 'pending';
  end if;

  update public.invoices
  set
    subtotal = calculated_total,
    total = calculated_total,
    balance = calculated_balance,
    status = next_invoice_status,
    updated_at = now()
  where id = invoice_row.id
  returning * into invoice_row;

  update public.appointments
  set
    status = 'completed',
    treatment_completed_at = coalesce(treatment_completed_at, now()),
    updated_at = now()
  where id = p_appointment_id
  returning * into appointment_row;

  select count(*)
  into remaining_active_appointments
  from public.appointments
  where case_id = p_case_id
    and id <> p_appointment_id
    and status in ('scheduled', 'booked', 'confirmed', 'in_progress', 'open');

  select count(*)
  into remaining_active_treatments
  from public.treatments
  where case_id = p_case_id
    and status in ('planned', 'in_progress');

  next_case_status :=
    case
      when remaining_active_appointments = 0
       and remaining_active_treatments = 0 then 'treatment_complete'
      else 'in_treatment'
    end;

  update public.cases
  set
    status = next_case_status,
    last_activity_at = now(),
    updated_at = now()
  where id = p_case_id
  returning * into case_row;

  perform public.refresh_case_billing_status(p_case_id);

  perform public.add_case_event(
    p_case_id,
    'visit_completed',
    'Visit completed',
    'Treatment for this appointment was completed and its invoice was generated.',
    p_appointment_id,
    jsonb_build_object(
      'invoice_id', invoice_row.id,
      'invoice_number', invoice_row.invoice_number,
      'invoice_total', invoice_row.total,
      'treatment_count', treatment_count
    )
  );

  insert into public.audit_events (actor_id, action, entity_type, entity_id, details)
  values (
    auth.uid(),
    'case_visit_completed',
    'appointment',
    p_appointment_id,
    jsonb_build_object(
      'case_id', p_case_id,
      'invoice_id', invoice_row.id,
      'invoice_number', invoice_row.invoice_number,
      'total', invoice_row.total,
      'treatment_count', treatment_count
    )
  );

  return jsonb_build_object(
    'case_id', p_case_id,
    'case_number', case_row.case_number,
    'case_status', case_row.status,
    'billing_status', (
      select billing_status from public.cases where id = p_case_id
    ),
    'appointment_id', appointment_row.id,
    'appointment_status', appointment_row.status::text,
    'invoice_id', invoice_row.id,
    'invoice_number', invoice_row.invoice_number,
    'invoice_status', invoice_row.status::text,
    'total', invoice_row.total,
    'amount_paid', invoice_row.amount_paid,
    'balance', invoice_row.balance,
    'treatment_count', treatment_count
  );
end;
$$;

revoke all on function public.complete_case_visit(uuid, uuid) from public;
grant execute on function public.complete_case_visit(uuid, uuid) to authenticated;

-- Rolling-deployment compatibility: route legacy completion RPCs through
-- the safe appointment-level workflow.
create or replace function public.complete_treatment_workflow(p_appointment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_case_id uuid;
begin
  select case_id into target_case_id
  from public.appointments
  where id = p_appointment_id;

  if target_case_id is null then
    raise exception 'appointment_has_no_case';
  end if;

  return public.complete_case_visit(target_case_id, p_appointment_id);
end;
$$;

create or replace function public.complete_case_workflow(p_case_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_appointment_id uuid;
begin
  select id
  into target_appointment_id
  from public.appointments
  where case_id = p_case_id
    and status = 'in_progress'
  order by handed_over_at desc nulls last, appointment_date desc, appointment_time desc
  limit 1;

  if target_appointment_id is null then
    raise exception 'no_active_visit_to_complete';
  end if;

  return public.complete_case_visit(p_case_id, target_appointment_id);
end;
$$;

-- ============================================================
-- Explicit clinical Case closure / reopening
-- ============================================================

create or replace function public.close_case_workflow(p_case_id uuid)
returns public.cases
language plpgsql
security definer
set search_path = public
as $$
declare
  case_row public.cases;
  active_appointments integer;
  active_treatments integer;
  caller_role public.app_role;
begin
  caller_role := public.current_user_role();

  if caller_role is null or caller_role not in ('admin', 'dentist') then
    raise exception 'dentist_or_admin_required';
  end if;

  select *
  into case_row
  from public.cases
  where id = p_case_id
  for update;

  if not found then
    raise exception 'case_not_found';
  end if;

  select count(*)
  into active_appointments
  from public.appointments
  where case_id = p_case_id
    and status in ('scheduled', 'booked', 'confirmed', 'in_progress', 'open');

  if active_appointments > 0 then
    raise exception 'case_has_active_appointments';
  end if;

  select count(*)
  into active_treatments
  from public.treatments
  where case_id = p_case_id
    and status in ('planned', 'in_progress');

  if active_treatments > 0 then
    raise exception 'case_has_incomplete_treatments';
  end if;

  update public.cases
  set
    status = 'closed',
    closed_at = coalesce(closed_at, now()),
    last_activity_at = now(),
    updated_at = now()
  where id = p_case_id
  returning * into case_row;

  perform public.add_case_event(
    p_case_id,
    'case_closed',
    'Case closed',
    'Clinical case closed. Billing remains independent.',
    null,
    jsonb_build_object('billing_status', case_row.billing_status)
  );

  return case_row;
end;
$$;

revoke all on function public.close_case_workflow(uuid) from public;
grant execute on function public.close_case_workflow(uuid) to authenticated;

create or replace function public.reopen_case_workflow(p_case_id uuid)
returns public.cases
language plpgsql
security definer
set search_path = public
as $$
declare
  case_row public.cases;
  has_in_progress boolean;
  caller_role public.app_role;
begin
  caller_role := public.current_user_role();

  if caller_role is null or caller_role not in ('admin', 'dentist') then
    raise exception 'dentist_or_admin_required';
  end if;

  select exists (
    select 1 from public.appointments
    where case_id = p_case_id
      and status = 'in_progress'
  )
  into has_in_progress;

  update public.cases
  set
    status = case when has_in_progress then 'in_treatment' else 'open' end,
    closed_at = null,
    last_activity_at = now(),
    updated_at = now()
  where id = p_case_id
  returning * into case_row;

  if not found then
    raise exception 'case_not_found';
  end if;

  perform public.add_case_event(
    p_case_id,
    'case_reopened',
    'Case reopened',
    'Clinical case reopened for additional care.'
  );

  return case_row;
end;
$$;

revoke all on function public.reopen_case_workflow(uuid) from public;
grant execute on function public.reopen_case_workflow(uuid) to authenticated;

-- ============================================================
-- Payment recording: billing only, never clinical completion
-- ============================================================

create or replace function public.record_invoice_payment(
  p_invoice_id uuid,
  p_amount numeric,
  p_payment_method text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  invoice_row public.invoices;
  applied_amount numeric(10,2);
  next_paid numeric(10,2);
  next_balance numeric(10,2);
  next_status public.invoice_status;
  next_case_billing_status text;
  caller_role public.app_role;
begin
  caller_role := public.current_user_role();

  if caller_role is null or caller_role not in ('admin', 'dentist', 'receptionist') then
    raise exception 'staff_profile_required';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'payment_amount_must_be_positive';
  end if;

  select *
  into invoice_row
  from public.invoices
  where id = p_invoice_id
  for update;

  if not found then
    raise exception 'invoice_not_found';
  end if;

  if invoice_row.status = 'cancelled' then
    raise exception 'cancelled_invoice_cannot_receive_payment';
  end if;

  if invoice_row.balance <= 0 then
    next_case_billing_status :=
      case when invoice_row.case_id is null
        then null
        else public.refresh_case_billing_status(invoice_row.case_id)
      end;

    return jsonb_build_object(
      'invoice_id', invoice_row.id,
      'invoice_number', invoice_row.invoice_number,
      'status', invoice_row.status::text,
      'amount_paid', invoice_row.amount_paid,
      'balance', invoice_row.balance,
      'appointment_id', invoice_row.appointment_id,
      'case_id', invoice_row.case_id,
      'case_billing_status', next_case_billing_status
    );
  end if;

  applied_amount := least(p_amount, invoice_row.balance)::numeric(10,2);
  next_paid := (invoice_row.amount_paid + applied_amount)::numeric(10,2);
  next_balance := greatest(invoice_row.total - next_paid, 0)::numeric(10,2);
  next_status := case when next_balance = 0 then 'paid' else 'partial' end;

  update public.invoices
  set
    amount_paid = next_paid,
    balance = next_balance,
    status = next_status,
    payment_method = coalesce(nullif(trim(p_payment_method), ''), payment_method),
    updated_at = now()
  where id = p_invoice_id
  returning * into invoice_row;

  next_case_billing_status :=
    case when invoice_row.case_id is null
      then null
      else public.refresh_case_billing_status(invoice_row.case_id)
    end;

  insert into public.audit_events (actor_id, action, entity_type, entity_id, details)
  values (
    auth.uid(),
    'invoice_payment_recorded',
    'invoice',
    invoice_row.id,
    jsonb_build_object(
      'applied_amount', applied_amount,
      'amount_paid', invoice_row.amount_paid,
      'balance', invoice_row.balance,
      'status', invoice_row.status::text,
      'appointment_id', invoice_row.appointment_id,
      'case_id', invoice_row.case_id
    )
  );

  if invoice_row.case_id is not null then
    perform public.add_case_event(
      invoice_row.case_id,
      'payment_recorded',
      'Payment recorded',
      invoice_row.invoice_number || ' · payment recorded',
      invoice_row.appointment_id,
      jsonb_build_object(
        'invoice_id', invoice_row.id,
        'invoice_number', invoice_row.invoice_number,
        'applied_amount', applied_amount,
        'balance', invoice_row.balance,
        'invoice_status', invoice_row.status::text
      )
    );
  end if;

  return jsonb_build_object(
    'invoice_id', invoice_row.id,
    'invoice_number', invoice_row.invoice_number,
    'status', invoice_row.status::text,
    'amount_paid', invoice_row.amount_paid,
    'balance', invoice_row.balance,
    'applied_amount', applied_amount,
    'appointment_id', invoice_row.appointment_id,
    'case_id', invoice_row.case_id,
    'case_billing_status', next_case_billing_status
  );
end;
$$;

revoke all on function public.record_invoice_payment(uuid, numeric, text) from public;
grant execute on function public.record_invoice_payment(uuid, numeric, text) to authenticated;

-- Realtime for operational timeline/assignment changes.
do $$
begin
  if exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'case_events'
    ) then
      execute 'alter publication supabase_realtime add table public.case_events';
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'case_assignments'
    ) then
      execute 'alter publication supabase_realtime add table public.case_assignments';
    end if;
  end if;
end;
$$;

commit;
