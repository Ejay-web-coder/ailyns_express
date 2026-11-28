// Sales numbers for the admin dashboard and the sales report, all worked out from the loaded orders.
// "Sales" never includes cancelled orders.
import type { Product } from "../shared";
import { activeStatuses, type Order, type Profile } from "./types";

export const DAY = 86_400_000;
/** Products with fewer units than this count as low stock. */
export const LOW_STOCK = 10;

export const isSale = (o: Order) => o.status !== "cancelled";
const at = (o: Order) => new Date(o.created_at).getTime();
const round2 = (n: number) => Math.round(n * 100) / 100;

// ------------------------------------------------------------------ periods

export type Range = { start: number; end: number };

const startOfDay = (t: number | Date) => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};
const shiftDays = (t: number, n: number) => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime();
};

export const periods = [
  ["today", "Today"],
  ["yesterday", "Yesterday"],
  ["7d", "Last 7 days"],
  ["30d", "Last 30 days"],
  ["month", "This month"],
  ["last-month", "Last month"],
  ["12m", "Last 12 months"],
  ["year", "This year"],
  ["custom", "Custom dates"],
] as const;
export type PeriodId = (typeof periods)[number][0];

/** "YYYY-MM-DD" in the browser's calendar. */
export const dayKey = (t: number | Date) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const fromDayKey = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
};

/** The time span of a period, up to the end of today. `custom` uses the from/to days (inclusive). */
export function periodRange(id: PeriodId, custom?: { from: string; to: string }, now = Date.now()): Range {
  const today = startOfDay(now);
  const tomorrow = shiftDays(today, 1);
  const d = new Date(now);
  switch (id) {
    case "today":
      return { start: today, end: tomorrow };
    case "yesterday":
      return { start: shiftDays(today, -1), end: today };
    case "7d":
      return { start: shiftDays(today, -6), end: tomorrow };
    case "30d":
      return { start: shiftDays(today, -29), end: tomorrow };
    case "month":
      return { start: new Date(d.getFullYear(), d.getMonth(), 1).getTime(), end: tomorrow };
    case "last-month":
      return {
        start: new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime(),
        end: new Date(d.getFullYear(), d.getMonth(), 1).getTime(),
      };
    case "12m":
      return { start: new Date(d.getFullYear(), d.getMonth() - 11, 1).getTime(), end: tomorrow };
    case "year":
      return { start: new Date(d.getFullYear(), 0, 1).getTime(), end: tomorrow };
    case "custom": {
      const from = custom?.from ? fromDayKey(custom.from) : today;
      const to = custom?.to ? fromDayKey(custom.to) : today;
      return { start: Math.min(from, to), end: shiftDays(Math.max(from, to), 1) };
    }
  }
}

/** The same length of time just before `range`, for "vs previous period". */
export const previousRange = (range: Range): Range => ({
  start: range.start - (range.end - range.start),
  end: range.start,
});

export const inRange = (orders: Order[], range: Range) =>
  orders.filter((o) => at(o) >= range.start && at(o) < range.end);

export const formatRange = (range: Range) => {
  const last = range.end - 1;
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" };
  const a = new Date(range.start).toLocaleDateString("en-PH", opts);
  const b = new Date(last).toLocaleDateString("en-PH", opts);
  return a === b ? a : `${a} – ${b}`;
};

/** "+12%" / "−5%" / "new" compared with the previous value, or "" when both are zero. */
export function change(now: number, before: number) {
  if (!before) return now ? "new" : "";
  const pct = Math.round(((now - before) / before) * 100);
  return `${pct >= 0 ? "+" : "−"}${Math.abs(pct)}%`;
}

// ------------------------------------------------------------------ totals

export type Summary = {
  /** Every order placed, cancelled included. */
  orders: number;
  /** Orders that weren't cancelled. */
  paid: number;
  /** What customers pay: items + delivery − discounts. */
  sales: number;
  itemSales: number;
  deliveryFees: number;
  discounts: number;
  voucherOrders: number;
  itemsSold: number;
  avgOrder: number;
  delivered: number;
  inProgress: number;
  cancelled: number;
  cancelledValue: number;
  cod: { count: number; amount: number };
  gcash: { count: number; amount: number };
};

