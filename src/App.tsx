import { useEffect, useMemo, useState } from "react";
import "./App.css";
import { signInWithMicrosoft, signOut, supabase } from "./lib/supabase";
import {
  createCalendarEvent,
  sendInvoiceEmail,
  sendPatientPortalAccessEmail,
} from "./lib/outlook";
import { WaitlistClaimWindow } from "./components/WaitlistClaimWindow";
import { PatientPortal } from "./components/PatientPortal";

type Page =
  | "Dashboard"
  | "Patients"
  | "Appointments"
  | "Treatments"
  | "Billing"
  | "Reports"
  | "User Management"
  | "Practice Settings";
type Patient = {
  id: string;
  patient_number: string;
  first_name: string;
  last_name: string;
  date_of_birth: string;
  phone: string | null;
  email: string | null;
  is_active: boolean;
  allergies: string | null;
};
type Profile = {
  id: string;
  full_name: string;
  email: string;
  role: string;
  is_active: boolean;
  last_login_at: string | null;
};
type Appointment = {
  id: string;
  patient_id: string;
  patient_name: string;
  provider_name: string;
  appointment_date: string;
  appointment_time: string;
  duration_minutes: number;
  appointment_type: string;
  status: string;
  reason: string | null;
  notes: string | null;
  outlook_event_id: string | null;
};

const navItems: Page[] = [
  "Dashboard",
  "Patients",
  "Appointments",
  "Treatments",
  "Billing",
  "Reports",
];
const toothNumbers = [
  18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28, 48, 47, 46,
  45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38,
];
const queryError = (error: { message: string } | null) => error?.message ?? "";
const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value);
const roleLabel = (role: string) =>
  role === "admin"
    ? "System Administrator"
    : role === "dentist"
      ? "Dentist"
      : "Receptionist";
const appointmentStatusLabel = (status: string) =>
  status === "in_progress"
    ? "In progress"
    : status === "scheduled"
      ? "Scheduled"
      : status === "completed"
        ? "Completed"
        : status === "cancelled"
          ? "Cancelled"
          : status === "no_show"
            ? "No show"
            : status === "confirmed"
              ? "Confirmed"
              : "Scheduled";

function App() {
  const [page, setPage] = useState<Page>("Dashboard");
  const [sessionUser, setSessionUser] = useState<{
    id: string;
    email?: string;
  } | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileError, setProfileError] = useState("");
  const [authLoading, setAuthLoading] = useState(true);
  const [notice, setNotice] = useState("Ready");
  const [, setError] = useState("");
  const [search, setSearch] = useState("");
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);

  useEffect(() => {
    if (!supabase) {
      setAuthLoading(false);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSessionUser(data.session?.user ?? null);
      setAuthLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, currentSession) =>
      setSessionUser(currentSession?.user ?? null),
    );
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (!supabase || !sessionUser) {
      setProfile(null);
      setProfileError("");
      return;
    }
    supabase
      .from("profiles")
      .select("id, full_name, email, role, is_active, last_login_at")
      .eq("id", sessionUser.id)
      .single()
      .then(({ data, error }) => {
        setProfile(data);
        setProfileError(error?.message ?? "");
      });
  }, [sessionUser]);

  if (authLoading) return <div className="auth-screen">Loading session...</div>;
  const portalMatch = window.location.pathname.match(/^\/portal\/([^/]+)$/);
  if (portalMatch) return <PatientPortal token={decodeURIComponent(portalMatch[1])} />;
  if (window.location.pathname === "/claim-slot") {
    return <WaitlistClaimWindow sessionUser={sessionUser ? { id: sessionUser.id } : null} />;
  }
  if (!sessionUser || !profile?.is_active)
    return (
      <div className="auth-screen">
        <section className="classic-dialog login-dialog">
          <div className="dialog-title">Sponty Dental Services</div>
          <div className="dialog-body">
            <h1>
              {sessionUser ? "Account setup required" : "Sign in required"}
            </h1>
            <p className="dialog-intro">
              {sessionUser
                ? "Microsoft sign-in succeeded, but this account is not linked to an active public.profiles record."
                : "Sign in with your Microsoft practice account to access patient and practice records."}
            </p>
            {sessionUser && (
              <p className="send-error">
                {profileError ||
                  "Create a profile row using this Auth user ID before signing in again."}
                <br />
                Auth user: {sessionUser.id}
              </p>
            )}{" "}
            {!sessionUser && (
              <button
                type="button"
                className="classic-button primary"
                onClick={() =>
                  signInWithMicrosoft().catch((error) =>
                    setNotice(error.message),
                  )
                }
              >
                Sign in with Microsoft
              </button>
            )}
            <button
              type="button"
              className="classic-button"
              onClick={() => signOut()}
            >
              Sign out
            </button>
            <p className="send-error">{notice}</p>
          </div>
        </section>
      </div>
    );

  const navigate = (next: Page) => {
    setPage(next);
    setNotice(`${next} selected`);
  };

  async function checkInPatientAppointment(appointmentId: string) {
    if (!supabase) return;

    try {
      const { data: appointment, error: fetchError } = await supabase
        .from("appointments")
        .select("id, patient_id, appointment_date, appointment_time, appointment_type, status, reason, notes")
        .eq("id", appointmentId)
        .single();

      if (fetchError || !appointment) throw new Error(fetchError?.message ?? "Appointment not found.");

      const { data: patientRecord, error: patientError } = await supabase
        .from("patients")
        .select("id, patient_number, first_name, last_name, date_of_birth, phone, email, is_active, allergies")
        .eq("id", appointment.patient_id)
        .single();

      if (patientError || !patientRecord) throw new Error(patientError?.message ?? "Patient not found.");

      const { error: updateError } = await supabase
        .from("appointments")
        .update({ status: "in_progress" })
        .eq("id", appointmentId);

      if (updateError) throw updateError;

      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("Your user session is not available.");

      const handoverSummary = [appointment.reason, appointment.notes].filter(Boolean).join(" | ") || "Patient ready for dentist review.";

      const { error: treatmentError } = await supabase.from("treatments").insert({
        patient_id: appointment.patient_id,
        appointment_id: appointmentId,
        treatment_date: appointment.appointment_date,
        procedure_name: appointment.appointment_type,
        status: "in_progress",
        notes: `Prepared for dentist from appointment at ${appointment.appointment_time}. ${handoverSummary}`,
        provider_id: auth.user.id,
        created_by: auth.user.id,
      });

      if (treatmentError) throw treatmentError;

      const { error: noteError } = await supabase.from("clinical_notes").insert({
        patient_id: appointment.patient_id,
        appointment_id: appointmentId,
        author_id: auth.user.id,
        visit_type: "consultation",
        note_date: appointment.appointment_date,
        subjective: appointment.reason ?? "Reason for visit not recorded.",
        objective: appointment.notes ?? "No assistant observations recorded.",
        assessment: "Awaiting dentist assessment.",
        plan: "Review appointment handover and proceed with treatment plan.",
        is_private: false,
      });

      if (noteError) throw noteError;

      if (selectedPatient && selectedPatient.id === appointment.patient_id) {
        setSelectedPatient({ ...selectedPatient, ...patientRecord });
      }

      setNotice(`Patient ${patientRecord.first_name} ${patientRecord.last_name} checked in and is ready for the dentist.`);
    } catch (reason) {
      const message =
        reason instanceof Error ? reason.message : "Patient check-in failed.";
      setNotice("Check-in failed");
      setError(message);
    }
  }

  async function handoverToDentist(appointmentId: string) {
    if (!supabase) return;

    try {
      const { data: appointment, error: fetchError } = await supabase
        .from("appointments")
        .select("id, patient_id, reason, notes, status")
        .eq("id", appointmentId)
        .single();

      if (fetchError || !appointment) throw new Error(fetchError?.message ?? "Appointment not found.");

      const nextNotes = [appointment.reason, appointment.notes].filter(Boolean).join(" | ") || "Patient handed over to dentist.";

      const { error: updateError } = await supabase
        .from("appointments")
        .update({ status: "in_progress", notes: nextNotes, reason: appointment.reason ?? "Dental consultation" })
        .eq("id", appointmentId);

      if (updateError) throw updateError;

      setNotice("Appointment handed over to the dentist.");
    } catch (reason) {
      const message =
        reason instanceof Error ? reason.message : "Handover failed.";
      setNotice("Handover failed");
      setError(message);
    }
  }

  async function completeTreatmentForAppointment(appointmentId: string) {
    if (!supabase) return;

    try {
      const { data: appointment, error: appointmentError } = await supabase
        .from("appointments")
        .select("id, patient_id, status")
        .eq("id", appointmentId)
        .single();

      if (appointmentError || !appointment) throw new Error(appointmentError?.message ?? "Appointment not found.");

      const { data: treatmentRows, error: treatmentError } = await supabase
        .from("treatments")
        .select("cost, procedure_name")
        .eq("appointment_id", appointmentId);

      if (treatmentError) throw treatmentError;
      if (!treatmentRows || treatmentRows.length === 0) {
        throw new Error("Add at least one treatment before completing the appointment.");
      }

      const { data: existingInvoice, error: invoiceCheckError } = await supabase
        .from("invoices")
        .select("id")
        .eq("appointment_id", appointmentId)
        .maybeSingle();

      if (invoiceCheckError) throw invoiceCheckError;
      if (existingInvoice) {
        setNotice("Invoice already exists for this appointment.");
        return;
      }

      const subtotal = treatmentRows.reduce((sum, row) => sum + Number(row.cost ?? 0), 0);
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("Your user session is not available.");

      const invoiceNumber = `INV-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Date.now().toString().slice(-6)}`;
      const { data: createdInvoice, error: invoiceError } = await supabase
        .from("invoices")
        .insert({
          invoice_number: invoiceNumber,
          patient_id: appointment.patient_id,
          appointment_id: appointmentId,
          subtotal,
          total: subtotal,
          balance: subtotal,
          amount_paid: 0,
          status: "pending",
          notes: `Auto-generated from appointment ${appointmentId}`,
          created_by: auth.user.id,
        })
        .select("id")
        .single();

      if (invoiceError) throw invoiceError;
      if (!createdInvoice) throw new Error("Invoice could not be created.");

      const invoiceItems = treatmentRows.map((row) => ({
        invoice_id: createdInvoice.id,
        treatment_id: null,
        description: row.procedure_name,
        quantity: 1,
        unit_price: Number(row.cost ?? 0),
        total: Number(row.cost ?? 0),
      }));

      const { error: itemError } = await supabase
        .from("invoice_items")
        .insert(invoiceItems);

      if (itemError) throw itemError;

      const { error: statusError } = await supabase
        .from("appointments")
        .update({ status: "completed" })
        .eq("id", appointmentId);

      if (statusError) throw statusError;

      setNotice("Treatment completed and invoice generated automatically.");
    } catch (reason) {
      const message =
        reason instanceof Error ? reason.message : "Complete treatment failed.";
      setNotice("Treatment completion failed");
      setError(message);
    }
  }

  return (
    <div className="app-window">
      <header className="title-bar">
        <div className="title-bar-text">
          <span className="app-mark">+</span> Sponty Dental Services
        </div>
        <div className="window-controls">
          <button type="button">_</button>
          <button type="button">[]</button>
          <button type="button" onClick={() => signOut()}>
            X
          </button>
        </div>
      </header>
      <div className="menu-bar">
        <button type="button" onClick={() => navigate("Patients")}>File</button>
        <button type="button" onClick={() => setNotice("Select a record to edit")}>Edit</button>
        <button type="button" onClick={() => navigate("Appointments")}>View</button>
        <button type="button" onClick={() => navigate("Practice Settings")}>Tools</button>
        <button type="button" onClick={() => setNotice("Use the sidebar to open a module")}>Help</button>
      </div>
      <div className="toolbar">
        <label className="quick-search">
          Quick Find:{" "}
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="patient name or number"
          />
        </label>
      </div>
      <div className="workspace">
        <aside className="sidebar">
          <div className="sidebar-heading">Practice Menu</div>
          <nav>
            {navItems.map((item) => (
              <button
                type="button"
                key={item}
                className={page === item ? "nav-item active" : "nav-item"}
                onClick={() => navigate(item)}
              >
                {item}
              </button>
            ))}
          </nav>
          <div className="sidebar-section">Administration</div>
          <button
            type="button"
            className={
              page === "User Management" ? "nav-item active" : "nav-item"
            }
            onClick={() => navigate("User Management")}
          >
            Users
          </button>
          <button
            type="button"
            className={
              page === "Practice Settings" ? "nav-item active" : "nav-item"
            }
            onClick={() => navigate("Practice Settings")}
          >
            Settings
          </button>
          <div className="sidebar-note">
            <strong>Signed in as</strong>
            <br />
            {profile.full_name}
            <br />
            <span>{roleLabel(profile.role)}</span>
          </div>
        </aside>
        <main className="main-panel">
          <div className="page-heading">
            <div>
              <div className="breadcrumbs">Practice / {page}</div>
              <h1>{page}</h1>
            </div>
          </div>
          {page === "Dashboard" && <Dashboard navigate={navigate} />}
          {page === "Patients" && (
            <Patients
              search={search}
              selected={selectedPatient}
              setSelected={setSelectedPatient}
              setNotice={setNotice}
              onCheckIn={checkInPatientAppointment}
              onHandoverToDentist={handoverToDentist}
              onCompleteTreatment={completeTreatmentForAppointment}
            />
          )}
          {page === "Appointments" && (
            <Appointments
              setNotice={setNotice}
              onCheckIn={checkInPatientAppointment}
              onHandoverToDentist={handoverToDentist}
              onCompleteTreatment={completeTreatmentForAppointment}
            />
          )}
          {page === "Treatments" && (
            <Treatments patient={selectedPatient} setNotice={setNotice} />
          )}
          {page === "Billing" && <Billing patient={selectedPatient} />}
          {page === "Reports" && <Reports />}
          {page === "User Management" && <UserManagement />}
          {page === "Practice Settings" && <PracticeSettings />}
        </main>
      </div>
      <footer className="status-bar">
        <span className="status-panel">{notice}</span>
      </footer>
    </div>
  );
}

