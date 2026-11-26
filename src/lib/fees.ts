import { useEffect, useState } from "react";
import { money } from "../shared";
import { LatLng, distanceMeters, fetchRoute, formatDistance, toLatLng, useStoreSettings } from "./geo";
import type { Order, StoreSettings } from "./types";

// Delivery pricing. The database prices every order itself in place_order()
// (supabase/migrations/20261126180000_distance_delivery_fee.sql); this file mirrors that formula so
// checkout can show the same fee before the order is placed. Keep the two in sync.

export type FeeRule = {
  /** Fee for the first `baseKm`, and the whole fee when distance pricing is off. */
  baseFee: number;
  baseKm: number;
  /** Charged for each extra km started past `baseKm`. */
  perKm: number;
  /** How much a rider may add on top of the checkout fee. */
  riderMaxExtra: number;
};

export const DEFAULT_FEE_RULE: FeeRule = { baseFee: 49, baseKm: 3, perKm: 10, riderMaxExtra: 100 };

/** With no routed road distance, the road is estimated at this many times the straight line. */
const ROAD_FACTOR = 1.3;
/** A routed distance is trusted up to this many times the straight line. */
const MAX_ROAD_FACTOR = 3;

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (value: unknown, fallback: number) =>
  value == null || !Number.isFinite(Number(value)) ? fallback : Number(value);

export function feeRule(settings: StoreSettings | null | undefined): FeeRule {
  return {
    baseFee: num(settings?.delivery_base_fee, DEFAULT_FEE_RULE.baseFee),
    baseKm: num(settings?.delivery_base_km, DEFAULT_FEE_RULE.baseKm),
    perKm: num(settings?.delivery_per_km, DEFAULT_FEE_RULE.perKm),
    riderMaxExtra: num(settings?.rider_fee_max_extra, DEFAULT_FEE_RULE.riderMaxExtra),
  };
}

/** True once the store row has a fee rule (the distance_delivery_fee migration is applied). */
export const hasFeeRule = (settings: StoreSettings | null | undefined) => settings?.delivery_base_fee != null;

/** The fee for a distance; null distance means the flat base fee. */
export function feeForKm(km: number | null, rule: FeeRule) {
  if (km == null) return rule.baseFee;
  const extraKm = Math.max(0, round2(km - rule.baseKm));
  return round2(rule.baseFee + Math.ceil(extraKm) * rule.perKm);
}

/** The distance that's charged: the routed road distance, kept within sane bounds of the straight line. */
export function chargedKm(straightKm: number, roadKm: number | null) {
  return round2(
    Math.min(Math.max(roadKm ?? straightKm * ROAD_FACTOR, straightKm), straightKm * MAX_ROAD_FACTOR),
  );
}

const kmText = (km: number) => `${Number(km.toFixed(2))} km`;

/** "₱49.00 for the first 3 km, then ₱10.00 for each extra km" */
export function describeFeeRule(rule: FeeRule) {
  if (rule.perKm <= 0) return `a flat ${money(rule.baseFee)}`;
  if (rule.baseKm <= 0) return `${money(rule.baseFee)} plus ${money(rule.perKm)} per km`;
  return `${money(rule.baseFee)} for the first ${kmText(rule.baseKm)}, then ${money(rule.perKm)} for each extra km`;
}

export const formatKm = (km: number) => formatDistance(km * 1000);

/** The highest fee the assigned rider may set on this order. */
export const riderFeeCap = (order: Order, rule: FeeRule) =>
  round2(num(order.quoted_delivery_fee, Number(order.delivery_fee)) + rule.riderMaxExtra);

/** The fee was changed after checkout. */
export const feeWasAdjusted = (order: Order) =>
  order.quoted_delivery_fee != null && Number(order.quoted_delivery_fee) !== Number(order.delivery_fee);

export type DeliveryQuote =
  | { status: "loading"; rule: FeeRule }
  /** Distance pricing is off (no store pin, or the database isn't migrated yet). */
  | { status: "flat"; rule: FeeRule; fee: number }
  | { status: "need-location"; rule: FeeRule }
  | { status: "measuring"; rule: FeeRule }
  | { status: "ready"; rule: FeeRule; fee: number; km: number; roadKm: number | null };

/** The delivery fee to `point`, worked out the same way place_order() will. */
export function useDeliveryQuote(point: LatLng | null): DeliveryQuote {
  const store = useStoreSettings();
  const rule = feeRule(store.settings);
  const from = hasFeeRule(store.settings) ? toLatLng(store.settings?.lat, store.settings?.lng) : null;
  const key = from && point ? `${from.lat},${from.lng};${point.lat},${point.lng}` : "";
  const [route, setRoute] = useState<{ key: string; roadKm: number | null } | null>(null);

  useEffect(() => {
    if (!from || !point) return;
    let live = true;
    void fetchRoute(from, point).then((r) => live && setRoute({ key, roadKm: r ? r.meters / 1000 : null }));
    return () => {
      live = false;
    };
  }, [key]);

  if (store.status === "loading") return { status: "loading", rule };
  if (!from) return { status: "flat", rule, fee: rule.baseFee };
  if (!point) return { status: "need-location", rule };
  if (route?.key !== key) return { status: "measuring", rule };
  const km = chargedKm(distanceMeters(from, point) / 1000, route.roadKm);
  return { status: "ready", rule, km, roadKm: route.roadKm, fee: feeForKm(km, rule) };
}
