-- Connected end-to-end clinic workflow for Sponty DMS.
-- Apply after the existing waitlist and patient portal migrations.
--
-- Existing statuses are reused:
--   scheduled/booked -> confirmed   : patient checked in
--   confirmed        -> in_progress : handed over to dentist
--   in_progress                     : treatment complete / invoice awaiting settlement
--   completed                       : invoice fully paid
--
-- No new application modules or workflow statuses are introduced.

begin;

-- Prevent duplicate invoices for the same appointment.
do $$
begin
  if exists (
    select 1
    from public.invoices
    where appointment_id is not null
    group by appointment_id
    having count(*) > 1
  ) then
    raise exception using
      message = 'duplicate_appointment_invoices_exist',
      detail = 'Resolve existing duplicate invoices for the same appointment before applying the workflow migration.';
  end if;
end;
$$;

create unique index if not exists invoices_one_per_appointment_idx
  on public.invoices (appointment_id)
  where appointment_id is not null;

-- Backfill treatment links only when a legacy invoice line matches exactly one treatment.
update public.invoice_items ii
set treatment_id = matched.treatment_id
from (
  select
    ii2.id as invoice_item_id,
    (array_agg(t.id order by t.id))[1] as treatment_id
  from public.invoice_items ii2
  join public.invoices i on i.id = ii2.invoice_id
  join public.treatments t
    on t.appointment_id = i.appointment_id
   and t.procedure_name = ii2.description
   and t.cost = ii2.unit_price
  where ii2.treatment_id is null
    and i.appointment_id is not null
    and i.notes like 'Auto-generated from appointment %'
  group by ii2.id
  having count(*) = 1
) matched
where ii.id = matched.invoice_item_id;

create unique index if not exists invoice_items_treatment_once_idx
  on public.invoice_items (invoice_id, treatment_id)
  where treatment_id is not null;

create index if not exists treatments_appointment_idx
  on public.treatments (appointment_id, status);

create index if not exists clinical_notes_appointment_idx
  on public.clinical_notes (appointment_id, note_date desc);

create index if not exists invoices_appointment_idx
  on public.invoices (appointment_id);

-- Safe dentist directory for appointment assignment.
drop view if exists public.active_provider_directory;
create view public.active_provider_directory as
select id, full_name, role
from public.profiles
where is_active = true
  and role in ('dentist', 'admin');

revoke all on public.active_provider_directory from public;
grant select on public.active_provider_directory to authenticated;

-- Keep Treatments module records connected to the current appointment where unambiguous.
create or replace function public.connect_treatment_to_appointment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  appointment_patient uuid;
  candidate_id uuid;
  candidate_count integer;
begin
  if new.appointment_id is null then
    select
      (array_agg(a.id order by a.appointment_time))[1],
      count(*)
    into candidate_id, candidate_count
    from public.appointments a
    where a.patient_id = new.patient_id
      and a.status = 'in_progress'
      and a.appointment_date = coalesce(new.treatment_date, current_date);

    if candidate_count = 1 then
      new.appointment_id := candidate_id;
    end if;
  end if;

  if new.appointment_id is not null then
    select a.patient_id
    into appointment_patient
    from public.appointments a
    where a.id = new.appointment_id;

    if appointment_patient is null then
      raise exception 'appointment_not_found';
    end if;

    if appointment_patient <> new.patient_id then
      raise exception 'treatment_patient_does_not_match_appointment';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists treatments_connect_appointment on public.treatments;
create trigger treatments_connect_appointment
before insert or update of patient_id, appointment_id, treatment_date
on public.treatments
for each row execute function public.connect_treatment_to_appointment();

-- Keep clinical notes connected to the current appointment where unambiguous.
create or replace function public.connect_clinical_note_to_appointment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  appointment_patient uuid;
  candidate_id uuid;
  candidate_count integer;
