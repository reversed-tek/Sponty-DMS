import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, FormEvent } from "react";
import {
  getPatientPortalData,
  uploadPatientPortalFile,
  verifyPatientPortalAccess,
} from "../lib/supabase";
import type { PortalContext, PortalInvoice } from "../lib/supabase";

type PatientPortalProps = { token: string };
type PortalData = Awaited<ReturnType<typeof getPatientPortalData>>;

const formatMoney = (value: number) =>
  new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
  }).format(value);

const statusLabel = (status: string) =>
  status === "pending_verification"
    ? "Pending Verification"
    : status === "unpaid"
      ? "Unpaid"
      : status[0].toUpperCase() + status.slice(1);

const acceptedUploadTypes =
  "image/png,image/jpeg,image/webp,application/pdf,.png,.jpg,.jpeg,.webp,.pdf";

function FileDrop({
  sessionToken,
  onUploaded,
}: {
  sessionToken: string;
  onUploaded: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const upload = async (file: File) => {
    setBusy(true);
    setMessage("");
    try {
      await uploadPatientPortalFile(sessionToken, "patient-documents", file);
      setMessage(`${file.name} uploaded.`);
      onUploaded();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  };

  const drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) void upload(file);
  };

  return (
    <>
      <div
        className="portal-file-explorer"
        onDragOver={(event) => event.preventDefault()}
        onDrop={drop}
      >
        <div className="explorer-toolbar">
          <strong>Patient Documents</strong>
          <button
            type="button"
            className="classic-button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
          >
            {busy ? "Uploading..." : "Add File"}
          </button>
        </div>
        <div className="drop-zone">
          <div className="folder-icon">DIR</div>
          <div>
            <strong>Drop X-rays or medical records here</strong>
            <small>PNG, JPG, PDF, or WEBP up to 10 MB</small>
          </div>
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={acceptedUploadTypes}
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
          event.currentTarget.value = "";
        }}
      />
      {message && <p className="portal-notice">{message}</p>}
    </>
  );
}

