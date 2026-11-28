import { ChangeEvent, useEffect, useRef, useState } from "react";
import { Icon, Notify } from "../shared";
import { proofPhotoUrls, riderConfirmDelivery, uploadProofPhoto } from "../lib/api";
import { prepareProofPhoto } from "../lib/photo";
import { errorMessage } from "../lib/supabase";
import { Order, formatDateTime } from "../lib/types";

const MAX_PHOTOS = 3;

type Shot = { blob: Blob; preview: string };

/**
 * Rider, at the door: take 1-3 photos of the order being handed over, then mark it delivered.
 * The photos are only uploaded when the rider confirms, so retakes cost nothing.
 */
export function DeliveryProofCapture({
  order,
  notify,
  onDelivered,
}: {
  order: Order;
  notify: Notify;
  onDelivered: () => void;
}) {
  const [shots, setShots] = useState<Shot[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"" | "reading" | "sending">("");
  const input = useRef<HTMLInputElement>(null);
  // Photos already uploaded, so a retry after a failed confirm doesn't upload them twice.
  const uploadedPaths = useRef(new Map<Blob, string>());
  const latest = useRef(shots);
  latest.current = shots;
  useEffect(() => () => latest.current.forEach((s) => URL.revokeObjectURL(s.preview)), []);

  const addPhotos = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).slice(0, MAX_PHOTOS - shots.length);
    e.target.value = "";
    if (!files.length) return;
    setBusy("reading");
    try {
      const caption = `Ailyn's Express · #${order.code} · ${formatDateTime(new Date().toISOString())}`;
      const blobs = await Promise.all(files.map((f) => prepareProofPhoto(f, caption)));
      setShots((prev) =>
        [...prev, ...blobs.map((blob) => ({ blob, preview: URL.createObjectURL(blob) }))].slice(0, MAX_PHOTOS),
      );
    } catch (err) {
      notify(errorMessage(err), "error");
    } finally {
      setBusy("");
    }
  };

  const remove = (index: number) => {
    URL.revokeObjectURL(shots[index].preview);
    setShots(shots.filter((_, i) => i !== index));
  };

  const finish = async () => {
    if (!shots.length) return notify("Take a photo of the order being handed over first", "error");
    if (!window.confirm(`Confirm order #${order.code} was handed to the customer?`)) return;
    setBusy("sending");
    try {
      const paths = await Promise.all(
        shots.map(async ({ blob }) => {
          const done = uploadedPaths.current.get(blob);
          if (done) return done;
          const path = await uploadProofPhoto(order, blob);
          uploadedPaths.current.set(blob, path);
          return path;
        }),
      );
      await riderConfirmDelivery(order.id, paths, note.trim());
      notify("Delivered. Nice work!");
      onDelivered();
    } catch (err) {
      notify(errorMessage(err), "error");
    } finally {
      setBusy("");
    }
  };

  const full = shots.length >= MAX_PHOTOS;
  return (
    <div className="proof-capture">
      <div className="proof-capture-head">
        <small>PROOF OF DELIVERY</small>
        <strong>Take a photo at the door</strong>
        <span>
          Show the order in the customer's hands, with the customer if they're okay with it. If they'd rather not be in
          the photo, take one of the order at their door.
        </span>
      </div>
      <div className="proof-shots">
        {shots.map((shot, i) => (
          <figure key={shot.preview}>
            <img src={shot.preview} alt={`Proof photo ${i + 1}`} />
            <button
              type="button"
              aria-label={`Remove photo ${i + 1}`}
              onClick={() => remove(i)}
              disabled={busy === "sending"}
            >
              <Icon name="close" size={14} />
            </button>
          </figure>
        ))}
        {!full && (
          <button
            type="button"
            className="proof-add"
            onClick={() => input.current?.click()}
            disabled={busy !== ""}
          >
            <Icon name="camera" size={22} />
            <span>{busy === "reading" ? "Preparing…" : shots.length ? "Add another" : "Take photo"}</span>
          </button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => void addPhotos(e)}
      />
      <label className="proof-note-field">
        Note for the customer (optional)
        <input
          value={note}
          maxLength={200}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Received by her sister"
        />
      </label>
      <button
        type="button"
        className="button button-primary button-full"
        disabled={busy !== "" || !shots.length}
        onClick={() => void finish()}
      >
        <Icon name="check" /> {busy === "sending" ? "Sending photos…" : "Mark as delivered"}
      </button>
      {!shots.length && <small className="proof-help">Add at least one photo to finish the delivery.</small>}
    </div>
  );
}

/** The rider's proof-of-delivery photos on an order. Tap a photo to open it full size. */
export function DeliveryProofView({ order, showMissing = false }: { order: Order; showMissing?: boolean }) {
  const paths = order.proof_photos ?? [];
  const key = paths.join("|");
  const [urls, setUrls] = useState<string[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setUrls(null);
    setError("");
    if (!key) return;
    let live = true;
    proofPhotoUrls(key.split("|")).then(
      (u) => live && setUrls(u),
      (e) => live && setError(errorMessage(e)),
    );
    return () => {
      live = false;
    };
  }, [key]);

  if (!paths.length) {
    return showMissing && order.status === "delivered" && order.proof_photos !== undefined ? (
      <div className="proof-box missing">
        <small>PROOF OF DELIVERY</small>
        <span>No delivery photo. This order was closed without one, for example from the admin portal.</span>
      </div>
    ) : null;
  }

  return (
    <div className="proof-box">
      <div className="proof-box-head">
        <small>PROOF OF DELIVERY</small>
        <span>
          {paths.length === 1 ? "Photo" : `${paths.length} photos`} taken by the rider
          {order.proof_at ? ` · ${formatDateTime(order.proof_at)}` : ""}
        </span>
      </div>
      {order.proof_note && <p className="proof-note">Rider's note: {order.proof_note}</p>}
      <div className="proof-photos">
        {error ? (
          <small className="proof-error">Couldn't load the photos: {error}</small>
        ) : urls ? (
          urls.map((url, i) => (
            <a key={url} href={url} target="_blank" rel="noreferrer" title="Open full size">
              <img src={url} alt={`Delivery photo ${i + 1} for order #${order.code}`} loading="lazy" />
            </a>
          ))
        ) : (
          paths.map((p) => <span key={p} className="proof-placeholder" aria-label="Loading photo" />)
        )}
      </div>
    </div>
  );
}
