import { money } from "../shared";
import { supabase } from "./supabase";
import type { Order, PaymentStatus, StoreSettings } from "./types";

/** Customers' receipt screenshots, as <customer id>/<order id>/<file>. Private. */
const PROOF_BUCKET = "payment-proofs";
/** The store's GCash QR. Public: every customer is meant to see it. */
const STORE_BUCKET = "store-assets";

function unwrap<T>(result: { data: T | null; error: unknown }): T {
  if (result.error) throw result.error;
  return result.data as T;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// ------------------------------------------------------------- store setup

export type GcashSetup = {
  /** The gcash_qr_payments migration is applied. */
  supported: boolean;
  /** A QR is uploaded, so GCash orders are paid online and checked by the admin. Otherwise customers pay the rider. */
  online: boolean;
  name: string;
  number: string;
  qrPath: string | null;
};

export function gcashSetup(settings: StoreSettings | null | undefined): GcashSetup {
  return {
    supported: settings?.gcash_qr_path !== undefined,
    online: !!settings?.gcash_qr_path,
    name: settings?.gcash_name?.trim() ?? "",
    number: settings?.gcash_number?.trim() ?? "",
    qrPath: settings?.gcash_qr_path ?? null,
  };
}

/** Link to the store's QR picture. With `download`, the browser saves it instead of opening it. */
export function qrImageUrl(path: string, download = false) {
  const ext = path.split(".").pop() || "png";
  return supabase.storage
    .from(STORE_BUCKET)
    .getPublicUrl(path, download ? { download: `Ailyns-Express-GCash-QR.${ext}` } : undefined).data.publicUrl;
}

/** Admin: upload a new QR picture. Returns its path; save it with saveGcashSetup. */
export async function uploadGcashQr(file: File): Promise<string> {
  // QR codes must stay sharp, so keep PNG and only shrink very large pictures.
  const image = await prepareImage(file, { maxBytes: 1_800_000, maxSide: 1400, type: "image/png" });
  const path = `gcash-qr/${Date.now()}.${image.ext}`;
  const { error } = await supabase.storage.from(STORE_BUCKET).upload(path, image.blob, {
    contentType: image.type,
    cacheControl: "31536000",
    upsert: false,
  });
  if (error) throw error;
  return path;
}

export async function saveGcashSetup(changes: {
  gcash_name: string | null;
  gcash_number: string | null;
  gcash_qr_path: string | null;
}) {
  // .select() so an update that RLS silently skipped shows up as an error instead of a fake success.
  return unwrap(
    await supabase.from("store_settings").update(changes).eq("id", 1).select().single(),
  ) as StoreSettings;
}

// ------------------------------------------------------------- customer: send the receipt

/** Upload the customer's GCash receipt screenshot for their order. Returns its storage path. */
export async function uploadPaymentProof(order: Pick<Order, "id" | "customer_id">, file: File): Promise<string> {
  // Receipts are tall phone screenshots; keep them big enough that the reference number stays readable.
  const image = await prepareImage(file, { maxBytes: 2_000_000, maxSide: 2400, type: "image/jpeg" });
  const path = `${order.customer_id}/${order.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${image.ext}`;
  const { error } = await supabase.storage.from(PROOF_BUCKET).upload(path, image.blob, {
    contentType: image.type,
    upsert: false,
  });
  if (!error) return path;
  if (/row-level security|unauthori[sz]ed|403/i.test(error.message)) {
    throw new Error("This order isn't waiting for a GCash payment any more. Refresh the page.");
  }
  throw error;
}

export async function submitGcashPayment(orderId: string, reference: string, proofPath: string) {
  unwrap(
    await supabase.rpc("customer_submit_gcash_payment", {
      p_order: orderId,
      p_reference: reference,
      p_proof: proofPath,
    }),
  );
}

// ------------------------------------------------------------- admin: check it

/** Verify (this also confirms a pending order) or don't accept the payment, with a reason the customer sees. */
export async function reviewGcashPayment(
  orderId: string,
  approve: boolean,
  options: { amount?: number; note?: string } = {},
) {
  unwrap(
    await supabase.rpc("admin_review_gcash_payment", {
      p_order: orderId,
      p_approve: approve,
      p_amount: options.amount ?? null,
      p_note: options.note?.trim() || null,
    }),
  );
}

/** Short-lived link to a receipt screenshot (the bucket is private: the customer and admins only). */
export async function paymentProofUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(PROOF_BUCKET).createSignedUrl(path, 60 * 60);
  if (error) throw error;
  return data.signedUrl;
}

// ------------------------------------------------------------- reference numbers

/** What the database stores: letters and digits only, upper case. */
export const normalizeReference = (raw: string) => raw.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
export const validReference = (ref: string) => ref.length >= 6 && ref.length <= 30;