export function PatientPortal({ token }: PatientPortalProps) {
  const [context, setContext] = useState<PortalContext | null>(null);
  const [data, setData] = useState<PortalData | null>(null);
  const [verificationCode, setVerificationCode] = useState("");
  const [verificationError, setVerificationError] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [fatalError, setFatalError] = useState("");
  const [loading, setLoading] = useState(true);
  const [uploadingInvoice, setUploadingInvoice] = useState<string | null>(null);
  const [proofMessage, setProofMessage] = useState("");

  const storageKey = `sponty-portal-session:${token}`;

  const refresh = async (sessionToken: string) =>
    setData(await getPatientPortalData(sessionToken));

  useEffect(() => {
    let active = true;

    (async () => {
      const stored = sessionStorage.getItem(storageKey);

      if (!stored) {
        if (active) setLoading(false);
        return;
      }

      try {
        const nextContext = JSON.parse(stored) as PortalContext;
        const nextData = await getPatientPortalData(nextContext.session_token);

        if (active) {
          setContext(nextContext);
          setData(nextData);
        }
      } catch {
        sessionStorage.removeItem(storageKey);
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [storageKey]);

  const verifyAccess = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const code = verificationCode.replace(/\D/g, "").slice(0, 6);
    if (code.length !== 6) {
      setVerificationError("Enter the 6-digit code from your portal email.");
      return;
    }

    setVerifying(true);
    setVerificationError("");
    setFatalError("");

    try {
      const nextContext = await verifyPatientPortalAccess(token, code);
      const nextData = await getPatientPortalData(nextContext.session_token);

      sessionStorage.setItem(storageKey, JSON.stringify(nextContext));
      setContext(nextContext);
      setData(nextData);
      setVerificationCode("");
    } catch (reason) {
      setVerificationError(
        reason instanceof Error
          ? reason.message
          : "The verification code could not be confirmed.",
      );
    } finally {
      setVerifying(false);
    }
  };

  const openInvoices = useMemo(
    () => data?.invoices.filter((invoice) => invoice.status !== "paid") ?? [],
    [data],
  );

  const uploadProof = async (invoice: PortalInvoice, file: File) => {
    if (!context) return;

    setUploadingInvoice(invoice.id);
    setProofMessage("");

    try {
      await uploadPatientPortalFile(
        context.session_token,
        "payment-proofs",
        file,
        invoice.id,
      );
      await refresh(context.session_token);
      setProofMessage("Receipt uploaded for clinic verification.");
    } catch (reason) {
      setProofMessage(
        reason instanceof Error ? reason.message : "Receipt upload failed.",
      );
    } finally {
      setUploadingInvoice(null);
    }
  };

  if (loading) {
    return (
      <div className="portal-screen">
        <section className="portal-window classic-dialog">
          <div className="dialog-title">Sponty Patient Portal</div>
          <div className="dialog-body">
            <p>Checking secure patient portal session...</p>
          </div>
        </section>
      </div>
    );
  }

  if (!context || !data) {
    return (
      <div className="portal-screen">
        <section className="portal-verify-window classic-dialog">
          <div className="dialog-title">Sponty Patient Portal</div>
          <div className="dialog-body portal-verify-body">
            <div className="portal-verify-icon">#</div>
            <div>
              <h1>Verify portal access</h1>
              <p>
                Enter the 6-digit verification code included in the portal email
                sent by Sponty Dental Services.
              </p>

              <form onSubmit={verifyAccess} className="portal-verify-form">
                <label>
                  Verification code
                  <input
                    autoFocus
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={verificationCode}
                    placeholder="000000"
                    onChange={(event) =>
                      setVerificationCode(
                        event.target.value.replace(/\D/g, "").slice(0, 6),
                      )
                    }
                  />
                </label>

                {verificationError && (
                  <p className="send-error">{verificationError}</p>
                )}
                {fatalError && <p className="send-error">{fatalError}</p>}

                <div className="dialog-actions">
                  <button
                    type="submit"
                    className="classic-button primary"
                    disabled={verifying || verificationCode.length !== 6}
                  >
                    {verifying ? "Verifying..." : "Verify and open portal"}
                  </button>
                </div>
              </form>

              <small>
                The portal link expires after 24 hours. After five incorrect code
                attempts, request a new portal email from the clinic.
              </small>
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="portal-screen">
      <section className="portal-window">
        <header className="title-bar">
          <div className="title-bar-text">
            <span className="app-mark">+</span> Sponty Patient Portal
          </div>
        </header>

        <div className="portal-toolbar">
          Secure session for <strong>{data.patient_name}</strong>
          <span>
            Expires {new Date(context.expires_at).toLocaleTimeString()}
          </span>
        </div>

        <main className="portal-body">
          <section className="portal-panel">
            <div className="panel-title">Outstanding Invoices</div>

            {openInvoices.length === 0 ? (
              <p className="empty-state">No outstanding invoices.</p>
            ) : (
              openInvoices.map((invoice) => (
                <article className="portal-invoice" key={invoice.id}>
                  <div>
                    <strong>{invoice.invoice_number}</strong>
                    <small>{invoice.invoice_date}</small>
                  </div>
                  <div>
                    <span className={`portal-status ${invoice.status}`}>
                      {statusLabel(invoice.status)}
                    </span>
                    <strong>{formatMoney(invoice.balance)}</strong>
                  </div>
                  <label className="portal-upload-button">
                    Upload receipt
                    <input
                      type="file"
                      accept={acceptedUploadTypes}
                      disabled={uploadingInvoice === invoice.id}
                      hidden
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void uploadProof(invoice, file);
                        event.currentTarget.value = "";
                      }}
                    />
                  </label>
                </article>
              ))
            )}
          </section>

          <fieldset className="portal-bank">
            <legend>Bank Transfer Instructions</legend>
            <p>Use this reference code when making your transfer:</p>
            <strong className="payment-reference">
              REF-{openInvoices[0]?.invoice_number ?? "PORTAL"}
            </strong>
            <dl>
              <dt>Bank Name</dt>
              <dd>{data.bank?.bank_name ?? "Contact the clinic"}</dd>
              <dt>Account Name</dt>
              <dd>{data.bank?.account_name ?? "Sponty Dental Services"}</dd>
              <dt>Account Number / IBAN</dt>
              <dd>
                {data.bank?.account_number ?? "Available from the clinic"}
              </dd>
            </dl>
          </fieldset>

          {proofMessage && <p className="portal-notice">{proofMessage}</p>}

          <FileDrop
            sessionToken={context.session_token}
            onUploaded={() => void refresh(context.session_token)}
          />
        </main>

        <footer className="status-bar">
          <span className="status-panel">Secure verified portal session active</span>
        </footer>
      </section>
    </div>
  );
}