begin
  if new.appointment_id is null then
    select
      (array_agg(a.id order by a.appointment_time))[1],
      count(*)
    into candidate_id, candidate_count
    from public.appointments a
    where a.patient_id = new.patient_id
      and a.status = 'in_progress'
      and a.appointment_date = coalesce(new.note_date, current_date);

    if candidate_count = 1 then
      new.appointment_id := candidate_id;
    end if;
  end if;

  if new.appointment_id is not null then
    select a.patient_id
    into appointment_patient
    from public.appointments a
    where a.id = new.appointment_id;

    if appointment_patient is null then
      raise exception 'appointment_not_found';
    end if;

    if appointment_patient <> new.patient_id then
      raise exception 'clinical_note_patient_does_not_match_appointment';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists clinical_notes_connect_appointment on public.clinical_notes;
create trigger clinical_notes_connect_appointment
before insert or update of patient_id, appointment_id, note_date
on public.clinical_notes
for each row execute function public.connect_clinical_note_to_appointment();

create or replace function public.validate_invoice_appointment_patient()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  appointment_patient uuid;
begin
  if new.appointment_id is null then
    return new;
  end if;

  select a.patient_id
  into appointment_patient
  from public.appointments a
  where a.id = new.appointment_id;

  if appointment_patient is null then
    raise exception 'appointment_not_found';
  end if;

  if appointment_patient <> new.patient_id then
    raise exception 'invoice_patient_does_not_match_appointment';
  end if;

  return new;
end;
$$;

drop trigger if exists invoices_validate_appointment_patient on public.invoices;
create trigger invoices_validate_appointment_patient
before insert or update of patient_id, appointment_id
on public.invoices
for each row execute function public.validate_invoice_appointment_patient();

-- Reception workflow: check-in.
create or replace function public.check_in_appointment(p_appointment_id uuid)
returns public.appointments
language plpgsql
security definer
set search_path = public
as $$
declare
  appointment_row public.appointments;
  caller_role public.app_role;
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

  if appointment_row.status not in ('confirmed', 'in_progress') then
    update public.appointments
    set status = 'confirmed'
    where id = p_appointment_id
    returning * into appointment_row;

    insert into public.audit_events (actor_id, action, entity_type, entity_id, details)
    values (
      auth.uid(),
      'appointment_checked_in',
      'appointment',
      p_appointment_id,
      jsonb_build_object('patient_id', appointment_row.patient_id)
    );
  end if;

  return appointment_row;
end;
$$;

revoke all on function public.check_in_appointment(uuid) from public;
grant execute on function public.check_in_appointment(uuid) to authenticated;

-- Reception workflow: handover.
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

  if appointment_row.status <> 'in_progress' then
    update public.appointments
    set status = 'in_progress'
    where id = p_appointment_id
    returning * into appointment_row;

    insert into public.audit_events (actor_id, action, entity_type, entity_id, details)
    values (
      auth.uid(),
      'appointment_handed_to_dentist',
      'appointment',
      p_appointment_id,
      jsonb_build_object(
        'patient_id', appointment_row.patient_id,
        'provider_id', appointment_row.provider_id
      )
    );
  end if;

  return appointment_row;
end;
$$;

revoke all on function public.handover_appointment_to_dentist(uuid) from public;
grant execute on function public.handover_appointment_to_dentist(uuid) to authenticated;

