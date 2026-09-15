import { useEffect, useState } from "react";
import { signInWithMicrosoft, supabase, claimWaitlistSlot } from "../lib/supabase";
import { syncBookedWaitlistCalendarEvent } from "../lib/outlook";

type WaitlistClaimWindowProps = {
  sessionUser: { id: string } | null;
};

type ClaimState = "waiting" | "claiming" | "success" | "error";

export function WaitlistClaimWindow({ sessionUser }: WaitlistClaimWindowProps) {
  const params = new URLSearchParams(window.location.search);
  const slotId = params.get("slot_id") ?? "";
  const patientId = params.get("patient_id") ?? "";
  const token = params.get("token") ?? "";
  const hasValidClaimParams = Boolean(slotId && patientId && token);
  const [state, setState] = useState<ClaimState>(
    sessionUser ? (hasValidClaimParams ? "claiming" : "error") : "waiting",
  );
  const [message, setMessage] = useState(
    sessionUser
      ? hasValidClaimParams
        ? "Validating your appointment claim..."
        : "This waitlist link is incomplete or invalid."
      : "Sign in to confirm this appointment.",
  );

  useEffect(() => {
    if (!sessionUser || !slotId || !patientId || !token) {
      return;
    }

    let cancelled = false;
    async function claim() {
      try {
        const appointment = await claimWaitlistSlot(slotId, patientId, token);
        if (cancelled) return;
        setState("success");
        setMessage("Your appointment has been confirmed.");

        let patientName = "Waitlist patient";
        const { data: patient } = await supabase!
          .from("patients")
          .select("first_name, last_name")
          .eq("id", patientId)
          .single();
        if (patient) patientName = `${patient.first_name} ${patient.last_name}`;

        try {
          await syncBookedWaitlistCalendarEvent({
            id: appointment.id,
            patientName,
            appointmentType: appointment.appointment_type,
            appointmentDate: appointment.appointment_date,
            appointmentTime: appointment.appointment_time,
            durationMinutes: appointment.duration_minutes,
            outlookEventId: appointment.outlook_event_id,
          });
        } catch {
          if (!cancelled) setMessage("Your appointment is confirmed. Calendar sync needs attention.");
        }
      } catch (error) {
        if (cancelled) return;
        setState("error");
        const detail = error instanceof Error ? error.message : "This slot is no longer available.";
        setMessage(detail.includes("already_claimed") ? "This appointment has already been claimed." : detail);
      }
    }
    void claim();
    return () => {
      cancelled = true;
    };
  }, [sessionUser, slotId, patientId, token]);

  return (
    <div className="claim-screen">
      <section className="classic-dialog claim-window" role="alertdialog" aria-live="polite">
        <div className="dialog-title">Sponty Dental Services</div>
        <div className="dialog-body claim-body">
          <div className={`claim-alert-icon ${state === "success" ? "success" : state === "error" ? "error" : ""}`}>
            {state === "success" ? "!" : state === "error" ? "X" : "..."}
          </div>
          <div>
            <h1>{state === "success" ? "Success: Appointment Confirmed" : state === "error" ? "Error: Slot Already Claimed" : "Waitlist Appointment"}</h1>
            <p>{message}</p>
          </div>
          {!sessionUser && state === "waiting" && (
            <button
              type="button"
              className="classic-button primary claim-sign-in"
              onClick={() => void signInWithMicrosoft().catch((error) => {
                setState("error");
                setMessage(error instanceof Error ? error.message : "Microsoft sign-in failed.");
              })}
            >
              Sign in with Microsoft
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
