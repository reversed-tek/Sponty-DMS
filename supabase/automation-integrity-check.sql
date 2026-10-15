-- PR9 automation integrity checks.
-- Queries 1-8 should return zero rows.

-- 1. Treatment plan items connected to missing Cases.
select tpi.*
from public.treatment_plan_items tpi
left join public.cases c on c.id = tpi.case_id
where c.id is null;

-- 2. Treatment linked to a plan item from a different Case.
select
  t.id as treatment_id,
  t.case_id as treatment_case_id,
  tpi.case_id as plan_case_id
from public.treatments t
join public.treatment_plan_items tpi on tpi.id = t.treatment_plan_item_id
where t.case_id is distinct from tpi.case_id;

-- 3. More than one treatment generated from one plan item.
select treatment_plan_item_id, count(*) as treatment_count
from public.treatments
where treatment_plan_item_id is not null
group by treatment_plan_item_id
having count(*) > 1;

-- 4. Completed treatments whose source plan item is not completed.
select
  t.id as treatment_id,
  t.status as treatment_status,
  tpi.id as plan_item_id,
  tpi.status as plan_status
from public.treatments t
join public.treatment_plan_items tpi on tpi.id = t.treatment_plan_item_id
where t.status = 'completed'
  and tpi.status <> 'completed';

-- 5. Duplicate open automated tasks by dedupe key.
select case_id, dedupe_key, count(*) as open_count
from public.case_tasks
where status = 'open'
  and dedupe_key is not null
group by case_id, dedupe_key
having count(*) > 1;

-- 6. Closed Cases with open tasks.
select c.case_number, ct.id as task_id, ct.title
from public.cases c
join public.case_tasks ct on ct.case_id = c.id
where c.status = 'closed'
  and ct.status = 'open';

-- 7. Closed Cases with unresolved treatment plan items.
select c.case_number, tpi.id, tpi.procedure_name, tpi.status
from public.cases c
join public.treatment_plan_items tpi on tpi.case_id = c.id
where c.status = 'closed'
  and tpi.status in ('proposed', 'accepted', 'in_progress');

-- 8. Scheduled/completed recalls without their linked appointment.
select pr.*
from public.patient_recalls pr
left join public.appointments a on a.id = pr.related_appointment_id
where pr.status in ('scheduled', 'completed')
  and a.id is null;

-- 9. Informational automation counts.
select
  (select count(*) from public.treatment_plan_items) as treatment_plan_items,
  (select count(*) from public.case_tasks where status = 'open') as open_case_tasks,
  (select count(*) from public.patient_recalls where status = 'open') as open_recalls,
  (select count(*) from public.patient_recalls where status = 'scheduled') as scheduled_recalls;
