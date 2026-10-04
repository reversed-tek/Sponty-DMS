import { supabase } from "./supabase";

export type CaseClinicalStatus =
  | "open"
  | "in_treatment"
  | "treatment_complete"
  | "closed";

export type CaseBillingStatus =
  | "not_billed"
  | "pending"
  | "partial"
  | "paid";

export type CasePriority = "low" | "normal" | "high" | "urgent";

export type CompleteVisitResult = {
  case_id: string;
  case_number: string;
  case_status: CaseClinicalStatus;
  billing_status: CaseBillingStatus;
  appointment_id: string;
  appointment_status: string;
  invoice_id: string;
  invoice_number: string;
  invoice_status: string;
  total: number;
  amount_paid: number;
  balance: number;
  treatment_count: number;
};

function client() {
  if (!supabase) throw new Error("Supabase is not configured.");
  return supabase;
}

export async function completeCaseVisit(caseId: string, appointmentId: string) {
  const { data, error } = await client().rpc("complete_case_visit", {
    p_case_id: caseId,
    p_appointment_id: appointmentId,
  });

  if (error) throw new Error(error.message);
  return data as CompleteVisitResult;
}

export async function closeCase(caseId: string) {
  const { data, error } = await client().rpc("close_case_workflow", {
    p_case_id: caseId,
  });

  if (error) throw new Error(error.message);
  return data as {
    id: string;
    case_number: string;
    status: CaseClinicalStatus;
    billing_status: CaseBillingStatus;
    closed_at: string | null;
  };
}

export async function reopenCase(caseId: string) {
  const { data, error } = await client().rpc("reopen_case_workflow", {
    p_case_id: caseId,
  });

  if (error) throw new Error(error.message);
  return data as {
    id: string;
    case_number: string;
    status: CaseClinicalStatus;
    billing_status: CaseBillingStatus;
    closed_at: string | null;
  };
}

export async function updateCasePriority(
  caseId: string,
  priority: CasePriority,
) {
  const { error } = await client()
    .from("cases")
    .update({ priority })
    .eq("id", caseId);

  if (error) throw new Error(error.message);
}

export async function addCaseClinicalNote(input: {
  caseId: string;
  appointmentId: string;
  patientId: string;
  authorId: string;
  visitType: string;
  subjective?: string;
  objective?: string;
  assessment?: string;
  plan?: string;
}) {
  const { error } = await client().from("clinical_notes").insert({
    patient_id: input.patientId,
    appointment_id: input.appointmentId,
    case_id: input.caseId,
    author_id: input.authorId,
    visit_type: input.visitType,
    note_date: new Date().toISOString().slice(0, 10),
    subjective: input.subjective?.trim() || null,
    objective: input.objective?.trim() || null,
    assessment: input.assessment?.trim() || null,
    plan: input.plan?.trim() || null,
    is_private: false,
  });

  if (error) throw new Error(error.message);
}

export async function addCaseTreatment(input: {
  caseId: string;
  appointmentId: string;
  patientId: string;
  providerId: string;
  createdBy: string;
  procedureName: string;
  toothNumber?: number | null;
  cost: number;
  notes?: string;
}) {
  const { error } = await client().from("treatments").insert({
    patient_id: input.patientId,
    appointment_id: input.appointmentId,
    case_id: input.caseId,
    provider_id: input.providerId,
    treatment_date: new Date().toISOString().slice(0, 10),
    tooth_number: input.toothNumber ?? null,
    procedure_name: input.procedureName.trim(),
    description: input.notes?.trim() || null,
    cost: input.cost,
    status: "planned",
    notes: input.notes?.trim() || null,
    created_by: input.createdBy,
  });

  if (error) throw new Error(error.message);
}
