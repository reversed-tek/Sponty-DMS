begin;

-- Replace the broad appointments policy so hard deletes cannot be issued
-- directly from the client. Select/insert/update remain unchanged.
drop policy if exists appointments_access on public.appointments;
drop policy if exists appointments_select_access on public.appointments;
drop policy if exists appointments_insert_access on public.appointments;
drop policy if exists appointments_update_access on public.appointments;

create policy appointments_select_access
on public.appointments
for select
to authenticated
using (true);

create policy appointments_insert_access
on public.appointments
for insert
to authenticated
with check (true);

create policy appointments_update_access
on public.appointments
for update
to authenticated
using (true)
with check (true);

create or replace function public.delete_appointment(p_appointment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  appointment_row public.appointments;
  caller_role public.app_role;
  linked_treatments integer;
  linked_notes integer;
  linked_invoices integer;
begin
  caller_role := public.current_user_role();

  if caller_role is null or caller_role not in ('admin', 'receptionist') then
    raise exception 'receptionist_or_admin_required';
  end if;

  select *
  into appointment_row
  from public.appointments
  where id = p_appointment_id
  for update;

  if not found then
    raise exception 'appointment_not_found';
  end if;

  if appointment_row.status not in ('scheduled', 'booked', 'open') then
    raise exception 'appointment_cannot_be_deleted_after_check_in_or_completion';
  end if;

  if appointment_row.checked_in_at is not null
     or appointment_row.handed_over_at is not null
     or appointment_row.clinical_updated_at is not null
     or appointment_row.treatment_completed_at is not null then
    raise exception 'appointment_has_workflow_history';
  end if;

  select count(*) into linked_treatments
  from public.treatments
  where appointment_id = p_appointment_id;

  select count(*) into linked_notes
  from public.clinical_notes
  where appointment_id = p_appointment_id;

  select count(*) into linked_invoices
  from public.invoices
  where appointment_id = p_appointment_id;

  if linked_treatments > 0 or linked_notes > 0 or linked_invoices > 0 then
    raise exception using
      message = 'appointment_has_linked_records',
      detail = format(
        'Treatments: %s, clinical notes: %s, invoices: %s',
        linked_treatments,
        linked_notes,
        linked_invoices
      );
  end if;

  insert into public.audit_events (
    actor_id,
    action,
    entity_type,
    entity_id,
    details
  )
  values (
    auth.uid(),
    'appointment_deleted',
    'appointment',
    appointment_row.id,
    jsonb_build_object(
      'patient_id', appointment_row.patient_id,
      'provider_id', appointment_row.provider_id,
      'appointment_date', appointment_row.appointment_date,
      'appointment_time', appointment_row.appointment_time,
      'appointment_type', appointment_row.appointment_type,
      'status', appointment_row.status::text,
      'outlook_event_id', appointment_row.outlook_event_id
    )
  );

  delete from public.appointments
  where id = p_appointment_id;

  return jsonb_build_object(
    'appointment_id', appointment_row.id,
    'deleted', true,
    'outlook_event_id', appointment_row.outlook_event_id
  );
end;
$$;

revoke all on function public.delete_appointment(uuid) from public;
grant execute on function public.delete_appointment(uuid) to authenticated;

commit;
