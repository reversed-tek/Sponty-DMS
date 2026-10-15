import { useEffect, useState } from "react";
import { schedulePatientRecall } from "../lib/caseService";
import { supabase } from "../lib/supabase";

type Recall = {
  id: string;
  case_id: string | null;
  recall_type: "preventive" | "follow_up";
  due_date: string;
  interval_months: number | null;
  status: "open" | "scheduled" | "completed" | "dismissed";
  source: "manual" | "automated";
  notes: string | null;
  created_at: string;
};

export function PatientRecalls({
  patientId,
  onNotice,
}: {
  patientId: string;
  onNotice: (message: string) => void;
}) {
  const [recalls, setRecalls] = useState<Recall[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [intervalMonths, setIntervalMonths] = useState("6");
  const [recallType, setRecallType] = useState<"preventive" | "follow_up">("preventive");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");

  async function load() {
    if (!supabase) return;

    const { data, error: loadError } = await supabase
      .from("patient_recalls")
      .select(
        "id, case_id, recall_type, due_date, interval_months, status, source, notes, created_at",
      )
      .eq("patient_id", patientId)
      .order("due_date", { ascending: false });

    if (loadError) {
      setError(loadError.message);
      return;
    }

    setRecalls((data ?? []) as Recall[]);
    setError("");
  }

  useEffect(() => {
    void load();
  }, [patientId]);

  async function addRecall() {
    try {
      await schedulePatientRecall({
        patientId,
        intervalMonths: Number(intervalMonths),
        recallType,
        notes,
      });
      setShowForm(false);
      setNotes("");
      onNotice("Patient recall scheduled.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Recall could not be scheduled.");
    }
  }

  return (
    <div className="patient-recalls-panel">
      <div className="case-toolbar">
        <div>
          <strong>Recall & follow-up</strong>
          <small>
            Closed Cases can create preventive recalls automatically. Manual recalls can be added here.
          </small>
        </div>
        <button
          type="button"
          className="classic-button primary"
          onClick={() => setShowForm((current) => !current)}
        >
          {showForm ? "Cancel" : "+ Recall"}
        </button>
      </div>

      {error && <p className="send-error">{error}</p>}

      {showForm && (
        <div className="recall-form">
          <label>
            Type
            <select
              value={recallType}
              onChange={(event) =>
                setRecallType(event.target.value as "preventive" | "follow_up")
              }
            >
              <option value="preventive">Preventive recall</option>
              <option value="follow_up">Follow-up</option>
            </select>
          </label>
          <label>
            Due in
            <select
              value={intervalMonths}
              onChange={(event) => setIntervalMonths(event.target.value)}
            >
              <option value="1">1 month</option>
              <option value="3">3 months</option>
              <option value="6">6 months</option>
              <option value="12">12 months</option>
            </select>
          </label>
          <label className="recall-notes">
            Notes
            <input
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Optional reminder context"
            />
          </label>
          <button
            type="button"
            className="classic-button primary"
            onClick={() => void addRecall()}
          >
            Schedule Recall
          </button>
        </div>
      )}

      <div className="recall-list">
        {recalls.map((recall) => {
          const overdue =
            recall.status === "open" &&
            new Date(`${recall.due_date}T23:59:59`).getTime() < Date.now();

          return (
            <article className={`recall-card ${overdue ? "overdue" : ""}`} key={recall.id}>
              <div>
                <strong>
                  {recall.recall_type === "preventive" ? "Preventive recall" : "Follow-up"}
                </strong>
                <span>{recall.due_date}</span>
              </div>
              <span className={`status-badge recall-${recall.status}`}>
                {recall.status}
              </span>
              <small>
                {recall.source === "automated" ? "Automated" : "Manual"}
                {recall.interval_months ? ` · ${recall.interval_months} month interval` : ""}
                {overdue ? " · OVERDUE" : ""}
              </small>
              {recall.notes && <p>{recall.notes}</p>}
            </article>
          );
        })}

        {!recalls.length && (
          <div className="empty-state">No recalls are scheduled for this patient.</div>
        )}
      </div>
    </div>
  );
}
