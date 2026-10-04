import { useEffect, useMemo, useState } from "react";
import {
  addTreatmentPlanItem,
  performTreatmentPlanItem,
  updateTreatmentPlanStatus,
} from "../lib/caseService";
import type { TreatmentPlanStatus } from "../lib/caseService";
import { supabase } from "../lib/supabase";

type PlanItem = {
  id: string;
  procedure_name: string;
  tooth_number: number | null;
  estimated_cost: number;
  status: TreatmentPlanStatus;
  sequence_no: number;
  notes: string | null;
  accepted_at: string | null;
  completed_at: string | null;
  created_at: string;
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
  }).format(value);

export function CaseTreatmentPlan({
  caseId,
  selectedVisitId,
  selectedVisitStatus,
  onNotice,
  onChanged,
  readOnly = false,
}: {
  caseId: string;
  selectedVisitId: string | null;
  selectedVisitStatus: string | null;
  onNotice: (message: string) => void;
  onChanged?: () => void;
  readOnly?: boolean;
}) {
  const [items, setItems] = useState<PlanItem[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState({
    procedureName: "",
    toothNumber: "",
    estimatedCost: "0",
    notes: "",
  });

  async function load() {
    if (!supabase) return;

    const { data, error: loadError } = await supabase
      .from("treatment_plan_items")
      .select(
        "id, procedure_name, tooth_number, estimated_cost, status, sequence_no, notes, accepted_at, completed_at, created_at",
      )
      .eq("case_id", caseId)
      .order("sequence_no")
      .order("created_at");

    if (loadError) {
      setError(loadError.message);
      return;
    }

    setItems((data ?? []) as PlanItem[]);
    setError("");
  }

  useEffect(() => {
    void load();

    if (!supabase) return;
    const channel = supabase
      .channel(`case-plan-${caseId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "treatment_plan_items",
          filter: `case_id=eq.${caseId}`,
        },
        () => void load(),
      )
      .subscribe();

    return () => {
      void supabase?.removeChannel(channel);
    };
  }, [caseId]);

  const activeItems = items.filter((item) => item.status !== "cancelled");
  const completedItems = activeItems.filter((item) => item.status === "completed");
  const estimatedTotal = activeItems.reduce(
    (sum, item) => sum + Number(item.estimated_cost),
    0,
  );
  const acceptedTotal = activeItems
    .filter((item) =>
      ["accepted", "in_progress", "completed"].includes(item.status),
    )
    .reduce((sum, item) => sum + Number(item.estimated_cost), 0);

  const progress = activeItems.length
    ? Math.round((completedItems.length / activeItems.length) * 100)
    : 0;

  const nextSequence = useMemo(
    () => Math.max(0, ...items.map((item) => item.sequence_no)) + 1,
    [items],
  );

  async function addItem() {
    if (!supabase || !draft.procedureName.trim()) return;

    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) {
      setError("Your session could not be verified.");
      return;
    }

    setSaving(true);
    try {
      await addTreatmentPlanItem({
        caseId,
        procedureName: draft.procedureName,
        toothNumber: draft.toothNumber ? Number(draft.toothNumber) : null,
        estimatedCost: Number(draft.estimatedCost || 0),
        notes: draft.notes,
        sequenceNo: nextSequence,
        createdBy: auth.user.id,
      });
      setDraft({
        procedureName: "",
        toothNumber: "",
        estimatedCost: "0",
        notes: "",
      });
      setShowForm(false);
      onNotice("Treatment plan item added.");
      await load();
      onChanged?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Plan item could not be added.");
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(item: PlanItem, status: TreatmentPlanStatus) {
    setSaving(true);
    try {
      await updateTreatmentPlanStatus(item.id, status);
      onNotice(
        `${item.procedure_name} marked ${status.replaceAll("_", " ")}.`,
      );
      await load();
      onChanged?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Plan status could not be updated.");
    } finally {
      setSaving(false);
    }
  }

  async function useInVisit(item: PlanItem) {
    if (!selectedVisitId || selectedVisitStatus !== "in_progress") {
      setError("Select an active handed-over visit before starting planned treatment.");
      return;
    }

    setSaving(true);
    try {
      await performTreatmentPlanItem(item.id, selectedVisitId);
      onNotice(`${item.procedure_name} added to the active visit.`);
      await load();
      onChanged?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Planned treatment could not be started.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="treatment-plan-panel">
      <div className="case-toolbar">
        <div>
          <strong>Treatment plan</strong>
          <small>
            Plan care first. Only treatment actually performed during a visit is billed.
          </small>
        </div>
        <button
          type="button"
          className="classic-button primary"
          disabled={readOnly}
          onClick={() => setShowForm((current) => !current)}
        >
          {showForm ? "Cancel" : "+ Plan Treatment"}
        </button>
      </div>

      <div className="plan-summary-grid">
        <div>
          <span>Progress</span>
          <strong>{progress}%</strong>
          <div className="plan-progress-track">
            <span style={{ width: `${progress}%` }} />
          </div>
        </div>
        <div>
          <span>Estimated plan</span>
          <strong>{formatCurrency(estimatedTotal)}</strong>
        </div>
        <div>
          <span>Accepted value</span>
          <strong>{formatCurrency(acceptedTotal)}</strong>
        </div>
        <div>
          <span>Items complete</span>
          <strong>{completedItems.length}/{activeItems.length}</strong>
        </div>
      </div>

      {error && <p className="send-error">{error}</p>}

      {showForm && (
        <div className="inline-treatment-form treatment-plan-form">
          <label>
            Procedure
            <input
              value={draft.procedureName}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  procedureName: event.target.value,
                }))
              }
              placeholder="e.g. Root canal treatment"
            />
          </label>
          <label>
            Tooth number
            <input
              type="number"
              min="11"
              max="48"
              value={draft.toothNumber}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  toothNumber: event.target.value,
                }))
              }
            />
          </label>
          <label>
            Estimated cost
            <input
              type="number"
              min="0"
              step="0.01"
              value={draft.estimatedCost}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  estimatedCost: event.target.value,
                }))
              }
            />
          </label>
          <label className="inline-treatment-notes">
            Plan notes
            <textarea
              value={draft.notes}
              onChange={(event) =>
                setDraft((current) => ({ ...current, notes: event.target.value }))
              }
            />
          </label>
          <div className="dialog-actions">
            <button
              type="button"
              className="classic-button primary"
              disabled={saving || readOnly || !draft.procedureName.trim()}
              onClick={() => void addItem()}
            >
              Add to Plan
            </button>
          </div>
        </div>
      )}

      <div className="treatment-plan-list">
        {items.map((item, index) => (
          <article className={`treatment-plan-item plan-${item.status}`} key={item.id}>
            <div className="plan-sequence">{index + 1}</div>
            <div className="plan-item-main">
              <div className="plan-item-heading">
                <div>
                  <strong>{item.procedure_name}</strong>
                  <span>
                    {item.tooth_number ? `Tooth ${item.tooth_number} · ` : ""}
                    {formatCurrency(Number(item.estimated_cost))}
                  </span>
                </div>
                <span className={`status-badge plan-${item.status}`}>
                  {item.status.replaceAll("_", " ")}
                </span>
              </div>
              {item.notes && <p>{item.notes}</p>}
              <div className="plan-item-actions">
                {item.status === "proposed" && (
                  <>
                    <button
                      type="button"
                      className="classic-button primary"
                      disabled={saving || readOnly}
                      onClick={() => void setStatus(item, "accepted")}
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      className="classic-button"
                      disabled={saving || readOnly}
                      onClick={() => void setStatus(item, "deferred")}
                    >
                      Defer
                    </button>
                  </>
                )}
                {item.status === "deferred" && (
                  <button
                    type="button"
                    className="classic-button"
                    disabled={saving || readOnly}
                    onClick={() => void setStatus(item, "accepted")}
                  >
                    Accept
                  </button>
                )}
                {item.status === "accepted" && (
                  <button
                    type="button"
                    className="classic-button primary"
                    disabled={
                      saving ||
                      readOnly ||
                      !selectedVisitId ||
                      selectedVisitStatus !== "in_progress"
                    }
                    onClick={() => void useInVisit(item)}
                  >
                    Start in Selected Visit
                  </button>
                )}
                {!["completed", "cancelled", "in_progress"].includes(item.status) && (
                  <button
                    type="button"
                    className="classic-button danger"
                    disabled={saving || readOnly}
                    onClick={() => void setStatus(item, "cancelled")}
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          </article>
        ))}

        {!items.length && (
          <div className="empty-state">
            No treatment plan yet. Add planned work before treatment begins.
          </div>
        )}
      </div>
    </div>
  );
}
