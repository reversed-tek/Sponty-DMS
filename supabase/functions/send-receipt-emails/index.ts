import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type ReceiptDelivery = {
  delivery_id: string;
  claim_token: string;
  recipient_email: string;
  receipt_number: string;
  invoice_number: string;
  issued_at: string;
  amount: number | string;
  invoice_total: number | string;
  amount_paid_after: number | string;
  balance_after: number | string;
  payment_method: string | null;
  patient_name: string;
};

const env = (name: string) => Deno.env.get(name)?.trim() ?? "";
const formatMoney = (amount: number | string) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(Number(amount));

const formatDate = (value: string) =>
  new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));

function safe(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char] ?? char);
}

function matchesSecret(provided: string | null, expected: string) {
  if (!provided || expected.length < 32 || provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

function receiptHtml(item: ReceiptDelivery) {
  const balance = Number(item.balance_after);
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#233244;line-height:1.5;">
    <div style="max-width:590px;margin:auto;padding:24px;border:1px solid #d6dee6;">
      <h2 style="color:#005a9e;margin:0;">Sponty Dental Services</h2>
      <h3 style="margin:6px 0 18px;">Payment Receipt</h3>
      <p>Hello ${safe(item.patient_name)},</p>
      <p>Thank you. We have recorded the payment below. A copy of this receipt is also
      available in your verified Sponty patient portal.</p>
      <table cellpadding="7" style="width:100%;border-collapse:collapse;text-align:left;">
        <tr><th>Receipt number</th><td>${safe(item.receipt_number)}</td></tr>
        <tr><th>Invoice number</th><td>${safe(item.invoice_number)}</td></tr>
        <tr><th>Date issued</th><td>${safe(formatDate(item.issued_at))}</td></tr>
        <tr><th>Amount received</th><td><strong>${safe(formatMoney(item.amount))}</strong></td></tr>
        <tr><th>Invoice total</th><td>${safe(formatMoney(item.invoice_total))}</td></tr>
        <tr><th>Paid to date</th><td>${safe(formatMoney(item.amount_paid_after))}</td></tr>
        <tr><th>Remaining balance</th><td>${safe(formatMoney(item.balance_after))}</td></tr>
        <tr><th>Payment method</th><td>${safe(item.payment_method || "Not specified")}</td></tr>
      </table>
      <p>${balance === 0 ? "This invoice is paid in full." : "This is a partial payment; a balance remains outstanding."}</p>
      <p>You can print or save this email as a receipt. To view receipts in the portal,
      please use your existing secure portal link and verification code, or contact the clinic.</p>
      <p style="color:#5a6878;font-size:12px;">Please contact the clinic if any details are incorrect.</p>
    </div></body></html>`;
}

async function graphAccessToken() {
  const tenant = env("MICROSOFT_TENANT_ID");
  const clientId = env("MICROSOFT_CLIENT_ID");
  const clientSecret = env("MICROSOFT_CLIENT_SECRET");
  if (!tenant || !clientId || !clientSecret) throw new Error("graph_credentials_not_configured");
  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
      scope: "https://graph.microsoft.com/.default",
    }),
  });
  if (!response.ok) throw new Error(`graph_token_http_${response.status}`);
  const data = await response.json();
  if (typeof data.access_token !== "string") throw new Error("graph_token_missing");
  return data.access_token as string;
}

async function sendMail(item: ReceiptDelivery, token: string) {
  const sender = env("MICROSOFT_GRAPH_SENDER");
  if (!sender) throw new Error("receipt_sender_not_configured");
  const response = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          subject: `Payment receipt ${item.receipt_number} - Sponty Dental Services`,
          body: { contentType: "HTML", content: receiptHtml(item) },
          toRecipients: [{ emailAddress: { address: item.recipient_email } }],
        },
        saveToSentItems: true,
      }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok) {
    const error = new Error(`graph_send_http_${response.status}`) as Error & { retryable?: boolean };
    error.retryable = response.status === 408 || response.status === 429 || response.status >= 500;
    throw error;
  }
  // Graph's 202 means accepted for processing, not guaranteed mailbox delivery.
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

  if (!matchesSecret(request.headers.get("x-receipt-dispatch-secret"), env("RECEIPT_DISPATCH_SECRET"))) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = env("SUPABASE_URL");
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return Response.json({ error: "database_not_configured" }, { status: 503 });
  if (!env("MICROSOFT_GRAPH_SENDER")) {
    return Response.json({ error: "receipt_sender_not_configured" }, { status: 503 });
  }

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  // Validate Graph credentials BEFORE claiming queued receipts.
  let token: string;
  try {
    token = await graphAccessToken();
  } catch (error) {
    console.error("Receipt dispatcher authentication failed", error instanceof Error ? error.message : "unknown");
    return Response.json({ error: "mail_provider_unavailable" }, { status: 503 });
  }

  const { data, error: claimError } = await supabase.rpc("claim_payment_receipt_emails", { p_limit: 10 });
  if (claimError) {
    console.error("Receipt dispatcher claim failed", claimError.code);
    return Response.json({ error: "receipt_queue_unavailable" }, { status: 503 });
  }
  const deliveries = (Array.isArray(data) ? data : []) as ReceiptDelivery[];
  let accepted = 0, retried = 0, failed = 0;

  for (const item of deliveries) {
    try {
      await sendMail(item, token);
      const { data: completed, error } = await supabase.rpc("complete_payment_receipt_email", {
        p_delivery_id: item.delivery_id,
        p_claim_token: item.claim_token,
      });
      if (error || !completed) throw new Error("receipt_delivery_ack_failed");
      accepted++;
    } catch (error) {
      const reason = error instanceof Error ? error.message : "receipt_send_failed";
      const retryable = typeof error === "object" && error !== null &&
        "retryable" in error ? Boolean((error as { retryable?: boolean }).retryable) : true;
      const { data: saved, error: saveError } = await supabase.rpc("fail_payment_receipt_email", {
        p_delivery_id: item.delivery_id,
        p_claim_token: item.claim_token,
        p_reason: reason,
        p_retryable: retryable,
      });
      if (saveError || !saved) {
        // An expired lease can be retried later. Do not log patient information.
        console.error("Receipt delivery failure could not be persisted", saveError?.code ?? "claim_expired");
      }
      if (retryable) retried++; else failed++;
    }
  }

  return Response.json({ processed: deliveries.length, accepted, retryable_failures: retried, permanent_failures: failed });
});