export function summarize(orders: Order[]): Summary {
  const s: Summary = {
    orders: orders.length,
    paid: 0,
    sales: 0,
    itemSales: 0,
    deliveryFees: 0,
    discounts: 0,
    voucherOrders: 0,
    itemsSold: 0,
    avgOrder: 0,
    delivered: 0,
    inProgress: 0,
    cancelled: 0,
    cancelledValue: 0,
    cod: { count: 0, amount: 0 },
    gcash: { count: 0, amount: 0 },
  };
  for (const o of orders) {
    if (!isSale(o)) {
      s.cancelled += 1;
      s.cancelledValue += Number(o.total);
      continue;
    }
    s.paid += 1;
    s.sales += Number(o.total);
    s.itemSales += Number(o.subtotal);
    s.deliveryFees += Number(o.delivery_fee);
    s.discounts += Number(o.discount);
    if (o.voucher_code) s.voucherOrders += 1;
    s.itemsSold += (o.order_items ?? []).reduce((n, i) => n + i.quantity, 0);
    if (o.status === "delivered") s.delivered += 1;
    else if (activeStatuses.includes(o.status)) s.inProgress += 1;
    const pay = o.payment_method === "gcash" ? s.gcash : s.cod;
    pay.count += 1;
    pay.amount += Number(o.total);
  }
  s.avgOrder = s.paid ? s.sales / s.paid : 0;
  return s;
}

// ------------------------------------------------------------------ products

export type ProductSale = {
  key: string;
  productId: number | null;
  name: string;
  image: string;
  /** null when the product was deleted from the catalog. */
  type: Product["type"] | null;
  category: string;
  qty: number;
  revenue: number;
  orders: number;
  product: Product | null;
};

/** Units and item sales per product, best sellers first. */
export function productSales(orders: Order[], products: Product[]): ProductSale[] {
  const byId = new Map(products.map((p) => [p.id, p]));
  const rows = new Map<string, ProductSale>();
  for (const o of orders) {
    if (!isSale(o)) continue;
    for (const item of o.order_items ?? []) {
      const key = item.product_id != null ? `p${item.product_id}` : `n${item.name}`;
      const product = item.product_id != null ? (byId.get(item.product_id) ?? null) : null;
      const row =
        rows.get(key) ??
        ({
          key,
          productId: item.product_id,
          name: product?.name ?? item.name,
          image: product?.image || item.image,
          type: product?.type ?? null,
          category: product?.category ?? "Removed product",
          qty: 0,
          revenue: 0,
          orders: 0,
          product,
        } satisfies ProductSale);
      row.qty += item.quantity;
      row.revenue = round2(row.revenue + Number(item.price) * item.quantity);
      row.orders += 1;
      rows.set(key, row);
    }
  }
  return [...rows.values()].sort((a, b) => b.qty - a.qty || b.revenue - a.revenue);
}

export type Share = { label: string; qty: number; revenue: number };

export function categorySales(rows: ProductSale[]): Share[] {
  const map = new Map<string, Share>();
  for (const r of rows) {
    const s = map.get(r.category) ?? { label: r.category, qty: 0, revenue: 0 };
    s.qty += r.qty;
    s.revenue = round2(s.revenue + r.revenue);
    map.set(r.category, s);
  }
  return [...map.values()].sort((a, b) => b.revenue - a.revenue);
}

/** Active products under LOW_STOCK, emptiest first. */
export const lowStock = (products: Product[]) =>
  products.filter((p) => p.active !== false && p.stock < LOW_STOCK).sort((a, b) => a.stock - b.stock || a.id - b.id);

// ------------------------------------------------------------------ over time

export type Bucket = { label: string; title: string; start: number; end: number; food: number; grocery: number };

/** Item sales split into food and grocery, in hours, days or months depending on the span. */
export function salesBuckets(orders: Order[], products: Product[], range: Range): Bucket[] {
  const typeOf = new Map(products.map((p) => [p.id, p.type]));
  const days = Math.round((range.end - range.start) / DAY);
  const spans: { label: string; title: string; start: number; end: number }[] = [];
  if (days <= 1) {
    for (let h = 0; h < 24; h += 3) {
      const start = range.start + h * 3_600_000;
      const label = new Date(start).toLocaleTimeString("en-PH", { hour: "numeric" }).replace(/\s/g, "");
      spans.push({ label, title: label, start, end: start + 3 * 3_600_000 });
    }
  } else if (days <= 62) {
    const size = days <= 16 ? 1 : Math.ceil(days / 16);
    for (let start = range.start; start < range.end; start = shiftDays(start, size)) {
      const d = new Date(start);
      spans.push({
        label: days <= 7 ? d.toLocaleDateString("en-PH", { weekday: "narrow" }) : String(d.getDate()),
        title: d.toLocaleDateString("en-PH", { month: "short", day: "numeric" }),
        start,
        end: Math.min(range.end, shiftDays(start, size)),
      });
    }
  } else {
    const first = new Date(range.start);
    for (let m = new Date(first.getFullYear(), first.getMonth(), 1); m.getTime() < range.end; ) {
      const next = new Date(m.getFullYear(), m.getMonth() + 1, 1);
      spans.push({
        label: m.toLocaleDateString("en-PH", { month: "narrow" }),
        title: m.toLocaleDateString("en-PH", { month: "short", year: "numeric" }),
        start: Math.max(m.getTime(), range.start),
        end: Math.min(next.getTime(), range.end),
      });
      m = next;
    }
  }
  return spans.map((span) => {
    const bucket: Bucket = { ...span, food: 0, grocery: 0 };
    for (const o of orders) {
      if (!isSale(o) || at(o) < span.start || at(o) >= span.end) continue;
      for (const item of o.order_items ?? []) {
        const type = (item.product_id != null && typeOf.get(item.product_id)) || "food";
        bucket[type] += Number(item.price) * item.quantity;
      }
    }
    return bucket;
  });
}

