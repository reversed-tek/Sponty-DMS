begin;

-- A clinic-issued receipt is a permanent record of an actual payment.
-- Patient-uploaded payment proofs remain a separate, unverified workflow.
create sequence if not exists public.payment_receipt_number_seq;

create table if not exists public.payment_receipts (
  id uuid primary key default gen_random_uuid(),
  receipt_number text not null unique,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  patient_id uuid not null references public.patients(id) on delete restrict,
  invoice_number text not null,
  issued_at timestamptz not null default now(),
  amount numeric(10,2) not null check (amount > 0),
  invoice_total numeric(10,2) not null check (invoice_total >= 0),
  amount_paid_after numeric(10,2) not null,
  balance_after numeric(10,2) not null,
  payment_method text,
  recorded_by uuid references public.profiles(id) on delete set null
);

create index if not exists payment_receipts_patient_date_idx
  on public.payment_receipts (patient_id, issued_at desc);
create index if not exists payment_receipts_invoice_idx
  on public.payment_receipts (invoice_id);

alter table public.payment_receipts enable row level security;

-- Staff may view receipts but cannot alter their financial history.
revoke all on table public.payment_receipts from anon, authenticated;
grant select on table public.payment_receipts to authenticated;
revoke all on sequence public.payment_receipt_number_seq from anon, authenticated;

drop policy if exists payment_receipts_staff_read on public.payment_receipts;
create policy payment_receipts_staff_read
  on public.payment_receipts for select to authenticated
  using (public.current_user_role() in ('admin', 'dentist', 'receptionist'));

-- A receipt is issued within the same transaction as the invoice payment.
-- If the invoice/payment transaction rolls back, its receipt rolls back too.
-- Triggering only on a positive amount_paid delta prevents duplicates when
-- an invoice is reloaded, marked paid again, or its other columns change.
create or replace function public.issue_receipt_for_invoice_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.payment_receipts (
    receipt_number, invoice_id, patient_id, invoice_number,
    amount, invoice_total, amount_paid_after, balance_after,
    payment_method, recorded_by
  )
  values (
    'RCT-' || to_char(now(), 'YYYY') || '-' ||
      lpad(nextval('public.payment_receipt_number_seq'::regclass)::text, 7, '0'),
    new.id, new.patient_id, new.invoice_number,
    (new.amount_paid - old.amount_paid)::numeric(10,2),
    new.total, new.amount_paid, new.balance,
    new.payment_method, auth.uid()
  );

  return new;
end;
$$;

revoke all on function public.issue_receipt_for_invoice_payment() from public;
drop trigger if exists invoices_issue_payment_receipt on public.invoices;
create trigger invoices_issue_payment_receipt
after update of amount_paid on public.invoices
for each row
when (new.amount_paid > old.amount_paid)
execute function public.issue_receipt_for_invoice_payment();

-- The portal continues to require a valid, patient-bound verified session.
-- Expose only that patient's confirmed payment receipts; never payment proofs
-- as though they were official clinic-issued receipts.
create or replace function public.get_patient_portal_data(p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  session_row public.portal_sessions;
  patient_row public.patients;
  result jsonb;
begin
  select * into session_row
  from public.portal_sessions
  where session_hash = encode(extensions.digest(p_session_token, 'sha256'), 'hex')
    and expires_at > now();

  if not found then
    raise exception 'portal_session_invalid_or_expired';
  end if;

  select * into patient_row
  from public.patients
  where id = session_row.patient_id;

  select jsonb_build_object(
    'patient_id', patient_row.id,
    'patient_name', patient_row.first_name || ' ' || patient_row.last_name,
    'invoices', coalesce((
      select jsonb_agg(i order by i.invoice_date desc)
      from public.invoices i
      where i.patient_id = session_row.patient_id
        and i.status in ('unpaid', 'pending', 'pending_verification', 'paid')
    ), '[]'::jsonb),
    'receipts', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', r.id,
          'receipt_number', r.receipt_number,
          'invoice_number', r.invoice_number,
          'issued_at', r.issued_at,
          'amount', r.amount,
          'invoice_total', r.invoice_total,
          'amount_paid_after', r.amount_paid_after,
          'balance_after', r.balance_after,
          'payment_method', r.payment_method
        )
        order by r.issued_at desc, r.receipt_number desc
      )
      from public.payment_receipts r
      where r.patient_id = session_row.patient_id
    ), '[]'::jsonb),
    'documents', coalesce((
      select jsonb_agg(d order by d.uploaded_at desc)
      from public.patient_documents d
      where d.patient_id = session_row.patient_id
    ), '[]'::jsonb),
    'bank', (
      select jsonb_build_object(
        'bank_name', bank_name,
        'account_name', bank_account_name,
        'account_number', bank_account_number
      )
      from public.practice_settings
      where id = true
    )
  ) into result;

  return result;
end;
$$;

revoke all on function public.get_patient_portal_data(text) from public;
grant execute on function public.get_patient_portal_data(text) to anon, authenticated;

-- No historical paid invoices are backfilled from balances; without a
-- verified payment event, the original amount/date cannot be reconstructed.
notify pgrst, 'reload schema';

commit;
