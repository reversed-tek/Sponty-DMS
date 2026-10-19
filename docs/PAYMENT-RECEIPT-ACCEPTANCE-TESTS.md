# Automatic payment receipts — acceptance checks

## Deployment order
1. Apply BOTH migrations to Supabase, in order:
   - `supabase/migrations/20261020000000_automatic_payment_receipts.sql`
   - `supabase/migrations/20261020000001_receipt_email_delivery.sql`
2. Verify the receipt table, delivery queue, triggers, and portal RPC exist.
3. Deploy the frontend from the PR after the migrations are applied. Vercel does not run SQL migrations.
4. Set the Supabase Edge Function secrets for Graph and `RECEIPT_DISPATCH_SECRET`, then deploy `send-receipt-emails` with JWT verification disabled and its custom secret-header check active.
5. In Supabase Vault, create `sponty_receipt_project_url` and `sponty_receipt_dispatch_secret` (same secret as the Edge Function).
6. Enable pg_cron and pg_net, then run `supabase/receipt-email-cron-setup.sql` manually to invoke the dispatcher every minute.
7. Check the Cron logs, receipt delivery queue and Graph sender permissions on a test invoice. **The migration and Vercel deployment alone do not activate emailing.**

See the complete setup and security notes in `DEPLOYMENT-GUIDE.md`.

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
11. With a valid patient email and the worker configured, create one partial and one final payment. Confirm **each issued receipt sends one email**, with the exact amount and unique receipt number.
12. Simulate a mail-service failure (for example, revoke the app's Mail.Send permission in a test tenant). Confirm the payment and receipt still persist while the delivery is queued or marked failed.
13. Confirm missing/invalid patient email addresses show `missing_email` in the delivery queue and do not attempt to send.
14. Confirm the same receipt cannot be enqueued twice and successfully sent delivery jobs are never picked up again in normal processing.
15. Confirm wrong or missing `x-receipt-dispatch-secret` returns HTTP 401 and cannot access the service-role worker.
16. Restore mail configuration, verify the retry schedule and check `sent_at`. Microsoft Graph HTTP 202 means **accepted for delivery**, not proof that the patient's mailbox received it.

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

## Outbound mail monitoring (staff/admin via Supabase SQL Editor)

```sql
select r.receipt_number, d.recipient_email, d.status, d.attempt_count,
       d.sent_at, d.next_attempt_at, d.last_error
from public.receipt_email_deliveries d
join public.payment_receipts r on r.id = d.receipt_id
order by d.created_at desc
limit 50;
```

`pending` awaits its next attempt, `processing` is leased by the worker,
`sent` means Graph accepted the message, `failed` needs investigation,
and `missing_email` requires a valid patient address. Fixing an invalid address
does not automatically resend older receipts. Review the recipient with the clinic
and intentionally requeue that delivery if appropriate.

## Scope and limitations
- A **receipt is created for each successfully recorded amount increase**, including partial payments. No receipt is created merely because an invoice is generated or viewed.
- Receipts are stored in PostgreSQL and automatically available in the verified patient portal. Patients can use Print / Save PDF.
- **An HTML receipt email is queued automatically** to the patient's email on record when each new payment receipt is issued. The backend worker delivers it via Microsoft Graph, independently of any receptionist session, if correctly deployed and scheduled.
- The email contains receipt details; **there is no PDF attachment** or server-generated PDF file. The portal remains the print/PDF option.
- The outbox retries temporary problems (up to five attempts). It avoids duplicate jobs and concurrent sends; Microsoft Graph offers no exactly-once guarantee if a worker crashes after Graph accepts a message but before recording `sent`.
- A Graph HTTP 202 response means the service accepted the email for sending, **not verified inbox delivery**.
- Historical paid invoices are **not backfilled** from invoice totals or dates, since that would invent payment details. A verified historical reconciliation can be built separately.
- If migration #1 ran before migration #2, migration #2 queues any genuine existing payment receipts for email. Review the queue before activating Cron if you do not want to send those earlier receipts.
- Receipt numbers and presentation are payment acknowledgments, not a claim of tax-authority compliance. Confirm local tax/invoicing requirements before production use.
