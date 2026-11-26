import { FormEvent, useState } from "react";
import { Notify, money } from "../shared";
import { setDeliveryFee } from "../lib/api";
import { feeRule, feeWasAdjusted, formatKm, hasFeeRule, riderFeeCap } from "../lib/fees";
import { useStoreSettings } from "../lib/geo";
import { errorMessage } from "../lib/supabase";
import type { Order } from "../lib/types";

/** Most common reasons, one tap for a rider on the road. */
const QUICK_REASONS = ["Heavy items", "Bulky items", "Many items", "Extra stop", "Long wait at drop-off"];
const ADMIN_MAX_FEE = 10000;

/** "4.2 km from the store · was ₱49.00" */
export function feeSummary(order: Order) {
  const km = order.delivery_km != null ? `${formatKm(Number(order.delivery_km))} from the store` : "Flat fee";
  return feeWasAdjusted(order) ? `${km} · was ${money(Number(order.quoted_delivery_fee))}` : km;
}

/**
 * The order's delivery fee, with an "Adjust fee" form for the assigned rider (up to the checkout
 * fee + the store's rider allowance) or an admin (any amount). Hidden once the order is closed.
 */
export function DeliveryFeeEditor({
  order,
  viewer,
  notify,
  onSaved,
}: {
  order: Order;
  viewer: "rider" | "admin";
  notify: Notify;
  onSaved: () => void;
}) {
  const store = useStoreSettings();
  const rule = feeRule(store.settings);
  const [open, setOpen] = useState(false);
  const [fee, setFee] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const closed = order.status === "delivered" || order.status === "cancelled";
  const current = Number(order.delivery_fee);
  const quoted = Number(order.quoted_delivery_fee ?? order.delivery_fee);
  const cap = viewer === "rider" ? riderFeeCap(order, rule) : ADMIN_MAX_FEE;
  // The adjust function arrives with the distance_delivery_fee migration, as does the fee rule.
  const canAdjust = !closed && hasFeeRule(store.settings);

  const value = fee.trim() === "" ? NaN : Math.round(Number(fee) * 100) / 100;
  const newTotal = Number.isFinite(value)
    ? Math.max(0, Number(order.subtotal) + value - Number(order.discount))
    : null;

  const start = () => {
    setFee(String(current));
    setReason("");
    setOpen(true);
  };

  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!Number.isFinite(value) || value < 0) return notify("Enter the delivery fee in pesos", "error");
    if (value > cap) return notify(`You can charge at most ${money(cap)} for this order`, "error");
    if (!reason.trim()) return notify("Add a reason the customer will see", "error");
    if (value === current) {
      setOpen(false);
      return;
    }
    setBusy(true);
    try {
      await setDeliveryFee(order.id, value, reason.trim());
      notify(`Delivery fee for #${order.code} is now ${money(value)}`);
      setOpen(false);
      onSaved();
    } catch (err) {
      notify(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fee-box">
      <div className="fee-box-head">
        <div>
          <small>DELIVERY FEE</small>
          <strong>{money(current)}</strong>
          <span>{feeSummary(order)}</span>
          {feeWasAdjusted(order) && order.delivery_fee_note && (
            <span className="fee-note">Reason: {order.delivery_fee_note}</span>
          )}
        </div>
        {canAdjust && !open && (
          <button type="button" className="button button-soft" onClick={start}>
            Adjust fee
          </button>
        )}
      </div>
      {open && (
        <form className="fee-form" onSubmit={save}>
          <div className="fee-chips" role="group" aria-label="Common reasons">
            {QUICK_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                className={reason === r ? "active" : ""}
                aria-pressed={reason === r}
                onClick={() => setReason(r)}
              >
                {r}
              </button>
            ))}
          </div>
          <div className="field-grid">
            <label>
              New fee (₱)
              <input
                type="number"
                inputMode="decimal"
                min={0}
                max={cap}
                step="any"
                value={fee}
                onChange={(e) => setFee(e.target.value)}
                required
              />
            </label>
            <label>
              Reason
              <input
                value={reason}
                maxLength={200}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. 2 sacks of rice"
                required
              />
            </label>
          </div>
          <small className="fee-help">
            {viewer === "rider"
              ? `Up to ${money(cap)}: the checkout fee of ${money(quoted)} plus up to ${money(rule.riderMaxExtra)} for heavy, bulky or many items. `
              : `Checkout fee was ${money(quoted)}. `}
            The customer sees the new fee and the reason on their order.
            {newTotal != null && (
              <>
                {" "}
                New total: <b>{money(newTotal)}</b>
                {order.payment_method === "cod" ? " cash." : " via GCash."}
              </>
            )}
          </small>
          <div className="fee-actions">
            <button type="button" className="button button-outline" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="button button-primary" disabled={busy}>
              {busy ? "Saving…" : "Save fee"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
