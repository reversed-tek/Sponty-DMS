import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addCaseClinicalNote,
  addCaseTreatment,
  closeCase,
  completeCaseVisit,
  reopenCase,
  updateCasePriority,
} from "../lib/caseService";
import type {
  CaseBillingStatus,
  CaseClinicalStatus,
  CasePriority,
} from "../lib/caseService";
import { supabase } from "../lib/supabase";
import { listActiveProviders } from "../lib/workflow";
import { CaseTreatmentPlan } from "./CaseTreatmentPlan";
import { CaseTasks } from "./CaseTasks";

type CaseTab =
  | "overview"
  | "plan"
  | "clinical"
  | "treatments"
  | "tasks"
  | "billing"
  | "activity";

type CaseRecord = {
  id: string;
  case_number: string;
  patient_id: string;
  primary_appointment_id: string | null;
  assigned_provider_id: string | null;
  title: string;
  intake_notes: string | null;
  status: CaseClinicalStatus;
  billing_status: CaseBillingStatus;
  priority: CasePriority;
  last_activity_at: string;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  patient_name: string;
  patient_number: string;
  patient_allergies: string | null;
  assigned_provider_name: string;
  next_appointment: CaseAppointmentSummary | null;
};

type CaseAppointmentSummary = {
  id: string;
  case_id: string | null;
  provider_id: string | null;
  appointment_date: string;
  appointment_time: string;
  appointment_type: string;
  status: string;
  checked_in_at: string | null;
  handed_over_at: string | null;
  treatment_completed_at: string | null;
};

type CaseAppointment = CaseAppointmentSummary & {
  reason: string | null;
  notes: string | null;
};

type CaseClinicalNote = {
  id: string;
  appointment_id: string | null;
  visit_type: string;
  note_date: string;
  subjective: string | null;
  objective: string | null;
  assessment: string | null;
  plan: string | null;
  created_at: string;
};

type CaseTreatment = {
  id: string;
  appointment_id: string | null;
  treatment_date: string;
  procedure_name: string;
  tooth_number: number | null;
  cost: number;
  status: string;
  notes: string | null;
  created_at: string;
};

type InvoiceItem = {
  id: string;
  description: string;
  quantity: number;
  unit_price: number;
  total: number;
};

type CaseInvoice = {
  id: string;
  appointment_id: string | null;
  invoice_number: string;
  invoice_date: string;
  total: number;
  amount_paid: number;
  balance: number;
  status: string;
  created_at: string;
  invoice_items: InvoiceItem[];
};

type CaseEvent = {
  id: string;
  appointment_id: string | null;
  event_type: string;
  title: string;
  detail: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

const priorityWeight: Record<CasePriority, number> = {
  urgent: 4,
  high: 3,
  normal: 2,
  low: 1,
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
  }).format(value);

const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

const clinicalStatusLabel = (status: CaseClinicalStatus) =>
  status === "in_treatment"
    ? "In treatment"
    : status === "treatment_complete"
      ? "Treatment complete"
      : status === "closed"
        ? "Closed"
        : "Open";

const billingStatusLabel = (status: CaseBillingStatus) =>
  status === "not_billed"
    ? "Not billed"
    : status === "partial"
      ? "Partially paid"
      : status === "paid"
        ? "Paid"
        : "Pending";

const appointmentStatusLabel = (status: string) =>
  status === "in_progress"
    ? "With dentist"
    : status === "confirmed"
      ? "Checked in"
      : status === "completed"
        ? "Visit complete"
        : status.replaceAll("_", " ");

function preferredVisit(appointments: CaseAppointment[]) {
  return (
    appointments.find((item) => item.status === "in_progress") ??
    appointments.find((item) => item.status === "confirmed") ??
    appointments.find((item) =>
      ["scheduled", "booked", "open"].includes(item.status),
    ) ??
    [...appointments].reverse().find((item) => item.status === "completed") ??
    appointments[0] ??
    null
  );
}

