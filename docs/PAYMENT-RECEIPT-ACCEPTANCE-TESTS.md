# Automatic payment receipts — acceptance checks

## Deployment order
1. Apply `supabase/migrations/20261020000000_automatic_payment_receipts.sql` to Supabase.
2. Verify the payment_receipts table, trigger, and portal RPC exist.
3. Deploy the frontend from the PR after the migration is applied. Vercel does not run SQL migrations.

## Expected behavior
1. Complete a handed-over clinical visit. Confirm the visit invoice is generated, but **no receipt** exists for an unpaid invoice.
2. In Billing, apply a partial payment (for example, PHP 100 against a PHP 300 balance). Confirm the invoice remains partial and exactly one receipt appears in payment_receipts for PHP 100 with the correct remaining balance.
3. Apply the remaining PHP 200. Confirm a second receipt for PHP 200 and a paid invoice. The partial receipt must remain unchanged.
4. Reopen or reload Billing and the patient portal. Confirm this does **not** create another receipt. Calling the payment RPC on an already-paid invoice must not issue a new receipt.
5. Open a verified patient portal link and check **Payment Receipts**. Confirm both receipts display, including the final paid invoice, and each shows its own amount and timestamp.
6. Select **View / Print**, then **Print / Save PDF**. Confirm the print preview contains the receipt only (not patient documents or bank-transfer instructions).
7. Verify as a second patient; receipts from the first patient must not be present.
8. Confirm a patient-uploaded proof of transfer alone does **not** issue a clinic payment receipt. Only actual recorded payments do so.
9. Confirm frontend use remains possible before the SQL migration is applied; the missing receipts collection shows as empty rather than crashing.
10. Confirm existing appointment, case and clinical completion flows still work.

## Read-only SQL integrity checks

```sql
-- Each receipt must match its invoice and patient.
select r.id, r.receipt_number
from public.payment_receipts r
join public.invoices i on i.id = r.invoice_id
where r.patient_id <> i.patient_id;

-- Receipt totals must be positive and nonnegative after payment.
select id, receipt_number
from public.payment_receipts
where amount <= 0 or amount_paid_after < amount or balance_after < 0;

-- Spot-check one invoice's cumulative receipts against invoice.amount_paid,
-- noting older payments made before the migration will not have receipt rows.
select i.invoice_number, i.amount_paid,
       coalesce(sum(r.amount), 0) as receipts_since_migration
from public.invoices i
left join public.payment_receipts r on r.invoice_id = i.id
group by i.id, i.invoice_number, i.amount_paid;
```

## Scope and limitations
- A **receipt is created for each successfully recorded amount increase**, including partial payments. No receipt is created merely because an invoice is generated or viewed.
- Receipts are persisted in PostgreSQL and surfaced to the verified patient's portal automatically; **no email notification or stored PDF file** is generated. Patients can use Print / Save PDF.
- Historical payments are **not backfilled** from invoice totals or dates, since that would invent payment details. A verified historical reconciliation can be built separately.
- Receipt numbers and presentation are payment acknowledgments, not a claim of tax-authority compliance. Confirm local tax/invoicing requirements before production use.
