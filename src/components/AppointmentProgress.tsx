type AppointmentProgressProps = {
  status: string;
  checkedInAt: string | null;
  handedOverAt: string | null;
  treatmentCompletedAt: string | null;
};

type WorkflowStep = "scheduled" | "checked_in" | "handover" | "complete";
type WorkflowStepState = "done" | "current" | "pending";

// Highlight the most recent stage reached, not the next action to take.
// Existing appointments may lack timestamps, so fall back to their status.
// Completing treatments alone does not mean the visit is complete.
const stepState = (step: WorkflowStep, props: AppointmentProgressProps): WorkflowStepState => {
  const completed = props.status === "completed";
  const handedOver = Boolean(props.handedOverAt) || props.status === "in_progress" || completed;
  const checkedIn = Boolean(props.checkedInAt) || props.status === "confirmed" || handedOver;

  if (completed) return "done";
  if (step === "scheduled") return checkedIn ? "done" : "current";
  if (step === "checked_in") return handedOver ? "done" : checkedIn ? "current" : "pending";
  if (step === "handover") return handedOver ? "current" : "pending";
  return "pending";
};

const steps = [
  ["scheduled", "Scheduled"],
  ["checked_in", "Checked in"],
  ["handover", "Handed over"],
  ["complete", "Visit complete"],
] as const;

export function AppointmentProgress(props: AppointmentProgressProps) {
  return (
    <ol className="appointment-progress" aria-label="Appointment workflow">
      {steps.map(([step, label], index) => {
        const state = stepState(step, props);
        return (
          <li
            className={`appointment-progress-step ${state}`}
            key={step}
            aria-current={state === "current" ? "step" : undefined}
            aria-label={`${label}: ${state === "done" ? "completed" : state === "current" ? "current stage" : "not reached"}`}
          >
            <span className="appointment-progress-dot" aria-hidden="true">
              {state === "done" ? "✓" : index + 1}
            </span>
            <span className="appointment-progress-label">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}