export function Cases({
  setNotice,
  initialCaseId = null,
  onInitialCaseHandled,
}: {
  setNotice: (message: string) => void;
  initialCaseId?: string | null;
  onInitialCaseHandled?: () => void;
}) {
  const [cases, setCases] = useState<CaseRecord[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [selectedVisitId, setSelectedVisitId] = useState<string | null>(null);
  const [caseView, setCaseView] = useState<"active" | "closed">("active");
  const [queueSearch, setQueueSearch] = useState("");
  const [tab, setTab] = useState<CaseTab>("overview");
  const [appointments, setAppointments] = useState<CaseAppointment[]>([]);
  const [clinicalNotes, setClinicalNotes] = useState<CaseClinicalNote[]>([]);
  const [treatments, setTreatments] = useState<CaseTreatment[]>([]);
  const [invoices, setInvoices] = useState<CaseInvoice[]>([]);
  const [events, setEvents] = useState<CaseEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [recallMonths, setRecallMonths] = useState("6");
  const [error, setError] = useState("");
  const [showClinicalForm, setShowClinicalForm] = useState(false);
  const [showTreatmentForm, setShowTreatmentForm] = useState(false);
  const [clinicalDraft, setClinicalDraft] = useState({
    visitType: "consultation",
    subjective: "",
    objective: "",
    assessment: "",
    plan: "",
  });
  const [treatmentDraft, setTreatmentDraft] = useState({
    procedureName: "",
    toothNumber: "",
    cost: "0",
    notes: "",
  });

  const loadCases = useCallback(async () => {
    if (!supabase) return;

    const [caseResult, patientResult, providerRows, appointmentResult] =
      await Promise.all([
        supabase
          .from("cases")
          .select(
            "id, case_number, patient_id, primary_appointment_id, assigned_provider_id, title, intake_notes, status, billing_status, priority, last_activity_at, created_at, updated_at, closed_at",
          )
          .order("last_activity_at", { ascending: false }),
        supabase
          .from("patients")
          .select("id, patient_number, first_name, last_name, allergies"),
        listActiveProviders(),
        supabase
          .from("appointments")
          .select(
            "id, case_id, provider_id, appointment_date, appointment_time, appointment_type, status, checked_in_at, handed_over_at, treatment_completed_at",
          )
          .not("case_id", "is", null)
          .order("appointment_date", { ascending: true })
          .order("appointment_time", { ascending: true }),
      ]);

    const firstError =
      caseResult.error ?? patientResult.error ?? appointmentResult.error;

    if (firstError) {
      setError(firstError.message);
      setLoading(false);
      return;
    }

    const patientMap = new Map(
      (patientResult.data ?? []).map((patient) => [
        patient.id,
        {
          name: `${patient.first_name} ${patient.last_name}`,
          number: patient.patient_number,
          allergies: patient.allergies ?? null,
        },
      ]),
    );

    const providerMap = new Map(
      providerRows.map((provider) => [provider.id, provider.full_name]),
    );

    const appointmentsByCase = new Map<string, CaseAppointmentSummary[]>();
    for (const appointment of (appointmentResult.data ?? []) as CaseAppointmentSummary[]) {
      if (!appointment.case_id) continue;
      const existing = appointmentsByCase.get(appointment.case_id) ?? [];
      existing.push(appointment);
      appointmentsByCase.set(appointment.case_id, existing);
    }

    const mapped = (caseResult.data ?? []).map((item) => {
      const patient = patientMap.get(item.patient_id);
      const caseAppointments = appointmentsByCase.get(item.id) ?? [];
      const nextAppointment =
        caseAppointments.find((appointment) =>
          ["in_progress", "confirmed"].includes(appointment.status),
        ) ??
        caseAppointments.find((appointment) =>
          ["scheduled", "booked", "open"].includes(appointment.status),
        ) ??
        null;

      return {
        ...item,
        status: item.status as CaseClinicalStatus,
        billing_status: item.billing_status as CaseBillingStatus,
        priority: item.priority as CasePriority,
        patient_name: patient?.name ?? "Unknown patient",
        patient_number: patient?.number ?? "-",
        patient_allergies: patient?.allergies ?? null,
        assigned_provider_name: item.assigned_provider_id
          ? providerMap.get(item.assigned_provider_id) ?? "Assigned dentist"
          : "Unassigned",
        next_appointment: nextAppointment,
      } satisfies CaseRecord;
    });

    setCases(mapped);
    setSelectedCaseId((current) =>
      current && mapped.some((item) => item.id === current) ? current : null,
    );
    setError("");
    setLoading(false);
  }, []);

  const loadCaseDetails = useCallback(async (caseId: string) => {
    if (!supabase) return;
    setDetailLoading(true);

    const [
      appointmentResult,
      noteResult,
      treatmentResult,
      invoiceResult,
      eventResult,
    ] = await Promise.all([
      supabase
        .from("appointments")
        .select(
          "id, case_id, provider_id, appointment_date, appointment_time, appointment_type, status, reason, notes, checked_in_at, handed_over_at, treatment_completed_at",
        )
        .eq("case_id", caseId)
        .order("appointment_date", { ascending: true })
        .order("appointment_time", { ascending: true }),
      supabase
        .from("clinical_notes")
        .select(
          "id, appointment_id, visit_type, note_date, subjective, objective, assessment, plan, created_at",
        )
        .eq("case_id", caseId)
        .order("created_at", { ascending: false }),
      supabase
        .from("treatments")
        .select(
          "id, appointment_id, treatment_date, procedure_name, tooth_number, cost, status, notes, created_at",
        )
        .eq("case_id", caseId)
        .order("created_at", { ascending: false }),
      supabase
        .from("invoices")
        .select(
          "id, appointment_id, invoice_number, invoice_date, total, amount_paid, balance, status, created_at, invoice_items(id, description, quantity, unit_price, total)",
        )
        .eq("case_id", caseId)
        .order("invoice_date", { ascending: false })
        .order("created_at", { ascending: false }),
      supabase
        .from("case_events")
        .select(
          "id, appointment_id, event_type, title, detail, metadata, created_at",
        )
        .eq("case_id", caseId)
        .order("created_at", { ascending: false }),
    ]);

    const firstError =
      appointmentResult.error ??
      noteResult.error ??
      treatmentResult.error ??
      invoiceResult.error ??
      eventResult.error;

    if (firstError) {
      setError(firstError.message);
      setDetailLoading(false);
      return;
    }

    const nextAppointments = (appointmentResult.data ?? []) as CaseAppointment[];
    setAppointments(nextAppointments);
    setClinicalNotes((noteResult.data ?? []) as CaseClinicalNote[]);
    setTreatments((treatmentResult.data ?? []) as CaseTreatment[]);
    setInvoices((invoiceResult.data ?? []) as unknown as CaseInvoice[]);
    setEvents((eventResult.data ?? []) as CaseEvent[]);
    setSelectedVisitId((current) => {
      if (current && nextAppointments.some((item) => item.id === current)) {
        return current;
      }
      return preferredVisit(nextAppointments)?.id ?? null;
    });
    setError("");
    setDetailLoading(false);
  }, []);

  useEffect(() => {
    void loadCases();
  }, [loadCases]);

  useEffect(() => {
    if (!selectedCaseId) {
      setAppointments([]);
      setClinicalNotes([]);
      setTreatments([]);
      setInvoices([]);
      setEvents([]);
      setSelectedVisitId(null);
      return;
    }

    void loadCaseDetails(selectedCaseId);
  }, [loadCaseDetails, selectedCaseId]);

  useEffect(() => {
    if (!initialCaseId || !cases.some((item) => item.id === initialCaseId)) return;
    setSelectedCaseId(initialCaseId);
    setTab("overview");
    onInitialCaseHandled?.();
  }, [cases, initialCaseId, onInitialCaseHandled]);

  useEffect(() => {
    const client = supabase;
    if (!client) return;

    const channel = client
      .channel("case-workspace-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "cases" },
        () => void loadCases(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "case_events" },
        (payload) => {
          const row = (payload.new ?? payload.old) as { case_id?: string };
          if (row.case_id && row.case_id === selectedCaseId) {
            void loadCaseDetails(row.case_id);
          }
        },
      )
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, [loadCaseDetails, loadCases, selectedCaseId]);

  const selectedCase = cases.find((item) => item.id === selectedCaseId) ?? null;
  const selectedVisit =
    appointments.find((item) => item.id === selectedVisitId) ?? null;

  const visibleCases = useMemo(() => {
    const needle = queueSearch.trim().toLowerCase();

    return cases
      .filter((item) =>
        caseView === "closed" ? item.status === "closed" : item.status !== "closed",
      )
      .filter((item) =>
        !needle
          ? true
          : `${item.case_number} ${item.patient_name} ${item.title} ${item.assigned_provider_name}`
              .toLowerCase()
              .includes(needle),
      )
      .sort((left, right) => {
        const priorityDifference =
          priorityWeight[right.priority] - priorityWeight[left.priority];
        if (priorityDifference !== 0) return priorityDifference;

        return (
          new Date(right.last_activity_at).getTime() -
          new Date(left.last_activity_at).getTime()
        );
      });
  }, [caseView, cases, queueSearch]);

  const selectedVisitTreatments = treatments.filter(
    (item) => item.appointment_id === selectedVisitId,
  );

  const outstandingBalance = invoices.reduce(
    (sum, invoice) => sum + Number(invoice.balance),
    0,
  );

  const appointmentMap = new Map(
    appointments.map((appointment) => [appointment.id, appointment]),
  );

  async function refreshSelectedCase() {
    if (!selectedCaseId) return;
    await Promise.all([loadCaseDetails(selectedCaseId), loadCases()]);
  }

  async function addClinicalNote() {
    if (!supabase || !selectedCase || !selectedVisit) return;

    if (
      !clinicalDraft.subjective.trim() &&
      !clinicalDraft.objective.trim() &&
      !clinicalDraft.assessment.trim() &&
      !clinicalDraft.plan.trim()
    ) {
      setError("Add at least one clinical note detail.");
      return;
    }

    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) {
      setError("Your session could not be verified.");
      return;
    }

    setSaving(true);
    try {
      await addCaseClinicalNote({
        caseId: selectedCase.id,
        appointmentId: selectedVisit.id,
        patientId: selectedCase.patient_id,
        authorId: auth.user.id,
        visitType: clinicalDraft.visitType,
        subjective: clinicalDraft.subjective,
        objective: clinicalDraft.objective,
        assessment: clinicalDraft.assessment,
        plan: clinicalDraft.plan,
      });

      setClinicalDraft({
        visitType: "consultation",
        subjective: "",
        objective: "",
        assessment: "",
        plan: "",
      });
      setShowClinicalForm(false);
      setNotice(`Clinical note added to ${selectedCase.case_number}`);
      await refreshSelectedCase();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Clinical note could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function addTreatment() {
    if (!supabase || !selectedCase || !selectedVisit) return;

    const procedureName = treatmentDraft.procedureName.trim();
    if (!procedureName) {
      setError("Add a procedure name.");
      return;
    }

    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) {
      setError("Your session could not be verified.");
      return;
    }

    setSaving(true);
    try {
      await addCaseTreatment({
        caseId: selectedCase.id,
        appointmentId: selectedVisit.id,
        patientId: selectedCase.patient_id,
        providerId: selectedCase.assigned_provider_id ?? auth.user.id,
        createdBy: auth.user.id,
        procedureName,
        toothNumber: treatmentDraft.toothNumber
          ? Number(treatmentDraft.toothNumber)
          : null,
        cost: Number(treatmentDraft.cost || 0),
        notes: treatmentDraft.notes,
      });

      setTreatmentDraft({
        procedureName: "",
        toothNumber: "",
        cost: "0",
        notes: "",
      });
      setShowTreatmentForm(false);
      setNotice(`Treatment added to ${selectedCase.case_number}`);
      await refreshSelectedCase();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Treatment could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function completeVisit() {
    if (!selectedCase || !selectedVisit) return;

    setSaving(true);
    try {
      const result = await completeCaseVisit(selectedCase.id, selectedVisit.id);
      setNotice(
        `Visit completed. ${result.invoice_number} was generated for ${formatCurrency(Number(result.total))}.`,
      );
      await refreshSelectedCase();
      setTab("billing");
    } catch (reason) {
      const message =
        reason instanceof Error ? reason.message : "The visit could not be completed.";
      setError(
        message.includes("at_least_one_treatment_required_for_visit")
          ? "Add at least one treatment to this visit before completing it."
          : message.includes("appointment_must_be_handed_to_dentist_first")
            ? "The selected visit must be handed over to the dentist first."
            : message,
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleCloseCase() {
    if (!selectedCase) return;

    setSaving(true);
    try {
      await closeCase(selectedCase.id, Number(recallMonths));
      setNotice(
        Number(recallMonths) > 0
          ? `${selectedCase.case_number} clinically closed. A preventive recall was scheduled in ${recallMonths} months.`
          : `${selectedCase.case_number} clinically closed with no automatic recall.`,
      );
      await refreshSelectedCase();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Case could not be closed.";
      setError(
        message.includes("case_has_active_appointments")
          ? "Complete or cancel all active appointments before closing this case."
          : message.includes("case_has_incomplete_treatments")
            ? "Complete or cancel all planned treatments before closing this case."
            : message,
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleReopenCase() {
    if (!selectedCase) return;

    setSaving(true);
    try {
      await reopenCase(selectedCase.id);
      setNotice(`${selectedCase.case_number} reopened.`);
      await refreshSelectedCase();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Case could not be reopened.");
    } finally {
      setSaving(false);
    }
  }

  async function handlePriorityChange(priority: CasePriority) {
    if (!selectedCase) return;

    try {
      await updateCasePriority(selectedCase.id, priority);
      setCases((current) =>
        current.map((item) =>
          item.id === selectedCase.id ? { ...item, priority } : item,
        ),
      );
      setNotice(`${selectedCase.case_number} priority updated.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Priority could not be updated.");
    }
  }

  return (
    <div className="cases-module">
      <section className="panel cases-queue">
        <div className="panel-title case-queue-title">
          <span>Case Queue</span>
          <span className="panel-title-hint">Clinical work lives here</span>
        </div>

        <div className="case-queue-toolbar">
          <div className="tab-strip">
            <button
              type="button"
              className={caseView === "active" ? "tab active" : "tab"}
              onClick={() => setCaseView("active")}
            >
              Active ({cases.filter((item) => item.status !== "closed").length})
            </button>
            <button
              type="button"
              className={caseView === "closed" ? "tab active" : "tab"}
              onClick={() => setCaseView("closed")}
            >
              Closed ({cases.filter((item) => item.status === "closed").length})
            </button>
          </div>

          <input
            className="case-search"
            value={queueSearch}
            onChange={(event) => setQueueSearch(event.target.value)}
            placeholder="Search case, patient, dentist..."
          />
        </div>

        {loading ? (
          <div className="empty-state">Loading cases...</div>
        ) : (
          <div className="case-list">
            {visibleCases.map((item) => (
              <button
                type="button"
                key={item.id}
                className={
                  selectedCaseId === item.id
                    ? "case-list-item selected"
                    : "case-list-item"
                }
                onClick={() => {
                  setSelectedCaseId(item.id);
                  setTab("overview");
                }}
              >
                <span className="case-list-heading">
                  <strong>{item.case_number}</strong>
                  <span className={`case-priority priority-${item.priority}`}>
                    {item.priority}
                  </span>
                </span>

                <strong className="case-patient-name">{item.patient_name}</strong>
                <span className="case-title-text">{item.title}</span>

                <span className="case-queue-statuses">
                  <span className={`status-badge case-${item.status}`}>
                    {clinicalStatusLabel(item.status)}
                  </span>
                  <span className={`status-badge billing-${item.billing_status}`}>
                    {billingStatusLabel(item.billing_status)}
                  </span>
                </span>

                <small>
                  {item.assigned_provider_name}
                  {item.next_appointment
                    ? ` · Next: ${item.next_appointment.appointment_date} ${item.next_appointment.appointment_time}`
                    : " · No active appointment"}
                </small>
                <small>Last activity {formatDateTime(item.last_activity_at)}</small>
              </button>
            ))}

            {!visibleCases.length && (
              <div className="empty-state">
                {queueSearch
                  ? "No cases match your search."
                  : caseView === "closed"
                    ? "No closed cases."
                    : "No active cases. Cases are created during check-in."}
              </div>
            )}
          </div>
        )}
      </section>

      {selectedCase && (
        <div className="modal-backdrop case-modal-backdrop">
          <section
            className="classic-dialog case-workspace-dialog"
            role="dialog"
            aria-modal="true"
          >
            <div className="dialog-title case-dialog-title">
              <div>
                <strong>
                  {selectedCase.case_number} · {selectedCase.patient_name}
                </strong>
                <span>{selectedCase.title}</span>
              </div>

              <div className="case-dialog-title-actions">
                <span className={`status-badge case-${selectedCase.status}`}>
                  {clinicalStatusLabel(selectedCase.status)}
                </span>
                <span
                  className={`status-badge billing-${selectedCase.billing_status}`}
                >
                  {billingStatusLabel(selectedCase.billing_status)}
                </span>
                <button
                  type="button"
                  aria-label="Close case workspace"
                  onClick={() => setSelectedCaseId(null)}
                >
                  X
                </button>
              </div>
            </div>

            {selectedCase.patient_allergies && (
              <div className="case-safety-alert">
                <strong>Patient alert:</strong> {selectedCase.patient_allergies}
              </div>
            )}

            <div className="case-command-bar">
              <label>
                Priority
                <select
                  value={selectedCase.priority}
                  onChange={(event) =>
                    void handlePriorityChange(event.target.value as CasePriority)
                  }
                >
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </label>

              <label className="case-visit-selector">
                Working visit
                <select
                  value={selectedVisitId ?? ""}
                  onChange={(event) => setSelectedVisitId(event.target.value || null)}
                >
                  <option value="">No visit selected</option>
                  {appointments.map((appointment) => (
                    <option key={appointment.id} value={appointment.id}>
                      {appointment.appointment_date} · {appointment.appointment_time} ·{" "}
                      {appointment.appointment_type} ·{" "}
                      {appointmentStatusLabel(appointment.status)}
                    </option>
                  ))}
                </select>
              </label>

              <div className="case-command-actions">
                {selectedCase.status !== "closed" && (
                  <label className="case-recall-selector">
                    Recall after close
                    <select
                      value={recallMonths}
                      onChange={(event) => setRecallMonths(event.target.value)}
                    >
                      <option value="0">No recall</option>
                      <option value="1">1 month</option>
                      <option value="3">3 months</option>
                      <option value="6">6 months</option>
                      <option value="12">12 months</option>
                    </select>
                  </label>
                )}
                {selectedCase.status === "closed" ? (
                  <button
                    type="button"
                    className="classic-button primary"
                    disabled={saving}
                    onClick={() => void handleReopenCase()}
                  >
                    Reopen Case
                  </button>
                ) : (
                  <button
                    type="button"
                    className="classic-button"
                    disabled={saving}
                    onClick={() => void handleCloseCase()}
                  >
                    Close Case
                  </button>
                )}
              </div>
            </div>

            <div className="case-context-strip">
              <div>
                <span>Patient</span>
                <strong>{selectedCase.patient_name}</strong>
                <small>{selectedCase.patient_number}</small>
              </div>
              <div>
                <span>Assigned dentist</span>
                <strong>{selectedCase.assigned_provider_name}</strong>
                <small>Assignment history is kept automatically</small>
              </div>
              <div>
                <span>Selected visit</span>
                <strong>
                  {selectedVisit
                    ? `${selectedVisit.appointment_date} · ${selectedVisit.appointment_time}`
                    : "No visit"}
                </strong>
                <small>
                  {selectedVisit
                    ? appointmentStatusLabel(selectedVisit.status)
                    : "Choose a visit before entering clinical work"}
                </small>
              </div>
              <div>
                <span>Outstanding</span>
                <strong>{formatCurrency(outstandingBalance)}</strong>
                <small>{invoices.length} visit invoice{invoices.length === 1 ? "" : "s"}</small>
              </div>
            </div>

            <div className="tab-strip case-tabs">
              {(
                [
                  ["overview", "Overview"],
                  ["plan", "Treatment Plan"],
                  ["clinical", "Clinical Notes"],
                  ["treatments", "Treatments"],
                  ["tasks", "Tasks"],
                  ["billing", "Billing"],
                  ["activity", "Activity"],
                ] as Array<[CaseTab, string]>
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={tab === value ? "tab active" : "tab"}
                  onClick={() => setTab(value)}
                >
                  {label}
                </button>
              ))}
            </div>

            {error && (
              <div className="case-error-bar">
                <span>{error}</span>
                <button type="button" onClick={() => setError("")}>Dismiss</button>
              </div>
            )}

            {detailLoading ? (
              <div className="empty-state">Loading case details...</div>
            ) : (
              <div className="case-tab-content">
                {tab === "overview" && (
                  <div className="case-overview-grid">
                    <div className="case-card case-intake-card">
                      <h3>Intake</h3>
                      <p>
                        {selectedCase.intake_notes ||
                          "No reception intake notes were recorded."}
                      </p>
                    </div>

                    <div className="case-card">
                      <h3>Visit workflow</h3>
                      {appointments.length ? (
                        <div className="case-visit-list">
                          {appointments.map((appointment) => (
                            <button
                              type="button"
                              className={
                                selectedVisitId === appointment.id
                                  ? "case-record-row selected"
                                  : "case-record-row"
                              }
                              key={appointment.id}
                              onClick={() => setSelectedVisitId(appointment.id)}
                            >
                              <div>
                                <strong>
                                  {appointment.appointment_date}{" "}
                                  {appointment.appointment_time}
                                </strong>
                                <span>{appointment.appointment_type}</span>
                              </div>
                              <span className={`status-badge ${appointment.status}`}>
                                {appointmentStatusLabel(appointment.status)}
                              </span>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <p>No appointments are linked to this case.</p>
                      )}
                    </div>

                    <div className="case-card">
                      <h3>Case health</h3>
                      <div className="case-health-grid">
                        <p>
                          <strong>{clinicalNotes.length}</strong>
                          <span>Clinical notes</span>
                        </p>
                        <p>
                          <strong>{treatments.length}</strong>
                          <span>Treatments</span>
                        </p>
                        <p>
                          <strong>{invoices.length}</strong>
                          <span>Invoices</span>
                        </p>
                        <p>
                          <strong>{events.length}</strong>
                          <span>Activity events</span>
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {tab === "plan" && (
                  <CaseTreatmentPlan
                    caseId={selectedCase.id}
                    selectedVisitId={selectedVisit?.id ?? null}
                    selectedVisitStatus={selectedVisit?.status ?? null}
                    onNotice={setNotice}
                    onChanged={() => void refreshSelectedCase()}
                  />
                )}

                {tab === "clinical" && (
                  <div className="case-work-section">
                    <div className="case-toolbar">
                      <div>
                        <strong>Clinical notes</strong>
                        <small>
                          {selectedVisit
                            ? `Writing against ${selectedVisit.appointment_date} ${selectedVisit.appointment_time}`
                            : "Select a working visit first"}
                        </small>
                      </div>
                      <button
                        type="button"
                        className="classic-button primary"
                        disabled={
                          selectedCase.status === "closed" ||
                          !selectedVisit ||
                          selectedVisit.status !== "in_progress" ||
                          saving
                        }
                        onClick={() => setShowClinicalForm((current) => !current)}
                      >
                        {showClinicalForm ? "Cancel note" : "+ Add Clinical Note"}
                      </button>
                    </div>

                    {showClinicalForm && selectedVisit && (
                      <div className="inline-clinical-form">
                        <label>
                          Visit type
                          <select
                            value={clinicalDraft.visitType}
                            onChange={(event) =>
                              setClinicalDraft((current) => ({
                                ...current,
                                visitType: event.target.value,
                              }))
                            }
                          >
                            <option value="consultation">Consultation</option>
                            <option value="initial">Initial</option>
                            <option value="follow_up">Follow up</option>
                            <option value="emergency">Emergency</option>
                          </select>
                        </label>
                        <label>
                          Subjective
                          <textarea
                            value={clinicalDraft.subjective}
                            onChange={(event) =>
                              setClinicalDraft((current) => ({
                                ...current,
                                subjective: event.target.value,
                              }))
                            }
                          />
                        </label>
                        <label>
                          Objective
                          <textarea
                            value={clinicalDraft.objective}
                            onChange={(event) =>
                              setClinicalDraft((current) => ({
                                ...current,
                                objective: event.target.value,
                              }))
                            }
                          />
                        </label>
                        <label>
                          Assessment
                          <textarea
                            value={clinicalDraft.assessment}
                            onChange={(event) =>
                              setClinicalDraft((current) => ({
                                ...current,
                                assessment: event.target.value,
                              }))
                            }
                          />
                        </label>
                        <label>
                          Plan
                          <textarea
                            value={clinicalDraft.plan}
                            onChange={(event) =>
                              setClinicalDraft((current) => ({
                                ...current,
                                plan: event.target.value,
                              }))
                            }
                          />
                        </label>
                        <div className="dialog-actions">
                          <button
                            type="button"
                            className="classic-button primary"
                            disabled={saving}
                            onClick={() => void addClinicalNote()}
                          >
                            Save Clinical Note
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="note-list">
                      {clinicalNotes.map((note) => {
                        const visit = note.appointment_id
                          ? appointmentMap.get(note.appointment_id)
                          : null;

                        return (
                          <article className="note-entry" key={note.id}>
                            <div className="note-meta">
                              <strong>{note.note_date}</strong>
                              <span>
                                {note.visit_type.replaceAll("_", " ")}
                                {visit
                                  ? ` · Visit ${visit.appointment_date} ${visit.appointment_time}`
                                  : ""}
                              </span>
                            </div>
                            {note.subjective && (
                              <p><strong>Subjective:</strong> {note.subjective}</p>
                            )}
                            {note.objective && (
                              <p><strong>Objective:</strong> {note.objective}</p>
                            )}
                            {note.assessment && (
                              <p><strong>Assessment:</strong> {note.assessment}</p>
                            )}
                            {note.plan && <p><strong>Plan:</strong> {note.plan}</p>}
                          </article>
                        );
                      })}

                      {!clinicalNotes.length && (
                        <div className="empty-state">
                          No clinical notes in this case.
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {tab === "treatments" && (
                  <div className="case-work-section">
                    <div className="case-toolbar">
                      <div>
                        <strong>Treatments</strong>
                        <small>
                          Planned treatment is billed only when the selected visit is completed.
                        </small>
                      </div>
                      <div>
                        <button
                          type="button"
                          className="classic-button"
                          disabled={
                            selectedCase.status === "closed" ||
                            !selectedVisit ||
                            saving
                          }
                          onClick={() => setShowTreatmentForm((current) => !current)}
                        >
                          {showTreatmentForm ? "Cancel treatment" : "+ Add Treatment"}
                        </button>
                        <button
                          type="button"
                          className="classic-button primary"
                          disabled={
                            saving ||
                            !selectedVisit ||
                            selectedVisit.status !== "in_progress" ||
                            !selectedVisitTreatments.some(
                              (treatment) => treatment.status !== "cancelled",
                            )
                          }
                          onClick={() => void completeVisit()}
                        >
                          Complete Visit &amp; Generate Invoice
                        </button>
                      </div>
                    </div>

                    {showTreatmentForm && selectedVisit && (
                      <div className="inline-treatment-form">
                        <label>
                          Procedure name
                          <input
                            value={treatmentDraft.procedureName}
                            onChange={(event) =>
                              setTreatmentDraft((current) => ({
                                ...current,
                                procedureName: event.target.value,
                              }))
                            }
                          />
                        </label>
                        <label>
                          Tooth number
                          <input
                            type="number"
                            min="11"
                            max="48"
                            value={treatmentDraft.toothNumber}
                            onChange={(event) =>
                              setTreatmentDraft((current) => ({
                                ...current,
                                toothNumber: event.target.value,
                              }))
                            }
                          />
                        </label>
                        <label>
                          Cost
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={treatmentDraft.cost}
                            onChange={(event) =>
                              setTreatmentDraft((current) => ({
                                ...current,
                                cost: event.target.value,
                              }))
                            }
                          />
                        </label>
                        <label className="inline-treatment-notes">
                          Treatment notes
                          <textarea
                            value={treatmentDraft.notes}
                            onChange={(event) =>
                              setTreatmentDraft((current) => ({
                                ...current,
                                notes: event.target.value,
                              }))
                            }
                          />
                        </label>
                        <div className="dialog-actions">
                          <button
                            type="button"
                            className="classic-button primary"
                            disabled={saving || !treatmentDraft.procedureName.trim()}
                            onClick={() => void addTreatment()}
                          >
                            Save Planned Treatment
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Visit</th>
                            <th>Procedure</th>
                            <th>Tooth</th>
                            <th>Cost</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {treatments.map((treatment) => {
                            const visit = treatment.appointment_id
                              ? appointmentMap.get(treatment.appointment_id)
                              : null;

                            return (
                              <tr key={treatment.id}>
                                <td>
                                  {visit
                                    ? `${visit.appointment_date} ${visit.appointment_time}`
                                    : treatment.treatment_date}
                                </td>
                                <td>{treatment.procedure_name}</td>
                                <td>{treatment.tooth_number ?? "-"}</td>
                                <td>{formatCurrency(Number(treatment.cost))}</td>
                                <td>
                                  <span className="status-badge">
                                    {treatment.status}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>

                      {!treatments.length && (
                        <div className="empty-state">
                          No treatments in this case.
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {tab === "tasks" && (
                  <CaseTasks caseId={selectedCase.id} onNotice={setNotice} />
                )}

                {tab === "billing" && (
                  <div className="case-billing">
                    <div className="case-billing-summary">
                      <div>
                        <span>Billing status</span>
                        <strong>{billingStatusLabel(selectedCase.billing_status)}</strong>
                      </div>
                      <div>
                        <span>Invoices</span>
                        <strong>{invoices.length}</strong>
                      </div>
                      <div>
                        <span>Outstanding</span>
                        <strong>{formatCurrency(outstandingBalance)}</strong>
                      </div>
                    </div>

                    {!invoices.length ? (
                      <div className="empty-state">
                        No invoice yet. Completing a visit creates an invoice for that visit only.
                      </div>
                    ) : (
                      <div className="case-invoice-list">
                        {invoices.map((invoice) => {
                          const visit = invoice.appointment_id
                            ? appointmentMap.get(invoice.appointment_id)
                            : null;

                          return (
                            <article className="case-invoice-card" key={invoice.id}>
                              <header>
                                <div>
                                  <strong>{invoice.invoice_number}</strong>
                                  <span>
                                    {visit
                                      ? `Visit ${visit.appointment_date} ${visit.appointment_time}`
                                      : invoice.invoice_date}
                                  </span>
                                </div>
                                <span className={`status-badge ${invoice.status}`}>
                                  {invoice.status.replaceAll("_", " ")}
                                </span>
                              </header>

                              <div className="billing-cards">
                                <div>
                                  <span>Total</span>
                                  <strong>{formatCurrency(Number(invoice.total))}</strong>
                                </div>
                                <div>
                                  <span>Paid</span>
                                  <strong>{formatCurrency(Number(invoice.amount_paid))}</strong>
                                </div>
                                <div>
                                  <span>Balance</span>
                                  <strong>{formatCurrency(Number(invoice.balance))}</strong>
                                </div>
                              </div>

                              <div className="table-wrap compact-table">
                                <table>
                                  <thead>
                                    <tr>
                                      <th>Item</th>
                                      <th>Qty</th>
                                      <th>Unit price</th>
                                      <th>Total</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {(invoice.invoice_items ?? []).map((item) => (
                                      <tr key={item.id}>
                                        <td>{item.description}</td>
                                        <td>{item.quantity}</td>
                                        <td>{formatCurrency(Number(item.unit_price))}</td>
                                        <td>{formatCurrency(Number(item.total))}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    )}

                    <p className="case-billing-note">
                      Payments are recorded from Billing. Payment changes the billing status only; it does not close the clinical case.
                    </p>
                  </div>
                )}

                {tab === "activity" && (
                  <div className="case-activity-list">
                    {events.map((event) => (
                      <div className="case-activity-item" key={event.id}>
                        <time>{formatDateTime(event.created_at)}</time>
                        <div>
                          <strong>{event.title}</strong>
                          <span>{event.detail || event.event_type.replaceAll("_", " ")}</span>
                        </div>
                      </div>
                    ))}

                    {!events.length && (
                      <div className="empty-state">
                        No Case activity has been recorded yet.
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
