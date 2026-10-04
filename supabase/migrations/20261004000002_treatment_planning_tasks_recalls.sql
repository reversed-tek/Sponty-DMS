begin;

-- ============================================================
-- PR9: Treatment planning, Case tasks, and recall automation
-- ============================================================

-- ============================================================
-- Treatment planning
-- ============================================================

create table if not exists public.treatment_plan_items (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  procedure_name text not null,
  tooth_number integer,
  estimated_cost numeric(10,2) not null default 0,
  status text not null default 'proposed'
    check (status in ('proposed', 'accepted', 'in_progress', 'completed', 'deferred', 'cancelled')),
  sequence_no integer not null default 1,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  accepted_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists treatment_plan_items_case_idx
  on public.treatment_plan_items (case_id, sequence_no, created_at);

alter table public.treatment_plan_items enable row level security;

drop policy if exists treatment_plan_items_access on public.treatment_plan_items;
create policy treatment_plan_items_access
on public.treatment_plan_items
for all
to authenticated
using (true)
with check (true);

drop trigger if exists treatment_plan_items_updated_at on public.treatment_plan_items;
create trigger treatment_plan_items_updated_at
before update on public.treatment_plan_items
for each row execute function public.set_updated_at();

alter table public.treatments
  add column if not exists treatment_plan_item_id uuid
  references public.treatment_plan_items(id)
  on delete set null;

create unique index if not exists treatments_plan_item_unique
  on public.treatments (treatment_plan_item_id)
  where treatment_plan_item_id is not null;

-- ============================================================
-- Case task engine
-- ============================================================

create table if not exists public.case_tasks (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  appointment_id uuid references public.appointments(id) on delete set null,
  task_type text not null,
  title text not null,
  description text,
  priority text not null default 'normal'
    check (priority in ('low', 'normal', 'high', 'urgent')),
  status text not null default 'open'
    check (status in ('open', 'completed', 'cancelled')),
  source text not null default 'manual'
    check (source in ('manual', 'automated')),
  dedupe_key text,
  due_at timestamptz,
  assigned_provider_id uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  completed_by uuid references public.profiles(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists case_tasks_case_status_idx
  on public.case_tasks (case_id, status, priority, due_at);

create index if not exists case_tasks_open_due_idx
  on public.case_tasks (status, due_at)
  where status = 'open';

create unique index if not exists case_tasks_open_dedupe_idx
  on public.case_tasks (case_id, dedupe_key)
  where status = 'open' and dedupe_key is not null;

alter table public.case_tasks enable row level security;

drop policy if exists case_tasks_access on public.case_tasks;
create policy case_tasks_access
on public.case_tasks
for all
to authenticated
using (true)
with check (true);

drop trigger if exists case_tasks_updated_at on public.case_tasks;
create trigger case_tasks_updated_at
before update on public.case_tasks
for each row execute function public.set_updated_at();

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
begin
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
    select *
    into task_row
    from public.case_tasks
    where case_id = p_case_id
      and dedupe_key = p_dedupe_key
      and status = 'open'
    limit 1
    for update;
  end if;

  if task_row.id is not null then
    update public.case_tasks
    set
      task_type = p_task_type,
      title = p_title,
      description = p_description,
      priority = p_priority,
      due_at = p_due_at,
      appointment_id = coalesce(p_appointment_id, appointment_id),
      updated_at = now()
    where id = task_row.id
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

revoke all on function public.upsert_case_task(uuid, text, text, text, text, timestamptz, uuid, text, text) from public;
grant execute on function public.upsert_case_task(uuid, text, text, text, text, timestamptz, uuid, text, text) to authenticated;

create or replace function public.complete_case_task(p_task_id uuid)
returns public.case_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  task_row public.case_tasks;
begin
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

revoke all on function public.complete_case_task(uuid) from public;
grant execute on function public.complete_case_task(uuid) to authenticated;

-- ============================================================
-- Patient recall engine
-- ============================================================

create table if not exists public.patient_recalls (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  case_id uuid references public.cases(id) on delete set null,
  related_appointment_id uuid references public.appointments(id) on delete set null,
  recall_type text not null default 'preventive'
    check (recall_type in ('preventive', 'follow_up')),
  due_date date not null,
  interval_months integer,
  status text not null default 'open'
    check (status in ('open', 'scheduled', 'completed', 'dismissed')),
  source text not null default 'automated'
    check (source in ('manual', 'automated')),
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists patient_recalls_status_due_idx
  on public.patient_recalls (status, due_date);

create index if not exists patient_recalls_patient_idx
  on public.patient_recalls (patient_id, status, due_date);

create unique index if not exists patient_recalls_open_case_unique
  on public.patient_recalls (case_id, recall_type)
  where case_id is not null and status in ('open', 'scheduled');

alter table public.patient_recalls enable row level security;

drop policy if exists patient_recalls_access on public.patient_recalls;
create policy patient_recalls_access
on public.patient_recalls
for all
to authenticated
using (true)
with check (true);

drop trigger if exists patient_recalls_updated_at on public.patient_recalls;
create trigger patient_recalls_updated_at
before update on public.patient_recalls
for each row execute function public.set_updated_at();

create or replace function public.schedule_patient_recall(
  p_patient_id uuid,
  p_case_id uuid default null,
  p_interval_months integer default 6,
  p_recall_type text default 'preventive',
  p_notes text default null
)
returns public.patient_recalls
language plpgsql
security definer
set search_path = public
as $$
declare
  recall_row public.patient_recalls;
begin
  if p_interval_months is null or p_interval_months <= 0 then
    raise exception 'recall_interval_must_be_positive';
  end if;

  if p_recall_type not in ('preventive', 'follow_up') then
    raise exception 'invalid_recall_type';
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
  end if;

  if recall_row.id is not null then
    update public.patient_recalls
    set
      due_date = current_date + make_interval(months => p_interval_months),
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
    current_date + make_interval(months => p_interval_months),
    p_interval_months,
    'open',
    'automated',
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

revoke all on function public.schedule_patient_recall(uuid, uuid, integer, text, text) from public;
grant execute on function public.schedule_patient_recall(uuid, uuid, integer, text, text) to authenticated;

-- A checkup/cleaning appointment satisfies an open preventive recall.
create or replace function public.sync_recall_from_appointment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recall_row public.patient_recalls;
begin
  if new.patient_id is null then
    return new;
  end if;

  if tg_op = 'INSERT'
     and new.appointment_type in ('checkup', 'cleaning')
     and new.status not in ('cancelled', 'no_show') then

    select *
    into recall_row
    from public.patient_recalls
    where patient_id = new.patient_id
      and recall_type = 'preventive'
      and status = 'open'
    order by due_date
    limit 1
    for update;

    if recall_row.id is not null then
      update public.patient_recalls
      set
        status = 'scheduled',
        related_appointment_id = new.id,
        updated_at = now()
      where id = recall_row.id;
    end if;
  end if;

  if tg_op = 'UPDATE'
     and new.status = 'completed'
     and old.status is distinct from new.status then

    update public.patient_recalls
    set
      status = 'completed',
      completed_at = now(),
      updated_at = now()
    where related_appointment_id = new.id
      and status = 'scheduled';
  end if;

  return new;
end;
$$;

drop trigger if exists appointments_sync_recall on public.appointments;
create trigger appointments_sync_recall
after insert or update of status
on public.appointments
for each row execute function public.sync_recall_from_appointment();

-- ============================================================
-- Treatment plan events and automation
-- ============================================================

create or replace function public.track_treatment_plan_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  has_active_appointment boolean;
begin
  if tg_op = 'INSERT' then
    perform public.add_case_event(
      new.case_id,
      'treatment_plan_item_added',
      'Treatment plan item added',
      new.procedure_name,
      null,
      jsonb_build_object(
        'plan_item_id', new.id,
        'status', new.status,
        'estimated_cost', new.estimated_cost,
        'tooth_number', new.tooth_number
      )
    );
  elsif old.status is distinct from new.status then
    perform public.add_case_event(
      new.case_id,
      'treatment_plan_status_changed',
      'Treatment plan updated',
      new.procedure_name || ' → ' || replace(new.status, '_', ' '),
      null,
      jsonb_build_object(
        'plan_item_id', new.id,
        'old_status', old.status,
        'new_status', new.status
      )
    );
  end if;

  if new.status in ('accepted', 'in_progress') then
    select exists (
      select 1
      from public.appointments
      where case_id = new.case_id
        and status in ('scheduled', 'booked', 'confirmed', 'in_progress', 'open')
    )
    into has_active_appointment;

    if not has_active_appointment then
      perform public.upsert_case_task(
        new.case_id,
        'schedule_treatment',
        'Schedule next treatment visit',
        'Accepted treatment plan has work remaining but no active appointment is booked.',
        case when exists (
          select 1
          from public.treatment_plan_items
          where case_id = new.case_id
            and status in ('accepted', 'in_progress')
            and id <> new.id
        ) then 'high' else 'normal' end,
        now() + interval '3 days',
        null,
        'schedule-treatment',
        'automated'
      );
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists treatment_plan_items_track on public.treatment_plan_items;
create trigger treatment_plan_items_track
after insert or update of status
on public.treatment_plan_items
for each row execute function public.track_treatment_plan_item();

-- When a real appointment is booked for the Case, close scheduling tasks.
create or replace function public.resolve_case_scheduling_tasks()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.case_id is not null
     and new.status in ('scheduled', 'booked', 'confirmed', 'in_progress', 'open') then
    update public.case_tasks
    set
      status = 'completed',
      completed_by = auth.uid(),
      completed_at = now(),
      updated_at = now()
    where case_id = new.case_id
      and status = 'open'
      and task_type in ('schedule_treatment', 'schedule_followup');
  end if;

  return new;
end;
$$;

drop trigger if exists appointments_resolve_case_tasks on public.appointments;
create trigger appointments_resolve_case_tasks
after insert or update of case_id, status
on public.appointments
for each row execute function public.resolve_case_scheduling_tasks();

-- Convert an accepted plan item into performed clinical work for a visit.
create or replace function public.perform_treatment_plan_item(
  p_plan_item_id uuid,
  p_appointment_id uuid
)
returns public.treatments
language plpgsql
security definer
set search_path = public
as $$
declare
  plan_row public.treatment_plan_items;
  appointment_row public.appointments;
  treatment_row public.treatments;
  caller_role public.app_role;
begin
  caller_role := public.current_user_role();

  if caller_role is null or caller_role not in ('admin', 'dentist') then
    raise exception 'dentist_or_admin_required';
  end if;

  select *
  into plan_row
  from public.treatment_plan_items
  where id = p_plan_item_id
  for update;

  if not found then
    raise exception 'treatment_plan_item_not_found';
  end if;

  if plan_row.status <> 'accepted' then
    raise exception 'treatment_plan_item_must_be_accepted';
  end if;

  select *
  into appointment_row
  from public.appointments
  where id = p_appointment_id
    and case_id = plan_row.case_id
    and status = 'in_progress'
  for update;

  if not found then
    raise exception 'active_case_visit_required';
  end if;

  insert into public.treatments (
    patient_id,
    appointment_id,
    case_id,
    treatment_plan_item_id,
    provider_id,
    treatment_date,
    tooth_number,
    procedure_name,
    description,
    cost,
    status,
    notes,
    created_by
  )
  select
    c.patient_id,
    appointment_row.id,
    c.id,
    plan_row.id,
    coalesce(appointment_row.provider_id, c.assigned_provider_id, auth.uid()),
    current_date,
    plan_row.tooth_number,
    plan_row.procedure_name,
    plan_row.notes,
    plan_row.estimated_cost,
    'planned',
    plan_row.notes,
    auth.uid()
  from public.cases c
  where c.id = plan_row.case_id
  on conflict (treatment_plan_item_id) where treatment_plan_item_id is not null
  do update set
    appointment_id = excluded.appointment_id,
    provider_id = excluded.provider_id,
    treatment_date = excluded.treatment_date
  returning * into treatment_row;

  update public.treatment_plan_items
  set
    status = 'in_progress',
    updated_at = now()
  where id = plan_row.id;

  return treatment_row;
end;
$$;

revoke all on function public.perform_treatment_plan_item(uuid, uuid) from public;
grant execute on function public.perform_treatment_plan_item(uuid, uuid) to authenticated;

-- Completed treatment completes its source plan item.
create or replace function public.sync_plan_item_from_treatment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.treatment_plan_item_id is null then
    return new;
  end if;

  if new.status = 'completed' and old.status is distinct from new.status then
    update public.treatment_plan_items
    set
      status = 'completed',
      completed_at = now(),
      updated_at = now()
    where id = new.treatment_plan_item_id;
  elsif new.status = 'cancelled' and old.status is distinct from new.status then
    update public.treatment_plan_items
    set
      status = 'deferred',
      updated_at = now()
    where id = new.treatment_plan_item_id
      and status <> 'completed';
  end if;

  return new;
end;
$$;

drop trigger if exists treatments_sync_plan_item on public.treatments;
create trigger treatments_sync_plan_item
after update of status
on public.treatments
for each row execute function public.sync_plan_item_from_treatment();

-- ============================================================
-- Extend visit completion with proactive tasks
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
  remaining_plan_items integer;
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

  select count(*)
  into remaining_plan_items
  from public.treatment_plan_items
  where case_id = p_case_id
    and status in ('proposed', 'accepted', 'in_progress', 'deferred');

  next_case_status :=
    case
      when remaining_active_appointments = 0
       and remaining_active_treatments = 0
       and remaining_plan_items = 0 then 'treatment_complete'
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

  if remaining_active_appointments = 0
     and (remaining_active_treatments > 0 or remaining_plan_items > 0) then
    perform public.upsert_case_task(
      p_case_id,
      'schedule_followup',
      'Schedule follow-up visit',
      'The Case still has planned clinical work but no future appointment is booked.',
      'high',
      now() + interval '3 days',
      null,
      'schedule-followup',
      'automated'
    );
  elsif next_case_status = 'treatment_complete' then
    perform public.upsert_case_task(
      p_case_id,
      'review_case_closure',
      'Review Case for closure',
      'All current visits and treatment plan items are complete. Review the Case and close it when appropriate.',
      'normal',
      now() + interval '1 day',
      null,
      'review-case-closure',
      'automated'
    );
  end if;

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
      'treatment_count', treatment_count,
      'remaining_plan_items', remaining_plan_items
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

-- ============================================================
-- Close Case + configurable automated recall
-- ============================================================

drop function if exists public.close_case_workflow(uuid);

create or replace function public.close_case_workflow(
  p_case_id uuid,
  p_recall_months integer default 6
)
returns public.cases
language plpgsql
security definer
set search_path = public
as $$
declare
  case_row public.cases;
  active_appointments integer;
  active_treatments integer;
  active_plan_items integer;
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

  select count(*)
  into active_plan_items
  from public.treatment_plan_items
  where case_id = p_case_id
    and status in ('proposed', 'accepted', 'in_progress', 'deferred');

  if active_plan_items > 0 then
    raise exception 'case_has_incomplete_treatment_plan';
  end if;

  update public.cases
  set
    status = 'closed',
    closed_at = coalesce(closed_at, now()),
    last_activity_at = now(),
    updated_at = now()
  where id = p_case_id
  returning * into case_row;

  update public.case_tasks
  set
    status = 'cancelled',
    updated_at = now()
  where case_id = p_case_id
    and status = 'open';

  if p_recall_months is not null and p_recall_months > 0 then
    perform public.schedule_patient_recall(
      case_row.patient_id,
      p_case_id,
      p_recall_months,
      'preventive',
      'Automatically created when ' || case_row.case_number || ' was closed.'
    );
  end if;

  perform public.add_case_event(
    p_case_id,
    'case_closed',
    'Case closed',
    case when p_recall_months > 0
      then 'Clinical case closed. Preventive recall scheduled in ' || p_recall_months || ' months.'
      else 'Clinical case closed with no automatic recall.'
    end,
    null,
    jsonb_build_object(
      'billing_status', case_row.billing_status,
      'recall_months', p_recall_months
    )
  );

  return case_row;
end;
$$;

revoke all on function public.close_case_workflow(uuid, integer) from public;
grant execute on function public.close_case_workflow(uuid, integer) to authenticated;

-- Realtime for proactive operational items.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'treatment_plan_items'
    ) then
      execute 'alter publication supabase_realtime add table public.treatment_plan_items';
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'case_tasks'
    ) then
      execute 'alter publication supabase_realtime add table public.case_tasks';
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'patient_recalls'
    ) then
      execute 'alter publication supabase_realtime add table public.patient_recalls';
    end if;
  end if;
end;
$$;

commit;