export type DayRow = {
  key: string;
  label: string;
  orders: number;
  cancelled: number;
  itemsSold: number;
  itemSales: number;
  deliveryFees: number;
  discounts: number;
  sales: number;
};

/** One row per day (or per month for spans over 62 days) that had orders, newest first. */
export function salesByDay(orders: Order[], range: Range): DayRow[] {
  const monthly = (range.end - range.start) / DAY > 62;
  const map = new Map<string, Order[]>();
  for (const o of orders) {
    const key = monthly ? dayKey(at(o)).slice(0, 7) : dayKey(at(o));
    map.set(key, [...(map.get(key) ?? []), o]);
  }
  return [...map.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, list]) => {
      const s = summarize(list);
      const date = monthly ? new Date(`${key}-01T00:00:00`) : new Date(`${key}T00:00:00`);
      return {
        key,
        label: monthly
          ? date.toLocaleDateString("en-PH", { month: "long", year: "numeric" })
          : date.toLocaleDateString("en-PH", { weekday: "short", month: "short", day: "numeric" }),
        orders: s.orders,
        cancelled: s.cancelled,
        itemsSold: s.itemsSold,
        itemSales: s.itemSales,
        deliveryFees: s.deliveryFees,
        discounts: s.discounts,
        sales: s.sales,
      };
    });
}

/** The hour of day with the most orders, e.g. "11AM–12PM". */
export function busiestHour(orders: Order[]) {
  const counts = new Array(24).fill(0) as number[];
  for (const o of orders) counts[new Date(o.created_at).getHours()] += 1;
  const max = Math.max(...counts);
  if (!max) return null;
  const hour = counts.indexOf(max);
  const fmt = (h: number) => new Date(2000, 0, 1, h).toLocaleTimeString("en-PH", { hour: "numeric" }).replace(/\s/g, "");
  return { label: `${fmt(hour)}–${fmt((hour + 1) % 24)}`, orders: max };
}

// ------------------------------------------------------------------ people & vouchers

export type CustomerRow = { id: string; name: string; orders: number; spent: number };

export function topCustomers(orders: Order[], profileById: Map<string, Profile>): CustomerRow[] {
  const map = new Map<string, CustomerRow>();
  for (const o of orders) {
    if (!isSale(o)) continue;
    const row = map.get(o.customer_id) ?? {
      id: o.customer_id,
      name: profileById.get(o.customer_id)?.full_name || o.customer_name,
      orders: 0,
      spent: 0,
    };
    row.orders += 1;
    row.spent = round2(row.spent + Number(o.total));
    map.set(o.customer_id, row);
  }
  return [...map.values()].sort((a, b) => b.spent - a.spent);
}

export type RiderRow = { rider: Profile; delivered: number; fees: number };

export function riderPerformance(orders: Order[], riders: Profile[]): RiderRow[] {
  return riders
    .map((rider) => {
      const mine = orders.filter((o) => o.rider_id === rider.id && o.status === "delivered");
      return { rider, delivered: mine.length, fees: round2(mine.reduce((s, o) => s + Number(o.delivery_fee), 0)) };
    })
    .filter((r) => r.delivered > 0)
    .sort((a, b) => b.delivered - a.delivered);
}

export type VoucherUse = { code: string; uses: number; discount: number; sales: number };

/** Orders that used each voucher code (cancelled ones excluded). */
export function voucherUses(orders: Order[]): VoucherUse[] {
  const map = new Map<string, VoucherUse>();
  for (const o of orders) {
    if (!isSale(o) || !o.voucher_code) continue;
    const row = map.get(o.voucher_code) ?? { code: o.voucher_code, uses: 0, discount: 0, sales: 0 };
    row.uses += 1;
    row.discount = round2(row.discount + Number(o.discount));
    row.sales = round2(row.sales + Number(o.total));
    map.set(o.voucher_code, row);
  }
  return [...map.values()].sort((a, b) => b.uses - a.uses);
}
