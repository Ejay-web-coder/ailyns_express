import { useEffect, useRef } from "react";
import type { Product } from "../shared";
import { supabase } from "./supabase";
import type {
  ChatLog,
  ChatSuggestion,
  FeeSettings,
  Order,
  OrderStatus,
  Profile,
  Role,
  StoreSettings,
  Voucher,
  VoucherInput,
} from "./types";

const ORDER_SELECT = "*, order_items(*), order_events(*)";

function unwrap<T>(result: { data: T | null; error: unknown }): T {
  if (result.error) throw result.error;
  return result.data as T;
}

const sortEvents = (order: Order): Order => ({
  ...order,
  order_events: [...(order.order_events ?? [])].sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  ),
});

// ------------------------------------------------------------- auth

export type AuthIntent = { role: Role; at: number };
const INTENT_KEY = "ae_auth_intent";

export function clearIntent() {
  try {
    localStorage.removeItem(INTENT_KEY);
  } catch {
    /* ignore */
  }
}

export function rememberIntent(role: Role) {
  try {
    localStorage.setItem(INTENT_KEY, JSON.stringify({ role, at: Date.now() }));
  } catch {
    /* storage unavailable: the role check after sign-in still applies */
  }
}

/** Read (without clearing) the portal the user signed in from. */
export function peekIntent(): AuthIntent | null {
  try {
    const raw = localStorage.getItem(INTENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthIntent;
    // Ignore stale intents (OAuth round trips take seconds, not hours).
    return Date.now() - parsed.at < 30 * 60 * 1000 ? parsed : null;
  } catch {
    return null;
  }
}

export async function signInWithGoogle(role: Role) {
  rememberIntent(role);
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin },
  });
  if (error) throw error;
}

export async function signInWithPassword(email: string, password: string, role: Role) {
  rememberIntent(role);
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signUp(
  email: string,
  password: string,
  role: Exclude<Role, "admin">,
  details: { full_name: string; phone: string; vehicle?: string; plate_number?: string },
) {
  rememberIntent(role);
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { ...details, role }, emailRedirectTo: window.location.origin },
  });
  if (error) throw error;
  return { needsConfirmation: !data.session };
}

export async function sendPasswordReset(email: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin,
  });
  if (error) throw error;
}

export const signOut = () => supabase.auth.signOut();

export async function fetchMyProfile(userId: string): Promise<Profile | null> {
  const result = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  return unwrap(result) as Profile | null;
}

export async function updateMyProfile(
  id: string,
  changes: Partial<
    Pick<
      Profile,
      "full_name" | "phone" | "vehicle" | "plate_number" | "rider_online" | "address" | "city" | "province"
    >
  >,
) {
  unwrap(await supabase.from("profiles").update(changes).eq("id", id));
}

export async function becomeRider(details: {
  full_name?: string;
  phone?: string;
  vehicle?: string;
  plate_number?: string;
}) {
  unwrap(
    await supabase.rpc("become_rider", {
      p_full_name: details.full_name ?? null,
      p_phone: details.phone ?? null,
      p_vehicle: details.vehicle ?? null,
      p_plate: details.plate_number ?? null,
    }),
  );
}

// ------------------------------------------------------------- catalog

export async function fetchProducts(): Promise<Product[]> {
  const rows = unwrap(await supabase.from("products").select("*").order("id")) as Product[];
  return rows.map((p) => ({ ...p, price: Number(p.price), rating: Number(p.rating) }));
}

export type ProductInput = Omit<Product, "id"> & { active?: boolean };

export async function saveProduct(product: ProductInput, id?: number) {
  if (id) unwrap(await supabase.from("products").update(product).eq("id", id));
  else unwrap(await supabase.from("products").insert(product));
}

/** Show or hide a product for customers (instead of deleting it, so its sales history stays whole). */
export async function setProductAvailable(id: number, active: boolean) {
  unwrap(await supabase.from("products").update({ active }).eq("id", id));
}

export async function setProductStock(id: number, stock: number) {
  unwrap(await supabase.from("products").update({ stock }).eq("id", id));
}

// ------------------------------------------------------------- orders

export type CheckoutDetails = {
  name: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  province: string;
  notes: string;
  payment: "cod" | "gcash";
};

/** Where the order goes: the customer's pin, or their typed address looked up on the map. */
export type DropOff = {
  lat: number;
  lng: number;
  /** The customer dropped this pin (saved as the order's exact drop-off), vs. a looked-up address. */
  pinned: boolean;
  /** Road distance routed from the store, which the database checks before pricing on it. */
  roadKm: number | null;
};

/**
 * Place the order. The database works out the delivery fee from the drop-off's distance to the
 * store, and checks and prices the voucher code (if any) itself.
 */
