-- Read-only workflow integrity checks for the Case-centric model.
-- Each query should return zero rows unless otherwise noted.

-- 1. Appointments linked to a Case belonging to a different patient.
select
  a.id as appointment_id,
  a.patient_id as appointment_patient_id,
  c.patient_id as case_patient_id,
  a.case_id
from public.appointments a
join public.cases c on c.id = a.case_id
where a.patient_id is distinct from c.patient_id;

-- 2. Treatments linked to a Case or appointment belonging to another patient.
select
  t.id as treatment_id,
  t.patient_id as treatment_patient_id,
  c.patient_id as case_patient_id,
  a.patient_id as appointment_patient_id
from public.treatments t
left join public.cases c on c.id = t.case_id
left join public.appointments a on a.id = t.appointment_id
where (c.id is not null and t.patient_id is distinct from c.patient_id)
   or (a.id is not null and t.patient_id is distinct from a.patient_id);

-- 3. Clinical notes linked to a Case or appointment belonging to another patient.
select
  n.id as clinical_note_id,
  n.patient_id as note_patient_id,
  c.patient_id as case_patient_id,
  a.patient_id as appointment_patient_id
from public.clinical_notes n
left join public.cases c on c.id = n.case_id
left join public.appointments a on a.id = n.appointment_id
where (c.id is not null and n.patient_id is distinct from c.patient_id)
   or (a.id is not null and n.patient_id is distinct from a.patient_id);

-- 4. More than one invoice for the same appointment.
select
  appointment_id,
  count(*) as invoice_count
from public.invoices
where appointment_id is not null
group by appointment_id
having count(*) > 1;

-- 5. Invoice linked to Case/appointment with inconsistent patient.
select
  i.id as invoice_id,
  i.patient_id as invoice_patient_id,
  c.patient_id as case_patient_id,
  a.patient_id as appointment_patient_id
from public.invoices i
left join public.cases c on c.id = i.case_id
left join public.appointments a on a.id = i.appointment_id
where (c.id is not null and i.patient_id is distinct from c.patient_id)
   or (a.id is not null and i.patient_id is distinct from a.patient_id);

-- 6. Active assignment history not matching current Case assignment.
select
  c.id as case_id,
  c.case_number,
  c.assigned_provider_id as case_provider,
  ca.provider_id as active_assignment_provider
from public.cases c
left join public.case_assignments ca
  on ca.case_id = c.id
 and ca.unassigned_at is null
where c.assigned_provider_id is distinct from ca.provider_id;

-- 7. Cases whose stored billing status differs from invoice totals.
with expected as (
  select
    c.id,
    case
      when count(i.id) filter (where i.status <> 'cancelled') = 0
        then 'not_billed'
      when coalesce(sum(i.balance) filter (where i.status <> 'cancelled'), 0) = 0
        then 'paid'
      when coalesce(sum(i.amount_paid) filter (where i.status <> 'cancelled'), 0) > 0
        then 'partial'
      else 'pending'
    end as expected_billing_status
  from public.cases c
  left join public.invoices i on i.case_id = c.id
  group by c.id
)
select
  c.case_number,
  c.billing_status,
  expected.expected_billing_status
from public.cases c
join expected on expected.id = c.id
where c.billing_status is distinct from expected.expected_billing_status;

-- 8. Closed clinical Cases that still have active appointments.
select
  c.case_number,
  a.id as appointment_id,
  a.appointment_date,
  a.appointment_time,
  a.status
from public.cases c
join public.appointments a on a.case_id = c.id
where c.status = 'closed'
  and a.status in ('scheduled', 'booked', 'confirmed', 'in_progress', 'open');

-- 9. Treatment-complete/closed Cases with incomplete treatments.
select
  c.case_number,
  t.id as treatment_id,
  t.procedure_name,
  t.status
from public.cases c
join public.treatments t on t.case_id = c.id
where c.status in ('treatment_complete', 'closed')
  and t.status in ('planned', 'in_progress');

-- 10. Summary counts (informational; non-zero is expected).
select
  (select count(*) from public.patients) as patients,
  (select count(*) from public.cases) as cases,
  (select count(*) from public.appointments) as appointments,
  (select count(*) from public.treatments) as treatments,
  (select count(*) from public.invoices) as invoices,
  (select count(*) from public.case_events) as case_events;
