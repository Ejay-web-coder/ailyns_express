import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { Icon, Notify, Spinner, money } from "../shared";
import { errorMessage } from "../lib/supabase";
import { Order, formatDateTime } from "../lib/types";
import { refreshStoreLocation, useStoreSettings } from "../lib/geo";
import {
  amountToCollect,
  formatReference,
  gcashSetup,
  normalizeReference,
  paymentLabel,
  paymentProofUrl,
  paymentState,
  qrImageUrl,
  reviewGcashPayment,
  saveGcashSetup,
  submitGcashPayment,
  uploadGcashQr,
  uploadPaymentProof,
  validReference,
} from "../lib/gcash";
import "../gcash.css";

type Method = "cod" | "gcash";

// ------------------------------------------------------------------ small parts

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      window.setTimeout(() => setDone(false), 1600);
    } catch {
      window.prompt("Copy this:", text);
    }
  };
  return (
    <button type="button" className="gcash-copy" onClick={() => void copy()}>
      {done ? "Copied" : label}
    </button>
  );
}

/** "GCash · to check" and friends, coloured by where the payment is. */
export function PaymentTag({ order, short = false }: { order: Order; short?: boolean }) {
  return <span className={`pay-tag pay-${paymentState(order)}`}>{paymentLabel(order, short)}</span>;
}

/** A receipt screenshot from the private bucket. Tap to open it full size. */
export function PaymentProofImage({ path, alt }: { path: string; alt: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    setUrl(null);
    setError("");
    paymentProofUrl(path).then(
      (u) => live && setUrl(u),
      (e) => live && setError(errorMessage(e)),
    );
    return () => {
      live = false;
    };
  }, [path]);
  if (error) return <small className="gcash-error">Couldn't load the screenshot: {error}</small>;
  if (!url) return <span className="gcash-proof gcash-proof-ph" aria-label="Loading screenshot" />;
  return (
    <a className="gcash-proof" href={url} target="_blank" rel="noreferrer" title="Open full size">
      <img src={url} alt={alt} />
    </a>
  );
}

// ------------------------------------------------------------------ checkout

/** Cash or GCash. With the store's QR set up, GCash means paying online now and sending the receipt. */
export function PaymentOptions({ value, onChange }: { value: Method; onChange: (m: Method) => void }) {
  const gcash = gcashSetup(useStoreSettings().settings);
  return (
    <>
      <div className="payment-options">
        <button type="button" className={value === "cod" ? "active" : ""} onClick={() => onChange("cod")}>
          <span className="radio" />
          <div>
            <strong>Cash on delivery</strong>
            <small>Pay the rider when your order arrives</small>
          </div>
        </button>
        <button type="button" className={value === "gcash" ? "active" : ""} onClick={() => onChange("gcash")}>
          <span className="radio" />
          <div>
            <strong>{gcash.online ? "GCash (scan QR)" : "GCash"}</strong>
            <small>{gcash.online ? "Pay online now and send us your receipt" : "Pay the rider via GCash on arrival"}</small>
          </div>
        </button>
      </div>
      {value === "gcash" && gcash.online && (
        <ol className="gcash-steps">
          <li>Place your order. Your total, delivery fee included, is final then.</li>
          <li>Scan Ailyn's GCash QR on the next screen and pay that exact total.</li>
          <li>Type the reference number and add a screenshot of your GCash receipt.</li>
          <li>Your order stays pending until the store checks the payment, then it's confirmed.</li>
        </ol>
      )}
    </>
  );
}

// ------------------------------------------------------------------ customer

type SentPayment = Pick<Order, "payment_status" | "gcash_reference" | "payment_proof" | "payment_submitted_at" | "payment_note">;

/**
 * The customer's GCash payment on their order: the store's QR and a form for the reference number and
 * receipt screenshot while it's due, then where the store's check is at. Nothing for cash orders.
 */