export async function placeOrder(
  items: { product_id: number; quantity: number }[],
  details: CheckoutDetails,
  dropOff: DropOff | null,
  voucherCode?: string | null,
): Promise<Order> {
  const base = {
    p_items: items,
    p_name: details.name,
    p_phone: details.phone,
    p_email: details.email,
    p_address: details.address,
    p_city: details.city,
    p_province: details.province,
    p_notes: details.notes,
    p_payment: details.payment,
  };
  const result = await supabase.rpc("place_order", {
    ...base,
    p_lat: dropOff?.lat ?? null,
    p_lng: dropOff?.lng ?? null,
    p_pinned: dropOff?.pinned ?? false,
    p_road_km: dropOff?.roadKm != null ? Math.round(dropOff.roadKm * 1000) / 1000 : null,
    // Only sent with a code, so ordering keeps working before the vouchers migration is applied.
    ...(voucherCode ? { p_voucher: voucherCode } : {}),
  });
  if (!result.error) return result.data as Order;
  if (voucherCode && (result.error as { code?: string }).code === "PGRST202") {
    throw new Error("Vouchers aren't switched on yet. Remove the voucher and place your order again.");
  }
  // PGRST202 = no function with these arguments: the distance_delivery_fee migration isn't applied
  // yet. Use the older flat-fee function, then save the pin separately as before.
  if ((result.error as { code?: string }).code !== "PGRST202") throw result.error;
  let order = unwrap(await supabase.rpc("place_order", base)) as Order;
  if (dropOff?.pinned) {
    const saved = await setOrderDropOff(order.id, dropOff.lat, dropOff.lng).then(
      () => true,
      () => false,
    );
    if (saved) order = { ...order, dest_lat: dropOff.lat, dest_lng: dropOff.lng };
  }
  return order;
}

/** Orders visible to the current user (RLS decides which: own, assigned, open jobs, or all for admin). */
export async function fetchOrders(filter?: {
  customerId?: string;
  riderId?: string;
  openJobs?: boolean;
  limit?: number;
}): Promise<Order[]> {
  let query = supabase.from("orders").select(ORDER_SELECT).order("created_at", { ascending: false });
  if (filter?.customerId) query = query.eq("customer_id", filter.customerId);
  if (filter?.riderId) query = query.eq("rider_id", filter.riderId);
  if (filter?.openJobs)
    query = query.is("rider_id", null).in("status", ["confirmed", "preparing", "ready"]);
  if (filter?.limit) query = query.limit(filter.limit);
  return (unwrap(await query) as Order[]).map(sortEvents);
}

export async function fetchOrder(id: string): Promise<Order | null> {
  const row = unwrap(
    await supabase.from("orders").select(ORDER_SELECT).eq("id", id).maybeSingle(),
  ) as Order | null;
  return row ? sortEvents(row) : null;
}

export async function fetchProfile(id: string): Promise<Profile | null> {
  return unwrap(
    await supabase.from("profiles").select("*").eq("id", id).maybeSingle(),
  ) as Profile | null;
}

export async function fetchProfiles(role?: Role): Promise<Profile[]> {
  let query = supabase.from("profiles").select("*").order("created_at", { ascending: false });
  if (role) query = query.eq("role", role);
  return unwrap(await query) as Profile[];
}

const rpc = async (fn: string, args: Record<string, unknown>) => {
  unwrap(await supabase.rpc(fn, args));
};

export const cancelOrder = (orderId: string) =>
  rpc("customer_cancel_order", { p_order: orderId });
export const adminUpdateStatus = (orderId: string, status: OrderStatus, note?: string) =>
  rpc("admin_update_order_status", { p_order: orderId, p_status: status, p_note: note ?? null });
export const adminAssignRider = (orderId: string, riderId: string | null) =>
  rpc("admin_assign_rider", { p_order: orderId, p_rider: riderId });
export const adminSetRiderApproval = (riderId: string, approved: boolean) =>
  rpc("admin_set_rider_approval", { p_rider: riderId, p_approved: approved });
export const riderAccept = (orderId: string) => rpc("rider_accept_order", { p_order: orderId });
export const riderRelease = (orderId: string) => rpc("rider_release_order", { p_order: orderId });
export const riderUpdateStatus = (orderId: string, status: OrderStatus) =>
  rpc("rider_update_status", { p_order: orderId, p_status: status });
export const riderUpdateLocation = (orderId: string, lat: number, lng: number) =>
  rpc("rider_update_location", { p_order: orderId, p_lat: lat, p_lng: lng });
/** The customer's exact drop-off pin for their own order. */
export const setOrderDropOff = (orderId: string, lat: number, lng: number) =>
  rpc("customer_set_drop_off", { p_order: orderId, p_lat: lat, p_lng: lng });
/**
 * Change an open order's delivery fee: the assigned rider (up to the checkout fee + the store's
 * rider allowance) or an admin. The reason is shown to the customer on the order timeline.
 */
