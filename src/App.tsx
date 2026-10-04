import { useEffect, useMemo, useState } from "react";
import "./App.css";
import { issuePatientPortalAccess, signInWithMicrosoft, signOut, supabase } from "./lib/supabase";
import {
  checkInAppointment,
  deleteAppointment,
  getPatientVisitHistory,
  handoverAppointmentToDentist,
  listActiveProviders,
  recordInvoicePayment,
} from "./lib/workflow";
import type { PatientVisitHistory, ProviderDirectoryEntry } from "./lib/workflow";
import {
  createCalendarEvent,
  sendInvoiceEmail,
  sendPatientPortalAccessEmail,
} from "./lib/outlook";
import { WaitlistClaimWindow } from "./components/WaitlistClaimWindow";
import { PatientPortal } from "./components/PatientPortal";
import { SearchableSelect } from "./components/SearchableSelect";
import { Cases } from "./components/Cases";
import { Dashboard } from "./components/Dashboard";
import { AppointmentProgress } from "./components/AppointmentProgress";

type Page =
  | "Dashboard"
  | "Patients"
  | "Appointments"
  | "Cases"
  | "Billing"
  | "Reports"
  | "User Settings"
  | "Practice Settings";
type CaseTab = "cases" | "chart" | "history" | null;
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
type ExistingCaseOption = {
  id: string;
  case_number: string;
  title: string;
  status: string;
  updated_at: string;
};

type Appointment = {
  id: string;
  patient_id: string;
  provider_id: string | null;
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
  checked_in_at: string | null;
  handed_over_at: string | null;
  clinical_updated_at: string | null;
  treatment_completed_at: string | null;
  case_id: string | null;
};

const navItems: Page[] = [
  "Dashboard",
  "Patients",
  "Appointments",
  "Cases",
  "Billing",
  "User Settings",
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
  const [requestedCaseId, setRequestedCaseId] = useState<string | null>(null);

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

  async function checkInPatientAppointment(
    appointmentId: string,
    intake: {
      caseTitle: string;
      intakeNotes: string;
      existingCaseId: string | null;
      createNewCase: boolean;
    },
  ): Promise<boolean> {
    try {
      const appointment = await checkInAppointment(appointmentId, intake);
      setNotice(
        appointment.status === "in_progress"
          ? "Patient is already with the dentist."
          : "Patient checked in and ready for dentist handover.",
      );
      return true;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Patient check-in failed.";
      setNotice("Check-in failed");
      setError(message);
      return false;
    }
  }

  async function handoverToDentist(appointmentId: string): Promise<boolean> {
    try {
      await handoverAppointmentToDentist(appointmentId);
      setNotice("Appointment handed over to the assigned dentist.");
      return true;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Handover failed.";
      setNotice("Handover failed");
      setError(message);
      return false;
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
        <button type="button" onClick={() => navigate("User Settings")}>Tools</button>
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
              onOpenCase={(caseId) => {
                setRequestedCaseId(caseId);
                navigate("Cases");
              }}
            />
          )}
          {page === "Appointments" && (
            <Appointments
              setNotice={setNotice}
              viewerProfile={profile}
              onCheckIn={checkInPatientAppointment}
              onHandoverToDentist={handoverToDentist}
              onOpenCase={(caseId) => {
                setRequestedCaseId(caseId);
                navigate("Cases");
              }}
            />
          )}
          {page === "Cases" && (
            <Cases
              setNotice={setNotice}
              initialCaseId={requestedCaseId}
              onInitialCaseHandled={() => setRequestedCaseId(null)}
            />
          )}
          {page === "Billing" && <Billing patient={selectedPatient} />}
          {page === "Reports" && <Reports />}
          {page === "User Settings" && <UserManagement />}
          {page === "Practice Settings" && <PracticeSettings />}
        </main>
      </div>
      <footer className="status-bar">
        <span className="status-panel">{notice}</span>
      </footer>
    </div>
  );
}

