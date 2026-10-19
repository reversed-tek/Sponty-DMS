-- Run this setup manually AFTER deploying send-receipt-emails and configuring
-- its secrets. This is NOT a schema migration because it requires local secrets.
--
-- Prerequisites:
--   1. Enable pg_cron and pg_net in Supabase Dashboard > Database > Extensions.
--   2. In Supabase Vault, create:
--        sponty_receipt_project_url = https://YOUR-PROJECT-REF.supabase.co
--        sponty_receipt_dispatch_secret = same long random secret as
--          Edge Function secret RECEIPT_DISPATCH_SECRET (at least 32 characters).
--   3. Deploy Edge Function with JWT verification disabled as specified in
--      supabase/config.toml, using --no-verify-jwt if necessary.
--   4. Ensure MICROSOFT_* and MICROSOFT_GRAPH_SENDER Edge Function secrets exist.
--
-- If the job already exists, cron.schedule with this same name updates it.
select cron.schedule(
  'sponty-send-payment-receipts',
  '* * * * *',
  $job$
  select net.http_post(
    url := (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'sponty_receipt_project_url'
      limit 1
    ) || '/functions/v1/send-receipt-emails',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-receipt-dispatch-secret', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'sponty_receipt_dispatch_secret'
        limit 1
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  ) as request_id;
  $job$
);

-- Verify with:
-- select jobid, jobname, schedule, active from cron.job
-- where jobname = 'sponty-send-payment-receipts';
--
-- To disable without deleting pending payment receipts:
-- select cron.unschedule('sponty-send-payment-receipts');
