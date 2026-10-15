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
export type TreatmentPlanStatus =
  | "proposed"
  | "accepted"
  | "in_progress"
  | "completed"
  | "deferred"
  | "cancelled";

export type CaseTaskPriority = "low" | "normal" | "high" | "urgent";

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

export async function closeCase(caseId: string, recallMonths = 6) {
  const { data, error } = await client().rpc("close_case_workflow", {
    p_case_id: caseId,
    p_recall_months: recallMonths,
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


export async function addTreatmentPlanItem(input: {
  caseId: string;
  procedureName: string;
  toothNumber?: number | null;
  estimatedCost: number;
  notes?: string;
  sequenceNo?: number;
  createdBy: string;
}) {
  const { data, error } = await client()
    .from("treatment_plan_items")
    .insert({
      case_id: input.caseId,
      procedure_name: input.procedureName.trim(),
      tooth_number: input.toothNumber ?? null,
      estimated_cost: input.estimatedCost,
      notes: input.notes?.trim() || null,
      sequence_no: input.sequenceNo ?? 1,
      status: "proposed",
      created_by: input.createdBy,
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function updateTreatmentPlanStatus(
  planItemId: string,
  status: TreatmentPlanStatus,
) {
  const patch: Record<string, unknown> = { status };

  if (status === "accepted") patch.accepted_at = new Date().toISOString();
  if (status === "completed") patch.completed_at = new Date().toISOString();

  const { data, error } = await client()
    .from("treatment_plan_items")
    .update(patch)
    .eq("id", planItemId)
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function performTreatmentPlanItem(
  planItemId: string,
  appointmentId: string,
) {
  const { data, error } = await client().rpc("perform_treatment_plan_item", {
    p_plan_item_id: planItemId,
    p_appointment_id: appointmentId,
  });

  if (error) throw new Error(error.message);
  return data;
}

export async function addCaseTask(input: {
  caseId: string;
  title: string;
  description?: string;
  priority?: CaseTaskPriority;
  dueAt?: string | null;
  appointmentId?: string | null;
}) {
  const { data, error } = await client().rpc("upsert_case_task", {
    p_case_id: input.caseId,
    p_task_type: "manual",
    p_title: input.title.trim(),
    p_description: input.description?.trim() || null,
    p_priority: input.priority ?? "normal",
    p_due_at: input.dueAt || null,
    p_appointment_id: input.appointmentId || null,
    p_dedupe_key: null,
    p_source: "manual",
  });

  if (error) throw new Error(error.message);
  return data;
}

export async function completeCaseTask(taskId: string) {
  const { data, error } = await client().rpc("complete_case_task", {
    p_task_id: taskId,
  });

  if (error) throw new Error(error.message);
  return data;
}

export async function schedulePatientRecall(input: {
  patientId: string;
  caseId?: string | null;
  intervalMonths: number;
  recallType?: "preventive" | "follow_up";
  notes?: string;
}) {
  const { data, error } = await client().rpc("schedule_patient_recall", {
    p_patient_id: input.patientId,
    p_case_id: input.caseId ?? null,
    p_interval_months: input.intervalMonths,
    p_recall_type: input.recallType ?? "preventive",
    p_notes: input.notes?.trim() || null,
    p_source: "manual",
  });

  if (error) throw new Error(error.message);
  return data;
}