function Dashboard({ navigate }: { navigate: (page: Page) => void }) {
  const [counts, setCounts] = useState({
    patients: 0,
    appointments: 0,
    invoices: 0,
  });
  useEffect(() => {
    if (!supabase) return;
    Promise.all([
      supabase
        .from("patients")
        .select("id", { count: "exact", head: true })
        .eq("is_active", true),
      supabase
        .from("appointments")
        .select("id", { count: "exact", head: true })
        .eq("appointment_date", new Date().toISOString().slice(0, 10)),
      supabase
        .from("invoices")
        .select("id", { count: "exact", head: true })
        .gt("balance", 0),
    ]).then(([patients, appointments, invoices]) =>
      setCounts({
        patients: patients.count ?? 0,
        appointments: appointments.count ?? 0,
        invoices: invoices.count ?? 0,
      }),
    );
  }, []);
  return (
    <div className="dashboard-grid">
      <section className="panel stat-panel">
        <div className="panel-title">Today's Overview</div>
        <div className="stat-row">
          <div>
            <b>{counts.appointments}</b>
            <span>Appointments today</span>
          </div>
          <div>
            <b>{counts.patients}</b>
            <span>Active patients</span>
          </div>
          <div>
            <b>{counts.invoices}</b>
            <span>Outstanding invoices</span>
          </div>
        </div>
      </section>
      <section className="panel alert-panel">
        <div className="panel-title">Database Status</div>
        <p className="notice info">Live counts are loaded from Supabase.</p>
        <p className="notice warning">
          Review active patient alerts before treatment.
        </p>
      </section>
      <section className="panel quick-panel">
        <div className="panel-title">Quick Actions</div>
        <button
          type="button"
          className="action-row"
          onClick={() => navigate("Patients")}
        >
          <strong>Open patients</strong>
          <small>Search the live patient register</small>
        </button>
        <button
          type="button"
          className="action-row"
          onClick={() => navigate("Appointments")}
        >
          <strong>Open appointments</strong>
          <small>Review the live schedule</small>
        </button>
        <button
          type="button"
          className="action-row"
          onClick={() => navigate("Billing")}
        >
          <strong>Open billing</strong>
          <small>Review outstanding invoices</small>
        </button>
      </section>
    </div>
  );
}

