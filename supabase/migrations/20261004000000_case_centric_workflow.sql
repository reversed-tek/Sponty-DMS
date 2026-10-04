begin;

-- Case-centric workflow foundation.
create sequence if not exists public.case_number_seq;

create table if not exists public.cases (
  id uuid primary key default gen_random_uuid(),
  case_number text not null unique default (
    'CASE-' || to_char(current_date, 'YYYY') || '-' ||
    lpad(nextval('public.case_number_seq')::text, 6, '0')
  ),
  patient_id uuid not null references public.patients(id) on delete cascade,
  primary_appointment_id uuid references public.appointments(id) on delete set null,
  assigned_provider_id uuid references public.profiles(id) on delete set null,
  title text not null,
  intake_notes text,
  status text not null default 'open'
    check (status in ('open', 'in_treatment', 'awaiting_payment', 'closed')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);

create unique index if not exists cases_primary_appointment_unique
  on public.cases (primary_appointment_id)
  where primary_appointment_id is not null;

create index if not exists cases_patient_status_idx
  on public.cases (patient_id, status, updated_at desc);

create index if not exists cases_assigned_provider_idx
  on public.cases (assigned_provider_id, status, updated_at desc);

alter table public.appointments
  add column if not exists case_id uuid references public.cases(id) on delete set null;

alter table public.clinical_notes
  add column if not exists case_id uuid references public.cases(id) on delete set null;

alter table public.treatments
  add column if not exists case_id uuid references public.cases(id) on delete set null;

alter table public.invoices
  add column if not exists case_id uuid references public.cases(id) on delete set null;

create index if not exists appointments_case_idx on public.appointments (case_id);
create index if not exists clinical_notes_case_idx on public.clinical_notes (case_id, created_at desc);
create index if not exists treatments_case_idx on public.treatments (case_id, created_at desc);
create index if not exists invoices_case_idx on public.invoices (case_id, invoice_date desc);

create unique index if not exists invoices_case_unique
  on public.invoices (case_id)
  where case_id is not null;

alter table public.cases enable row level security;
drop policy if exists cases_access on public.cases;
create policy cases_access
on public.cases
for all
to authenticated
using (true)
with check (true);

drop trigger if exists cases_updated_at on public.cases;
create trigger cases_updated_at
before update on public.cases
for each row execute function public.set_updated_at();

-- Bring existing checked-in/clinical workflow records into Cases so this
-- migration does not strand records created before the case-centric model.
insert into public.cases (
  patient_id,
  primary_appointment_id,
  assigned_provider_id,
  title,
  intake_notes,
  status,
  created_by,
  created_at,
  updated_at,
  closed_at
)
select
  a.patient_id,
  a.id,
  a.provider_id,
  coalesce(nullif(trim(a.reason), ''), initcap(replace(a.appointment_type, '_', ' ')) || ' case'),
  a.notes,
  case
    when exists (
      select 1 from public.invoices i
      where i.appointment_id = a.id and i.status = 'paid' and i.balance = 0
    ) or a.status = 'completed' then 'closed'
    when a.treatment_completed_at is not null then 'awaiting_payment'
    when a.handed_over_at is not null or a.status = 'in_progress' then 'in_treatment'
    else 'open'
  end,
  a.created_by,
  a.created_at,
  a.updated_at,
  case when a.status = 'completed' then a.updated_at else null end
from public.appointments a
where a.case_id is null
  and (
    a.checked_in_at is not null
    or a.handed_over_at is not null
    or a.status in ('confirmed', 'in_progress', 'completed')
    or exists (select 1 from public.treatments t where t.appointment_id = a.id)
    or exists (select 1 from public.clinical_notes n where n.appointment_id = a.id)
    or exists (select 1 from public.invoices i where i.appointment_id = a.id)
  )
on conflict (primary_appointment_id) where primary_appointment_id is not null
do nothing;

update public.appointments a
set case_id = c.id
from public.cases c
where a.case_id is null
  and c.primary_appointment_id = a.id;

update public.treatments t
set case_id = a.case_id
from public.appointments a
where t.case_id is null
  and t.appointment_id = a.id
  and a.case_id is not null;

update public.clinical_notes n
set case_id = a.case_id
from public.appointments a
where n.case_id is null
  and n.appointment_id = a.id
  and a.case_id is not null;

update public.invoices i
set case_id = a.case_id
from public.appointments a
where i.case_id is null
  and i.appointment_id = a.id
  and a.case_id is not null;

-- Check-in is now the point where a Case is created (or the patient's current
-- open Case is reused for a follow-up appointment). Intake details are stored
-- on the appointment and seed the Case.
create or replace function public.check_in_appointment(
  p_appointment_id uuid,
  p_case_title text default null,
  p_intake_notes text default null
)
returns public.appointments
language plpgsql
security definer
set search_path = public
as $$
declare
  appointment_row public.appointments;
  case_row public.cases;
  caller_role public.app_role;
  created_case boolean := false;
begin
  caller_role := public.current_user_role();

  if caller_role is null or caller_role not in ('admin', 'dentist', 'receptionist') then
    raise exception 'staff_profile_required';
  end if;

  select *
  into appointment_row
  from public.appointments
  where id = p_appointment_id
  for update;

  if not found then
    raise exception 'appointment_not_found';
  end if;

  if appointment_row.patient_id is null then
    raise exception 'appointment_has_no_patient';
  end if;

  if appointment_row.status in ('cancelled', 'no_show', 'completed', 'open') then
    raise exception 'appointment_cannot_be_checked_in_from_status_%', appointment_row.status;
  end if;

  update public.appointments
  set
    reason = coalesce(nullif(trim(p_case_title), ''), reason),
    notes = coalesce(nullif(trim(p_intake_notes), ''), notes)
  where id = p_appointment_id
  returning * into appointment_row;

  if appointment_row.case_id is not null then
    select * into case_row
    from public.cases
    where id = appointment_row.case_id
    for update;
  else
    select *
    into case_row
    from public.cases
    where patient_id = appointment_row.patient_id
      and status in ('open', 'in_treatment', 'awaiting_payment')
    order by updated_at desc
    limit 1
    for update;

    if not found then
      insert into public.cases (
        patient_id,
        primary_appointment_id,
        assigned_provider_id,
        title,
        intake_notes,
        status,
        created_by
      )
      values (
        appointment_row.patient_id,
        appointment_row.id,
        appointment_row.provider_id,
        coalesce(
          nullif(trim(p_case_title), ''),
          nullif(trim(appointment_row.reason), ''),
          initcap(replace(appointment_row.appointment_type, '_', ' ')) || ' case'
        ),
        coalesce(nullif(trim(p_intake_notes), ''), appointment_row.notes),
        'open',
        auth.uid()
      )
      returning * into case_row;

      created_case := true;
    end if;

    update public.appointments
    set case_id = case_row.id
    where id = p_appointment_id
    returning * into appointment_row;
  end if;

  if appointment_row.status not in ('confirmed', 'in_progress') then
    update public.appointments
    set
      status = 'confirmed',
      checked_in_at = coalesce(checked_in_at, now()),
      updated_at = now()
    where id = p_appointment_id
    returning * into appointment_row;
  elsif appointment_row.checked_in_at is null then
    update public.appointments
    set checked_in_at = now(), updated_at = now()
    where id = p_appointment_id
    returning * into appointment_row;
  end if;

  update public.cases
  set
    assigned_provider_id = coalesce(assigned_provider_id, appointment_row.provider_id),
    updated_at = now()
  where id = case_row.id;

  if created_case then
    insert into public.audit_events (actor_id, action, entity_type, entity_id, details)
    values (
      auth.uid(),
      'case_created',
      'case',
      case_row.id,
      jsonb_build_object(
        'patient_id', appointment_row.patient_id,
        'appointment_id', appointment_row.id,
        'case_number', case_row.case_number
      )
    );
  end if;

  insert into public.audit_events (actor_id, action, entity_type, entity_id, details)
  values (
    auth.uid(),
    'appointment_checked_in',
    'appointment',
    p_appointment_id,
    jsonb_build_object(
      'patient_id', appointment_row.patient_id,
      'case_id', case_row.id,
      'case_number', case_row.case_number
    )
  );

  return appointment_row;
end;
$$;

revoke all on function public.check_in_appointment(uuid, text, text) from public;
grant execute on function public.check_in_appointment(uuid, text, text) to authenticated;

-- Handover now assigns the Case to the appointment's dentist.
create or replace function public.handover_appointment_to_dentist(p_appointment_id uuid)
returns public.appointments
language plpgsql
security definer
set search_path = public
as $$
declare
  appointment_row public.appointments;
  provider_role public.app_role;
  caller_role public.app_role;
  was_handed_over boolean;
begin
  caller_role := public.current_user_role();

  if caller_role is null or caller_role not in ('admin', 'dentist', 'receptionist') then
    raise exception 'staff_profile_required';
  end if;

  select *
  into appointment_row
  from public.appointments
  where id = p_appointment_id
  for update;

  if not found then
    raise exception 'appointment_not_found';
  end if;

  if appointment_row.patient_id is null then
    raise exception 'appointment_has_no_patient';
  end if;

  if appointment_row.case_id is null then
    raise exception 'appointment_must_be_checked_in_before_handover';
  end if;

  if appointment_row.provider_id is null then
    raise exception 'dentist_not_assigned';
  end if;

  select role
  into provider_role
  from public.profiles
  where id = appointment_row.provider_id
    and is_active = true;

  if provider_role is null or provider_role not in ('dentist', 'admin') then
    raise exception 'assigned_provider_is_not_an_active_dentist';
  end if;

  if appointment_row.status in ('cancelled', 'no_show', 'completed', 'open') then
    raise exception 'appointment_cannot_be_handed_over_from_status_%', appointment_row.status;
  end if;

  if appointment_row.status not in ('confirmed', 'in_progress') then
    raise exception 'appointment_must_be_checked_in_before_handover';
  end if;

  was_handed_over := appointment_row.handed_over_at is not null;

  update public.appointments
  set
    status = 'in_progress',
    checked_in_at = coalesce(checked_in_at, now()),
    handed_over_at = coalesce(handed_over_at, now()),
    updated_at = now()
  where id = p_appointment_id
  returning * into appointment_row;

  update public.cases
  set
    assigned_provider_id = appointment_row.provider_id,
    status = case when status = 'closed' then status else 'in_treatment' end,
    updated_at = now()
  where id = appointment_row.case_id;

  if not was_handed_over then
    insert into public.audit_events (actor_id, action, entity_type, entity_id, details)
    values (
      auth.uid(),
      'case_assigned_to_dentist',
      'case',
      appointment_row.case_id,
      jsonb_build_object(
        'appointment_id', p_appointment_id,
        'patient_id', appointment_row.patient_id,
        'provider_id', appointment_row.provider_id,
        'handed_over_at', appointment_row.handed_over_at
      )
    );
  end if;

  return appointment_row;
end;
$$;

revoke all on function public.handover_appointment_to_dentist(uuid) from public;
grant execute on function public.handover_appointment_to_dentist(uuid) to authenticated;

-- Keep the Case assignment aligned when staff change the dentist after check-in.
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
    update public.cases
    set assigned_provider_id = new.provider_id,
        updated_at = now()
    where id = new.case_id
      and status <> 'closed';
  end if;

  return new;
end;
$$;

drop trigger if exists appointments_sync_case_assignment on public.appointments;
create trigger appointments_sync_case_assignment
after update of provider_id
on public.appointments
for each row execute function public.sync_case_assignment_from_appointment();

-- Completing work from the Case creates/synchronises one invoice for the Case.
create or replace function public.complete_case_workflow(p_case_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  case_row public.cases;
  invoice_row public.invoices;
  billing_appointment_id uuid;
  treatment_count integer;
  calculated_total numeric(10,2);
  calculated_balance numeric(10,2);
  next_invoice_status public.invoice_status;
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

  select coalesce(
    case_row.primary_appointment_id,
    (
      select a.id
      from public.appointments a
      where a.case_id = p_case_id
      order by a.appointment_date desc, a.appointment_time desc
      limit 1
    )
  )
  into billing_appointment_id;

  select count(*)
  into treatment_count
  from public.treatments
  where case_id = p_case_id
    and status <> 'cancelled';

  if treatment_count = 0 then
    raise exception 'at_least_one_treatment_required';
  end if;

  update public.treatments
  set status = 'completed'
  where case_id = p_case_id
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
    billing_appointment_id,
    p_case_id,
    0,
    0,
    0,
    0,
    'pending',
    'Auto-generated from case ' || case_row.case_number,
    auth.uid()
  )
  on conflict (case_id) where case_id is not null
  do update set
    patient_id = excluded.patient_id,
    appointment_id = coalesce(public.invoices.appointment_id, excluded.appointment_id)
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
        and t.status <> 'cancelled'
    );

  select coalesce(sum(ii.total), 0)::numeric(10,2)
  into calculated_total
  from public.invoice_items ii
  where ii.invoice_id = invoice_row.id;

  calculated_balance :=
    greatest(calculated_total - invoice_row.amount_paid, 0)::numeric(10,2);

  if calculated_balance = 0 then
    next_invoice_status := 'paid';
  elsif invoice_row.amount_paid > 0 then
    next_invoice_status := 'partial';
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
    treatment_completed_at = coalesce(treatment_completed_at, now()),
    status = case
      when status in ('cancelled', 'no_show') then status
      else 'completed'::public.appointment_status
    end,
    updated_at = now()
  where case_id = p_case_id;

  update public.cases
  set
    status = case when invoice_row.status = 'paid' then 'closed' else 'awaiting_payment' end,
    closed_at = case when invoice_row.status = 'paid' then coalesce(closed_at, now()) else null end,
    updated_at = now()
  where id = p_case_id
  returning * into case_row;

  insert into public.audit_events (actor_id, action, entity_type, entity_id, details)
  values (
    auth.uid(),
    'case_treatment_completed_invoice_synced',
    'case',
    p_case_id,
    jsonb_build_object(
      'invoice_id', invoice_row.id,
      'invoice_number', invoice_row.invoice_number,
      'total', invoice_row.total,
      'balance', invoice_row.balance,
      'treatment_count', treatment_count
    )
  );

  return jsonb_build_object(
    'case_id', case_row.id,
    'case_number', case_row.case_number,
    'case_status', case_row.status,
    'appointment_id', billing_appointment_id,
    'appointment_status', 'completed',
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

revoke all on function public.complete_case_workflow(uuid) from public;
grant execute on function public.complete_case_workflow(uuid) to authenticated;

-- A paid Case invoice closes the Case automatically.
create or replace function public.sync_case_from_invoice()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.case_id is not null then
    update public.cases
    set
      status = case
        when new.status = 'paid' and new.balance = 0 then 'closed'
        else 'awaiting_payment'
      end,
      closed_at = case
        when new.status = 'paid' and new.balance = 0 then coalesce(closed_at, now())
        else null
      end,
      updated_at = now()
    where id = new.case_id;
  end if;

  return new;
end;
$$;

drop trigger if exists invoices_sync_case_status on public.invoices;
create trigger invoices_sync_case_status
after insert or update of status, balance, amount_paid
on public.invoices
for each row execute function public.sync_case_from_invoice();

-- Keep legacy appointment-based writes connected to their Case. This lets
-- existing patient-history forms continue to work while the UI moves to Cases.
create or replace function public.inherit_case_from_appointment()
returns trigger
language plpgsql
security definer
set search_path = public
as $
begin
  if new.case_id is null and new.appointment_id is not null then
    select a.case_id
    into new.case_id
    from public.appointments a
    where a.id = new.appointment_id;
  end if;

  return new;
end;
$;

drop trigger if exists clinical_notes_inherit_case on public.clinical_notes;
create trigger clinical_notes_inherit_case
before insert or update of appointment_id, case_id
on public.clinical_notes
for each row execute function public.inherit_case_from_appointment();

drop trigger if exists treatments_inherit_case on public.treatments;
create trigger treatments_inherit_case
before insert or update of appointment_id, case_id
on public.treatments
for each row execute function public.inherit_case_from_appointment();

-- New case-scoped clinical records touch the Case for queue ordering.
create or replace function public.touch_case_from_clinical_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_case_id uuid;
begin
  target_case_id := case when tg_op = 'DELETE' then old.case_id else new.case_id end;

  if target_case_id is not null then
    update public.cases
    set
      status = case
        when status in ('awaiting_payment', 'closed') then status
        else 'in_treatment'
      end,
      updated_at = now()
    where id = target_case_id;
  end if;

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

-- Cases use realtime so staff see assignment/status changes without refresh.
do $$
begin
  if exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'cases'
  ) then
    execute 'alter publication supabase_realtime add table public.cases';
  end if;
end;
$$;

commit;