export function GcashPayCard({ order }: { order: Order }) {
  // Show the payment as sent straight away; the live order replaces this once it catches up.
  const [sent, setSent] = useState<SentPayment | null>(null);
  useEffect(() => setSent(null), [order.payment_status, order.payment_submitted_at]);
  const view: Order = sent ? { ...order, ...sent } : order;
  const state = paymentState(view);

  if (state === "cod" || state === "gcash-on-arrival") return null;

  if (view.status === "cancelled") {
    return state === "submitted" || state === "verified" ? (
      <section className="gcash-card">
        <Head icon="info" kicker="GCASH PAYMENT" title="This order was cancelled">
          Ailyn's will refund the GCash payment you sent (Ref {formatReference(view.gcash_reference ?? "")}). Message
          the store if it hasn't reached you.
        </Head>
      </section>
    ) : null;
  }

  if (state === "submitted") {
    return (
      <section className="gcash-card is-submitted">
        <Head icon="clock" kicker="GCASH PAYMENT SENT" title="Waiting for Ailyn's to check your payment">
          The store compares your receipt with its GCash. Your order is confirmed as soon as it matches; you'll see
          it here.
        </Head>
        <div className="gcash-sent">
          {view.payment_proof && (
            <PaymentProofImage path={view.payment_proof} alt={`Your GCash receipt for order #${view.code}`} />
          )}
          <dl className="gcash-facts">
            <div>
              <dt>Ref No.</dt>
              <dd className="gcash-ref">{formatReference(view.gcash_reference ?? "")}</dd>
            </div>
            <div>
              <dt>Amount</dt>
              <dd>{money(Number(view.total))}</dd>
            </div>
            {view.payment_submitted_at && (
              <div>
                <dt>Sent</dt>
                <dd>{formatDateTime(view.payment_submitted_at)}</dd>
              </div>
            )}
          </dl>
        </div>
      </section>
    );
  }

  if (state === "verified") {
    const due = amountToCollect(view);
    return (
      <section className="gcash-card is-verified">
        <Head icon="check" kicker="GCASH PAYMENT VERIFIED" title={`Paid ${money(Number(view.paid_amount ?? view.total))} via GCash`}>
          {due > 0 ? `Pay the remaining ${money(due)} to your rider.` : "Nothing to pay when your order arrives."} Ref{" "}
          {formatReference(view.gcash_reference ?? "")}
          {view.payment_note ? ` · ${view.payment_note}` : ""}
        </Head>
      </section>
    );
  }

  return <GcashPayForm order={view} rejected={state === "rejected" ? (view.payment_note ?? "") : null} onSent={setSent} />;
}

function Head({
  icon,
  kicker,
  title,
  children,
}: {
  icon: string;
  kicker: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="gcash-head">
      <span className="gcash-icon">
        <Icon name={icon} size={18} />
      </span>
      <div>
        <small>{kicker}</small>
        <strong>{title}</strong>
        {children && <span>{children}</span>}
      </div>
    </header>
  );
}