-- Dentist workflow: complete treatment and synchronise one invoice.
create or replace function public.complete_treatment_workflow(p_appointment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  appointment_row public.appointments;
  invoice_row public.invoices;
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

  if appointment_row.status in ('cancelled', 'no_show', 'open') then
    raise exception 'appointment_cannot_be_completed_from_status_%', appointment_row.status;
  end if;

  if appointment_row.status not in ('in_progress', 'completed') then
    raise exception 'appointment_must_be_handed_to_dentist_first';
  end if;

  select count(*)
  into treatment_count
  from public.treatments
  where appointment_id = p_appointment_id
    and status <> 'cancelled';

  if treatment_count = 0 then
    raise exception 'at_least_one_treatment_required';
  end if;

  update public.treatments
  set status = 'completed'
  where appointment_id = p_appointment_id
    and status in ('planned', 'in_progress');

  generated_invoice_number :=
    'INV-' || to_char(current_date, 'YYYYMMDD') || '-' ||
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));

  insert into public.invoices (
    invoice_number,
    patient_id,
    appointment_id,
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
    appointment_row.patient_id,
    p_appointment_id,
    0,
    0,
    0,
    0,
    'pending',
    'Auto-generated from appointment ' || p_appointment_id::text,
    auth.uid()
  )
  on conflict (appointment_id) where appointment_id is not null
  do update set appointment_id = excluded.appointment_id
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
  where t.appointment_id = p_appointment_id
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
  set subtotal = calculated_total,
      total = calculated_total,
      balance = calculated_balance,
      status = next_invoice_status,
      updated_at = now()
  where id = invoice_row.id
  returning * into invoice_row;

  if invoice_row.status = 'paid' then
    update public.appointments
    set status = 'completed'
    where id = p_appointment_id
      and status not in ('cancelled', 'no_show');
  else
    update public.appointments
    set status = 'in_progress'
    where id = p_appointment_id
      and status not in ('cancelled', 'no_show');
  end if;

  insert into public.audit_events (actor_id, action, entity_type, entity_id, details)
  values (
    auth.uid(),
    'treatment_completed_invoice_synced',
    'appointment',
    p_appointment_id,
    jsonb_build_object(
      'invoice_id', invoice_row.id,
      'invoice_number', invoice_row.invoice_number,
      'total', invoice_row.total,
      'balance', invoice_row.balance,
      'treatment_count', treatment_count
    )
  );

  return jsonb_build_object(
    'appointment_id', p_appointment_id,
    'appointment_status', (
      select status::text
      from public.appointments
      where id = p_appointment_id
    ),
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

revoke all on function public.complete_treatment_workflow(uuid) from public;
grant execute on function public.complete_treatment_workflow(uuid) to authenticated;

-- Payment finishing trigger.
create or replace function public.finish_appointment_when_invoice_paid()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.appointment_id is not null
     and new.status = 'paid'
     and new.balance = 0
     and (
       old.status is distinct from new.status
       or old.balance is distinct from new.balance
     ) then

    update public.treatments
    set status = 'completed'
    where appointment_id = new.appointment_id
      and status in ('planned', 'in_progress');

    update public.appointments
    set status = 'completed'
    where id = new.appointment_id
      and status not in ('cancelled', 'no_show');

    if auth.uid() is not null then
      insert into public.audit_events (actor_id, action, entity_type, entity_id, details)
      values (
        auth.uid(),
        'invoice_paid_appointment_completed',
        'invoice',
        new.id,
        jsonb_build_object(
          'appointment_id', new.appointment_id,
          'amount_paid', new.amount_paid,
          'total', new.total
        )
      );
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists invoices_complete_paid_appointment on public.invoices;
create trigger invoices_complete_paid_appointment
after update of status, balance, amount_paid
on public.invoices
for each row execute function public.finish_appointment_when_invoice_paid();

-- Reception billing workflow.
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
    return jsonb_build_object(
      'invoice_id', invoice_row.id,
      'invoice_number', invoice_row.invoice_number,
      'status', invoice_row.status::text,
      'amount_paid', invoice_row.amount_paid,
      'balance', invoice_row.balance,
      'appointment_id', invoice_row.appointment_id,
      'appointment_completed',
        invoice_row.appointment_id is not null and invoice_row.status = 'paid'
    );
  end if;

  applied_amount := least(p_amount, invoice_row.balance)::numeric(10,2);
  next_paid := (invoice_row.amount_paid + applied_amount)::numeric(10,2);
  next_balance := greatest(invoice_row.total - next_paid, 0)::numeric(10,2);
  next_status := case when next_balance = 0 then 'paid' else 'partial' end;

  update public.invoices
  set amount_paid = next_paid,
      balance = next_balance,
      status = next_status,
      payment_method = coalesce(nullif(trim(p_payment_method), ''), payment_method),
      updated_at = now()
  where id = p_invoice_id
  returning * into invoice_row;

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
      'appointment_id', invoice_row.appointment_id
    )
  );

  return jsonb_build_object(
    'invoice_id', invoice_row.id,
    'invoice_number', invoice_row.invoice_number,
    'status', invoice_row.status::text,
    'amount_paid', invoice_row.amount_paid,
    'balance', invoice_row.balance,
    'applied_amount', applied_amount,
    'appointment_id', invoice_row.appointment_id,
    'appointment_completed',
      invoice_row.status = 'paid' and invoice_row.appointment_id is not null
  );
