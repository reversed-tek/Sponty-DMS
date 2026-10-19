begin;

-- Email delivery is kept separate from the accounting transaction. A receipt
-- is committed first; background delivery can safely fail or be retried.
create table if not exists public.receipt_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null unique references public.payment_receipts(id) on delete restrict,
  recipient_email text,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'sent', 'failed', 'missing_email')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  claim_token uuid,
  claimed_until timestamptz,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists receipt_email_dispatch_idx
  on public.receipt_email_deliveries (status, next_attempt_at, claimed_until);

alter table public.receipt_email_deliveries enable row level security;
revoke all on public.receipt_email_deliveries from anon, authenticated;
-- Only SECURITY DEFINER routines and service-role backend code can work with this queue.

create or replace function public.enqueue_payment_receipt_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_email text;
begin
  select nullif(trim(p.email), '')
  into target_email
  from public.patients p
  where p.id = new.patient_id;

  -- No patient address, no outbound email. The receipt still exists in portal.
  insert into public.receipt_email_deliveries (
    receipt_id, recipient_email, status
  )
  values (
    new.id,
    target_email,
    case
      when target_email is null or target_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
        then 'missing_email'
      else 'pending'
    end
  )
  on conflict (receipt_id) do nothing;

  return new;
end;
$$;
revoke all on function public.enqueue_payment_receipt_email() from public;
drop trigger if exists payment_receipts_queue_email on public.payment_receipts;
create trigger payment_receipts_queue_email
after insert on public.payment_receipts
for each row execute function public.enqueue_payment_receipt_email();

-- Concurrent workers safely lease distinct rows using SKIP LOCKED.
-- A crashed worker's lease can be recovered by a subsequent cron run.
create or replace function public.claim_payment_receipt_emails(p_limit integer default 10)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role_required';
  end if;

  with ready as (
    select d.id
    from public.receipt_email_deliveries d
    where d.attempt_count < 5
      and (
        (d.status = 'pending' and d.next_attempt_at <= now())
        or (d.status = 'processing' and d.claimed_until < now())
      )
    order by d.next_attempt_at, d.created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 10), 20))
  ), claimed as (
    update public.receipt_email_deliveries d
    set status = 'processing',
        attempt_count = d.attempt_count + 1,
        claim_token = gen_random_uuid(),
        claimed_until = now() + interval '5 minutes',
        updated_at = now()
    from ready
    where d.id = ready.id
    returning d.id, d.receipt_id, d.recipient_email, d.claim_token
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'delivery_id', c.id,
    'claim_token', c.claim_token,
    'recipient_email', c.recipient_email,
    'receipt_number', r.receipt_number,
    'invoice_number', r.invoice_number,
    'issued_at', r.issued_at,
    'amount', r.amount,
    'invoice_total', r.invoice_total,
    'amount_paid_after', r.amount_paid_after,
    'balance_after', r.balance_after,
    'payment_method', r.payment_method,
    'patient_name', p.first_name || ' ' || p.last_name
  )), '[]'::jsonb)
  into result
  from claimed c
  join public.payment_receipts r on r.id = c.receipt_id
  join public.patients p on p.id = r.patient_id;

  return result;
end;
$$;
revoke all on function public.claim_payment_receipt_emails(integer) from public;
grant execute on function public.claim_payment_receipt_emails(integer) to service_role;

create or replace function public.complete_payment_receipt_email(
  p_delivery_id uuid, p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role_required';
  end if;
  update public.receipt_email_deliveries
  set status = 'sent', sent_at = now(), claim_token = null,
      claimed_until = null, last_error = null, updated_at = now()
  where id = p_delivery_id and claim_token = p_claim_token
    and status = 'processing';
  return found;
end;
$$;
revoke all on function public.complete_payment_receipt_email(uuid, uuid) from public;
grant execute on function public.complete_payment_receipt_email(uuid, uuid) to service_role;

create or replace function public.fail_payment_receipt_email(
  p_delivery_id uuid, p_claim_token uuid, p_reason text, p_retryable boolean default true
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role_required';
  end if;
  update public.receipt_email_deliveries d
  set status = case
        when p_retryable and d.attempt_count < 5 then 'pending'
        else 'failed'
      end,
      next_attempt_at = now() + case d.attempt_count
        when 1 then interval '2 minutes'
        when 2 then interval '5 minutes'
        when 3 then interval '15 minutes'
        else interval '1 hour'
      end,
      last_error = left(coalesce(p_reason, 'email_delivery_failed'), 350),
      claim_token = null, claimed_until = null, updated_at = now()
  where d.id = p_delivery_id and d.claim_token = p_claim_token
    and d.status = 'processing';
  return found;
end;
$$;
revoke all on function public.fail_payment_receipt_email(uuid, uuid, text, boolean) from public;
grant execute on function public.fail_payment_receipt_email(uuid, uuid, text, boolean) to service_role;

-- This is a one-time outbox initialization for receipts issued between
-- migration #1 and this migration. The unique key prevents duplicate jobs.
insert into public.receipt_email_deliveries (receipt_id, recipient_email, status)
select r.id,
       nullif(trim(p.email), ''),
       case
         when nullif(trim(p.email), '') is null
           or trim(p.email) !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
           then 'missing_email'
         else 'pending'
       end
from public.payment_receipts r
join public.patients p on p.id = r.patient_id
on conflict (receipt_id) do nothing;

notify pgrst, 'reload schema';
commit;
