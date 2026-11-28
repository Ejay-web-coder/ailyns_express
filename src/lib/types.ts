export type Role = "customer" | "rider" | "admin";

export type OrderStatus =
  | "pending"
  | "confirmed"
  | "preparing"
  | "ready"
  | "out_for_delivery"
  | "delivered"
  | "cancelled";

export type Profile = {
  id: string;
  role: Role;
  full_name: string;
  email: string | null;
  phone: string | null;
  avatar_url: string | null;
  vehicle: string | null;
  plate_number: string | null;
  rider_approved: boolean;
  rider_online: boolean;
  address: string | null;
  city: string | null;
  province: string | null;
  /** Riders: average stars from customers (null until rated; absent before the customer_reviews migration). */
  rider_rating?: number | null;
  rider_rating_count?: number;
  created_at: string;
};

export type ChatSuggestion = {
  id: number;
  question: string;
  sort_order: number;
  active: boolean;
  created_at: string;
};

export type ChatLog = {
  id: number;
  customer_id: string;
  question: string;
  answer: string;
  product_id: number | null;
  matched: boolean;
  created_at: string;
};

export type OrderItem = {
  id: number;
  order_id: string;
  product_id: number | null;
  name: string;
  image: string;
  price: number;
  quantity: number;
};

export type OrderEvent = {
  id: number;
  order_id: string;
  status: OrderStatus;
  note: string | null;
  /** Who caused it (null for system events). */
  actor_id: string | null;
  actor_role: Role | null;
  created_at: string;
};

export type Order = {
  id: string;
  code: string;
  customer_id: string;
  rider_id: string | null;
  status: OrderStatus;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  address: string;
  city: string;
  province: string;
  notes: string | null;
  payment_method: "cod" | "gcash";
  subtotal: number;
  delivery_fee: number;
  /** Fee worked out at checkout, before a rider/admin adjustment (absent before the distance_delivery_fee migration). */
  quoted_delivery_fee?: number | null;
  /** Store → drop-off distance the fee was priced on; null for flat-fee orders. */
  delivery_km?: number | null;
  /** Why the fee was last adjusted. */
  delivery_fee_note?: string | null;
  discount: number;
  /** Voucher or coupon used (absent before the vouchers migration). */
  voucher_id?: number | null;
  voucher_code?: string | null;
  total: number;
  rider_lat: number | null;
  rider_lng: number | null;
  rider_location_at: string | null;
  /** Drop-off pin the customer set at checkout (absent before the live_route_map migration). */
  dest_lat?: number | null;
  dest_lng?: number | null;
  /** Storage paths of the rider's proof-of-delivery photos (absent before the delivery_proof_photos migration). */
  proof_photos?: string[] | null;
  /** Optional note the rider left at drop-off, e.g. who received the order. */
  proof_note?: string | null;
  /** When the rider confirmed the delivery with photos. */
  proof_at?: string | null;
  /**
   * GCash QR payment (absent before the gcash_qr_payments migration). Null for cash, and for GCash
   * paid to the rider on arrival (orders placed while the store had no QR).
   */
  payment_status?: PaymentStatus | null;
  /** Reference number the customer typed from their GCash receipt. */
  gcash_reference?: string | null;
  /** Storage path (bucket payment-proofs) of the customer's receipt screenshot. */
  payment_proof?: string | null;
  payment_submitted_at?: string | null;
  payment_reviewed_at?: string | null;
  payment_reviewed_by?: string | null;
  /** Why the admin didn't accept the payment, or an optional note when verifying it. */
  payment_note?: string | null;
  /** What the admin received in GCash; the rider collects any rest. */
  paid_amount?: number | null;
  created_at: string;
  updated_at: string;
  order_items?: OrderItem[];
  order_events?: OrderEvent[];
};

/** The single store row: where Ailyn's is (for the live map) and how delivery is priced. */
export type StoreSettings = {
  id: number;
  address: string | null;
  lat: number | null;
  lng: number | null;
  /** Fee rule; absent until the distance_delivery_fee migration is applied. */
  delivery_base_fee?: number;
  delivery_base_km?: number;
  delivery_per_km?: number;
  rider_fee_max_extra?: number;
  /** GCash QR payments; absent until the gcash_qr_payments migration is applied. No QR = pay the rider. */
  gcash_name?: string | null;
  gcash_number?: string | null;
  /** Path in the public store-assets bucket. */
  gcash_qr_path?: string | null;
  updated_at: string;
};

/** Where an online GCash payment is: unpaid → submitted → verified, or rejected (the customer resends). */
export type PaymentStatus = "unpaid" | "submitted" | "verified" | "rejected";

export type VoucherKind = "voucher" | "coupon";
export type DiscountType = "amount" | "percent" | "free_delivery";

/**
 * A discount for days the admin picks. A "voucher" is listed for customers at checkout; a "coupon"
 * is a secret code the store shares and customers type in. Dates are whole days, Philippine time.
 */
export type Voucher = {
  id: number;
  code: string;
  title: string;
  kind: VoucherKind;
  discount_type: DiscountType;
  /** Pesos off (amount), percent off (percent), unused for free delivery. */
  amount: number;
  /** Cap on a percent or free-delivery discount. */
  max_discount: number | null;
  /** Minimum item total (before delivery). */
  min_spend: number;
  /** YYYY-MM-DD */
  starts_on: string;
  ends_on: string;
  max_uses: number | null;
  per_customer: number;
  active: boolean;
  created_at: string;
  updated_at: string;
};

/** What the admin edits. */
export type VoucherInput = Omit<Voucher, "id" | "created_at" | "updated_at">;

/** The admin-editable part of the store row. */
export type FeeSettings = Pick<
  Required<StoreSettings>,
  "delivery_base_fee" | "delivery_base_km" | "delivery_per_km" | "rider_fee_max_extra"
>;

export const statusLabel: Record<OrderStatus, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  preparing: "Preparing",
  ready: "Ready for pickup",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

/** The customer-facing progress line. Cancelled is shown separately. */
export const trackingStages: OrderStatus[] = [
  "pending",
  "confirmed",
  "preparing",
  "ready",
  "out_for_delivery",
  "delivered",
];

export const activeStatuses: OrderStatus[] = [
  "pending",
  "confirmed",
  "preparing",
  "ready",
  "out_for_delivery",
];

export const roleLabel: Record<Role, string> = {
  customer: "Customer",
  rider: "Rider",
  admin: "Admin",
};

export const initials = (name: string | null | undefined) =>
  (name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

export const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" });

export const itemsSummary = (items: OrderItem[] | undefined) => {
  if (!items?.length) return "No items";
  const [first, ...rest] = items;
  return rest.length ? `${first.name} + ${rest.length} more` : first.name;
};

/** Google Maps directions to the drop-off: the customer's pin when there is one, else the address. */
export const directionsUrl = (order: Pick<Order, "address" | "city" | "province" | "dest_lat" | "dest_lng">) =>
  `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
    order.dest_lat != null && order.dest_lng != null
      ? `${order.dest_lat},${order.dest_lng}`
      : `${order.address}, ${order.city}, ${order.province}, Philippines`,
  )}`;
