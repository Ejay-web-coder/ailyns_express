import { money } from "../shared";
import type { DiscountType, Voucher, VoucherInput } from "./types";

// Keep in sync with place_order() in the migrations.
export const WELCOME_DISCOUNT = 30;

/** Today's date in the Philippines as YYYY-MM-DD, the calendar vouchers run on. */
export const manilaToday = (at = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(at);

/** "AB c-1" → "ABC-1": the form codes are stored in. */
export const normalizeCode = (raw: string) => raw.toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 20);
export const validCode = (code: string) => /^[A-Z0-9_-]{3,20}$/.test(code);

/** A code from the title's first word plus a few random characters, e.g. "XMAS-7KQ4". */
export function suggestCode(title: string) {
  const word = normalizeCode(title.split(/\s+/).find((w) => /[a-z0-9]/i.test(w)) ?? "").replace(/[-_]/g, "");
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const tail = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  return `${(word || "PROMO").slice(0, 8)}-${tail}`;
}

/** What a voucher takes off an order (same rule as voucher_discount() in the database). */
export function voucherDiscount(
  v: Pick<Voucher, "discount_type" | "amount" | "max_discount">,
  subtotal: number,
  fee: number | null,
) {
  const amount = Number(v.amount);
  const cap = v.max_discount == null ? null : Number(v.max_discount);
  const raw =
    v.discount_type === "amount"
      ? Math.min(amount, subtotal)
      : v.discount_type === "percent"
        ? Math.min((subtotal * amount) / 100, cap ?? subtotal)
        : Math.min(fee ?? 0, cap ?? (fee ?? 0));
  return Math.round(Math.max(0, raw) * 100) / 100;
}

const peso = (n: number) => money(Number(n)).replace(/\.00$/, "");

/** "₱50 off", "10% off up to ₱100", "Free delivery". */
export function describeDiscount(v: Pick<Voucher, "discount_type" | "amount" | "max_discount">) {
  const cap = v.max_discount != null ? ` up to ${peso(v.max_discount)}` : "";
  if (v.discount_type === "amount") return `${peso(v.amount)} off`;
  if (v.discount_type === "percent") return `${Number(v.amount)}% off${cap}`;
  return `Free delivery${cap}`;
}

export const discountTypeLabel: Record<DiscountType, string> = {
  amount: "Peso amount off",
  percent: "Percent off",
  free_delivery: "Free delivery",
};

const parseDay = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const toDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export const formatDay = (day: string, withYear = true) =>
  parseDay(day).toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
  });

/** "Dec 25, 2026", "Dec 24 – Dec 25, 2026" or "Dec 31, 2026 – Jan 1, 2027". */
export function formatDays(start: string, end: string) {
  if (start === end) return formatDay(start);
  if (start.slice(0, 4) === end.slice(0, 4)) return `${formatDay(start, false)} – ${formatDay(end)}`;
  return `${formatDay(start)} – ${formatDay(end)}`;
}

export type VoucherState = "running" | "scheduled" | "ended" | "claimed" | "off";

export const voucherStateLabel: Record<VoucherState, string> = {
  running: "Running",
  scheduled: "Scheduled",
  ended: "Ended",
  claimed: "Fully claimed",
  off: "Off",
};

export function voucherState(v: Voucher, uses: number, today = manilaToday()): VoucherState {
  if (!v.active) return "off";
  if (today < v.starts_on) return "scheduled";
  if (today > v.ends_on) return "ended";
  if (v.max_uses != null && uses >= v.max_uses) return "claimed";
  return "running";
}

/** One line for customers: "₱50 off · min. spend ₱300 · until Dec 25". */
export function voucherFinePrint(v: Pick<Voucher, "min_spend" | "ends_on" | "starts_on">, today = manilaToday()) {
  const parts: string[] = [];
  if (Number(v.min_spend) > 0) parts.push(`min. spend ${peso(v.min_spend)}`);
  parts.push(v.ends_on === today ? "today only" : `until ${formatDay(v.ends_on, false)}`);
  return parts.join(" · ");
}

export const emptyVoucher = (): VoucherInput => {
  const today = manilaToday();
  return {
    code: "",
    title: "",
    kind: "voucher",
    discount_type: "amount",
    amount: 50,
    max_discount: null,
    min_spend: 0,
    starts_on: today,
    ends_on: today,
    max_uses: null,
    per_customer: 1,
    active: true,
  };
};

// ------------------------------------------------------------------ special days

export type SpecialDay = { label: string; title: string; start: string; end: string };

const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
/** The nth Sunday (1-based) of a month. */
const nthSunday = (year: number, month: number, n: number) => {
  const first = new Date(year, month, 1);
  return new Date(year, month, 1 + ((7 - first.getDay()) % 7) + (n - 1) * 7);
};

/**
 * Quick date picks for the voucher form: today, this weekend, the next payday and the next
 * Philippine holidays and occasions, soonest first.
 */
export function specialDays(todayStr = manilaToday()): SpecialDay[] {
  const today = parseDay(todayStr);
  const year = today.getFullYear();
  const day = today.getDay();
  const saturday = day === 0 ? today : addDays(today, 6 - day);
  const sunday = day === 0 ? today : addDays(saturday, 1);
  const monthEnd = new Date(year, today.getMonth() + 1, 0);
  const payday = today.getDate() <= 15 ? new Date(year, today.getMonth(), 15) : monthEnd;

  // [label, title, start(year), length in days]
  const yearly: [string, string, (y: number) => Date, number][] = [
    ["Valentine's Day", "Valentine's Treat", (y) => new Date(y, 1, 14), 1],
    ["Mother's Day", "Mother's Day Special", (y) => nthSunday(y, 4, 2), 1],
    ["Father's Day", "Father's Day Special", (y) => nthSunday(y, 5, 3), 1],
    ["Independence Day", "Independence Day Sale", (y) => new Date(y, 5, 12), 1],
    ["Undas", "Undas Sale", (y) => new Date(y, 10, 1), 2],
    ["Christmas", "Christmas Sale", (y) => new Date(y, 11, 24), 2],
    ["New Year", "New Year Sale", (y) => new Date(y, 11, 31), 2],
  ];
  const upcoming = yearly
    .map(([label, title, at, length]) => {
      let start = at(year);
      if (addDays(start, length - 1) < today) start = at(year + 1);
      return { label, title, start: toDay(start), end: toDay(addDays(start, length - 1)) };
    })
    .sort((a, b) => a.start.localeCompare(b.start));

  return [
    { label: "Today", title: "", start: todayStr, end: todayStr },
    { label: "This weekend", title: "Weekend Sale", start: toDay(saturday), end: toDay(sunday) },
    { label: "Payday", title: "Payday Sale", start: toDay(payday), end: toDay(payday) },
    ...upcoming,
  ];
}
