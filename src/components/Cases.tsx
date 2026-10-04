import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { completeCaseWorkflow, listActiveProviders } from "../lib/workflow";

type CaseStatus = "open" | "in_treatment" | "awaiting_payment" | "closed";
type CaseTab = "overview" | "clinical" | "treatments" | "billing" | "activity";

type CaseRecord = {
  id: string;
  case_number: string;
  patient_id: string;
  primary_appointment_id: string | null;
  assigned_provider_id: string | null;
  title: string;
  intake_notes: string | null;
  status: CaseStatus;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  patient_name: string;
  patient_number: string;
  assigned_provider_name: string;
};

type CaseAppointment = {
  id: string;
  appointment_date: string;
  appointment_time: string;
  appointment_type: string;
  status: string;
  reason: string | null;
  notes: string | null;
  checked_in_at: string | null;
  handed_over_at: string | null;
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

type CaseInvoice = {
  id: string;
  invoice_number: string;
  invoice_date: string;
  total: number;
  amount_paid: number;
  balance: number;
  status: string;
  created_at: string;
};

type InvoiceItem = {
  id: string;
  description: string;
  quantity: number;
  unit_price: number;
  total: number;
};

type ActivityItem = {
  id: string;
  at: string;
  title: string;
  detail: string;
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value);

const statusLabel = (status: CaseStatus) =>
  status === "in_treatment"
    ? "In treatment"
    : status === "awaiting_payment"
      ? "Awaiting payment"
      : status === "closed"
        ? "Closed"
        : "Open";

export function Cases({ setNotice }: { setNotice: (message: string) => void }) {
  const [cases, setCases] = useState<CaseRecord[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [caseView, setCaseView] = useState<"active" | "closed">("active");
  const [tab, setTab] = useState<CaseTab>("overview");
  const [appointments, setAppointments] = useState<CaseAppointment[]>([]);
  const [clinicalNotes, setClinicalNotes] = useState<CaseClinicalNote[]>([]);
  const [treatments, setTreatments] = useState<CaseTreatment[]>([]);
  const [invoice, setInvoice] = useState<CaseInvoice | null>(null);
  const [invoiceItems, setInvoiceItems] = useState<InvoiceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
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

    const [caseResult, patientResult, providerRows] = await Promise.all([
      supabase
        .from("cases")
        .select(
          "id, case_number, patient_id, primary_appointment_id, assigned_provider_id, title, intake_notes, status, created_at, updated_at, closed_at",
        )
        .order("updated_at", { ascending: false }),
      supabase
        .from("patients")
        .select("id, patient_number, first_name, last_name"),
      listActiveProviders(),
    ]);

    if (caseResult.error) {
      setError(caseResult.error.message);
      setLoading(false);
      return;
    }

    if (patientResult.error) {
      setError(patientResult.error.message);
      setLoading(false);
      return;
    }

    const patientMap = new Map(
      (patientResult.data ?? []).map((patient) => [
        patient.id,
        {
          name: `${patient.first_name} ${patient.last_name}`,
          number: patient.patient_number,
        },
      ]),
    );
    const providerMap = new Map(
      providerRows.map((provider) => [provider.id, provider.full_name]),
    );

    const mapped = (caseResult.data ?? []).map((item) => {
      const patient = patientMap.get(item.patient_id);
      return {
        ...item,
        status: item.status as CaseStatus,
        patient_name: patient?.name ?? "Unknown patient",
        patient_number: patient?.number ?? "-",
        assigned_provider_name: item.assigned_provider_id
          ? providerMap.get(item.assigned_provider_id) ?? "Assigned dentist"
          : "Unassigned",
      } satisfies CaseRecord;
    });

    setCases(mapped);
    setSelectedCaseId((current) => {
      if (current && mapped.some((item) => item.id === current)) return current;
      const firstActive = mapped.find((item) => item.status !== "closed");
      return firstActive?.id ?? mapped[0]?.id ?? null;
    });
    setError("");
    setLoading(false);
  }, []);

  const loadCaseDetails = useCallback(async (caseId: string) => {
    if (!supabase) return;
    setDetailLoading(true);

    const [appointmentResult, noteResult, treatmentResult, invoiceResult] =
      await Promise.all([
        supabase
          .from("appointments")
          .select(
            "id, appointment_date, appointment_time, appointment_type, status, reason, notes, checked_in_at, handed_over_at",
          )
          .eq("case_id", caseId)
          .order("appointment_date", { ascending: false })
          .order("appointment_time", { ascending: false }),
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
            "id, invoice_number, invoice_date, total, amount_paid, balance, status, created_at",
          )
          .eq("case_id", caseId)
          .order("created_at", { ascending: false })
          .limit(1),
      ]);

    const firstError =
      appointmentResult.error ??
      noteResult.error ??
      treatmentResult.error ??
      invoiceResult.error;

    if (firstError) {
      setError(firstError.message);
      setDetailLoading(false);
      return;
    }

    const nextInvoice = (invoiceResult.data?.[0] ?? null) as CaseInvoice | null;
    let nextInvoiceItems: InvoiceItem[] = [];

    if (nextInvoice) {
      const itemResult = await supabase
        .from("invoice_items")
        .select("id, description, quantity, unit_price, total")
        .eq("invoice_id", nextInvoice.id)
        .order("created_at");

      if (itemResult.error) {
        setError(itemResult.error.message);
        setDetailLoading(false);
        return;
      }
      nextInvoiceItems = (itemResult.data ?? []) as InvoiceItem[];
    }

    setAppointments((appointmentResult.data ?? []) as CaseAppointment[]);
    setClinicalNotes((noteResult.data ?? []) as CaseClinicalNote[]);
    setTreatments((treatmentResult.data ?? []) as CaseTreatment[]);
    setInvoice(nextInvoice);
    setInvoiceItems(nextInvoiceItems);
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
      setInvoice(null);
      setInvoiceItems([]);
      return;
    }
    void loadCaseDetails(selectedCaseId);
  }, [loadCaseDetails, selectedCaseId]);

  useEffect(() => {
    const client = supabase;
    if (!client) return;

    const channel = client
      .channel("cases-workflow")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "cases" },
        () => void loadCases(),
      )
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, [loadCases]);

  const selectedCase = cases.find((item) => item.id === selectedCaseId) ?? null;
  const visibleCases = cases.filter((item) =>
    caseView === "closed" ? item.status === "closed" : item.status !== "closed",
  );

  const workingAppointmentId =
    selectedCase?.primary_appointment_id ?? appointments[0]?.id ?? null;

  const activity = useMemo<ActivityItem[]>(() => {
    if (!selectedCase) return [];

    const items: ActivityItem[] = [
      {
        id: `case-${selectedCase.id}`,
        at: selectedCase.created_at,
        title: "Case opened",
        detail: selectedCase.title,
      },
    ];

    for (const appointment of appointments) {
      if (appointment.checked_in_at) {
        items.push({
          id: `checkin-${appointment.id}`,
          at: appointment.checked_in_at,
          title: "Patient checked in",
          detail: `${appointment.appointment_date} ${appointment.appointment_time}`,
        });
      }
      if (appointment.handed_over_at) {
        items.push({
          id: `handover-${appointment.id}`,
          at: appointment.handed_over_at,
          title: "Case handed to dentist",
          detail: appointment.appointment_type,
        });
      }
    }

    for (const note of clinicalNotes) {
      items.push({
        id: `note-${note.id}`,
        at: note.created_at,
        title: "Clinical note added",
        detail: note.visit_type.replace("_", " "),
      });
    }

    for (const treatment of treatments) {
      items.push({
        id: `treatment-${treatment.id}`,
        at: treatment.created_at,
        title: "Treatment added",
        detail: treatment.procedure_name,
      });
    }

    if (invoice) {
      items.push({
        id: `invoice-${invoice.id}`,
        at: invoice.created_at,
        title: invoice.status === "paid" ? "Invoice paid" : "Invoice generated",
        detail: `${invoice.invoice_number} · ${formatCurrency(Number(invoice.total))}`,
      });
    }

    if (selectedCase.closed_at) {
      items.push({
        id: `closed-${selectedCase.id}`,
        at: selectedCase.closed_at,
        title: "Case closed",
        detail: "Treatment and billing workflow completed.",
      });
    }

    return items.sort(
      (left, right) => new Date(right.at).getTime() - new Date(left.at).getTime(),
    );
  }, [appointments, clinicalNotes, invoice, selectedCase, treatments]);

  async function addClinicalNote() {
    if (!supabase || !selectedCase) return;

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

    const { error: insertError } = await supabase.from("clinical_notes").insert({
      patient_id: selectedCase.patient_id,
      appointment_id: workingAppointmentId,
      case_id: selectedCase.id,
      author_id: auth.user.id,
      visit_type: clinicalDraft.visitType,
      note_date: new Date().toISOString().slice(0, 10),
      subjective: clinicalDraft.subjective.trim() || null,
      objective: clinicalDraft.objective.trim() || null,
      assessment: clinicalDraft.assessment.trim() || null,
      plan: clinicalDraft.plan.trim() || null,
      is_private: false,
    });

    if (insertError) {
      setError(insertError.message);
      return;
    }

    setClinicalDraft({
      visitType: "consultation",
      subjective: "",
      objective: "",
      assessment: "",
      plan: "",
    });
    setShowClinicalForm(false);
    setNotice(`Clinical note added to ${selectedCase.case_number}`);
    await Promise.all([loadCaseDetails(selectedCase.id), loadCases()]);
  }

  async function addTreatment() {
    if (!supabase || !selectedCase) return;

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

    const { error: insertError } = await supabase.from("treatments").insert({
      patient_id: selectedCase.patient_id,
      appointment_id: workingAppointmentId,
      case_id: selectedCase.id,
      provider_id: selectedCase.assigned_provider_id ?? auth.user.id,
      treatment_date: new Date().toISOString().slice(0, 10),
      tooth_number: treatmentDraft.toothNumber
        ? Number(treatmentDraft.toothNumber)
        : null,
      procedure_name: procedureName,
      description: treatmentDraft.notes.trim() || null,
      cost: Number(treatmentDraft.cost || 0),
      status: "planned",
      notes: treatmentDraft.notes.trim() || null,
      created_by: auth.user.id,
    });

    if (insertError) {
      setError(insertError.message);
      return;
    }

    setTreatmentDraft({
      procedureName: "",
      toothNumber: "",
      cost: "0",
      notes: "",
    });
    setShowTreatmentForm(false);
    setNotice(`Treatment added to ${selectedCase.case_number}`);
    await Promise.all([loadCaseDetails(selectedCase.id), loadCases()]);
  }

  async function completeCase() {
    if (!selectedCase) return;

    try {
      const result = await completeCaseWorkflow(selectedCase.id);
      setNotice(
        result.case_status === "closed"
          ? `${result.case_number} completed and closed. Invoice ${result.invoice_number} is paid.`
          : `${result.case_number} treatment completed. Invoice ${result.invoice_number} is ready in Billing.`,
      );
      await Promise.all([loadCaseDetails(selectedCase.id), loadCases()]);
      setTab("billing");
    } catch (reason) {
      const message =
        reason instanceof Error ? reason.message : "The case could not be completed.";
      setError(
        message.includes("at_least_one_treatment_required")
          ? "Add at least one treatment before completing the case."
          : message,
      );
    }
  }

  return (
    <div className="cases-layout">
      <section className="panel cases-queue">
        <div className="panel-title">Case Queue</div>
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
                  <span className={`status-badge case-${item.status}`}>
                    {statusLabel(item.status)}
                  </span>
                </span>
                <strong>{item.patient_name}</strong>
                <span>{item.title}</span>
                <small>{item.assigned_provider_name}</small>
              </button>
            ))}
            {!visibleCases.length && (
              <div className="empty-state">
                {caseView === "closed" ? "No closed cases." : "No active cases."}
              </div>
            )}
          </div>
        )}
      </section>

      <section className="panel case-workspace">
        {!selectedCase ? (
          <div className="empty-state">
            Cases are created when reception checks a patient in.
          </div>
        ) : (
          <>
            <div className="panel-title">
              <span>
                {selectedCase.case_number} · {selectedCase.patient_name}
              </span>
              <span className={`status-badge case-${selectedCase.status}`}>
                {statusLabel(selectedCase.status)}
              </span>
            </div>

            <div className="case-header">
              <div>
                <span>Patient</span>
                <strong>{selectedCase.patient_name}</strong>
                <small>{selectedCase.patient_number}</small>
              </div>
              <div>
                <span>Case</span>
                <strong>{selectedCase.title}</strong>
                <small>Opened {new Date(selectedCase.created_at).toLocaleString()}</small>
              </div>
              <div>
                <span>Assigned dentist</span>
                <strong>{selectedCase.assigned_provider_name}</strong>
                <small>Assignment follows appointment handover</small>
              </div>
            </div>

            <div className="tab-strip case-tabs">
              {(
                [
                  ["overview", "Overview"],
                  ["clinical", "Clinical Notes"],
                  ["treatments", "Treatments"],
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

            {error && <p className="send-error">{error}</p>}
            {detailLoading ? (
              <div className="empty-state">Loading case details...</div>
            ) : (
              <div className="case-tab-content">
                {tab === "overview" && (
                  <div className="case-overview-grid">
                    <div className="case-card">
                      <h3>Intake</h3>
                      <p>{selectedCase.intake_notes || "No intake notes were recorded."}</p>
                    </div>
                    <div className="case-card">
                      <h3>Appointments</h3>
                      {appointments.length ? (
                        appointments.map((appointment) => (
                          <div className="case-record-row" key={appointment.id}>
                            <div>
                              <strong>
                                {appointment.appointment_date} {appointment.appointment_time}
                              </strong>
                              <span>{appointment.appointment_type}</span>
                            </div>
                            <span className={`status-badge ${appointment.status}`}>
                              {appointment.status}
                            </span>
                          </div>
                        ))
                      ) : (
                        <p>No appointments are linked to this case.</p>
                      )}
                    </div>
                    <div className="case-card">
                      <h3>Case summary</h3>
                      <p>
                        {treatments.length} treatment{treatments.length === 1 ? "" : "s"} ·{" "}
                        {clinicalNotes.length} clinical note{clinicalNotes.length === 1 ? "" : "s"}
                      </p>
                      <p>
                        Billing:{" "}
                        {invoice
                          ? `${invoice.invoice_number} · ${invoice.status}`
                          : "Not generated yet"}
                      </p>
                    </div>
                  </div>
                )}

                {tab === "clinical" && (
                  <>
                    <div className="case-toolbar">
                      <strong>Clinical notes</strong>
                      <button
                        type="button"
                        className="classic-button primary"
                        disabled={selectedCase.status === "closed"}
                        onClick={() => setShowClinicalForm(true)}
                      >
                        + Add Clinical Note
                      </button>
                    </div>
                    <div className="note-list">
                      {clinicalNotes.map((note) => (
                        <article className="note-entry" key={note.id}>
                          <div className="note-meta">
                            <strong>{note.note_date}</strong>
                            <span>{note.visit_type.replace("_", " ")}</span>
                          </div>
                          {note.subjective && <p><strong>Subjective:</strong> {note.subjective}</p>}
                          {note.objective && <p><strong>Objective:</strong> {note.objective}</p>}
                          {note.assessment && <p><strong>Assessment:</strong> {note.assessment}</p>}
                          {note.plan && <p><strong>Plan:</strong> {note.plan}</p>}
                        </article>
                      ))}
                      {!clinicalNotes.length && (
                        <div className="empty-state">No clinical notes in this case.</div>
                      )}
                    </div>
                  </>
                )}

                {tab === "treatments" && (
                  <>
                    <div className="case-toolbar">
                      <strong>Treatments</strong>
                      <div>
                        <button
                          type="button"
                          className="classic-button"
                          disabled={selectedCase.status === "closed"}
                          onClick={() => setShowTreatmentForm(true)}
                        >
                          + Add Treatment
                        </button>
                        <button
                          type="button"
                          className="classic-button primary"
                          disabled={selectedCase.status === "closed" || !treatments.length}
                          onClick={() => void completeCase()}
                        >
                          Complete Treatment &amp; Generate Bill
                        </button>
                      </div>
                    </div>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>Procedure</th>
                            <th>Tooth</th>
                            <th>Cost</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {treatments.map((treatment) => (
                            <tr key={treatment.id}>
                              <td>{treatment.treatment_date}</td>
                              <td>{treatment.procedure_name}</td>
                              <td>{treatment.tooth_number ?? "-"}</td>
                              <td>{formatCurrency(Number(treatment.cost))}</td>
                              <td><span className="status-badge">{treatment.status}</span></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {!treatments.length && (
                        <div className="empty-state">No treatments in this case.</div>
                      )}
                    </div>
                  </>
                )}

                {tab === "billing" && (
                  <div className="case-billing">
                    {!invoice ? (
                      <div className="empty-state">
                        No invoice yet. Complete the treatment workflow to generate it automatically.
                      </div>
                    ) : (
                      <>
                        <div className="billing-cards">
                          <div>
                            <span>Invoice</span>
                            <strong>{invoice.invoice_number}</strong>
                          </div>
                          <div>
                            <span>Total</span>
                            <strong>{formatCurrency(Number(invoice.total))}</strong>
                          </div>
                          <div>
                            <span>Balance</span>
                            <strong>{formatCurrency(Number(invoice.balance))}</strong>
                          </div>
                        </div>
                        <div className="table-wrap">
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
                              {invoiceItems.map((item) => (
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
                        <p className="case-billing-note">
                          Payments are recorded from the main Billing module. The case closes
                          automatically when the balance reaches zero.
                        </p>
                      </>
                    )}
                  </div>
                )}

                {tab === "activity" && (
                  <div className="case-activity-list">
                    {activity.map((item) => (
                      <div className="case-activity-item" key={item.id}>
                        <time>{new Date(item.at).toLocaleString()}</time>
                        <div>
                          <strong>{item.title}</strong>
                          <span>{item.detail}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </section>

      {showClinicalForm && selectedCase && (
        <div className="modal-backdrop">
          <section className="classic-dialog" role="dialog" aria-modal="true">
            <div className="dialog-title">
              Add Clinical Note
              <button type="button" onClick={() => setShowClinicalForm(false)}>X</button>
            </div>
            <div className="dialog-body">
              <p className="dialog-intro">
                {selectedCase.case_number} · {selectedCase.patient_name}
              </p>
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
                  className="classic-button"
                  onClick={() => setShowClinicalForm(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="classic-button primary"
                  onClick={() => void addClinicalNote()}
                >
                  Save Clinical Note
                </button>
              </div>
            </div>
          </section>
        </div>
      )}

      {showTreatmentForm && selectedCase && (
        <div className="modal-backdrop">
          <section className="classic-dialog" role="dialog" aria-modal="true">
            <div className="dialog-title">
              Add Treatment
              <button type="button" onClick={() => setShowTreatmentForm(false)}>X</button>
            </div>
            <div className="dialog-body">
              <p className="dialog-intro">
                {selectedCase.case_number} · {selectedCase.patient_name}
              </p>
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
              <label>
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
                  className="classic-button"
                  onClick={() => setShowTreatmentForm(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="classic-button primary"
                  onClick={() => void addTreatment()}
                >
                  Save Treatment
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