export const setDeliveryFee = (orderId: string, fee: number, reason: string) =>
  rpc("set_delivery_fee", { p_order: orderId, p_fee: fee, p_reason: reason });

// ------------------------------------------------------------- proof of delivery

const PROOF_BUCKET = "delivery-proofs";

/** The rider can photograph this order as proof (false until the delivery_proof_photos migration is applied). */
export const supportsDeliveryProof = (order: Order) => order.proof_photos !== undefined;

/** Upload one proof photo for an order out for delivery. Returns its storage path. */
export async function uploadProofPhoto(order: Pick<Order, "id" | "customer_id">, photo: Blob): Promise<string> {
  const path = `${order.customer_id}/${order.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const { error } = await supabase.storage.from(PROOF_BUCKET).upload(path, photo, {
    contentType: "image/jpeg",
    upsert: false,
  });
  if (!error) return path;
  if (/row-level security|unauthori[sz]ed|403/i.test(error.message)) {
    throw new Error("Photos can only be added while you're delivering this order.");
  }
  throw error;
}

/** Finish the delivery with the uploaded photos (and an optional note the customer sees). */
export const riderConfirmDelivery = (orderId: string, photoPaths: string[], note: string) =>
  rpc("rider_confirm_delivery", { p_order: orderId, p_photos: photoPaths, p_note: note || null });

/** Short-lived links to an order's proof photos (the bucket is private). */
export async function proofPhotoUrls(paths: string[]): Promise<string[]> {
  const { data, error } = await supabase.storage.from(PROOF_BUCKET).createSignedUrls(paths, 60 * 60);
  if (error) throw error;
  return (data ?? []).map((d) => d.signedUrl).filter((u): u is string => Boolean(u));
}

// ------------------------------------------------------------- store location

/** The store row, or null when it can't be read (e.g. the live_route_map migration isn't applied yet). */
export async function fetchStoreSettings(): Promise<StoreSettings | null> {
  const { data, error } = await supabase.from("store_settings").select("*").eq("id", 1).maybeSingle();
  return error ? null : (data as StoreSettings | null);
}

export async function updateStoreSettings(
  changes: Pick<StoreSettings, "address" | "lat" | "lng"> | FeeSettings,
) {
  // .select() so an update that RLS silently skipped shows up as an error instead of a fake success.
  return unwrap(
    await supabase.from("store_settings").update(changes).eq("id", 1).select().single(),
  ) as StoreSettings;
}

// ------------------------------------------------------------- vouchers

/** Postgres/PostgREST codes for "this table or function doesn't exist yet". */
const MISSING = new Set(["42P01", "PGRST205", "PGRST202", "42883"]);
const isMissing = (error: unknown) => MISSING.has(String((error as { code?: string } | null)?.code ?? ""));

const toVoucher = (v: Voucher): Voucher => ({
  ...v,
  amount: Number(v.amount),
  max_discount: v.max_discount == null ? null : Number(v.max_discount),
  min_spend: Number(v.min_spend),
});

/**
 * Vouchers the current user can see: admins get all of them, customers only the vouchers (not
 * coupons) running today. null when the vouchers migration isn't applied yet.
 */
export async function fetchVouchers(): Promise<Voucher[] | null> {
  const { data, error } = await supabase
    .from("vouchers")
    .select("*")
    .order("starts_on", { ascending: false })
    .order("id", { ascending: false });
  if (error) {
    if (isMissing(error)) return null;
    throw error;
  }
  return (data as Voucher[]).map(toVoucher);
}

export async function saveVoucher(voucher: VoucherInput, id?: number) {
  const result = id
    ? await supabase.from("vouchers").update(voucher).eq("id", id).select().single()
    : await supabase.from("vouchers").insert(voucher).select().single();
  if ((result.error as { code?: string } | null)?.code === "23505") {
    throw new Error(`The code ${voucher.code} is already used by another voucher. Pick a different code.`);
  }
  return toVoucher(unwrap(result) as Voucher);
}

export async function setVoucherActive(id: number, active: boolean) {
  unwrap(await supabase.from("vouchers").update({ active }).eq("id", id).select().single());
}

/** A voucher checked for this customer and item total, with what it would take off. */
export type CheckedVoucher = Pick<
  Voucher,
  "id" | "code" | "title" | "kind" | "discount_type" | "amount" | "max_discount" | "min_spend" | "starts_on" | "ends_on"
> & { discount: number };

/** Check a code before placing the order. Throws with the reason when it can't be used. */
export async function checkVoucher(code: string, subtotal: number, fee: number | null): Promise<CheckedVoucher> {
  const { data, error } = await supabase.rpc("check_voucher", {
    p_code: code,
    p_subtotal: Math.round(subtotal * 100) / 100,
    p_fee: fee,
  });
  if (error) {
    if (isMissing(error)) throw new Error("Vouchers aren't switched on yet.");
    throw error;
  }
  const v = data as CheckedVoucher;
  return { ...toVoucher(v as unknown as Voucher), discount: Number(v.discount) } as CheckedVoucher;
}

// ------------------------------------------------------------- chatbot

const DEFAULT_SUGGESTIONS = [
  "What's in Chicken Adobo?",
  "Recommend a meal",
  "Do you have cooking oil?",
  "How much is delivery?",
];

/** Suggested questions for the customer chatbot (admins also see hidden ones). */
export async function fetchChatSuggestions(): Promise<ChatSuggestion[]> {
  return unwrap(
    await supabase
      .from("chat_suggestions")
      .select("*")
      .order("sort_order")
      .order("id"),
  ) as ChatSuggestion[];
}

/** Active suggestion texts, falling back to built-in ones if the table is empty or unreachable. */
export async function fetchActiveSuggestionTexts(): Promise<string[]> {
  try {
    const rows = (await fetchChatSuggestions()).filter((s) => s.active).map((s) => s.question);
    return rows.length ? rows : DEFAULT_SUGGESTIONS;
  } catch {
    return DEFAULT_SUGGESTIONS;
  }
}

export async function addChatSuggestion(question: string, sortOrder: number) {
  unwrap(await supabase.from("chat_suggestions").insert({ question, sort_order: sortOrder }));
}

export async function updateChatSuggestion(
  id: number,
  changes: Partial<Pick<ChatSuggestion, "question" | "active" | "sort_order">>,
) {
  unwrap(await supabase.from("chat_suggestions").update(changes).eq("id", id));
}

export async function deleteChatSuggestion(id: number) {
  unwrap(await supabase.from("chat_suggestions").delete().eq("id", id));
}

/** Record a customer question and the bot's answer. Never blocks or breaks the chat. */
export function logChat(entry: {
  question: string;
  answer: string;
  product_id: number | null;
  matched: boolean;
}) {
  void supabase
    .from("chat_logs")
    .insert({
      question: entry.question.slice(0, 500),
      answer: entry.answer.slice(0, 2000),
      product_id: entry.product_id,
      matched: entry.matched,
    })
    .then(({ error }) => {
      if (error) console.warn("Chat log not saved:", error.message);
    });
}

export type AiChatTurn = { role: "user" | "assistant"; text: string };
export type AiChatReply = {
  answer: string;
  /** Catalog product ids the answer is about, most relevant first (already checked server-side). */
  product_ids: number[];
  show_order_tracking: boolean;
  understood: boolean;
};

/**
 * Ask Ailyn AI (Google Gemini via the `ailyn-chat` Edge Function). The function logs the question
 * itself. Throws when the AI can't answer (no key configured, rate limit, outage), so the caller
 * can fall back to the built-in answers.
 */
export async function askAilynAI(question: string, history: AiChatTurn[]): Promise<AiChatReply> {
  const { data, error } = await supabase.functions.invoke<AiChatReply>("ailyn-chat", {
    body: { question, history },
  });
  if (error) throw error;
  if (!data || typeof data.answer !== "string" || !data.answer.trim()) {
    throw new Error("Ailyn AI returned no answer");
  }
  return {
    answer: data.answer,
    product_ids: Array.isArray(data.product_ids) ? data.product_ids : [],
    show_order_tracking: data.show_order_tracking === true,
    understood: data.understood !== false,
  };
}

export async function fetchChatLogs(sinceDays = 30): Promise<ChatLog[]> {
  const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString();
  return unwrap(
    await supabase
      .from("chat_logs")
      .select("*")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1000),
  ) as ChatLog[];
}

// ------------------------------------------------------------- realtime

export type RealtimeSub = { table: string; filter?: string };

/**
 * Re-run `onChange` whenever rows in the given tables change. Realtime respects RLS,
 * so each role only hears about rows it is allowed to see.
 */
export function useRealtime(channel: string, subs: RealtimeSub[], onChange: () => void) {
  const callback = useRef(onChange);
  callback.current = onChange;
  const key = `${channel}|${subs.map((s) => `${s.table}:${s.filter ?? ""}`).join(",")}`;
  useEffect(() => {
    let timer: number | undefined;
    const fire = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => callback.current(), 250);
    };
    const sub = supabase.channel(`${channel}-${Math.random().toString(36).slice(2)}`);
    for (const { table, filter } of subs) {
      sub.on(
        "postgres_changes",
        { event: "*", schema: "public", table, ...(filter ? { filter } : {}) },
        fire,
      );
    }
    sub.subscribe();
    return () => {
      window.clearTimeout(timer);
      void supabase.removeChannel(sub);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
