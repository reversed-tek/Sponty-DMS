type AppointmentProgressProps = {
  status: string;
  checkedInAt: string | null;
  handedOverAt: string | null;
  treatmentCompletedAt: string | null;
};

const stepState = (
  step: "scheduled" | "checked_in" | "handover" | "complete",
  props: AppointmentProgressProps,
) => {
  const completed = props.status === "completed" || Boolean(props.treatmentCompletedAt);

  if (step === "scheduled") return "done";
  if (step === "checked_in") {
    return props.checkedInAt || props.handedOverAt || completed ? "done" : "current";
  }
  if (step === "handover") {
    if (props.handedOverAt || completed) return "done";
    return props.checkedInAt ? "current" : "pending";
  }

  if (completed) return "done";
  return props.handedOverAt ? "current" : "pending";
};

export function AppointmentProgress(props: AppointmentProgressProps) {
  const steps = [
    ["scheduled", "Scheduled"],
    ["checked_in", "Checked in"],
    ["handover", "Handed over"],
    ["complete", "Visit complete"],
  ] as const;

  return (
    <div className="appointment-progress" aria-label="Appointment workflow">
      {steps.map(([step, label], index) => (
        <div
          className={`appointment-progress-step ${stepState(step, props)}`}
          key={step}
        >
          <span className="appointment-progress-dot">
            {stepState(step, props) === "done" ? "✓" : index + 1}
          </span>
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}