end;
$$;

revoke all on function public.record_invoice_payment(uuid, numeric, text) from public;
grant execute on function public.record_invoice_payment(uuid, numeric, text) to authenticated;

-- Appointment-centred patient history.
create or replace function public.get_patient_visit_history(p_patient_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role public.app_role;
  result jsonb;
begin
  caller_role := public.current_user_role();

  if caller_role is null then
    raise exception 'staff_profile_required';
  end if;

  if not exists (
    select 1
    from public.patients
    where id = p_patient_id
  ) then
    raise exception 'patient_not_found';
  end if;

  select coalesce(
    jsonb_agg(
      visit
      order by visit.appointment_date desc, visit.appointment_time desc
    ),
    '[]'::jsonb
  )
  into result
  from (
    select
      a.id as appointment_id,
      a.appointment_date,
      a.appointment_time,
      a.appointment_type,
      a.status::text as appointment_status,
      a.reason,
      a.notes,
      a.provider_id,
      p.full_name as provider_name,
      case
        when caller_role in ('admin', 'dentist') then
          coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', t.id,
                'procedure_name', t.procedure_name,
                'tooth_number', t.tooth_number,
                'cost', t.cost,
                'status', t.status::text,
                'notes', t.notes
              )
              order by t.created_at
            )
            from public.treatments t
            where t.appointment_id = a.id
          ), '[]'::jsonb)
        else '[]'::jsonb
      end as treatments,
      case
        when caller_role in ('admin', 'dentist') then
          coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', n.id,
                'visit_type', n.visit_type,
                'subjective', n.subjective,
                'objective', n.objective,
                'assessment', n.assessment,
                'plan', n.plan,
                'note_date', n.note_date
              )
              order by n.created_at
            )
            from public.clinical_notes n
            where n.appointment_id = a.id
              and (
                not n.is_private
                or n.author_id = auth.uid()
                or caller_role = 'admin'
              )
          ), '[]'::jsonb)
        else '[]'::jsonb
      end as clinical_notes,
      (
        select jsonb_build_object(
          'id', i.id,
          'invoice_number', i.invoice_number,
          'invoice_date', i.invoice_date,
          'total', i.total,
          'amount_paid', i.amount_paid,
          'balance', i.balance,
          'status', i.status::text,
          'items', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', ii.id,
                'treatment_id', ii.treatment_id,
                'description', ii.description,
                'quantity', ii.quantity,
                'unit_price', ii.unit_price,
                'total', ii.total
              )
              order by ii.created_at
            )
            from public.invoice_items ii
            where ii.invoice_id = i.id
          ), '[]'::jsonb)
        )
        from public.invoices i
        where i.appointment_id = a.id
      ) as invoice
    from public.appointments a
    left join public.profiles p on p.id = a.provider_id
    where a.patient_id = p_patient_id
  ) visit;

  return result;
end;
$$;

revoke all on function public.get_patient_visit_history(uuid) from public;
grant execute on function public.get_patient_visit_history(uuid) to authenticated;

commit;