/** GCash prints its 13-digit Ref No. as 4-3-6 digits; group other references by 4 so they're easy to compare. */
export function formatReference(ref: string) {
  if (/^\d{13}$/.test(ref)) return `${ref.slice(0, 4)} ${ref.slice(4, 7)} ${ref.slice(7)}`;
  return ref.replace(/(.{4})(?=.)/g, "$1 ");
}

// ------------------------------------------------------------- where a payment is

/** `gcash-on-arrival`: GCash paid to the rider (orders placed while the store had no QR, or before this feature). */
export type PaymentState = "cod" | "gcash-on-arrival" | PaymentStatus;

export function paymentState(order: Pick<Order, "payment_method" | "payment_status">): PaymentState {
  if (order.payment_method === "cod") return "cod";
  return order.payment_status ?? "gcash-on-arrival";
}

/** The GCash payment still has to be sent or checked, so the order can't be confirmed yet. */
export const paymentBlocksConfirm = (order: Pick<Order, "payment_method" | "payment_status">) => {
  const state = paymentState(order);
  return state === "unpaid" || state === "submitted" || state === "rejected";
};

/** The admin's "cancel this order?" question, with a refund reminder when the customer already paid. */
export function cancelOrderQuestion(order: Pick<Order, "code" | "payment_method" | "payment_status" | "total" | "paid_amount">) {
  const state = paymentState(order);
  const refund =
    state === "verified"
      ? ` The customer paid ${money(Number(order.paid_amount ?? order.total))} by GCash: refund it to them.`
      : state === "submitted"
        ? " The customer already sent a GCash payment: check it and refund them."
        : "";
  return `Cancel order #${order.code}? Stock will be restored.${refund}`;
}

/** What the rider still collects at the door. */
export function amountToCollect(order: Pick<Order, "payment_method" | "payment_status" | "total" | "paid_amount">) {
  const total = Number(order.total);
  if (paymentState(order) !== "verified") return total;
  return Math.max(0, round2(total - Number(order.paid_amount ?? total)));
}

const LABELS: Record<PaymentState, [long: string, short: string]> = {
  cod: ["Cash on delivery", "COD"],
  "gcash-on-arrival": ["GCash on arrival", "GCash"],
  unpaid: ["GCash · not paid yet", "GCash · unpaid"],
  submitted: ["GCash · waiting for the store to check", "GCash · to check"],
  verified: ["GCash · paid", "GCash · paid"],
  rejected: ["GCash · payment not accepted", "GCash · resend"],
};

export const paymentLabel = (order: Pick<Order, "payment_method" | "payment_status">, short = false) =>
  LABELS[paymentState(order)][short ? 1 : 0];

/** The rider's line about money, e.g. "Collect ₱250.00 cash" or "Paid via GCash". */
export function collectText(order: Pick<Order, "payment_method" | "payment_status" | "total" | "paid_amount">) {
  const state = paymentState(order);
  const total = Number(order.total);
  if (state === "cod") return `Collect ${money(total)} cash`;
  if (state === "gcash-on-arrival") return `GCash ${money(total)} on arrival`;
  if (state === "verified") {
    const due = amountToCollect(order);
    return due > 0 ? `Collect ${money(due)} · rest paid via GCash` : "Paid via GCash";
  }
  return "GCash · not paid yet";
}

// ------------------------------------------------------------- pictures

const UPLOAD_TYPES = ["image/jpeg", "image/png", "image/webp"];
const extFor = (type: string) => (type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg");

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Couldn't read that picture. Try a screenshot (PNG or JPEG)."));
    };
    img.src = url;
  });
}

/**
 * A picture ready to upload: the original when it's already small and a type the buckets take,
 * otherwise shrunk on a canvas. Nothing is drawn on it, so a receipt stays exactly as GCash showed it.
 */
async function prepareImage(
  file: File,
  opts: { maxBytes: number; maxSide: number; type: "image/jpeg" | "image/png" },
): Promise<{ blob: Blob; type: string; ext: string }> {
  if (file.type && !file.type.startsWith("image/")) throw new Error("Choose a picture (PNG or JPEG).");
  if (UPLOAD_TYPES.includes(file.type) && file.size <= opts.maxBytes) {
    return { blob: file, type: file.type, ext: extFor(file.type) };
  }
  const img = await loadImage(file);
  const scale = Math.min(1, opts.maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This device can't prepare pictures.");
  if (opts.type === "image/jpeg") {
    // JPEG has no transparency: put see-through screenshots on white, not black.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Couldn't prepare that picture. Please try again."))),
      opts.type,
      0.88,
    ),
  );
  return { blob, type: opts.type, ext: extFor(opts.type) };
}
