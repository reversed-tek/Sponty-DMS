import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

type DashboardPage = "Patients" | "Appointments" | "Cases" | "Billing";

type AttentionItem = {
  id: string;
  page: DashboardPage;
  title: string;
  detail: string;
  urgency: "normal" | "warning" | "urgent";
};

export function Dashboard({
  navigate,
}: {
  navigate: (page: DashboardPage) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [counts, setCounts] = useState({
    appointments: 0,
    checkedIn: 0,
    waitingDentist: 0,
    activeCases: 0,
    pendingInvoices: 0,
    overdueInvoices: 0,
    openTasks: 0,
    recallsDue: 0,
  });
  const [attention, setAttention] = useState<AttentionItem[]>([]);

  useEffect(() => {
    if (!supabase) return;

    const today = new Date().toISOString().slice(0, 10);
    const recallWindow = new Date();
    recallWindow.setDate(recallWindow.getDate() + 14);
    const recallWindowDate = recallWindow.toISOString().slice(0, 10);

    Promise.all([
      supabase
        .from("appointments")
        .select(
          "id, patient_id, appointment_date, appointment_time, status, checked_in_at, handed_over_at, treatment_completed_at, patients(first_name, last_name)",
        )
        .eq("appointment_date", today)
        .order("appointment_time"),
      supabase
        .from("cases")
        .select(
          "id, case_number, title, status, billing_status, priority, last_activity_at, patients(first_name, last_name)",
        )
        .neq("status", "closed")
        .order("last_activity_at", { ascending: false }),
      supabase
        .from("invoices")
        .select("id, invoice_number, due_date, balance, status, case_id")
        .gt("balance", 0)
        .neq("status", "cancelled"),
      supabase
        .from("case_tasks")
        .select(
          "id, case_id, title, description, priority, due_at, source, cases(case_number, title)",
        )
        .eq("status", "open")
        .order("due_at", { ascending: true, nullsFirst: false }),
      supabase
        .from("patient_recalls")
        .select(
          "id, patient_id, recall_type, due_date, status, patients(first_name, last_name)",
        )
        .eq("status", "open")
        .lte("due_date", recallWindowDate)
        .order("due_date"),
    ])
      .then(([appointmentResult, caseResult, invoiceResult, taskResult, recallResult]) => {
        const appointments = appointmentResult.data ?? [];
        const cases = caseResult.data ?? [];
        const invoices = invoiceResult.data ?? [];
        const tasks = taskResult.data ?? [];
        const recalls = recallResult.data ?? [];

        const checkedIn = appointments.filter(
          (item) =>
            item.checked_in_at &&
            !item.handed_over_at &&
            !["completed", "cancelled", "no_show"].includes(item.status),
        );

        const waitingDentist = appointments.filter(
          (item) =>
            item.handed_over_at &&
            item.status === "in_progress" &&
            !item.treatment_completed_at,
        );

        const overdue = invoices.filter(
          (item) => item.due_date && item.due_date < today,
        );

        const attentionItems: AttentionItem[] = [];

        for (const item of checkedIn.slice(0, 3)) {
          const patient = item.patients as unknown as {
            first_name: string;
            last_name: string;
          } | null;

          attentionItems.push({
            id: `checkin-${item.id}`,
            page: "Appointments",
            title: patient
              ? `${patient.first_name} ${patient.last_name} is checked in`
              : "Patient is checked in",
            detail: `${item.appointment_time} · waiting for handover`,
            urgency: "warning",
          });
        }

        for (const item of waitingDentist.slice(0, 3)) {
          const patient = item.patients as unknown as {
            first_name: string;
            last_name: string;
          } | null;

          attentionItems.push({
            id: `dentist-${item.id}`,
            page: "Cases",
            title: patient
              ? `${patient.first_name} ${patient.last_name} is with the dentist`
              : "Case is with the dentist",
            detail: `${item.appointment_time} · active visit`,
            urgency: "normal",
          });
        }

        for (const item of cases
          .filter(
            (caseItem) =>
              caseItem.status === "treatment_complete" &&
              caseItem.billing_status !== "paid",
          )
          .slice(0, 3)) {
          attentionItems.push({
            id: `case-${item.id}`,
            page: "Cases",
            title: `${item.case_number} is ready for review`,
            detail: `${item.title} · clinical work complete · billing ${item.billing_status}`,
            urgency: item.priority === "urgent" ? "urgent" : "warning",
          });
        }

        for (const invoice of overdue.slice(0, 3)) {
          attentionItems.push({
            id: `invoice-${invoice.id}`,
            page: "Billing",
            title: `${invoice.invoice_number} is overdue`,
            detail: `Outstanding balance: ${new Intl.NumberFormat("en-PH", {
              style: "currency",
              currency: "PHP",
            }).format(Number(invoice.balance))}`,
            urgency: "urgent",
          });
        }

        for (const task of tasks.slice(0, 4)) {
          const caseData = task.cases as unknown as {
            case_number: string;
            title: string;
          } | null;
          const overdueTask =
            task.due_at && new Date(task.due_at).getTime() < Date.now();

          attentionItems.push({
            id: `task-${task.id}`,
            page: "Cases",
            title: task.title,
            detail: `${caseData?.case_number ?? "Case"} · ${task.source === "automated" ? "automated" : "manual"}${task.due_at ? ` · due ${new Date(task.due_at).toLocaleString()}` : ""}`,
            urgency:
              task.priority === "urgent" || overdueTask
                ? "urgent"
                : task.priority === "high"
                  ? "warning"
                  : "normal",
          });
        }

        for (const recall of recalls.slice(0, 4)) {
          const patient = recall.patients as unknown as {
            first_name: string;
            last_name: string;
          } | null;
          const overdueRecall = recall.due_date < today;

          attentionItems.push({
            id: `recall-${recall.id}`,
            page: "Patients",
            title: patient
              ? `${patient.first_name} ${patient.last_name} recall ${overdueRecall ? "overdue" : "due"}`
              : `Patient recall ${overdueRecall ? "overdue" : "due"}`,
            detail: `${recall.recall_type.replaceAll("_", " ")} · ${recall.due_date}`,
            urgency: overdueRecall ? "urgent" : "warning",
          });
        }

        setCounts({
          appointments: appointments.filter(
            (item) => !["cancelled", "no_show"].includes(item.status),
          ).length,
          checkedIn: checkedIn.length,
          waitingDentist: waitingDentist.length,
          activeCases: cases.length,
          pendingInvoices: invoices.length,
          overdueInvoices: overdue.length,
          openTasks: tasks.length,
          recallsDue: recalls.length,
        });
        setAttention(attentionItems.slice(0, 8));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const cards = useMemo(
    () => [
      {
        label: "Appointments today",
        value: counts.appointments,
        page: "Appointments" as const,
      },
      {
        label: "Checked in",
        value: counts.checkedIn,
        page: "Appointments" as const,
      },
      {
        label: "With dentist",
        value: counts.waitingDentist,
        page: "Cases" as const,
      },
      {
        label: "Active cases",
        value: counts.activeCases,
        page: "Cases" as const,
      },
      {
        label: "Pending invoices",
        value: counts.pendingInvoices,
        page: "Billing" as const,
      },
      {
        label: "Overdue invoices",
        value: counts.overdueInvoices,
        page: "Billing" as const,
      },
      {
        label: "Open tasks",
        value: counts.openTasks,
        page: "Cases" as const,
      },
      {
        label: "Recalls due",
        value: counts.recallsDue,
        page: "Patients" as const,
      },
    ],
    [counts],
  );

  if (loading) {
    return <div className="empty-state">Loading clinic overview...</div>;
  }

  return (
    <div className="dashboard-modern">
      <section className="panel">
        <div className="panel-title">
          <span>Today at a glance</span>
          <span className="panel-title-hint">Operational workload</span>
        </div>
        <div className="dashboard-metric-grid">
          {cards.map((card) => (
            <button
              key={card.label}
              type="button"
              className="dashboard-metric-card"
              onClick={() => navigate(card.page)}
            >
              <strong>{card.value}</strong>
              <span>{card.label}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="panel dashboard-attention-panel">
        <div className="panel-title">
          <span>Needs attention</span>
          <span className="panel-title-hint">Work that may need action now</span>
        </div>

        <div className="dashboard-attention-list">
          {attention.map((item) => (
            <button
              type="button"
              key={item.id}
              className={`dashboard-attention-item ${item.urgency}`}
              onClick={() => navigate(item.page)}
            >
              <span className="attention-indicator" />
              <span>
                <strong>{item.title}</strong>
                <small>{item.detail}</small>
              </span>
            </button>
          ))}

          {!attention.length && (
            <div className="empty-state">
              Nothing urgent is waiting right now.
            </div>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel-title">Quick actions</div>
        <div className="dashboard-quick-grid">
          <button type="button" onClick={() => navigate("Patients")}>
            <strong>Patients</strong>
            <small>Find patient records and history</small>
          </button>
          <button type="button" onClick={() => navigate("Appointments")}>
            <strong>Appointments</strong>
            <small>Book, check in and hand over</small>
          </button>
          <button type="button" onClick={() => navigate("Cases")}>
            <strong>Cases</strong>
            <small>Clinical work queue</small>
          </button>
          <button type="button" onClick={() => navigate("Billing")}>
            <strong>Billing</strong>
            <small>Invoices and payments</small>
          </button>
        </div>
      </section>
    </div>
  );
}