function Patients({
  search,
  selected,
  setSelected,
  setNotice,
  onCheckIn,
  onHandoverToDentist,
  onCompleteTreatment,
}: {
  search: string;
  selected: Patient | null;
  setSelected: (patient: Patient | null) => void;
  setNotice: (message: string) => void;
  onCheckIn: (appointmentId: string) => void;
  onHandoverToDentist: (appointmentId: string) => void;
  onCompleteTreatment: (appointmentId: string) => void;
}) {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [editingPatient, setEditingPatient] = useState<Patient | null>(null);
  const [patientFiles, setPatientFiles] = useState<
    Array<{
      id: string;
      bucket: "payment-proofs" | "patient-documents";
      file_name: string;
      content_type: string;
      storage_path: string;
      uploaded_at: string;
      label: string;
      signedUrl: string | null;
    }>
  >([]);
  const [upcomingAppointment, setUpcomingAppointment] = useState<{
    id: string;
    appointment_date: string;
    appointment_time: string;
    appointment_type: string;
    status: string;
    reason: string | null;
    notes: string | null;
    provider_name: string | null;
  } | null>(null);
  const [caseTab, setCaseTab] = useState<"clinical" | "chart">("clinical");
  const [filesLoading, setFilesLoading] = useState(false);
  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    date_of_birth: "",
    phone: "",
    email: "",
  });

  const resetForm = () =>
    setForm({
      first_name: "",
      last_name: "",
      date_of_birth: "",
      phone: "",
      email: "",
    });

  useEffect(() => {
    if (!supabase) return;
    supabase
      .from("patients")
      .select(
        "id, patient_number, first_name, last_name, date_of_birth, phone, email, is_active, allergies",
      )
      .order("last_name")
      .then(({ data, error: fetchError }) => {
        setPatients(data ?? []);
        setError(queryError(fetchError));
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!supabase || !selected) {
      setUpcomingAppointment(null);
      return;
    }

    supabase
      .from("appointments")
      .select(
        "id, appointment_date, appointment_time, appointment_type, status, reason, notes, profiles:provider_id(full_name)",
      )
      .eq("patient_id", selected.id)
      .order("appointment_date", { ascending: true })
      .order("appointment_time", { ascending: true })
      .then(({ data, error }) => {
        if (error) {
          setUpcomingAppointment(null);
          return;
        }

        const next = (data ?? []).find(
          (appointment) =>
            appointment.appointment_date >= new Date().toISOString().slice(0, 10),
        );

        if (!next) {
          setUpcomingAppointment(null);
          return;
        }

        const provider = next.profiles as unknown as { full_name: string } | null;
        setUpcomingAppointment({
          id: next.id,
          appointment_date: next.appointment_date,
          appointment_time: next.appointment_time,
          appointment_type: next.appointment_type,
          status: next.status,
          reason: next.reason,
          notes: next.notes,
          provider_name: provider?.full_name ?? null,
        });
      });
  }, [selected]);

  useEffect(() => {
    const client = supabase;
    if (!client || !selected) {
      setPatientFiles([]);
      return;
    }

    let isMounted = true;
    const loadFiles = async () => {
      setFilesLoading(true);
      try {
        const [documentsResult, proofsResult] = await Promise.all([
          client
            .from("patient_documents")
            .select("id, file_name, storage_path, content_type, uploaded_at")
            .eq("patient_id", selected.id)
            .order("uploaded_at", { ascending: false }),
          client
            .from("payment_proofs")
            .select("id, file_name, storage_path, content_type, uploaded_at")
            .eq("patient_id", selected.id)
            .order("uploaded_at", { ascending: false }),
        ]);

        const records = [
          ...(documentsResult.data ?? []).map((item) => ({
            ...item,
            bucket: "patient-documents" as const,
            label: "Patient document",
          })),
          ...(proofsResult.data ?? []).map((item) => ({
            ...item,
            bucket: "payment-proofs" as const,
            label: "Payment receipt",
          })),
        ].sort(
          (left, right) =>
            new Date(right.uploaded_at).getTime() - new Date(left.uploaded_at).getTime(),
        );

        const resolved = await Promise.all(
          records.map(async (record) => {
            const { data: signed, error } = await client.storage
              .from(record.bucket)
              .createSignedUrl(record.storage_path, 3600);

            return {
              ...record,
              signedUrl: error || !signed?.signedUrl ? null : signed.signedUrl,
            };
          }),
        );

        if (!isMounted) return;
        setPatientFiles(resolved);
      } catch {
        if (isMounted) setPatientFiles([]);
      } finally {
        if (isMounted) setFilesLoading(false);
      }
    };

    void loadFiles();
    return () => {
      isMounted = false;
    };
  }, [selected]);

  const filtered = useMemo(
    () =>
      patients.filter((patient) =>
        `${patient.first_name} ${patient.last_name} ${patient.patient_number} ${patient.phone ?? ""}`
          .toLowerCase()
          .includes(search.toLowerCase()),
      ),
    [patients, search],
  );

  const openNewPatient = () => {
    setEditingPatient(null);
    resetForm();
    setShowAdd(true);
  };

  const openEditPatient = (patient: Patient) => {
    setEditingPatient(patient);
    setForm({
      first_name: patient.first_name,
      last_name: patient.last_name,
      date_of_birth: patient.date_of_birth,
      phone: patient.phone ?? "",
      email: patient.email ?? "",
    });
    setShowAdd(true);
  };

  async function savePatient() {
    if (!supabase) return;
    const payload = {
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      date_of_birth: form.date_of_birth,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
    };

    if (editingPatient) {
      const { error: updateError } = await supabase
        .from("patients")
        .update(payload)
        .eq("id", editingPatient.id);

      if (updateError) {
        setError(updateError.message);
        return;
      }

      setPatients((current) =>
        current.map((patient) =>
          patient.id === editingPatient.id
            ? { ...patient, ...payload, phone: payload.phone ?? "", email: payload.email ?? "" }
            : patient,
        ),
      );
      setSelected(
        selected && selected.id === editingPatient.id
          ? { ...selected, ...payload, phone: payload.phone ?? "", email: payload.email ?? "" }
          : selected,
      );
      setNotice("Patient updated");
      setShowAdd(false);
      setEditingPatient(null);
      resetForm();
      return;
    }

    const { data: user } = await supabase.auth.getUser();
    const { data, error: insertError } = await supabase
      .from("patients")
      .insert({
        ...payload,
        patient_number: `P-${Date.now().toString().slice(-6)}`,
        created_by: user.user?.id,
      })
      .select()
      .single();

    if (insertError) {
      setError(insertError.message);
      return;
    }

    if (data) {
      setPatients((current) => [data, ...current]);
      setSelected(data);
      setNotice("Patient saved to Supabase");
      setShowAdd(false);
      setEditingPatient(null);
      resetForm();
    }
  }

  async function deletePatient(patient: Patient) {
    if (!supabase) return;
    const confirmed = window.confirm(
      `Delete patient ${patient.first_name} ${patient.last_name}? This will also remove associated records from the system.`,
    );
    if (!confirmed) return;

    const { error: deleteError } = await supabase
      .from("patients")
      .delete()
      .eq("id", patient.id);

    if (deleteError) {
      setError(deleteError.message);
      return;
    }

    setPatients((current) => current.filter((item) => item.id !== patient.id));
    if (selected?.id === patient.id) setSelected(null);
    setNotice("Patient deleted");
  }

  async function getPatientPortalToken(patient: Patient) {
    if (!supabase) throw new Error("Supabase is not configured.");

    const { data: token, error: tokenError } = await supabase.rpc(
      "issue_patient_portal_token",
      {
        p_patient_id: patient.id,
        p_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      },
    );

    if (tokenError) throw new Error(tokenError.message);
    if (!token) throw new Error("Portal token could not be generated.");

    return String(token);
  }

  async function getPatientPortalUrl(patient: Patient) {
    const token = await getPatientPortalToken(patient);
    const appUrl = import.meta.env.VITE_APP_URL || window.location.origin;
    return `${appUrl.replace(/\/$/, "")}/portal/${encodeURIComponent(token)}`;
  }

  async function sendPortalLink(patient: Patient) {
    if (!supabase) return;
    if (!patient.email) {
      setNotice("Add an email address before sending the patient portal link.");
      return;
    }

    try {
      const token = await getPatientPortalToken(patient);
      await sendPatientPortalAccessEmail(
        patient.email,
        `${patient.first_name} ${patient.last_name}`,
        token,
        import.meta.env.VITE_APP_URL || window.location.origin,
      );

      setNotice("Patient portal link sent");
    } catch (reason) {
      const message =
        reason instanceof Error
          ? reason.message
          : "Patient portal link could not be sent.";
      setError(message);
      setNotice("Portal link failed");
    }
  }

  async function copyPortalLink(patient: Patient) {
    try {
      const portalUrl = await getPatientPortalUrl(patient);
      if (!navigator.clipboard) {
        window.prompt("Copy the patient portal link:", portalUrl);
        setNotice("Portal link prepared");
        return;
      }
      await navigator.clipboard.writeText(portalUrl);
      setNotice("Portal link copied to clipboard");
    } catch (reason) {
      const message =
        reason instanceof Error
          ? reason.message
          : "Patient portal link could not be copied.";
      setError(message);
      setNotice("Copy failed");
    }
  }

  return (
    <div className="content-stack">
      <section className="panel">
        <div className="panel-title">
          Patient Register{" "}
          <button
            type="button"
            className="classic-button primary"
            onClick={openNewPatient}
          >
            + New Patient
          </button>
        </div>
        <div className="filter-row">
          <label>
            Search{" "}
            <input value={search} readOnly placeholder="Use Quick Find above" />
          </label>
        </div>
        {error && <p className="send-error">{error}</p>}
        {loading ? (
          <div className="empty-state">Loading patient records...</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Patient No.</th>
                  <th>Name</th>
                  <th>Date of birth</th>
                  <th>Phone</th>
                  <th>Status</th>
                  <th>Alerts</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((patient) => (
                  <tr
                    key={patient.id}
                    className={
                      selected?.id === patient.id ? "selected-row" : ""
                    }
                    onClick={() =>
                      setSelected(selected?.id === patient.id ? null : patient)
                    }
                  >
                    <td>{patient.patient_number}</td>
                    <td>
                      <strong>
                        {patient.first_name} {patient.last_name}
                      </strong>
                    </td>
                    <td>{patient.date_of_birth}</td>
                    <td>{patient.phone ?? "-"}</td>
                    <td>
                      <span
                        className={`status-badge ${patient.is_active ? "active" : "inactive"}`}
                      >
                        {patient.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td>{patient.allergies ?? "-"}</td>
                    <td>
                      <div className="dialog-actions">
                        <button
                          type="button"
                          className="classic-button"
                          onClick={(event) => {
                            event.stopPropagation();
                            openEditPatient(patient);
                          }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="classic-button"
                          onClick={(event) => {
                            event.stopPropagation();
                            deletePatient(patient);
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!filtered.length && (
              <div className="empty-state">No patient records found.</div>
            )}
          </div>
        )}
      </section>
      {selected && (
        <div className="patient-detail-overlay" role="dialog" aria-modal="true">
          <div className="patient-detail-page">
            <button
              type="button"
              className="patient-close"
              onClick={() => setSelected(null)}
              aria-label="Close patient record"
            >
              ×
            </button>

            <section className="panel patient-summary">
              <div className="patient-summary-header">
                <div>
                  <span className="patient-record-kicker">Patient Record</span>
                  <h2>
                    {selected.first_name} {selected.last_name}
                  </h2>
                </div>
                <div className="patient-summary-meta">
                  <span className="status-badge active">
                    {selected.is_active ? "Active" : "Inactive"}
                  </span>
                  <span className="record-chip">#{selected.patient_number}</span>
                </div>
              </div>
              <div className="patient-grid">
                <div>
                  <span>Patient number</span>
                  <strong className="patient-name">{selected.patient_number}</strong>
                </div>
                <div>
                  <span>Full name</span>
                  <strong className="patient-name">
                    {selected.first_name} {selected.last_name}
                  </strong>
                </div>
                <div>
                  <span>Date of birth</span>
                  <strong>{selected.date_of_birth}</strong>
                </div>
                <div>
                  <span>Telephone</span>
                  <strong>{selected.phone ?? "-"}</strong>
                </div>
                <div>
                  <span>Email</span>
                  <strong>{selected.email ?? "-"}</strong>
                </div>
                <div>
                  <span>Status</span>
                  <span className="status-badge active">
                    {selected.is_active ? "Active" : "Inactive"}
                  </span>
                </div>
              </div>
              {upcomingAppointment && (
                <div className="checkin-card">
                  <div>
                    <span>Next appointment</span>
                    <strong>
                      {upcomingAppointment.appointment_type} · {upcomingAppointment.appointment_date}
                    </strong>
                    <small>
                      {upcomingAppointment.appointment_time}
                      {upcomingAppointment.provider_name ? ` · ${upcomingAppointment.provider_name}` : ""}
                    </small>
                  </div>
                  <div className="checkin-aside">
                    <span className="status-badge">
                      {appointmentStatusLabel(upcomingAppointment.status)}
                    </span>
                    <button
                      type="button"
                      className="classic-button primary"
                      onClick={() => void onCheckIn(upcomingAppointment.id)}
                      disabled={upcomingAppointment.status === "in_progress"}
                    >
                      {upcomingAppointment.status === "in_progress" ? "Ready for dentist" : "Check in"}
                    </button>
                  </div>
                </div>
              )}
              <div className="dialog-actions" style={{ marginTop: "1rem" }}>
                <button
                  type="button"
                  className="classic-button primary"
                  onClick={() => void sendPortalLink(selected)}
                >
                  Send Portal Link
                </button>
                <button
                  type="button"
                  className="classic-button"
                  onClick={() => void copyPortalLink(selected)}
                >
                  Copy Portal Link
                </button>
              </div>
            </section>

            <PatientCaseWorkspace
              patient={selected}
              caseTab={caseTab}
              setCaseTab={setCaseTab}
              onCheckIn={onCheckIn}
              onHandoverToDentist={onHandoverToDentist}
              onCompleteTreatment={onCompleteTreatment}
              upcomingAppointment={upcomingAppointment}
              setNotice={setNotice}
            />

            <div className="patient-detail-sections">
              <Treatments patient={selected} setNotice={setNotice} />
            </div>

            <section className="panel patient-files">
              <div className="panel-title">Patient Files</div>
              {filesLoading ? (
                <div className="empty-state">Loading uploaded files...</div>
              ) : patientFiles.length === 0 ? (
                <div className="empty-state">
                  No files uploaded for this patient yet.
                </div>
              ) : (
                <div className="document-list">
                  {patientFiles.map((file) => (
                    <div className="document-item" key={`${file.bucket}-${file.id}`}>
                      <div className="document-meta">
                        <div className="document-name-row">
                          <strong>{file.file_name}</strong>
                          <div className="document-actions">
                            {file.signedUrl ? (
                              <>
                                <a
                                  href={file.signedUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="classic-button"
                                >
                                  Open
                                </a>
                                <a
                                  href={file.signedUrl}
                                  download={file.file_name}
                                  className="classic-button"
                                >
                                  Download
                                </a>
                              </>
                            ) : (
                              <span className="file-unavailable">Unavailable</span>
                            )}
                          </div>
                        </div>
                        <small>
                          {file.label} · {new Date(file.uploaded_at).toLocaleString()}
                        </small>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      )}
      {showAdd && (
        <div className="modal-backdrop">
          <section className="classic-dialog" role="dialog" aria-modal="true">
            <div className="dialog-title">
              {editingPatient ? "Edit Patient" : "New Patient"}{" "}
              <button
                type="button"
                onClick={() => {
                  setShowAdd(false);
                  setEditingPatient(null);
                  resetForm();
                }}
              >
                X
              </button>
            </div>
            <div className="dialog-body">
              <label>
                First name
                <input
                  value={form.first_name}
                  onChange={(event) =>
                    setForm({ ...form, first_name: event.target.value })
                  }
                />
              </label>
              <label>
                Last name
                <input
                  value={form.last_name}
                  onChange={(event) =>
                    setForm({ ...form, last_name: event.target.value })
                  }
                />
              </label>
              <label>
                Date of birth
                <input
                  type="date"
                  value={form.date_of_birth}
                  onChange={(event) =>
                    setForm({ ...form, date_of_birth: event.target.value })
                  }
                />
              </label>
              <label>
                Phone
                <input
                  value={form.phone}
                  onChange={(event) =>
                    setForm({ ...form, phone: event.target.value })
                  }
                />
              </label>
              <label>
                Email
                <input
                  type="email"
                  value={form.email}
                  onChange={(event) =>
                    setForm({ ...form, email: event.target.value })
                  }
                />
              </label>
              <div className="dialog-actions">
                <button
                  type="button"
                  className="classic-button"
                  onClick={() => {
                    setShowAdd(false);
                    setEditingPatient(null);
                    resetForm();
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="classic-button primary"
                  disabled={
                    !form.first_name || !form.last_name || !form.date_of_birth
                  }
                  onClick={savePatient}
                >
                  {editingPatient ? "Save Changes" : "Save Patient"}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function Appointments({
  setNotice,
  onCheckIn,
  onHandoverToDentist,
  onCompleteTreatment,
}: {
  setNotice: (message: string) => void;
  onCheckIn: (appointmentId: string) => void;
  onHandoverToDentist: (appointmentId: string) => void;
  onCompleteTreatment: (appointmentId: string) => void;
}) {
  const [items, setItems] = useState<Appointment[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [expandedActionId, setExpandedActionId] = useState<string | null>(null);
  const [form, setForm] = useState({ patient_id: "", appointment_date: "", appointment_time: "08:00", duration_minutes: "30", appointment_type: "checkup", reason: "" });
  useEffect(() => {
    if (!supabase) return;
    supabase.from("patients").select("id, patient_number, first_name, last_name, date_of_birth, phone, email, is_active, allergies").eq("is_active", true).order("last_name").then(({ data }) => setPatients(data ?? []));
    supabase
      .from("appointments")
      .select(
        "id, patient_id, appointment_date, appointment_time, duration_minutes, appointment_type, status, reason, notes, outlook_event_id, patients(first_name, last_name), profiles:provider_id(full_name)",
      )
      .order("appointment_date")
      .order("appointment_time")
      .then(({ data, error }) => {
        if (error) setMessage(error.message);
        setItems(
          (data ?? []).map((item) => {
            const patient = item.patients as unknown as {
              first_name: string;
              last_name: string;
            } | null;
            const provider = item.profiles as unknown as {
              full_name: string;
            } | null;
            return {
              ...item,
              patient_name: patient
                ? `${patient.first_name} ${patient.last_name}`
                : "Unknown patient",
              provider_name: provider?.full_name ?? "Unassigned",
              notes: item.notes ?? null,
            } satisfies Appointment;
          }),
        );
        setLoading(false);
      });
  }, []);
  async function addAppointment() {
    if (!supabase || !form.patient_id || !form.appointment_date) return;
    const { data: auth } = await supabase.auth.getUser();
    const { data, error: insertError } = await supabase.from("appointments").insert({ ...form, duration_minutes: Number(form.duration_minutes), provider_id: auth.user?.id, created_by: auth.user?.id }).select("id, patient_id, appointment_date, appointment_time, duration_minutes, appointment_type, status, reason, notes, outlook_event_id, patients(first_name, last_name), profiles:provider_id(full_name)").single();
    if (insertError) setMessage(insertError.message);
    else if (data) {
      const patient = data.patients as unknown as { first_name: string; last_name: string } | null;
      const provider = data.profiles as unknown as { full_name: string } | null;
      setItems((current) => [{
        ...data,
        patient_name: patient ? `${patient.first_name} ${patient.last_name}` : "Unknown patient",
        provider_name: provider?.full_name ?? "Unassigned",
        notes: data.notes ?? null,
      } as Appointment, ...current]);
      setShowForm(false); setNotice("Appointment saved to Supabase");
    }
  }
  async function sync(item: Appointment) {
    try {
      const event = await createCalendarEvent({
        patientName: item.patient_name,
        provider: item.provider_name,
        type: item.appointment_type,
        date: item.appointment_date,
        time: item.appointment_time,
        durationMinutes: item.duration_minutes,
        notes: item.reason ?? "",
      });
      if (supabase)
        await supabase
          .from("appointments")
          .update({ outlook_event_id: event.id })
          .eq("id", item.id);
      setItems((current) =>
        current.map((appointment) =>
          appointment.id === item.id
            ? { ...appointment, outlook_event_id: event.id }
            : appointment,
        ),
      );
      setNotice("Appointment synced to Outlook");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Outlook sync failed",
      );
    }
  }
  return (
    <section className="panel">
      <div className="panel-title">Appointment Calendar <button type="button" className="classic-button primary" onClick={() => setShowForm(true)}>+ New Appointment</button></div>
      {message && <p className="send-error">{message}</p>}
      {loading ? (
        <div className="empty-state">Loading appointments...</div>
      ) : (
        <div className="appointment-list">
          {items.map((item) => (
            <div className="appointment-row" key={item.id}>
              <time>
                {item.appointment_date} {item.appointment_time}
              </time>
              <div className="appointment-block">
                <strong>{item.patient_name}</strong>
                <span>
                  {item.appointment_type} with {item.provider_name}
                </span>
              </div>
              <span className={`status-badge ${item.status}`}>
                {item.status}
              </span>
              <span
                className={
                  item.outlook_event_id
                    ? "calendar-sync synced"
                    : "calendar-sync"
                }
              >
                {item.outlook_event_id ? "Outlook synced" : "Local only"}
              </span>
              <button
                type="button"
                className="classic-button"
                disabled={Boolean(item.outlook_event_id)}
                onClick={() => sync(item)}
              >
                {item.outlook_event_id ? "Synced" : "Sync Outlook"}
              </button>
              <button
                type="button"
                className="classic-button appointment-action-toggle"
                onClick={() =>
                  setExpandedActionId((current) =>
                    current === item.id ? null : item.id,
                  )
                }
              >
                {expandedActionId === item.id ? "Hide actions" : "Actions"}
              </button>
              {expandedActionId === item.id && (
                <div className="appointment-clinic-actions">
                  <button
                    type="button"
                    className="classic-button primary"
                    onClick={() => onCheckIn(item.id)}
                    disabled={item.status === "in_progress" || item.status === "completed"}
                  >
                    {item.status === "in_progress" ? "Ready for dentist" : "Check in"}
                  </button>
                  <button
                    type="button"
                    className="classic-button"
                    onClick={() => onHandoverToDentist(item.id)}
                    disabled={item.status === "completed"}
                  >
                    Handover
                  </button>
                  <button
                    type="button"
                    className="classic-button primary"
                    onClick={() => onCompleteTreatment(item.id)}
                    disabled={item.status === "completed"}
                  >
                    Complete
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {!loading && !items.length && <div className="empty-state">No appointments found. Use <strong>+ New Appointment</strong> to schedule the first visit.</div>}
      {showForm && <div className="modal-backdrop"><section className="classic-dialog" role="dialog" aria-modal="true"><div className="dialog-title">New Appointment <button type="button" onClick={() => setShowForm(false)}>X</button></div><div className="dialog-body"><label>Patient<select value={form.patient_id} onChange={(event) => setForm({ ...form, patient_id: event.target.value })}><option value="">Select patient</option>{patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.first_name} {patient.last_name} ({patient.patient_number})</option>)}</select></label><label>Date<input type="date" value={form.appointment_date} onChange={(event) => setForm({ ...form, appointment_date: event.target.value })} /></label><label>Time<input type="time" value={form.appointment_time} onChange={(event) => setForm({ ...form, appointment_time: event.target.value })} /></label><label>Duration<select value={form.duration_minutes} onChange={(event) => setForm({ ...form, duration_minutes: event.target.value })}><option value="30">30 minutes</option><option value="45">45 minutes</option><option value="60">60 minutes</option></select></label><label>Appointment type<select value={form.appointment_type} onChange={(event) => setForm({ ...form, appointment_type: event.target.value })}><option value="checkup">Checkup</option><option value="cleaning">Cleaning</option><option value="filling">Filling</option><option value="extraction">Extraction</option><option value="consultation">Consultation</option><option value="emergency">Emergency</option></select></label><label>Reason<input value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} /></label><div className="dialog-actions"><button type="button" className="classic-button" onClick={() => setShowForm(false)}>Cancel</button><button type="button" className="classic-button primary" disabled={!form.patient_id || !form.appointment_date} onClick={addAppointment}>Save Appointment</button></div></div></section></div>}
    </section>
  );
}

function PatientCaseWorkspace({
  patient,
  caseTab,
  setCaseTab,
  onCheckIn,
  onHandoverToDentist,
  onCompleteTreatment,
  upcomingAppointment,
  setNotice,
}: {
  patient: Patient | null;
  caseTab: "clinical" | "chart";
  setCaseTab: (value: "clinical" | "chart") => void;
  onCheckIn: (appointmentId: string) => void;
  onHandoverToDentist: (appointmentId: string) => void;
  onCompleteTreatment: (appointmentId: string) => void;
  upcomingAppointment: { id: string; appointment_date: string; appointment_time: string; appointment_type: string; status: string; reason: string | null; notes: string | null; provider_name: string | null } | null;
  setNotice: (message: string) => void;
}) {
  const [notes, setNotes] = useState<
    Array<{
      id: string;
      note_date: string;
      visit_type: string;
      subjective: string | null;
      assessment: string | null;
      plan: string | null;
    }>
  >([]);
  const [history, setHistory] = useState<
    Array<{
      id: string;
      record_type: string;
      name: string;
      detail: string | null;
      severity: string | null;
    }>
  >([]);

  useEffect(() => {
    if (!supabase || !patient) return;

    Promise.all([
      supabase
        .from("clinical_notes")
        .select("id, note_date, visit_type, subjective, assessment, plan")
        .eq("patient_id", patient.id)
        .order("note_date", { ascending: false }),
      supabase
        .from("medical_history")
        .select("id, record_type, name, detail, severity")
        .eq("patient_id", patient.id)
        .order("created_at", { ascending: false }),
    ]).then(([notesResult, historyResult]) => {
      setNotes(notesResult.data ?? []);
      setHistory(historyResult.data ?? []);
    });
  }, [patient]);

  return (
    <section className="panel patient-case-workspace">
      <div className="panel-title">
        Patient Case Workspace
        <span>{patient ? `${patient.first_name} ${patient.last_name}` : "No patient selected"}</span>
      </div>
      <div className="tab-strip">
        {[
          { id: "clinical", label: "Clinical Records" },
          { id: "chart", label: "Dental Chart" },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={caseTab === tab.id ? "tab active" : "tab"}
            onClick={() => setCaseTab(tab.id as "clinical" | "chart")}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {caseTab === "clinical" ? (
        <div className="patient-case-body">
          <div className="case-summary-row">
            {upcomingAppointment ? (
              <div className="case-appointment-box">
                <div>
                  <span>Appointment handover</span>
                  <strong>{upcomingAppointment.appointment_type}</strong>
                  <small>
                    {upcomingAppointment.appointment_date} · {upcomingAppointment.appointment_time}
                  </small>
                </div>
                <div className="case-action-stack">
                  <button type="button" className="classic-button primary" onClick={() => onCheckIn(upcomingAppointment.id)} disabled={upcomingAppointment.status === "in_progress" || upcomingAppointment.status === "completed"}>
                    {upcomingAppointment.status === "in_progress" || upcomingAppointment.status === "completed" ? "Checked in" : "Check in"}
                  </button>
                  <button type="button" className="classic-button" onClick={() => onHandoverToDentist(upcomingAppointment.id)} disabled={upcomingAppointment.status === "completed"}>
                    Handover to dentist
                  </button>
                  <button type="button" className="classic-button primary" onClick={() => onCompleteTreatment(upcomingAppointment.id)} disabled={upcomingAppointment.status === "completed"}>
                    Complete treatment
                  </button>
                </div>
              </div>
            ) : (
              <div className="case-appointment-box empty-box">
                <span>No upcoming visit</span>
                <small>Schedule an appointment to prep the treatment flow.</small>
              </div>
            )}
          </div>
          <div className="case-columns">
            <div className="case-column">
              <h3>Assistant handover</h3>
              {upcomingAppointment ? (
                <>
                  <div className="case-note">
                    <div className="note-meta"><strong>Reason for visit</strong></div>
                    <p>{upcomingAppointment.reason || "No chief complaint recorded."}</p>
                  </div>
                  <div className="case-note">
                    <div className="note-meta"><strong>Assistant notes</strong></div>
                    <p>{upcomingAppointment.notes || "No assistant observations recorded yet."}</p>
                  </div>
                </>
              ) : (
                <div className="empty-state">No appointment handover on file.</div>
              )}
            </div>
            <div className="case-column">
              <h3>Clinical notes</h3>
              {notes.length ? notes.slice(0, 3).map((note) => (
                <article className="case-note" key={note.id}>
                  <div className="note-meta"><strong>{note.note_date}</strong><span>{note.visit_type}</span></div>
                  <p>{note.assessment || note.subjective || note.plan || "No detailed note recorded."}</p>
                </article>
              )) : <div className="empty-state">No clinical notes on record.</div>}
            </div>
          </div>
          <div className="case-columns" style={{ marginTop: "10px" }}>
            <div className="case-column">
              <h3>Patient history</h3>
              {history.length ? history.slice(0, 4).map((entry) => (
                <div className="case-history-item" key={entry.id}>
                  <strong>{entry.name}</strong>
                  <small>{entry.record_type}</small>
                  <span>{entry.severity ?? "Active"}</span>
                </div>
              )) : <div className="empty-state">No medical history recorded.</div>}
            </div>
            <div className="case-column">
              <h3>Dental workflow</h3>
              <div className="case-note">
                <div className="note-meta"><strong>Current state</strong></div>
                <p>{upcomingAppointment ? appointmentStatusLabel(upcomingAppointment.status) : "No active visit selected."}</p>
              </div>
              <div className="case-note">
                <div className="note-meta"><strong>System rule</strong></div>
                <p>Appointments connect handover notes, clinical records, treatment, and invoice generation in one flow.</p>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="patient-case-body">
          <DentalChart patient={patient} setNotice={setNotice} />
        </div>
      )}
    </section>
  );
}

function DentalChart({
  patient,
  setNotice,
}: {
  patient: Patient | null;
  setNotice: (message: string) => void;
}) {
  const [records, setRecords] = useState<
    Array<{
      id: string;
      tooth_number: number;
      condition: string;
      tooth_surface: string | null;
      severity: string | null;
      follow_up_required: boolean;
      notes: string | null;
    }>
  >([]);
  const [selectedTooth, setSelectedTooth] = useState(16);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ condition: "", surface: "Whole tooth", severity: "Mild", notes: "", followUp: false });
  const [error, setError] = useState("");
  useEffect(() => {
    if (!supabase || !patient) return;
    supabase
      .from("dental_chart_records")
      .select(
        "id, tooth_number, condition, tooth_surface, severity, follow_up_required, notes",
      )
      .eq("patient_id", patient.id)
      .order("recorded_at", { ascending: false })
      .then(({ data }) => setRecords(data ?? []));
  }, [patient]);
  if (!patient)
    return (
      <section className="panel">
        <div className="empty-state">
          Select a patient first to view the dental chart.
        </div>
      </section>
    );
  const selectedRecords = records.filter(
    (record) => record.tooth_number === selectedTooth,
  );
  async function addCondition() {
    if (!supabase || !patient || !form.condition) return;
    const { data: auth } = await supabase.auth.getUser();
    const { data, error: insertError } = await supabase.from("dental_chart_records").insert({
      patient_id: patient.id,
      tooth_number: selectedTooth,
      tooth_surface: form.surface,
      condition: form.condition,
      severity: form.severity,
      notes: form.notes,
      follow_up_required: form.followUp,
      recorded_by: auth.user?.id,
    }).select("id, tooth_number, condition, tooth_surface, severity, follow_up_required, notes").single();
    if (insertError) setError(insertError.message);
    else if (data) { setRecords((current) => [data, ...current]); setShowForm(false); setForm({ condition: "", surface: "Whole tooth", severity: "Mild", notes: "", followUp: false }); setNotice(`Tooth ${selectedTooth} condition saved`); }
  }
  return (
    <div className="content-stack">
      <section className="panel dental-panel">
        <div className="dental-toolbar">
          <span className="dental-chart-summary">
            {patient.first_name} {patient.last_name} · FDI notation
          </span>
          <button type="button" className="classic-button primary" onClick={() => setShowForm(true)}>+ Record condition</button>
        </div>
        {error && <p className="send-error">{error}</p>}
        <div className="tooth-grid">
          {toothNumbers.map((number) => (
            <button
              type="button"
              key={number}
              className={`${selectedTooth === number ? "tooth selected" : "tooth"} ${records.some((record) => record.tooth_number === number) ? "has-record" : ""}`}
              onClick={() => setSelectedTooth(number)}
            >
              <span className="tooth-shape">
                {records.some((record) => record.tooth_number === number)
                  ? "●"
                  : ""}
              </span>
              <strong>{number}</strong>
            </button>
          ))}
        </div>
      </section>
      <section className="panel">
        <div className="panel-title">Tooth {selectedTooth} History</div>
        <div className="tooth-history">
          {selectedRecords.map((record) => (
            <div className="tooth-record" key={record.id}>
              <div>
                <strong>{record.condition}</strong>
                <small>
                  {record.tooth_surface ?? "Whole tooth"} |{" "}
                  {record.severity ?? "Unspecified"}
                </small>
                <p>{record.notes ?? "No notes recorded."}</p>
                {record.follow_up_required && (
                  <span className="follow-up">Follow-up required</span>
                )}
              </div>
            </div>
          ))}
          {!selectedRecords.length && (
            <div className="empty-state">
              No conditions recorded for tooth {selectedTooth}.
            </div>
          )}
        </div>
      </section>
      {showForm && <div className="modal-backdrop"><section className="classic-dialog" role="dialog" aria-modal="true"><div className="dialog-title">Tooth {selectedTooth} Condition <button type="button" onClick={() => setShowForm(false)}>X</button></div><div className="dialog-body"><label>Condition<select value={form.condition} onChange={(event) => setForm({ ...form, condition: event.target.value })}><option value="">Select condition</option><option>Existing filling</option><option>Caries</option><option>Missing</option><option>Crown</option><option>Fracture</option><option>Healthy</option></select></label><label>Surface<select value={form.surface} onChange={(event) => setForm({ ...form, surface: event.target.value })}><option>Whole tooth</option><option>Occlusal</option><option>Mesial</option><option>Distal</option><option>Buccal</option><option>Lingual</option></select></label><label>Severity<select value={form.severity} onChange={(event) => setForm({ ...form, severity: event.target.value })}><option>Mild</option><option>Moderate</option><option>Severe</option></select></label><label>Notes<textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label><label className="check-label"><input type="checkbox" checked={form.followUp} onChange={(event) => setForm({ ...form, followUp: event.target.checked })} /> Follow-up required</label><div className="dialog-actions"><button type="button" className="classic-button" onClick={() => setShowForm(false)}>Cancel</button><button type="button" className="classic-button primary" disabled={!form.condition} onClick={addCondition}>Save Condition</button></div></div></section></div>}
    </div>
  );
}

function Treatments({
  patient,
  setNotice,
}: {
  patient: Patient | null;
  setNotice: (message: string) => void;
}) {
  const [items, setItems] = useState<
    Array<{
      id: string;
      patient_id: string;
      treatment_date: string;
      procedure_name: string;
      tooth_number: number | null;
      cost: number;
      status: string;
      notes: string | null;
      patients: { first_name: string; last_name: string } | null;
    }>
  >([]);
  const [showForm, setShowForm] = useState(false);
  const [editingTreatment, setEditingTreatment] = useState<(typeof items)[number] | null>(null);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    procedure_name: "",
    tooth_number: "",
    cost: "",
    status: "planned",
    notes: "",
  });

  const resetForm = () =>
    setForm({
      procedure_name: "",
      tooth_number: "",
      cost: "",
      status: "planned",
      notes: "",
    });

  useEffect(() => {
    if (!supabase) return;
    supabase
      .from("treatments")
      .select(
        "id, patient_id, treatment_date, procedure_name, tooth_number, cost, status, notes, patients(first_name, last_name)",
      )
      .order("treatment_date", { ascending: false })
      .then(({ data, error: fetchError }) => {
        setItems((data ?? []) as unknown as typeof items);
        if (fetchError) setError(fetchError.message);
      });
  }, []);

  const openNewTreatment = () => {
    if (!patient) return;
    setEditingTreatment(null);
    resetForm();
    setShowForm(true);
  };

  const openEditTreatment = (item: (typeof items)[number]) => {
    setEditingTreatment(item);
    setForm({
      procedure_name: item.procedure_name,
      tooth_number: item.tooth_number?.toString() ?? "",
      cost: String(item.cost),
      status: item.status,
      notes: item.notes ?? "",
    });
    setShowForm(true);
  };

  async function saveTreatment() {
    if (!supabase || !patient) return;
    if (!form.procedure_name) return;

    const payload = {
      patient_id: editingTreatment?.patient_id ?? patient.id,
      procedure_name: form.procedure_name.trim(),
      tooth_number: form.tooth_number ? Number(form.tooth_number) : null,
      cost: Number(form.cost || 0),
      status: form.status,
      notes: form.notes.trim() || null,
    };

    if (editingTreatment) {
      const { error: updateError } = await supabase
        .from("treatments")
        .update(payload)
        .eq("id", editingTreatment.id);

      if (updateError) {
        setError(updateError.message);
        return;
      }

      setItems((current) =>
        current.map((item) =>
          item.id === editingTreatment.id
            ? { ...item, ...payload, cost: Number(payload.cost) }
            : item,
        ),
      );
      setNotice("Treatment updated");
    } else {
      const { data: auth } = await supabase.auth.getUser();
      const { data, error: insertError } = await supabase
        .from("treatments")
        .insert({
          ...payload,
          provider_id: auth.user?.id,
          created_by: auth.user?.id,
        })
        .select(
          "id, patient_id, treatment_date, procedure_name, tooth_number, cost, status, notes, patients(first_name, last_name)",
        )
        .single();

      if (insertError) {
        setError(insertError.message);
        return;
      }

      if (data) {
        setItems((current) => [data as unknown as (typeof items)[number], ...current]);
      }
      setNotice("Treatment saved");
    }

    setShowForm(false);
    setEditingTreatment(null);
    resetForm();
  }

  async function deleteTreatment(id: string) {
    if (!supabase) return;
    const target = items.find((item) => item.id === id);
    if (!target) return;

    const confirmed = window.confirm(
      `Delete the ${target.procedure_name} treatment record?`,
    );
    if (!confirmed) return;

    const { error: deleteError } = await supabase
      .from("treatments")
      .delete()
      .eq("id", id);

    if (deleteError) {
      setError(deleteError.message);
      return;
    }

    setItems((current) => current.filter((item) => item.id !== id));
    setNotice("Treatment deleted");
  }

  return (
    <section className="panel">
      <div className="panel-title">
        Treatment Register{" "}
        <button
          type="button"
          className="classic-button primary"
          onClick={openNewTreatment}
          disabled={!patient}
        >
          + New Treatment
        </button>
      </div>
      {error && <p className="send-error">{error}</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Patient</th>
              <th>Procedure</th>
              <th>Tooth</th>
              <th>Cost</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{item.treatment_date}</td>
                <td>
                  {item.patients
                    ? `${item.patients.first_name} ${item.patients.last_name}`
                    : "-"}
                </td>
                <td>{item.procedure_name}</td>
                <td>{item.tooth_number ?? "-"}</td>
                <td>{formatCurrency(Number(item.cost))}</td>
                <td>
                  <span className="status-badge">{item.status}</span>
                </td>
                <td>
                  <div className="dialog-actions">
                    <button
                      type="button"
                      className="classic-button"
                      onClick={() => openEditTreatment(item)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="classic-button"
                      onClick={() => deleteTreatment(item.id)}
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!items.length && (
          <div className="empty-state">No treatments found.</div>
        )}
      </div>
      {!patient && <p className="empty-state">Select a patient from Patients before adding a treatment.</p>}
      {showForm && (
        <div className="modal-backdrop">
          <section className="classic-dialog" role="dialog" aria-modal="true">
            <div className="dialog-title">
              {editingTreatment ? "Edit Treatment" : "New Treatment"}{" "}
              <button type="button" onClick={() => { setShowForm(false); setEditingTreatment(null); resetForm(); }}>
                X
              </button>
            </div>
            <div className="dialog-body">
              <p className="dialog-intro">Patient: {patient?.first_name} {patient?.last_name}</p>
              <label>
                Procedure name
                <input
                  value={form.procedure_name}
                  onChange={(event) =>
                    setForm({ ...form, procedure_name: event.target.value })
                  }
                />
              </label>
              <label>
                Tooth number
                <input
                  type="number"
                  min="11"
                  max="48"
                  value={form.tooth_number}
                  onChange={(event) =>
                    setForm({ ...form, tooth_number: event.target.value })
                  }
                />
              </label>
              <label>
                Cost
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.cost}
                  onChange={(event) => setForm({ ...form, cost: event.target.value })}
                />
              </label>
              <label>
                Status
                <select
                  value={form.status}
                  onChange={(event) => setForm({ ...form, status: event.target.value })}
                >
                  <option value="planned">Planned</option>
                  <option value="in_progress">In progress</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </label>
              <label>
                Notes
                <textarea
                  value={form.notes}
                  onChange={(event) => setForm({ ...form, notes: event.target.value })}
                />
              </label>
              <div className="dialog-actions">
                <button
                  type="button"
                  className="classic-button"
                  onClick={() => { setShowForm(false); setEditingTreatment(null); resetForm(); }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="classic-button primary"
                  disabled={!form.procedure_name}
                  onClick={saveTreatment}
                >
                  {editingTreatment ? "Save Changes" : "Save Treatment"}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

function Billing({ patient }: { patient: Patient | null }) {
  const [items, setItems] = useState<
    Array<{
      id: string;
      invoice_number: string;
      invoice_date: string;
      total: number;
      amount_paid: number;
      balance: number;
      status: string;
      patient: string;
      email: string;
    }>
  >([]);
  const [emailInvoice, setEmailInvoice] = useState<
    (typeof items)[number] | null
  >(null);
  const [paymentInvoice, setPaymentInvoice] = useState<
    (typeof items)[number] | null
  >(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [message, setMessage] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ total: "", due_date: "", notes: "" });

  function refreshInvoiceList() {
    if (!supabase) return;
    supabase
      .from("invoices")
      .select(
        "id, invoice_number, invoice_date, total, amount_paid, balance, status, patients(first_name, last_name, email)",
      )
      .order("invoice_date", { ascending: false })
      .then(({ data }) =>
        setItems(
          (data ?? []).map((item) => {
            const patientData = item.patients as unknown as {
              first_name: string;
              last_name: string;
              email: string | null;
            } | null;
            return {
              ...item,
              patient: patientData
                ? `${patientData.first_name} ${patientData.last_name}`
                : "Unknown patient",
              email: patientData?.email ?? "",
            };
          }),
        ),
      );
  }

  useEffect(() => {
    refreshInvoiceList();
  }, []);

  async function sendInvoice() {
    if (!emailInvoice) return;
    try {
      await sendInvoiceEmail({
        invoiceNumber: emailInvoice.invoice_number,
        patientName: emailInvoice.patient,
        total: formatCurrency(Number(emailInvoice.total)),
        balance: formatCurrency(Number(emailInvoice.balance)),
        invoiceDate: emailInvoice.invoice_date,
        recipient,
      });
      setMessage("Invoice sent from your Outlook mailbox.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Invoice email failed.",
      );
    }
  }

  async function recordPayment() {
    if (!supabase || !paymentInvoice || !paymentAmount) return;

    const amount = Number(paymentAmount);
    if (Number.isNaN(amount) || amount <= 0) {
      setMessage("Enter a valid payment amount.");
      return;
    }

    const nextPaid = Math.min(
      Number(paymentInvoice.amount_paid) + amount,
      Number(paymentInvoice.total),
    );
    const nextBalance = Math.max(Number(paymentInvoice.total) - nextPaid, 0);
    const nextStatus = nextBalance > 0 ? "partial" : "paid";

    const { error } = await supabase
      .from("invoices")
      .update({
        amount_paid: nextPaid,
        balance: nextBalance,
        status: nextStatus,
      })
      .eq("id", paymentInvoice.id);

    if (error) {
      setMessage(error.message);
      return;
    }

    setPaymentInvoice(null);
    setPaymentAmount("");
    setMessage("Payment recorded.");
    refreshInvoiceList();
  }

  async function addInvoice() {
    if (!supabase || !patient || !form.total) return;
    const { data: auth } = await supabase.auth.getUser();
    const total = Number(form.total);
    const { data, error: insertError } = await supabase.from("invoices").insert({ invoice_number: `INV-${Date.now().toString().slice(-8)}`, patient_id: patient.id, due_date: form.due_date || null, subtotal: total, total, balance: total, notes: form.notes, created_by: auth.user?.id }).select("id, invoice_number, invoice_date, total, amount_paid, balance, status, patients(first_name, last_name, email)").single();
    if (insertError) setMessage(insertError.message);
    else if (data) { const linked = data.patients as unknown as { first_name: string; last_name: string; email: string | null } | null; setItems((current) => [{ ...data, patient: linked ? `${linked.first_name} ${linked.last_name}` : "Unknown patient", email: linked?.email ?? "" }, ...current]); setShowForm(false); setForm({ total: "", due_date: "", notes: "" }); }
  }
  return (
    <section className="panel">
      <div className="panel-title">Invoice Register <button type="button" className="classic-button primary" onClick={() => setShowForm(true)} disabled={!patient}>+ New Invoice</button></div>
      {!patient && <p className="empty-state">Select a patient from Patients before creating an invoice.</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Invoice</th>
              <th>Patient</th>
              <th>Date</th>
              <th>Total</th>
              <th>Balance</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{item.invoice_number}</td>
                <td>{item.patient}</td>
                <td>{item.invoice_date}</td>
                <td>{formatCurrency(Number(item.total))}</td>
                <td>{formatCurrency(Number(item.balance))}</td>
                <td>
                  <span className="status-badge">{item.status}</span>
                </td>
                <td>
                  <div className="dialog-actions">
                    <button
                      type="button"
                      className="classic-button"
                      onClick={() => {
                        setEmailInvoice(item);
                        setRecipient(item.email);
                        setMessage("");
                      }}
                    >
                      Email
                    </button>
                    <button
                      type="button"
                      className="classic-button primary"
                      onClick={() => {
                        setPaymentInvoice(item);
                        setPaymentAmount("");
                        setMessage("");
                      }}
                    >
                      Receive payment
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!items.length && <div className="empty-state">No invoices found.</div>}
      </div>
      {emailInvoice && (
        <div className="modal-backdrop">
          <section className="classic-dialog" role="dialog" aria-modal="true">
            <div className="dialog-title">
              Send Invoice by Outlook{" "}
              <button type="button" onClick={() => setEmailInvoice(null)}>
                X
              </button>
            </div>
            <div className="dialog-body">
              <p>
                Send {emailInvoice.invoice_number} from the logged-in Microsoft
                mailbox.
              </p>
              <label>
                Recipient email
                <input
                  type="email"
                  value={recipient}
                  onChange={(event) => setRecipient(event.target.value)}
                />
              </label>
              {message && <p className="send-success">{message}</p>}
              <div className="dialog-actions">
                <button
                  type="button"
                  className="classic-button"
                  onClick={() => setEmailInvoice(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="classic-button primary"
                  disabled={!recipient}
                  onClick={sendInvoice}
                >
                  Send invoice
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
      {paymentInvoice && (
        <div className="modal-backdrop">
          <section className="classic-dialog" role="dialog" aria-modal="true">
            <div className="dialog-title">
              Receive payment for {paymentInvoice.invoice_number}{" "}
              <button type="button" onClick={() => setPaymentInvoice(null)}>
                X
              </button>
            </div>
            <div className="dialog-body">
              <p>
                Total: {formatCurrency(Number(paymentInvoice.total))} · Balance: {formatCurrency(Number(paymentInvoice.balance))}
              </p>
              <label>
                Payment amount
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={paymentAmount}
                  onChange={(event) => setPaymentAmount(event.target.value)}
                />
              </label>
              {message && <p className="send-success">{message}</p>}
              <div className="dialog-actions">
                <button
                  type="button"
                  className="classic-button"
                  onClick={() => setPaymentInvoice(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="classic-button primary"
                  disabled={!paymentAmount}
                  onClick={recordPayment}
                >
                  Save payment
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
      {showForm && <div className="modal-backdrop"><section className="classic-dialog" role="dialog" aria-modal="true"><div className="dialog-title">New Invoice <button type="button" onClick={() => setShowForm(false)}>X</button></div><div className="dialog-body"><p className="dialog-intro">Patient: {patient?.first_name} {patient?.last_name}</p><label>Total amount<input type="number" min="0" step="0.01" value={form.total} onChange={(event) => setForm({ ...form, total: event.target.value })} /></label><label>Due date<input type="date" value={form.due_date} onChange={(event) => setForm({ ...form, due_date: event.target.value })} /></label><label>Notes<textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label><div className="dialog-actions"><button type="button" className="classic-button" onClick={() => setShowForm(false)}>Cancel</button><button type="button" className="classic-button primary" disabled={!form.total} onClick={addInvoice}>Save Invoice</button></div></div></section></div>}
    </section>
  );
}

function Reports() {
  const [counts, setCounts] = useState({
    appointments: 0,
    patients: 0,
    treatments: 0,
    collections: 0,
  });
  useEffect(() => {
    if (!supabase) return;
    Promise.all([
      supabase
        .from("appointments")
        .select("id", { count: "exact", head: true }),
      supabase
        .from("patients")
        .select("id", { count: "exact", head: true })
        .eq("is_active", true),
      supabase.from("treatments").select("id", { count: "exact", head: true }),
      supabase.from("invoices").select("amount_paid"),
    ]).then(([appointments, patients, treatments, invoices]) =>
      setCounts({
        appointments: appointments.count ?? 0,
        patients: patients.count ?? 0,
        treatments: treatments.count ?? 0,
        collections: (invoices.data ?? []).reduce(
          (sum, invoice) => sum + Number(invoice.amount_paid),
          0,
        ),
      }),
    );
  }, []);
  return (
    <div className="report-grid">
      <section className="panel report-card">
        <div className="panel-title">Appointments</div>
        <strong className="report-number">{counts.appointments}</strong>
        <span>records in database</span>
      </section>
      <section className="panel report-card">
        <div className="panel-title">Active Patients</div>
        <strong className="report-number">{counts.patients}</strong>
        <span>current patient records</span>
      </section>
      <section className="panel report-card">
        <div className="panel-title">Collections</div>
        <strong className="report-number">
          {formatCurrency(counts.collections)}
        </strong>
        <span>payments recorded</span>
      </section>
      <section className="panel report-card">
        <div className="panel-title">Treatments</div>
        <strong className="report-number">{counts.treatments}</strong>
        <span>treatment records</span>
      </section>
    </div>
  );
}

function UserManagement() {
  const [members, setMembers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingMember, setEditingMember] = useState<Profile | null>(null);
  const [form, setForm] = useState({
    auth_id: "",
    full_name: "",
    email: "",
    role: "receptionist",
    is_active: true,
  });

  const resetForm = () =>
    setForm({
      auth_id: "",
      full_name: "",
      email: "",
      role: "receptionist",
      is_active: true,
    });

  useEffect(() => {
    if (!supabase) {
      setError("Supabase is not configured.");
      setLoading(false);
      return;
    }
    supabase
      .from("profiles")
      .select("id, full_name, email, role, is_active, last_login_at")
      .order("full_name")
      .then(({ data, error: fetchError }) => {
        setMembers(data ?? []);
        setError(queryError(fetchError));
        setLoading(false);
      });
  }, []);

  const openAddUser = () => {
    setEditingMember(null);
    resetForm();
    setShowForm(true);
  };

  const openEditUser = (member: Profile) => {
    setEditingMember(member);
    setForm({
      auth_id: member.id,
      full_name: member.full_name,
      email: member.email,
      role: member.role,
      is_active: member.is_active,
    });
    setShowForm(true);
  };

  async function toggle(member: Profile) {
    if (!supabase) return;
    const { error: updateError } = await supabase
      .from("profiles")
      .update({ is_active: !member.is_active })
      .eq("id", member.id);
    if (updateError) setError(updateError.message);
    else
      setMembers((current) =>
        current.map((item) =>
          item.id === member.id
            ? { ...item, is_active: !member.is_active }
            : item,
        ),
      );
  }

  async function saveMember() {
    if (!supabase) return;

    const payload = {
      full_name: form.full_name.trim(),
      email: form.email.trim(),
      role: form.role,
      is_active: form.is_active,
    };

    if (!payload.full_name || !payload.email) return;

    if (editingMember) {
      const { error: updateError } = await supabase
        .from("profiles")
        .update(payload)
        .eq("id", editingMember.id);

      if (updateError) {
        setError(updateError.message);
        return;
      }

      setMembers((current) =>
        current.map((member) =>
          member.id === editingMember.id ? { ...member, ...payload } : member,
        ),
      );
    } else {
      const { error: insertError } = await supabase.from("profiles").insert({
        id: form.auth_id,
        ...payload,
      });

      if (insertError) {
        setError(insertError.message);
        return;
      }

      setMembers((current) => [
        {
          id: form.auth_id,
          ...payload,
          last_login_at: null,
        },
        ...current,
      ]);
    }

    setShowForm(false);
    setEditingMember(null);
    resetForm();
  }

  async function deleteMember(member: Profile) {
    if (!supabase) return;
    const confirmed = window.confirm(
      `Remove ${member.full_name} from the app? This removes their system profile only.`,
    );
    if (!confirmed) return;

    const { error: deleteError } = await supabase
      .from("profiles")
      .delete()
      .eq("id", member.id);

    if (deleteError) {
      setError(deleteError.message);
      return;
    }

    setMembers((current) => current.filter((item) => item.id !== member.id));
  }

  return (
    <section className="panel">
      <div className="panel-title">
        Staff Directory{" "}
        <button
          type="button"
          className="classic-button primary"
          onClick={openAddUser}
        >
          + Add User
        </button>
      </div>
      <div className="filter-row">
        <label>
          Search{" "}
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
        </label>
      </div>
      {error && <p className="send-error">{error}</p>}
      {loading ? (
        <div className="empty-state">Loading profiles...</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Last login</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {members
                .filter((member) =>
                  `${member.full_name} ${member.email} ${member.role}`
                    .toLowerCase()
                    .includes(filter.toLowerCase()),
                )
                .map((member) => (
                  <tr key={member.id}>
                    <td>{member.full_name}</td>
                    <td>{member.email}</td>
                    <td>{member.role}</td>
                    <td>
                      <span
                        className={`status-badge ${member.is_active ? "active" : "inactive"}`}
                      >
                        {member.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td>{member.last_login_at ?? "Never"}</td>
                    <td>
                      <div className="dialog-actions">
                        <button
                          type="button"
                          className="classic-button"
                          onClick={() => openEditUser(member)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="classic-button"
                          onClick={() => toggle(member)}
                        >
                          {member.is_active ? "Deactivate" : "Activate"}
                        </button>
                        <button
                          type="button"
                          className="classic-button"
                          onClick={() => deleteMember(member)}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          {!members.length && (
            <div className="empty-state">No staff profiles found.</div>
          )}
        </div>
      )}
      {showForm && (
        <div className="modal-backdrop">
          <section className="classic-dialog" role="dialog" aria-modal="true">
            <div className="dialog-title">
              {editingMember ? "Edit User" : "Add User"}{" "}
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  setEditingMember(null);
                  resetForm();
                }}
              >
                X
              </button>
            </div>
            <div className="dialog-body">
              {!editingMember && (
                <label>
                  Auth user UUID
                  <input
                    value={form.auth_id}
                    onChange={(event) =>
                      setForm({ ...form, auth_id: event.target.value })
                    }
                    placeholder="UUID from Supabase Auth"
                  />
                </label>
              )}
              <label>
                Full name
                <input
                  value={form.full_name}
                  onChange={(event) =>
                    setForm({ ...form, full_name: event.target.value })
                  }
                />
              </label>
              <label>
                Email
                <input
                  type="email"
                  value={form.email}
                  onChange={(event) => setForm({ ...form, email: event.target.value })}
                />
              </label>
              <label>
                Role
                <select
                  value={form.role}
                  onChange={(event) =>
                    setForm({ ...form, role: event.target.value })
                  }
                >
                  <option value="admin">Admin</option>
                  <option value="dentist">Dentist</option>
                  <option value="receptionist">Receptionist</option>
                </select>
              </label>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(event) =>
                    setForm({ ...form, is_active: event.target.checked })
                  }
                />
                Active user access
              </label>
              <div className="dialog-actions">
                <button
                  type="button"
                  className="classic-button"
                  onClick={() => {
                    setShowForm(false);
                    setEditingMember(null);
                    resetForm();
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="classic-button primary"
                  disabled={
                    (!editingMember && !form.auth_id) || !form.full_name || !form.email
                  }
                  onClick={saveMember}
                >
                  {editingMember ? "Save Changes" : "Add User"}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

function PracticeSettings() {
  const [settings, setSettings] = useState<Record<string, string>>({
    name: "",
    phone: "",
    email: "",
    address: "",
    city: "",
    state: "",
    postal_code: "",
    open: "08:00",
    close: "18:00",
    interval: "15",
  });
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!supabase) return;
    supabase
      .from("practice_settings")
      .select("*")
      .eq("id", true)
      .single()
      .then(({ data, error }) => {
        if (error) setMessage(error.message);
        if (data) {
          const hours = data.business_hours as {
            open?: string;
            close?: string;
          };
          setSettings({
            name: data.name ?? "",
            phone: data.phone ?? "",
            email: data.email ?? "",
            address: data.address ?? "",
            city: data.city ?? "",
            state: data.state ?? "",
            postal_code: data.postal_code ?? "",
            open: hours.open ?? "08:00",
            close: hours.close ?? "18:00",
            interval: String(data.appointment_interval_minutes ?? 15),
          });
        }
      });
  }, []);
  const save = async () => {
    if (!supabase) return;
    const { error } = await supabase
      .from("practice_settings")
      .upsert({
        id: true,
        name: settings.name,
        phone: settings.phone,
        email: settings.email,
        address: settings.address,
        city: settings.city,
        state: settings.state,
        postal_code: settings.postal_code,
        business_hours: { open: settings.open, close: settings.close },
        appointment_interval_minutes: Number(settings.interval),
      });
    setMessage(error?.message ?? "Practice settings saved.");
  };
  const update = (field: string, value: string) =>
    setSettings((current) => ({ ...current, [field]: value }));
  return (
    <div className="content-stack">
      <section className="panel settings-panel">
        <div className="panel-title">Practice Information</div>
        <div className="settings-form">
          {[
            ["name", "Practice name"],
            ["phone", "Phone"],
            ["email", "Email"],
            ["address", "Address"],
            ["city", "City"],
            ["state", "State"],
            ["postal_code", "Postal code"],
          ].map(([field, label]) => (
            <label key={field}>
              {label}
              <input
                value={settings[field]}
                onChange={(event) => update(field, event.target.value)}
              />
            </label>
          ))}
        </div>
      </section>
      <section className="panel settings-panel">
        <div className="panel-title">Appointment Configuration</div>
        <div className="settings-form">
          <label>
            Opening time
            <input
              type="time"
              value={settings.open}
              onChange={(event) => update("open", event.target.value)}
            />
          </label>
          <label>
            Closing time
            <input
              type="time"
              value={settings.close}
              onChange={(event) => update("close", event.target.value)}
            />
          </label>
          <label>
            Interval
            <select
              value={settings.interval}
              onChange={(event) => update("interval", event.target.value)}
            >
              <option value="15">15 minutes</option>
              <option value="30">30 minutes</option>
              <option value="60">60 minutes</option>
            </select>
          </label>
        </div>
        <div className="settings-actions">
          <button
            type="button"
            className="classic-button primary"
            onClick={save}
          >
            Save Settings
          </button>
          {message && <span className="send-success">{message}</span>}
        </div>
      </section>
    </div>
  );
}

export default App;