function GcashPayForm({
  order,
  rejected,
  onSent,
}: {
  order: Order;
  /** The admin's reason when the last receipt wasn't accepted. */
  rejected: string | null;
  onSent: (p: SentPayment) => void;
}) {
  const gcash = gcashSetup(useStoreSettings().settings);
  const [reference, setReference] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  // Screenshots already uploaded, so a retry after a failed send doesn't upload them twice.
  const uploaded = useRef(new Map<File, string>());
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  const total = Number(order.total);
  const ref = normalizeReference(reference);

  const pick = (e: ChangeEvent<HTMLInputElement>) => {
    const next = e.target.files?.[0];
    e.target.value = "";
    if (!next) return;
    if (next.type && !next.type.startsWith("image/")) {
      setError("Choose a screenshot (a picture) of your GCash receipt.");
      return;
    }
    setError("");
    setFile(next);
    setPreview(URL.createObjectURL(next));
  };

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!validReference(ref)) {
      setError("Type the reference number (Ref No.) from your GCash receipt.");
      return;
    }
    if (!file) {
      setError("Add a screenshot of your GCash receipt.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      let path = uploaded.current.get(file);
      if (!path) {
        path = await uploadPaymentProof(order, file);
        uploaded.current.set(file, path);
      }
      await submitGcashPayment(order.id, ref, path);
      onSent({
        payment_status: "submitted",
        gcash_reference: ref,
        payment_proof: path,
        payment_submitted_at: new Date().toISOString(),
        payment_note: null,
      });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="gcash-card">
      <Head icon="wallet" kicker="PAY WITH GCASH" title={`Pay ${money(total)} to confirm your order`}>
        Your order stays pending until Ailyn's checks your payment.
      </Head>
      {rejected !== null && (
        <p className="gcash-alert">
          <Icon name="alert" size={16} />
          <span>
            <b>The store couldn't accept your last payment</b>
            {rejected ? `: ${/[.!?]$/.test(rejected.trim()) ? rejected.trim() : `${rejected.trim()}.`}` : "."} Check it
            and send your receipt again.
          </span>
        </p>
      )}

      <div className="gcash-step">
        <span>1</span> Scan and pay
      </div>
      {gcash.qrPath || gcash.number ? (
        <div className="gcash-pay">
          {gcash.qrPath && (
            <figure className="gcash-qr">
              <img src={qrImageUrl(gcash.qrPath)} alt="Ailyn's Express GCash QR code" />
              <a className="button button-soft" href={qrImageUrl(gcash.qrPath, true)}>
                <Icon name="download" size={16} /> Save QR
              </a>
            </figure>
          )}
          <dl className="gcash-facts">
            <div>
              <dt>Amount to pay</dt>
              <dd>
                <b className="gcash-amount">{money(total)}</b> <CopyButton text={total.toFixed(2)} />
              </dd>
            </div>
            {gcash.name && (
              <div>
                <dt>Account name</dt>
                <dd>{gcash.name}</dd>
              </div>
            )}
            {gcash.number && (
              <div>
                <dt>GCash number</dt>
                <dd>
                  {gcash.number} <CopyButton text={gcash.number.replace(/[\s-]/g, "")} />
                </dd>
              </div>
            )}
          </dl>
          {gcash.qrPath && (
            <small className="gcash-tip">
              Ordering on this phone? Tap <b>Save QR</b>, open GCash, tap <b>QR</b>, then <b>Upload QR</b> and pick the
              saved picture.
            </small>
          )}
        </div>
      ) : (
        <p className="gcash-muted">
          Ailyn's GCash QR isn't available right now. Message the store, or cancel and order again with cash on
          delivery.
        </p>
      )}

      <form className="gcash-form" onSubmit={submit}>
        <div className="gcash-step">
          <span>2</span> Send your receipt
        </div>
        <label>
          Reference number (Ref No.)
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            inputMode="numeric"
            autoComplete="off"
            maxLength={40}
            placeholder="e.g. 1234 567 890123"
            aria-describedby="gcash-ref-help"
          />
          <small id="gcash-ref-help">Copy it exactly as it shows on your GCash receipt.</small>
        </label>
        <div className="gcash-upload">
          {preview ? (
            <figure>
              <img src={preview} alt="Your GCash receipt screenshot" />
              <button type="button" className="button button-outline" onClick={() => input.current?.click()} disabled={busy}>
                Change screenshot
              </button>
            </figure>
          ) : (
            <button type="button" className="gcash-add" onClick={() => input.current?.click()} disabled={busy}>
              <Icon name="camera" size={22} />
              <span>Add receipt screenshot</span>
              <small>The GCash screen that shows the amount and Ref No.</small>
            </button>
          )}
          <input ref={input} type="file" accept="image/*" hidden onChange={pick} />
        </div>
        {error && <p className="form-error">{error}</p>}
        <button className="button button-primary button-full" type="submit" disabled={busy}>
          {busy ? "Sending…" : "Send payment for checking"}
        </button>
      </form>
    </section>
  );
}

// ------------------------------------------------------------------ admin

const REJECT_REASONS = [
  "The reference number doesn't match the screenshot",
  "No payment with this reference number came in",
  "The amount sent is short",
  "The screenshot is unclear",
];

/**
 * The admin's check of a GCash payment: the customer's screenshot next to the reference number they
 * typed, then verify (confirms the order) or don't accept with a reason.
 */