function Patients({
  search,
  selected,
  setSelected,
  setNotice,
  onOpenCase,
}: {
  search: string;
  selected: Patient | null;
  setSelected: (patient: Patient | null) => void;
  setNotice: (message: string) => void;
  onOpenCase: (caseId: string) => void;
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
    case_id: string | null;
  } | null>(null);
  const [caseTab, setCaseTab] = useState<CaseTab>(null);
  useEffect(() => {
    setCaseTab(selected ? "cases" : null);
  }, [selected?.id]);
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

    Promise.all([
      supabase
        .from("appointments")
        .select(
          "id, provider_id, case_id, appointment_date, appointment_time, appointment_type, status, reason, notes",
        )
        .eq("patient_id", selected.id)
        .order("appointment_date", { ascending: true })
        .order("appointment_time", { ascending: true }),
      listActiveProviders(),
    ]).then(([appointmentResult, providers]) => {
      if (appointmentResult.error) {
        setUpcomingAppointment(null);
        return;
      }

      const activeAppointments = (appointmentResult.data ?? []).filter(
        (appointment) => !["completed", "cancelled", "no_show"].includes(appointment.status),
      );

      const next =
        activeAppointments.find((appointment) => appointment.status === "in_progress") ??
        activeAppointments.find((appointment) => appointment.status === "confirmed") ??
        activeAppointments[0] ??
        null;

      if (!next) {
        setUpcomingAppointment(null);
        return;
      }

      const provider = providers.find((candidate) => candidate.id === next.provider_id);
      setUpcomingAppointment({
        id: next.id,
        appointment_date: next.appointment_date,
        appointment_time: next.appointment_time,
        appointment_type: next.appointment_type,
        status: next.status,
        reason: next.reason,
        notes: next.notes,
        provider_name: provider?.full_name ?? null,
        case_id: next.case_id ?? null,
      });
    }).catch(() => setUpcomingAppointment(null));
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

  async function createPatientPortalAccess(patient: Patient) {
    return issuePatientPortalAccess(
      patient.id,
      new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    );
  }

  async function sendPortalLink(patient: Patient) {
    if (!patient.email) {
      setNotice("Add an email address before sending the patient portal link.");
      return;
    }

    try {
      const access = await createPatientPortalAccess(patient);
      await sendPatientPortalAccessEmail(
        patient.email,
        `${patient.first_name} ${patient.last_name}`,
        access.token,
        access.verification_code,
        import.meta.env.VITE_APP_URL || window.location.origin,
      );

      setNotice("Patient portal link and verification code sent");
    } catch (reason) {
      const message =
        reason instanceof Error
          ? reason.message
          : "Patient portal access could not be sent.";
      setError(message);
      setNotice("Portal access failed");
    }
  }

  async function copyPortalLink(patient: Patient) {
    try {
      const access = await createPatientPortalAccess(patient);
      const appUrl = import.meta.env.VITE_APP_URL || window.location.origin;
      const portalUrl = `${appUrl.replace(/\/$/, "")}/portal/${encodeURIComponent(access.token)}`;
      const accessText = `Portal link: ${portalUrl}\nVerification code: ${access.verification_code}`;

      if (!navigator.clipboard) {
        window.prompt("Copy the portal link and verification code:", accessText);
        setNotice("Portal access prepared");
        return;
      }

      await navigator.clipboard.writeText(accessText);
      setNotice("Portal link and verification code copied");
    } catch (reason) {
      const message =
        reason instanceof Error
          ? reason.message
          : "Patient portal access could not be copied.";
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
                <div className="appointment-detail-card">
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
                    {upcomingAppointment.case_id ? (
                      <button
                        type="button"
                        className="classic-button primary"
                        onClick={() => onOpenCase(upcomingAppointment.case_id!)}
                      >
                        Open Case
                      </button>
                    ) : (
                      <span className="record-chip">Case created at check-in</span>
                    )}
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
              onOpenCase={onOpenCase}
              setNotice={setNotice}
            />

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
  viewerProfile,
  onCheckIn,
  onHandoverToDentist,
  onOpenCase,
}: {
  setNotice: (message: string) => void;
  viewerProfile: Profile;
  onCheckIn: (
    appointmentId: string,
    intake: {
      caseTitle: string;
      intakeNotes: string;
      existingCaseId: string | null;
      createNewCase: boolean;
    },
  ) => Promise<boolean> | boolean;
  onHandoverToDentist: (appointmentId: string) => Promise<boolean> | boolean;
  onOpenCase: (caseId: string | null) => void;
}) {
  const [items, setItems] = useState<Appointment[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [providers, setProviders] = useState<ProviderDirectoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [selectedAppointmentId, setSelectedAppointmentId] = useState<string | null>(null);
  const [detailDraft, setDetailDraft] = useState({ reason: "", notes: "", providerId: "" });
  const [checkInTarget, setCheckInTarget] = useState<Appointment | null>(null);
  const [activePatientCases, setActivePatientCases] = useState<ExistingCaseOption[]>([]);
  const [checkInCasesLoading, setCheckInCasesLoading] = useState(false);
  const [checkInDraft, setCheckInDraft] = useState<{
    mode: "new" | "existing";
    existingCaseId: string;
    caseTitle: string;
    intakeNotes: string;
  }>({
    mode: "new",
    existingCaseId: "",
    caseTitle: "",
    intakeNotes: "",
  });
  const [appointmentView, setAppointmentView] = useState<"active" | "completed">("active");
  const [expandedActionId, setExpandedActionId] = useState<string | null>(null);
  const [workflowConfirmation, setWorkflowConfirmation] = useState<{
    title: string;
    patientName: string;
    time: string;
    detail: string;
  } | null>(null);
  const [form, setForm] = useState({ patient_id: "", provider_id: "", appointment_date: "", appointment_time: "08:00", duration_minutes: "30", appointment_type: "checkup", reason: "" });
  const activeAppointments = items.filter((item) => !["completed", "cancelled", "no_show"].includes(item.status));
  const completedAppointments = items.filter((item) => item.status === "completed");
  useEffect(() => {
    if (!supabase) return;
    Promise.all([
      supabase
        .from("patients")
        .select("id, patient_number, first_name, last_name, date_of_birth, phone, email, is_active, allergies")
        .eq("is_active", true)
        .order("last_name"),
      listActiveProviders(),
      supabase
        .from("appointments")
        .select(
          "id, patient_id, provider_id, appointment_date, appointment_time, duration_minutes, appointment_type, status, reason, notes, outlook_event_id, checked_in_at, handed_over_at, clinical_updated_at, treatment_completed_at, case_id, patients(first_name, last_name)",
        )
        .order("appointment_date")
        .order("appointment_time"),
    ])
      .then(([patientResult, providerRows, appointmentResult]) => {
        setPatients(patientResult.data ?? []);
        setProviders(providerRows);
        if (patientResult.error) setMessage(patientResult.error.message);
        if (appointmentResult.error) setMessage(appointmentResult.error.message);

        setItems(
          (appointmentResult.data ?? []).map((item) => {
            const patient = item.patients as unknown as {
              first_name: string;
              last_name: string;
            } | null;
            const provider = providerRows.find((candidate) => candidate.id === item.provider_id);
            return {
              ...item,
              provider_id: item.provider_id ?? null,
              patient_name: patient
                ? `${patient.first_name} ${patient.last_name}`
                : "Unknown patient",
              provider_name: provider?.full_name ?? "Unassigned",
              notes: item.notes ?? null,
            } satisfies Appointment;
          }),
        );
        setLoading(false);
      })
      .catch((reason) => {
        setMessage(reason instanceof Error ? reason.message : "Appointments could not be loaded.");
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    const client = supabase;
    if (!client) return;

    const channel = client
      .channel(`appointments-workflow-${viewerProfile.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "appointments",
        },
        (payload) => {
          const changed = payload.new as Partial<Appointment> & {
            id?: string;
            provider_id?: string | null;
          };

          if (!changed.id) return;

          setItems((current) =>
            current.map((appointment) => {
              if (appointment.id !== changed.id) return appointment;

              const providerId =
                changed.provider_id === undefined
                  ? appointment.provider_id
                  : changed.provider_id;

              return {
                ...appointment,
                ...changed,
                patient_name: appointment.patient_name,
                provider_name:
                  providers.find((provider) => provider.id === providerId)?.full_name ??
                  appointment.provider_name,
              };
            }),
          );
        },
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "appointments",
        },
        (payload) => {
          const deleted = payload.old as { id?: string };
          if (!deleted.id) return;

          setItems((current) =>
            current.filter((appointment) => appointment.id !== deleted.id),
          );
          setSelectedAppointmentId((current) =>
            current === deleted.id ? null : current,
          );
          setExpandedActionId((current) =>
            current === deleted.id ? null : current,
          );
        },
      )
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, [providers, viewerProfile.id]);

  async function addAppointment() {
    if (!supabase || !form.patient_id || !form.provider_id || !form.appointment_date) return;
    const { data: auth } = await supabase.auth.getUser();
    const { data, error: insertError } = await supabase
      .from("appointments")
      .insert({
        ...form,
        duration_minutes: Number(form.duration_minutes),
        provider_id: form.provider_id,
        created_by: auth.user?.id,
      })
      .select("id, patient_id, provider_id, appointment_date, appointment_time, duration_minutes, appointment_type, status, reason, notes, outlook_event_id, checked_in_at, handed_over_at, clinical_updated_at, treatment_completed_at, case_id, patients(first_name, last_name)")
      .single();

    if (insertError) {
      setMessage(insertError.message);
      return;
    }

    if (data) {
      const patient = data.patients as unknown as { first_name: string; last_name: string } | null;
      const provider = providers.find((candidate) => candidate.id === data.provider_id);
      setItems((current) => [{
        ...data,
        provider_id: data.provider_id ?? null,
        patient_name: patient ? `${patient.first_name} ${patient.last_name}` : "Unknown patient",
        provider_name: provider?.full_name ?? "Unassigned",
        notes: data.notes ?? null,
      } as Appointment, ...current]);
      setShowForm(false);
      setNotice("Appointment saved to Supabase");
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

  const selectedAppointment = items.find((item) => item.id === selectedAppointmentId) ?? null;

  async function runCheckIn(item: Appointment) {
    setCheckInTarget(item);
    setCheckInCasesLoading(true);
    setCheckInDraft({
      mode: "new",
      existingCaseId: "",
      caseTitle: item.reason ?? `${item.appointment_type} case`,
      intakeNotes: item.notes ?? "",
    });

    if (!supabase) {
      setActivePatientCases([]);
      setCheckInCasesLoading(false);
      return;
    }

    const { data, error: caseError } = await supabase
      .from("cases")
      .select("id, case_number, title, status, updated_at")
      .eq("patient_id", item.patient_id)
      .in("status", ["open", "in_treatment", "awaiting_payment"])
      .order("updated_at", { ascending: false });

    if (caseError) {
      setMessage(caseError.message);
      setActivePatientCases([]);
    } else {
      const options = (data ?? []) as ExistingCaseOption[];
      setActivePatientCases(options);
      if (options.length) {
        setCheckInDraft((current) => ({
          ...current,
          mode: "existing",
          existingCaseId: options[0].id,
        }));
      }
    }

    setCheckInCasesLoading(false);
  }

  async function confirmCheckIn() {
    if (!checkInTarget) return;

    const item = checkInTarget;

    if (checkInDraft.mode === "existing" && !checkInDraft.existingCaseId) {
      setMessage("Select an existing case or choose Create new case.");
      return;
    }

    const checkedIn = await onCheckIn(item.id, {
      caseTitle: checkInDraft.caseTitle,
      intakeNotes: checkInDraft.intakeNotes,
      existingCaseId:
        checkInDraft.mode === "existing" ? checkInDraft.existingCaseId : null,
      createNewCase: checkInDraft.mode === "new",
    });
    if (!checkedIn) return;

    const actionTime = new Date().toISOString();
    setItems((current) =>
      current.map((appointment) =>
        appointment.id === item.id
          ? {
              ...appointment,
              status: "confirmed",
              checked_in_at: appointment.checked_in_at ?? actionTime,
              reason: checkInDraft.caseTitle.trim() || appointment.reason,
              notes: checkInDraft.intakeNotes.trim() || appointment.notes,
            }
          : appointment,
      ),
    );
    setCheckInTarget(null);
    setWorkflowConfirmation({
      title: "Patient checked in · Case ready",
      patientName: item.patient_name,
      time: actionTime,
      detail:
        checkInDraft.mode === "existing"
          ? `The appointment was linked to the selected existing case. Next step: hand it over to ${item.provider_name}.`
          : `A new case was created for this visit. Next step: hand it over to ${item.provider_name}.`,
    });
  }

  async function runHandover(item: Appointment) {
    const handedOver = await onHandoverToDentist(item.id);
    if (!handedOver) return;

    const actionTime = new Date().toISOString();
    setItems((current) =>
      current.map((appointment) =>
        appointment.id === item.id
          ? {
              ...appointment,
              status: "in_progress",
              handed_over_at: appointment.handed_over_at ?? actionTime,
            }
          : appointment,
      ),
    );
    setWorkflowConfirmation({
      title: "Handover complete",
      patientName: item.patient_name,
      time: actionTime,
      detail: `The case is now assigned to ${item.provider_name} and available in Cases.`,
    });
  }

  const canDeleteAppointment = (item: Appointment) =>
    (viewerProfile.role === "admin" || viewerProfile.role === "receptionist") &&
    ["scheduled", "booked", "open"].includes(item.status) &&
    !item.checked_in_at &&
    !item.handed_over_at &&
    !item.clinical_updated_at &&
    !item.treatment_completed_at;

  async function runDeleteAppointment(item: Appointment) {
    const outlookWarning = item.outlook_event_id
      ? "\n\nThis appointment is synced to Outlook. Deleting it from Sponty does not automatically remove the Outlook calendar event."
      : "";

    const confirmed = window.confirm(
      `Permanently delete the appointment for ${item.patient_name} on ${item.appointment_date} at ${item.appointment_time}?\n\nThis action cannot be undone.${outlookWarning}`,
    );

    if (!confirmed) return;

    try {
      await deleteAppointment(item.id);
      setItems((current) =>
        current.filter((appointment) => appointment.id !== item.id),
      );
      setExpandedActionId((current) => (current === item.id ? null : current));
      setSelectedAppointmentId((current) => (current === item.id ? null : current));
      setMessage("");
      setNotice(
        item.outlook_event_id
          ? "Appointment deleted from Sponty. Check Outlook if the synced calendar event also needs to be removed."
          : "Appointment deleted.",
      );
    } catch (reason) {
      const rawMessage =
        reason instanceof Error ? reason.message : "Appointment could not be deleted.";

      if (
        rawMessage.includes("appointment_has_linked_records") ||
        rawMessage.includes("appointment_has_workflow_history")
      ) {
        setMessage(
          "This appointment has clinical, treatment, billing, or workflow history and cannot be permanently deleted.",
        );
      } else if (
        rawMessage.includes("appointment_cannot_be_deleted_after_check_in_or_completion")
      ) {
        setMessage(
          "Only appointments that have not been checked in can be permanently deleted.",
        );
      } else if (rawMessage.includes("receptionist_or_admin_required")) {
        setMessage("Only a receptionist or administrator can delete appointments.");
      } else {
        setMessage(rawMessage);
      }
    }
  }

  async function saveAppointmentDetails() {
    if (!supabase || !selectedAppointmentId) return;

    const reason = detailDraft.reason.trim();
    const notes = detailDraft.notes.trim();
    const providerId = detailDraft.providerId || null;

    const { error } = await supabase
      .from("appointments")
      .update({
        reason: reason || null,
        notes: notes || null,
        provider_id: providerId,
      })
      .eq("id", selectedAppointmentId);

    if (error) {
      setMessage(error.message);
      return;
    }

    const providerName = providers.find((candidate) => candidate.id === providerId)?.full_name ?? "Unassigned";
    setItems((current) =>
      current.map((appointment) =>
        appointment.id === selectedAppointmentId
          ? {
              ...appointment,
              reason: reason || null,
              notes: notes || null,
              provider_id: providerId,
              provider_name: providerName,
            }
          : appointment,
      ),
    );
    setSelectedAppointmentId(null);
    setDetailDraft({ reason: "", notes: "", providerId: "" });
    setNotice("Appointment details saved");
  }

  return (
    <section className="panel">
      <div className="panel-title">Appointment Calendar <button type="button" className="classic-button primary" onClick={() => setShowForm(true)}>+ New Appointment</button></div>
      {message && <p className="send-error">{message}</p>}
      {loading ? (
        <div className="empty-state">Loading appointments...</div>
      ) : (
        <div className="appointment-list">
          <div className="appointment-tab-strip tab-strip">
            <button
              type="button"
              className={appointmentView === "active" ? "tab active" : "tab"}
              onClick={() => setAppointmentView("active")}
            >
              Active
            </button>
            <button
              type="button"
              className={appointmentView === "completed" ? "tab active" : "tab"}
              onClick={() => setAppointmentView("completed")}
            >
              Completed
            </button>
          </div>

          <div className="appointment-section">
            {appointmentView === "active" ? (
              <>
                <h3>Active appointments</h3>
                                {activeAppointments.map((item) => (
                  <div
                    className="appointment-row"
                    key={item.id}
                  >
                    <time>
                      {item.appointment_date} {item.appointment_time}
                    </time>
                    <div className="appointment-block">
                      <strong>{item.patient_name}</strong>
                      <span>
                        {item.appointment_type} with {item.provider_name}
                      </span>

                      <AppointmentProgress
                        status={item.status}
                        checkedInAt={item.checked_in_at}
                        handedOverAt={item.handed_over_at}
                        treatmentCompletedAt={item.treatment_completed_at}
                      />
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
                    <div className="appointment-action-group">
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
                        className="classic-button"
                        onClick={() => {
                          setSelectedAppointmentId(item.id);
                          setDetailDraft({ reason: item.reason ?? "", notes: item.notes ?? "", providerId: item.provider_id ?? "" });
                        }}
                      >
                        Open
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
                    </div>
                    {expandedActionId === item.id && (
                      <div className="appointment-clinic-actions">
                        <button
                          type="button"
                          className="classic-button"
                          onClick={() => void runCheckIn(item)}
                          disabled={!['scheduled', 'booked'].includes(item.status)}
                        >
                          {item.status === "confirmed" || item.status === "in_progress" ? "Checked in" : "Check in"}
                        </button>
                        <button
                          type="button"
                          className="classic-button"
                          onClick={() => void runHandover(item)}
                          disabled={item.status !== "confirmed"}
                        >
                          Handover to dentist
                        </button>
                        <button
                          type="button"
                          className="classic-button primary"
                          onClick={() => onOpenCase(item.case_id)}
                          disabled={!item.case_id}
                        >
                          Open Case
                        </button>
                        {canDeleteAppointment(item) && (
                          <button
                            type="button"
                            className="classic-button danger"
                            onClick={() => void runDeleteAppointment(item)}
                          >
                            Delete appointment
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
                {!activeAppointments.length && <div className="empty-state">No active appointments.</div>}
              </>
            ) : (
              <>
                <h3>Completed appointments</h3>
                {completedAppointments.length ? completedAppointments.map((item) => (
                  <div className="appointment-row appointment-row-completed" key={item.id}>
                    <time>
                      {item.appointment_date} {item.appointment_time}
                    </time>
                    <div className="appointment-block">
                      <strong>{item.patient_name}</strong>
                      <span>
                        {item.appointment_type} with {item.provider_name}
                      </span>

                      <AppointmentProgress
                        status={item.status}
                        checkedInAt={item.checked_in_at}
                        handedOverAt={item.handed_over_at}
                        treatmentCompletedAt={item.treatment_completed_at}
                      />
                    </div>
                    <span className={`status-badge ${item.status}`}>
                      {item.status}
                    </span>
                    <span className="calendar-sync synced">Invoice generated</span>
                    <div className="appointment-action-group">
                      <button
                        type="button"
                        className="classic-button"
                        onClick={() => {
                          setSelectedAppointmentId(item.id);
                          setDetailDraft({ reason: item.reason ?? "", notes: item.notes ?? "", providerId: item.provider_id ?? "" });
                        }}
                      >
                        Open
                      </button>
                    </div>
                  </div>
                )) : <div className="empty-state">No completed appointments.</div>}
              </>
            )}
          </div>
        </div>
      )}
      {!loading && !items.length && <div className="empty-state">No appointments found. Use <strong>+ New Appointment</strong> to schedule the first visit.</div>}

      {checkInTarget && (
        <div className="modal-backdrop">
          <section className="classic-dialog check-in-case-dialog" role="dialog" aria-modal="true">
            <div className="dialog-title">
              Check In &amp; Select Case
              <button type="button" onClick={() => setCheckInTarget(null)}>X</button>
            </div>
            <div className="dialog-body">
              <p className="dialog-intro">
                Check in {checkInTarget.patient_name}, then either continue an existing active case or create a separate new case for this visit.
              </p>

              {checkInCasesLoading ? (
                <div className="empty-state">Checking active cases...</div>
              ) : (
                <div className="case-choice-list">
                  {activePatientCases.length > 0 && (
                    <label className="case-choice-option">
                      <input
                        type="radio"
                        name="check-in-case-mode"
                        checked={checkInDraft.mode === "existing"}
                        onChange={() =>
                          setCheckInDraft((current) => ({
                            ...current,
                            mode: "existing",
                            existingCaseId:
                              current.existingCaseId || activePatientCases[0]?.id || "",
                          }))
                        }
                      />
                      <span>
                        <strong>Continue an existing case</strong>
                        <small>Use this when the appointment is another visit for ongoing treatment.</small>
                      </span>
                    </label>
                  )}

                  {checkInDraft.mode === "existing" && activePatientCases.length > 0 && (
                    <label>
                      Existing case
                      <select
                        value={checkInDraft.existingCaseId}
                        onChange={(event) =>
                          setCheckInDraft((current) => ({
                            ...current,
                            existingCaseId: event.target.value,
                          }))
                        }
                      >
                        {activePatientCases.map((caseOption) => (
                          <option key={caseOption.id} value={caseOption.id}>
                            {caseOption.case_number} · {caseOption.title} · {caseOption.status.replace("_", " ")}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}

                  <label className="case-choice-option">
                    <input
                      type="radio"
                      name="check-in-case-mode"
                      checked={checkInDraft.mode === "new"}
                      onChange={() =>
                        setCheckInDraft((current) => ({
                          ...current,
                          mode: "new",
                          existingCaseId: "",
                        }))
                      }
                    />
                    <span>
                      <strong>Create a new case</strong>
                      <small>Use this when the patient is being seen for a separate dental issue or course of treatment.</small>
                    </span>
                  </label>
                </div>
              )}

              {checkInDraft.mode === "new" && (
                <label>
                  New case title / reason
                  <input
                    value={checkInDraft.caseTitle}
                    onChange={(event) =>
                      setCheckInDraft((current) => ({
                        ...current,
                        caseTitle: event.target.value,
                      }))
                    }
                    placeholder="e.g. Upper right tooth pain"
                  />
                </label>
              )}

              <label>
                Reception intake notes
                <textarea
                  value={checkInDraft.intakeNotes}
                  onChange={(event) =>
                    setCheckInDraft((current) => ({
                      ...current,
                      intakeNotes: event.target.value,
                    }))
                  }
                  placeholder="Basic symptoms, arrival notes, or information for the dentist"
                />
              </label>

              <div className="dialog-actions">
                <button
                  type="button"
                  className="classic-button"
                  onClick={() => setCheckInTarget(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="classic-button primary"
                  disabled={
                    checkInCasesLoading ||
                    (checkInDraft.mode === "new" && !checkInDraft.caseTitle.trim()) ||
                    (checkInDraft.mode === "existing" && !checkInDraft.existingCaseId)
                  }
                  onClick={() => void confirmCheckIn()}
                >
                  Check In
                </button>
              </div>
            </div>
          </section>
        </div>
      )}

      {workflowConfirmation && (
        <div className="modal-backdrop workflow-confirmation-backdrop">
          <section className="classic-dialog workflow-confirmation-dialog" role="dialog" aria-modal="true">
            <div className="dialog-title">
              {workflowConfirmation.title}
              <button type="button" onClick={() => setWorkflowConfirmation(null)}>X</button>
            </div>
            <div className="dialog-body">
              <div className="workflow-confirmation-icon">✓</div>
              <div className="workflow-confirmation-copy">
                <h3>{workflowConfirmation.patientName}</h3>
                <p>
                  <strong>Time:</strong>{" "}
                  {new Date(workflowConfirmation.time).toLocaleString()}
                </p>
                <p>{workflowConfirmation.detail}</p>
              </div>
              <div className="dialog-actions workflow-confirmation-actions">
                <button
                  type="button"
                  className="classic-button primary"
                  onClick={() => setWorkflowConfirmation(null)}
                >
                  OK
                </button>
              </div>
            </div>
          </section>
        </div>
      )}

      {selectedAppointment && (
        <div className="modal-backdrop">
          <section className="classic-dialog" role="dialog" aria-modal="true">
            <div className="dialog-title">
              {selectedAppointment.patient_name}
              <button type="button" onClick={() => setSelectedAppointmentId(null)}>X</button>
            </div>
            <div className="dialog-body appointment-detail-body">
              <div className="appointment-detail-meta">
                <span>{selectedAppointment.appointment_date}</span>
                <span>{selectedAppointment.appointment_time}</span>
                <span>{selectedAppointment.appointment_type}</span>
              </div>

              <div className="appointment-workflow-card">
                <strong>Visit workflow</strong>
                <AppointmentProgress
                  status={selectedAppointment.status}
                  checkedInAt={selectedAppointment.checked_in_at}
                  handedOverAt={selectedAppointment.handed_over_at}
                  treatmentCompletedAt={selectedAppointment.treatment_completed_at}
                />
                {selectedAppointment.checked_in_at && (
                  <small>Checked in: {new Date(selectedAppointment.checked_in_at).toLocaleString()}</small>
                )}
                {selectedAppointment.handed_over_at && (
                  <small>Handed over: {new Date(selectedAppointment.handed_over_at).toLocaleString()}</small>
                )}
              </div>

              <div className="appointment-session-panel">
                <h3>Case workflow</h3>
                <p className="dialog-intro">
                  Check-in creates or links the patient case. Handover assigns that case to the selected dentist. Clinical notes and treatments are completed from Cases.
                </p>
                <div className="appointment-session-actions">
                  <button
                    type="button"
                    className="classic-button"
                    onClick={() => runCheckIn(selectedAppointment)}
                    disabled={!['scheduled', 'booked'].includes(selectedAppointment.status)}
                  >
                    {selectedAppointment.status === "confirmed" || selectedAppointment.status === "in_progress" ? "Checked in" : "Check in / create case"}
                  </button>
                  <button
                    type="button"
                    className="classic-button"
                    onClick={() => void runHandover(selectedAppointment)}
                    disabled={selectedAppointment.status !== "confirmed"}
                  >
                    Handover to dentist
                  </button>
                  <button
                    type="button"
                    className="classic-button primary"
                    onClick={() => onOpenCase(selectedAppointment.case_id)}
                    disabled={!selectedAppointment.case_id}
                  >
                    Open Case
                  </button>
                </div>
              </div>

              <label>
                Assigned dentist
                <select
                  value={detailDraft.providerId}
                  onChange={(event) =>
                    setDetailDraft((current) => ({ ...current, providerId: event.target.value }))
                  }
                >
                  <option value="">Select dentist</option>
                  {providers.map((provider) => (
                    <option key={provider.id} value={provider.id}>{provider.full_name}</option>
                  ))}
                </select>
              </label>

              <label>
                Chief complaint
                <input
                  value={detailDraft.reason}
                  onChange={(event) =>
                    setDetailDraft((current) => ({ ...current, reason: event.target.value }))
                  }
                  placeholder="e.g. Tooth pain on upper right molar"
                />
              </label>
              <label>
                Assistant notes
                <textarea
                  value={detailDraft.notes}
                  onChange={(event) =>
                    setDetailDraft((current) => ({ ...current, notes: event.target.value }))
                  }
                  placeholder="Add clinical observations, symptoms, or follow-up notes"
                />
              </label>

              <div className="dialog-actions">
                {canDeleteAppointment(selectedAppointment) && (
                  <button
                    type="button"
                    className="classic-button danger"
                    onClick={() => void runDeleteAppointment(selectedAppointment)}
                  >
                    Delete appointment
                  </button>
                )}
                <button type="button" className="classic-button" onClick={() => setSelectedAppointmentId(null)}>
                  Close
                </button>
                <button type="button" className="classic-button primary" onClick={saveAppointmentDetails}>
                  Save details
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
      {showForm && <div className="modal-backdrop"><section className="classic-dialog" role="dialog" aria-modal="true"><div className="dialog-title">New Appointment <button type="button" onClick={() => setShowForm(false)}>X</button></div><div className="dialog-body"><label>
  Patient
  <SearchableSelect
    value={form.patient_id}
    onChange={(patientId) => setForm({ ...form, patient_id: patientId })}
    placeholder="Select patient"
    searchPlaceholder="Search patient name or number..."
    emptyMessage="No patients match your search."
    options={patients.map((patient) => ({
      value: patient.id,
      label: `${patient.first_name} ${patient.last_name}`,
      description: patient.patient_number,
      searchText: `${patient.patient_number} ${patient.first_name} ${patient.last_name} ${patient.phone ?? ""} ${patient.email ?? ""}`,
    }))}
  />
</label><label>Dentist<select value={form.provider_id} onChange={(event) => setForm({ ...form, provider_id: event.target.value })}><option value="">Select dentist</option>{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.full_name}</option>)}</select></label><label>Date<input type="date" value={form.appointment_date} onChange={(event) => setForm({ ...form, appointment_date: event.target.value })} /></label><label>Time<input type="time" value={form.appointment_time} onChange={(event) => setForm({ ...form, appointment_time: event.target.value })} /></label><label>Duration<select value={form.duration_minutes} onChange={(event) => setForm({ ...form, duration_minutes: event.target.value })}><option value="30">30 minutes</option><option value="45">45 minutes</option><option value="60">60 minutes</option></select></label><label>Appointment type<select value={form.appointment_type} onChange={(event) => setForm({ ...form, appointment_type: event.target.value })}><option value="checkup">Checkup</option><option value="cleaning">Cleaning</option><option value="filling">Filling</option><option value="extraction">Extraction</option><option value="consultation">Consultation</option><option value="emergency">Emergency</option></select></label><label>Reason<input value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} /></label><div className="dialog-actions"><button type="button" className="classic-button" onClick={() => setShowForm(false)}>Cancel</button><button type="button" className="classic-button primary" disabled={!form.patient_id || !form.provider_id || !form.appointment_date} onClick={addAppointment}>Save Appointment</button></div></div></section></div>}
    </section>
  );
}

function PatientCaseWorkspace({
  patient,
  caseTab,
  setCaseTab,
  onOpenCase,
  setNotice,
}: {
  patient: Patient | null;
  caseTab: CaseTab;
  setCaseTab: (value: CaseTab) => void;
  onOpenCase: (caseId: string) => void;
  setNotice: (message: string) => void;
}) {
  const [visitHistory, setVisitHistory] = useState<PatientVisitHistory[]>([]);
  const [patientCases, setPatientCases] = useState<
    Array<{
      id: string;
      case_number: string;
      title: string;
      status: string;
      billing_status: string;
      priority: string;
      assigned_provider_id: string | null;
      assigned_provider_name: string;
      last_activity_at: string;
    }>
  >([]);
  const [selectedHistoryAppointmentId, setSelectedHistoryAppointmentId] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState("");

  useEffect(() => {
    if (!patient || !supabase) {
      setVisitHistory([]);
      setPatientCases([]);
      setSelectedHistoryAppointmentId(null);
      return;
    }

    Promise.all([
      getPatientVisitHistory(patient.id),
      supabase
        .from("cases")
        .select(
          "id, case_number, title, status, billing_status, priority, assigned_provider_id, last_activity_at",
        )
        .eq("patient_id", patient.id)
        .order("last_activity_at", { ascending: false }),
      listActiveProviders(),
    ])
      .then(([history, caseResult, providers]) => {
        if (caseResult.error) throw new Error(caseResult.error.message);

        setVisitHistory(history);
        setHistoryError("");
        setSelectedHistoryAppointmentId((currentSelection) => {
          if (!history.length) return null;
          if (
            currentSelection &&
            history.some((item) => item.appointment_id === currentSelection)
          ) {
            return currentSelection;
          }
          return history[0].appointment_id;
        });

        setPatientCases(
          (caseResult.data ?? []).map((item) => ({
            ...item,
            assigned_provider_name:
              providers.find((provider) => provider.id === item.assigned_provider_id)
                ?.full_name ?? "Unassigned",
          })),
        );
      })
      .catch((reason) => {
        setVisitHistory([]);
        setPatientCases([]);
        setHistoryError(
          reason instanceof Error
            ? reason.message
            : "Patient history could not be loaded.",
        );
      });
  }, [patient]);

  return (
    <section className="panel patient-case-workspace">
      <div className="panel-title">
        <span>Patient Record</span>
        <span className="panel-title-hint">
          {patient ? `${patient.first_name} ${patient.last_name}` : "No patient selected"}
        </span>
      </div>

      <div className="tab-strip">
        {[
          { id: "cases", label: "Cases" },
          { id: "history", label: "Visit History" },
          { id: "chart", label: "Dental Chart" },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={caseTab === tab.id ? "tab active" : "tab"}
            onClick={() => setCaseTab(tab.id as Exclude<CaseTab, null>)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {caseTab === "cases" ? (
        <div className="patient-case-body">
          <div className="patient-case-list">
            {patientCases.map((item) => (
              <button
                type="button"
                key={item.id}
                className="patient-case-card"
                onClick={() => onOpenCase(item.id)}
              >
                <span className="patient-case-card-heading">
                  <strong>{item.case_number}</strong>
                  <span className={`case-priority priority-${item.priority}`}>
                    {item.priority}
                  </span>
                </span>
                <strong>{item.title}</strong>
                <span>
                  Clinical: {item.status.replaceAll("_", " ")} · Billing:{" "}
                  {item.billing_status.replaceAll("_", " ")}
                </span>
                <small>
                  {item.assigned_provider_name} · Last activity{" "}
                  {new Date(item.last_activity_at).toLocaleString()}
                </small>
              </button>
            ))}

            {!patientCases.length && (
              <div className="empty-state">
                No cases for this patient yet. A case is created during check-in.
              </div>
            )}
          </div>
        </div>
      ) : caseTab === "history" ? (
        <div className="patient-case-body">
          {historyError && <p className="send-error">{historyError}</p>}
          {(() => {
            const selectedVisit =
              visitHistory.find(
                (entry) => entry.appointment_id === selectedHistoryAppointmentId,
              ) ??
              visitHistory[0] ??
              null;

            return (
              <div className="case-columns">
                <div className="case-column">
                  <h3>Visit history</h3>
                  {visitHistory.length ? (
                    visitHistory.map((entry) => (
                      <button
                        key={entry.appointment_id}
                        type="button"
                        className={
                          selectedVisit?.appointment_id === entry.appointment_id
                            ? "history-selector active"
                            : "history-selector"
                        }
                        onClick={() =>
                          setSelectedHistoryAppointmentId(entry.appointment_id)
                        }
                      >
                        <div className="history-selector-header">
                          <strong>{entry.appointment_date}</strong>
                          <span>{entry.appointment_type}</span>
                        </div>
                        <small>
                          {entry.appointment_time} ·{" "}
                          {appointmentStatusLabel(entry.appointment_status)}
                        </small>
                        <p>{entry.reason || "No chief complaint recorded."}</p>
                      </button>
                    ))
                  ) : (
                    <div className="empty-state">
                      No appointment history saved for this patient yet.
                    </div>
                  )}
                </div>

                <div className="case-column">
                  {selectedVisit ? (
                    <>
                      <h3>
                        {selectedVisit.appointment_date} ·{" "}
                        {selectedVisit.appointment_time}
                      </h3>
                      <div className="case-note">
                        <div className="note-meta">
                          <strong>Appointment</strong>
                          <span>{selectedVisit.appointment_type}</span>
                        </div>
                        <p>
                          <strong>Status:</strong>{" "}
                          {appointmentStatusLabel(selectedVisit.appointment_status)}
                        </p>
                        <p>
                          <strong>Dentist:</strong>{" "}
                          {selectedVisit.provider_name ?? "Unassigned"}
                        </p>
                      </div>

                      <div className="case-note">
                        <div className="note-meta">
                          <strong>Reason for visit</strong>
                        </div>
                        <p>
                          {selectedVisit.reason || "No chief complaint recorded."}
                        </p>
                      </div>

                      <div className="case-note">
                        <div className="note-meta">
                          <strong>Treatments / procedures</strong>
                          <span>{selectedVisit.treatments.length}</span>
                        </div>
                        {selectedVisit.treatments.length ? (
                          selectedVisit.treatments.map((treatment) => (
                            <p key={treatment.id}>
                              <strong>{treatment.procedure_name}</strong>
                              {treatment.tooth_number
                                ? ` · Tooth ${treatment.tooth_number}`
                                : ""}
                              {` · ${formatCurrency(Number(treatment.cost))} · ${treatment.status}`}
                            </p>
                          ))
                        ) : (
                          <p>No treatment details are available for this visit.</p>
                        )}
                      </div>

                      <div className="case-note">
                        <div className="note-meta">
                          <strong>Clinical notes</strong>
                          <span>{selectedVisit.clinical_notes.length}</span>
                        </div>
                        {selectedVisit.clinical_notes.length ? (
                          selectedVisit.clinical_notes.map((note) => (
                            <div key={note.id}>
                              <p>
                                <strong>{note.visit_type}</strong> · {note.note_date}
                              </p>
                              {note.subjective && (
                                <p>
                                  <strong>Subjective:</strong> {note.subjective}
                                </p>
                              )}
                              {note.assessment && (
                                <p>
                                  <strong>Assessment:</strong> {note.assessment}
                                </p>
                              )}
                              {note.plan && (
                                <p><strong>Plan:</strong> {note.plan}</p>
                              )}
                            </div>
                          ))
                        ) : (
                          <p>No clinical notes are available for this visit.</p>
                        )}
                      </div>

                      <div className="case-note">
                        <div className="note-meta">
                          <strong>Billing</strong>
                          <span>
                            {selectedVisit.invoice?.status ?? "No invoice"}
                          </span>
                        </div>
                        {selectedVisit.invoice ? (
                          <>
                            <p><strong>{selectedVisit.invoice.invoice_number}</strong></p>
                            <p>
                              Total:{" "}
                              {formatCurrency(Number(selectedVisit.invoice.total))}
                            </p>
                            <p>
                              Paid:{" "}
                              {formatCurrency(Number(selectedVisit.invoice.amount_paid))}
                            </p>
                            <p>
                              Balance:{" "}
                              {formatCurrency(Number(selectedVisit.invoice.balance))}
                            </p>
                          </>
                        ) : (
                          <p>No invoice is linked to this appointment.</p>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="empty-state">
                      Select an appointment to view the connected visit history.
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      ) : caseTab === "chart" ? (
        <div className="patient-case-body">
          <DentalChart patient={patient} setNotice={setNotice} />
        </div>
      ) : (
        <div className="patient-case-body">
          <div className="empty-state">Select a patient record view.</div>
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
      patient_id: string;
      case_id: string | null;
      case_number: string;
      patient: string;
      email: string;
    }>
  >([]);
  const [patientOptions, setPatientOptions] = useState<Patient[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState<string>(patient?.id ?? "");
  const [emailInvoice, setEmailInvoice] = useState<
    (typeof items)[number] | null
  >(null);
  const [paymentInvoice, setPaymentInvoice] = useState<
    (typeof items)[number] | null
  >(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [message, setMessage] = useState("");
  const [invoiceView, setInvoiceView] = useState<"pending" | "paid">("pending");

  const activePatient =
    patientOptions.find((option) => option.id === selectedPatientId) ?? patient ?? null;
  const filteredByPatient = activePatient
    ? items.filter((item) => item.patient_id === activePatient.id)
    : items;
  const pendingInvoices = filteredByPatient.filter((item) => item.status !== "paid");
  const paidInvoices = filteredByPatient.filter((item) => item.status === "paid");
  const visibleInvoices = invoiceView === "pending" ? pendingInvoices : paidInvoices;

  const renderInvoiceRows = (rows: typeof items) =>
    rows.map((item) => (
      <tr key={item.id}>
        <td>{item.invoice_number}</td>
        <td>{item.patient}</td>
        <td>{item.case_number}</td>
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
              onClick={() => setEmailInvoice(item)}
            >
              {item.status === "paid" ? "Receipt" : "Email"}
            </button>
            <button
              type="button"
              className="classic-button"
              onClick={() => setPaymentInvoice(item)}
            >
              Payment
            </button>
          </div>
        </td>
      </tr>
    ));

  useEffect(() => {
    if (!supabase) return;
    supabase
      .from("patients")
      .select("id, patient_number, first_name, last_name, date_of_birth, phone, email, is_active, allergies")
      .eq("is_active", true)
      .order("last_name")
      .then(({ data }) => {
        const nextPatients = data ?? [];
        setPatientOptions(nextPatients);
        if (patient && !selectedPatientId) setSelectedPatientId(patient.id);
        if (patient && !nextPatients.some((option) => option.id === patient.id)) {
          setSelectedPatientId(patient.id);
        }
      });
  }, [patient, selectedPatientId]);

  function refreshInvoiceList() {
    if (!supabase) return;
    supabase
      .from("invoices")
      .select(
        "id, patient_id, case_id, invoice_number, invoice_date, total, amount_paid, balance, status, patients(first_name, last_name, email), cases(case_number)",
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
            const caseData = item.cases as unknown as {
              case_number: string;
            } | null;
            return {
              ...item,
              patient_id: item.patient_id,
              case_id: item.case_id ?? null,
              case_number: caseData?.case_number ?? "-",
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
        kind: emailInvoice.status === "paid" ? "receipt" : "invoice",
      });
      setMessage("Invoice sent from your Outlook mailbox.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Invoice email failed.",
      );
    }
  }

  async function recordPayment() {
    if (!paymentInvoice || !paymentAmount) return;

    const amount = Number(paymentAmount);
    if (Number.isNaN(amount) || amount <= 0) {
      setMessage("Enter a valid payment amount.");
      return;
    }

    try {
      const result = await recordInvoicePayment(paymentInvoice.id, amount);
      setPaymentInvoice(null);
      setPaymentAmount("");
      setMessage(
        result.case_billing_status
          ? `Payment recorded. Case billing is now ${result.case_billing_status.replaceAll("_", " ")}. Clinical status is unchanged.`
          : "Payment recorded.",
      );
      refreshInvoiceList();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Payment could not be recorded.");
    }
  }

  return (
    <section className="panel billing-workspace">
      <div className="panel-title">
        <span>Billing</span>
        <span className="panel-title-hint">Invoices are generated from completed Case visits</span>
      </div>
      <div className="billing-summary-strip">
        <div>
          <span>Pending invoices</span>
          <strong>{pendingInvoices.length}</strong>
        </div>
        <div>
          <span>Outstanding</span>
          <strong>{formatCurrency(pendingInvoices.reduce((sum, item) => sum + Number(item.balance), 0))}</strong>
        </div>
        <div>
          <span>Paid invoices</span>
          <strong>{paidInvoices.length}</strong>
        </div>
      </div>
      <div className="filter-row billing-filter-row">
        <label>
          Patient filter
          <SearchableSelect
            value={selectedPatientId}
            onChange={setSelectedPatientId}
            placeholder="All patients"
            searchPlaceholder="Search patient name or number..."
            emptyMessage="No patients match your search."
            options={patientOptions.map((option) => ({
              value: option.id,
              label: `${option.first_name} ${option.last_name}`,
              description: option.patient_number,
              searchText: `${option.patient_number} ${option.first_name} ${option.last_name} ${option.phone ?? ""} ${option.email ?? ""}`,
            }))}
          />
        </label>
        {selectedPatientId && (
          <button
            type="button"
            className="classic-button"
            onClick={() => setSelectedPatientId("")}
          >
            Show all
          </button>
        )}
      </div>

      <div className="billing-tab-strip tab-strip">
        <button
          type="button"
          className={invoiceView === "pending" ? "tab active" : "tab"}
          onClick={() => setInvoiceView("pending")}
        >
          Pending ({pendingInvoices.length})
        </button>
        <button
          type="button"
          className={invoiceView === "paid" ? "tab active" : "tab"}
          onClick={() => setInvoiceView("paid")}
        >
          Paid ({paidInvoices.length})
        </button>
      </div>

      <div className="table-wrap">
        <div className="invoice-section">
          <table>
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Patient</th>
                <th>Case</th>
                <th>Date</th>
                <th>Total</th>
                <th>Balance</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {renderInvoiceRows(visibleInvoices)}
            </tbody>
          </table>
          {!visibleInvoices.length && (
            <div className="empty-state">
              {invoiceView === "pending" ? "No pending invoices." : "No paid invoices."}
            </div>
          )}
        </div>
      </div>
      {emailInvoice && (
        <div className="modal-backdrop">
          <section className="classic-dialog" role="dialog" aria-modal="true">
            <div className="dialog-title">
              Send Invoice / Receipt by Outlook{" "}
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
                  {emailInvoice.status === "paid" ? "Send receipt" : "Send invoice"}
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
