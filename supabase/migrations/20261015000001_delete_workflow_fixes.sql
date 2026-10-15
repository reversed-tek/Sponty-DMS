begin;

-- ============================================================
-- Delete workflow fixes
-- ============================================================
-- 1. Recreate the safe appointment delete RPC in case an older database
--    missed the original migration.
-- 2. Prevent clinical DELETE triggers from writing Case events after the
--    parent Case has already been removed by a cascading patient delete.
-- 3. Replace direct patient deletion with a safe RPC that refuses to remove
--    patients that already have clinical, appointment, or billing history.

-- ============================================================
-- Appointment delete RPC
-- ============================================================

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

-- ============================================================
-- Clinical cascade guard
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

  -- During a cascading patient/Case delete the parent Case may already be
  -- gone by the time treatment/note DELETE triggers fire. In that situation
  -- there is intentionally no Case event to write.
  if not exists (
    select 1
    from public.cases
    where id = target_case_id
  ) then
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

-- ============================================================
-- Safe patient delete RPC
-- ============================================================

drop policy if exists patients_delete_clinical on public.patients;

create or replace function public.delete_patient(p_patient_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  patient_row public.patients;
  caller_role public.app_role;
  appointment_count integer;
  case_count integer;
  clinical_note_count integer;
  treatment_count integer;
  invoice_count integer;
  medical_history_count integer;
  chart_count integer;
  diagnosis_count integer;
begin
  caller_role := public.current_user_role();

  if caller_role is null or caller_role not in ('admin', 'dentist') then
    raise exception 'dentist_or_admin_required';
  end if;

  select *
  into patient_row
  from public.patients
  where id = p_patient_id
  for update;

  if not found then
    raise exception 'patient_not_found';
  end if;

  select count(*) into appointment_count
  from public.appointments
  where patient_id = p_patient_id;

  select count(*) into case_count
  from public.cases
  where patient_id = p_patient_id;

  select count(*) into clinical_note_count
  from public.clinical_notes
  where patient_id = p_patient_id;

  select count(*) into treatment_count
  from public.treatments
  where patient_id = p_patient_id;

  select count(*) into invoice_count
  from public.invoices
  where patient_id = p_patient_id;

  select count(*) into medical_history_count
  from public.medical_history
  where patient_id = p_patient_id;

  select count(*) into chart_count
  from public.dental_chart_records
  where patient_id = p_patient_id;

  select count(*) into diagnosis_count
  from public.diagnoses
  where patient_id = p_patient_id;

  if appointment_count > 0
     or case_count > 0
     or clinical_note_count > 0
     or treatment_count > 0
     or invoice_count > 0
     or medical_history_count > 0
     or chart_count > 0
     or diagnosis_count > 0 then
    raise exception using
      message = 'patient_has_linked_history',
      detail = format(
        'Appointments: %s, cases: %s, notes: %s, treatments: %s, invoices: %s, medical history: %s, chart records: %s, diagnoses: %s',
        appointment_count,
        case_count,
        clinical_note_count,
        treatment_count,
        invoice_count,
        medical_history_count,
        chart_count,
        diagnosis_count
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
    'patient_deleted',
    'patient',
    patient_row.id,
    jsonb_build_object(
      'patient_number', patient_row.patient_number,
      'first_name', patient_row.first_name,
      'last_name', patient_row.last_name
    )
  );

  delete from public.patients
  where id = p_patient_id;

  return jsonb_build_object(
    'patient_id', patient_row.id,
    'patient_number', patient_row.patient_number,
    'deleted', true
  );
end;
$$;

revoke all on function public.delete_patient(uuid) from public;
grant execute on function public.delete_patient(uuid) to authenticated;

-- Ask PostgREST to refresh its function cache immediately.
notify pgrst, 'reload schema';

commit;