export function GcashReviewPanel({ order, notify, onDone }: { order: Order; notify: Notify; onDone?: () => void }) {
  const [amount, setAmount] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const state = paymentState(order);
  if (state === "cod" || state === "gcash-on-arrival") return null;

  const total = Number(order.total);
  const ref = order.gcash_reference ?? "";
  const amountText = amount ?? total.toFixed(2);
  const received = Number(amountText);

  const run = async (fn: () => Promise<void>, message: string) => {
    setBusy(true);
    try {
      await fn();
      notify(message);
      setAmount(null);
      setRejecting(false);
      setReason("");
      onDone?.();
    } catch (err) {
      notify(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  };

  const verify = () => {
    if (!amountText.trim() || !Number.isFinite(received) || received <= 0) {
      notify("Enter the amount you received in GCash", "error");
      return;
    }
    const short = received < total - 0.005;
    const question = short
      ? `You received ${money(received)}, ${money(total - received)} less than the total. The rider will collect the rest. Verify the payment and confirm #${order.code}?`
      : `Verify the GCash payment (Ref ${formatReference(ref)}) and confirm order #${order.code}?`;
    if (!window.confirm(question)) return;
    void run(
      () => reviewGcashPayment(order.id, true, { amount: received }),
      order.status === "pending" ? `Payment verified. #${order.code} is confirmed.` : "Payment verified",
    );
  };

  const reject = () => {
    const note = reason.trim();
    if (!note) {
      notify("Tell the customer what's wrong with the payment", "error");
      return;
    }
    void run(
      () => reviewGcashPayment(order.id, false, { note }),
      `Payment not accepted. ${order.customer_name} is asked to send it again.`,
    );
  };

  const title =
    state === "submitted"
      ? "Check this payment"
      : state === "verified"
        ? "Payment verified"
        : state === "rejected"
          ? "Waiting for a new receipt"
          : "Waiting for the customer to pay";

  return (
    <section className={`gcash-review is-${state}`}>
      <div className="gcash-review-head">
        <div>
          <small>GCASH PAYMENT</small>
          <strong>{title}</strong>
        </div>
        <PaymentTag order={order} short />
      </div>
      {state === "unpaid" && (
        <p className="gcash-muted">
          The customer sees the store's QR on their order and hasn't sent a receipt yet. If they don't pay, cancel the
          order.
        </p>
      )}
      {state === "rejected" && (
        <p className="gcash-muted">
          You didn't accept the last receipt{order.payment_note ? `: “${order.payment_note}”` : ""}. The customer can send
          a new one.
        </p>
      )}
      {order.payment_proof && state !== "unpaid" && (
        <div className="gcash-sent">
          <PaymentProofImage path={order.payment_proof} alt={`GCash receipt for order #${order.code}`} />
          <dl className="gcash-facts">
            <div>
              <dt>Ref No. the customer typed</dt>
              <dd className="gcash-ref">
                {formatReference(ref)} <CopyButton text={ref} />
              </dd>
            </div>
            <div>
              <dt>Order total</dt>
              <dd>{money(total)}</dd>
            </div>
            {order.payment_submitted_at && (
              <div>
                <dt>Sent</dt>
                <dd>{formatDateTime(order.payment_submitted_at)}</dd>
              </div>
            )}
            {state === "verified" && (
              <div>
                <dt>Received</dt>
                <dd>
                  {money(Number(order.paid_amount ?? total))}
                  {order.payment_reviewed_at ? ` · verified ${formatDateTime(order.payment_reviewed_at)}` : ""}
                </dd>
              </div>
            )}
          </dl>
        </div>
      )}
      {state === "verified" && amountToCollect(order) > 0 && (
        <p className="gcash-muted">The rider collects the remaining {money(amountToCollect(order))}.</p>
      )}
      {state === "submitted" &&
        (rejecting ? (
          <div className="gcash-decide">
            <label>
              What's wrong? The customer sees this.
              <textarea value={reason} maxLength={200} rows={2} onChange={(e) => setReason(e.target.value)} />
            </label>
            <div className="gcash-reasons">
              {REJECT_REASONS.map((r) => (
                <button type="button" key={r} onClick={() => setReason(r)} className={reason === r ? "active" : ""}>
                  {r}
                </button>
              ))}
            </div>
            <div className="gcash-actions">
              <button type="button" className="button button-outline" onClick={() => setRejecting(false)} disabled={busy}>
                Back
              </button>
              <button type="button" className="button button-primary" onClick={reject} disabled={busy}>
                {busy ? "Sending…" : "Don't accept payment"}
              </button>
            </div>
          </div>
        ) : (
          <div className="gcash-decide">
            <ol className="gcash-checklist">
              <li>The Ref No. on the screenshot is the same as the one the customer typed.</li>
              <li>In the store's GCash app, a payment with that Ref No. came in.</li>
              <li>The amount you received matches the order total.</li>
            </ol>
            <label className="gcash-received">
              Amount received (₱)
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={amountText}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            <div className="gcash-actions">
              <button type="button" className="button button-outline" onClick={() => setRejecting(true)} disabled={busy}>
                Don't accept…
              </button>
              <button type="button" className="button button-primary" onClick={verify} disabled={busy}>
                <Icon name="check" size={16} />
                {busy ? "Verifying…" : order.status === "pending" ? "Verify & confirm order" : "Verify payment"}
              </button>
            </div>
          </div>
        ))}
    </section>
  );
}

/** Settings: the store's GCash QR, account name and number. No QR = customers pay the rider via GCash. */
export function GcashSettingsPanel({ notify }: { notify: Notify }) {
  const store = useStoreSettings();
  const gcash = gcashSetup(store.settings);
  const [name, setName] = useState<string | null>(null);
  const [number, setNumber] = useState<string | null>(null);
  const [qr, setQr] = useState<{ file: File; preview: string } | null>(null);
  const [removeQr, setRemoveQr] = useState(false);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => () => void (qr && URL.revokeObjectURL(qr.preview)), [qr]);

  const nameText = name ?? gcash.name;
  const numberText = number ?? gcash.number;
  const dirty = name !== null || number !== null || qr !== null || removeQr;
  const shownQr = qr?.preview ?? (!removeQr && gcash.qrPath ? qrImageUrl(gcash.qrPath) : null);

  const pick = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.type && !file.type.startsWith("image/")) {
      notify("Choose a picture of the QR code (PNG or JPEG)", "error");
      return;
    }
    setQr({ file, preview: URL.createObjectURL(file) });
    setRemoveQr(false);
  };

  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const digits = numberText.replace(/[\s-]/g, "");
    if (digits && !/^(\+?63|0)9\d{9}$/.test(digits)) {
      notify("Enter the GCash number like 0917 123 4567", "error");
      return;
    }
    setBusy(true);
    try {
      const qrPath = qr ? await uploadGcashQr(qr.file) : removeQr ? null : gcash.qrPath;
      await saveGcashSetup({
        gcash_name: nameText.trim() || null,
        gcash_number: numberText.trim() || null,
        gcash_qr_path: qrPath,
      });
      await refreshStoreLocation();
      setName(null);
      setNumber(null);
      setQr(null);
      setRemoveQr(false);
      notify(
        qrPath
          ? "GCash saved. Customers who choose GCash now pay with this QR."
          : "GCash saved. Without a QR, customers pay the rider via GCash on arrival.",
      );
    } catch (err) {
      notify(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="panel store-location-panel gcash-settings" onSubmit={save}>
      <div className="store-location-head">
        <div>
          <h3>GCash payments</h3>
          <p>
            Upload the store's GCash QR and customers who choose GCash pay online right after ordering, then send their
            reference number and a receipt screenshot. Their order waits in Pending until you verify the payment in
            Orders. Without a QR, they pay the rider via GCash on arrival.
          </p>
        </div>
        <button type="submit" className="button button-primary" disabled={busy || !dirty || !gcash.supported}>
          {busy ? "Saving…" : "Save GCash"}
        </button>
      </div>
      {store.status === "loading" ? (
        <Spinner label="Loading GCash settings" />
      ) : !gcash.supported ? (
        <p className="muted small-note">
          GCash QR payments aren't set up yet. Apply the <code>gcash_qr_payments</code> migration in Supabase, then
          reload this page.
        </p>
      ) : (
        <div className="gcash-settings-body">
          <div className="gcash-settings-qr">
            {shownQr ? (
              <img src={shownQr} alt="Store GCash QR code" />
            ) : (
              <span className="gcash-qr-empty">
                <Icon name="wallet" size={26} />
                No QR yet
              </span>
            )}
            <div className="gcash-actions">
              <button type="button" className="button button-soft" onClick={() => input.current?.click()} disabled={busy}>
                <Icon name="plus" size={16} /> {shownQr ? "Replace QR" : "Upload QR"}
              </button>
              {shownQr && (
                <button
                  type="button"
                  className="button button-outline"
                  disabled={busy}
                  onClick={() => {
                    setQr(null);
                    setRemoveQr(true);
                  }}
                >
                  Remove
                </button>
              )}
            </div>
            <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={pick} />
          </div>
          <div className="field-grid">
            <label className="full-field">
              Account name
              <input
                value={nameText}
                maxLength={80}
                onChange={(e) => setName(e.target.value)}
                placeholder="As it shows in GCash, e.g. AI***N J."
              />
            </label>
            <label className="full-field">
              GCash number
              <input
                value={numberText}
                maxLength={20}
                inputMode="tel"
                onChange={(e) => setNumber(e.target.value)}
                placeholder="0917 123 4567"
              />
            </label>
            <small className="muted full-field">
              Save the QR code from your GCash app and upload that picture. Customers see the name and number under it,
              so they can check they're paying Ailyn's, or send money to the number instead.
            </small>
          </div>
        </div>
      )}
    </form>
  );
}
