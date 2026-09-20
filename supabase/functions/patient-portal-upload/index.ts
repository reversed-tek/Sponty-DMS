import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const supabase = createClient(
  supabaseUrl ?? "",
  supabaseServiceRoleKey ?? "",
);

async function notifyStaff(invoiceId: string, patientName: string) {
  const tenant = Deno.env.get("MICROSOFT_TENANT_ID");
  const clientId = Deno.env.get("MICROSOFT_CLIENT_ID");
  const clientSecret = Deno.env.get("MICROSOFT_CLIENT_SECRET");
  const sender = Deno.env.get("MICROSOFT_GRAPH_SENDER");
  const recipients = (Deno.env.get("PORTAL_STAFF_EMAILS") ?? "").split(",").map((email) => email.trim()).filter(Boolean);
  if (!tenant || !clientId || !clientSecret || !sender || !recipients.length) return;
  const tokenResponse = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }),
  });
  if (!tokenResponse.ok) return;
  const { access_token: accessToken } = await tokenResponse.json();
  await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message: { subject: "New Bank Transfer Receipt Uploaded for Verification", body: { contentType: "HTML", content: `<p>A receipt was uploaded for verification.</p><p><strong>Patient:</strong> ${patientName}<br><strong>Invoice:</strong> ${invoiceId}</p>` }, toRecipients: recipients.map((address) => ({ emailAddress: { address } })) }, saveToSentItems: true }),
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const form = await request.formData();
    const sessionToken = String(form.get("session_token") ?? "");
    const bucket = String(form.get("bucket") ?? "");
    const file = form.get("file");
    const invoiceId = String(form.get("invoice_id") ?? "");
    if (!sessionToken || !(file instanceof File) || !["payment-proofs", "patient-documents"].includes(bucket)) throw new Error("Invalid portal upload request.");
    if (file.size > 10 * 1024 * 1024) throw new Error("Files must be 10 MB or smaller.");
    const allowed = bucket === "payment-proofs"
      ? ["image/png", "image/jpeg", "application/pdf"]
      : ["image/png", "image/jpeg", "application/pdf", "image/webp"];
    if (!allowed.includes(file.type)) throw new Error("This file type is not allowed.");

    const { data: context, error: contextError } = await supabase.rpc("get_patient_portal_data", { p_session_token: sessionToken });
    if (contextError || !context?.patient_id) throw new Error("Portal session is invalid or expired.");
    if (bucket === "payment-proofs" && !invoiceId) throw new Error("An invoice is required for payment proof uploads.");

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${context.patient_id}/${crypto.randomUUID()}-${safeName}`;
    const { error: uploadError } = await supabase.storage.from(bucket).upload(path, file, { contentType: file.type, upsert: false });
    if (uploadError) throw uploadError;

    if (bucket === "payment-proofs") {
      const { error } = await supabase.rpc("mark_invoice_pending_verification", { p_session_token: sessionToken, p_invoice_id: invoiceId, p_storage_path: path, p_file_name: file.name, p_content_type: file.type });
      if (error) throw error;
      await notifyStaff(invoiceId, context.patient_name);
    } else {
      const { error } = await supabase.from("patient_documents").insert({ patient_id: context.patient_id, storage_path: path, file_name: file.name, content_type: file.type });
      if (error) throw error;
    }
    return new Response(JSON.stringify({ path, file_name: file.name }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Upload failed." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
