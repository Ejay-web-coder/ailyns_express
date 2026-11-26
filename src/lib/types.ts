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
  discount: number;
  total: number;
  rider_lat: number | null;
  rider_lng: number | null;
  rider_location_at: string | null;
  /** Drop-off pin the customer set at checkout (absent before the live_route_map migration). */
  dest_lat?: number | null;
  dest_lng?: number | null;
  created_at: string;
  updated_at: string;
  order_items?: OrderItem[];
  order_events?: OrderEvent[];
};

/** The single store row: where Ailyn's is, for the live map. */
export type StoreSettings = {
  id: number;
  address: string | null;
  lat: number | null;
  lng: number | null;
  updated_at: string;
};

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
