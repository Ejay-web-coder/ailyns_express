import { FormEvent, useMemo, useState } from "react";
import { Icon, Notify, Spinner, Status, money } from "../shared";
import { saveVoucher, setVoucherActive } from "../lib/api";
import { errorMessage } from "../lib/supabase";
import type { DiscountType, Order, Voucher, VoucherInput, VoucherKind } from "../lib/types";
import {
  VoucherState,
  describeDiscount,
  emptyVoucher,
  formatDays,
  manilaToday,
  normalizeCode,
  specialDays,
  suggestCode,
  validCode,
  voucherState,
  voucherStateLabel,
} from "../lib/vouchers";

type Usage = { uses: number; discount: number; sales: number };

/** Vouchers and coupons the admin sets up for the days they choose. */
export function AdminVouchers({
  vouchers,
  orders,
  reload,
  notify,
}: {
  /** null: the vouchers migration isn't applied yet. undefined: still loading. */
  vouchers: Voucher[] | null | undefined;
  orders: Order[];
  reload: () => Promise<unknown>;
  notify: Notify;
}) {
  const [editing, setEditing] = useState<{ id?: number; draft: VoucherInput } | null>(null);
  const [filter, setFilter] = useState<"all" | VoucherState>("all");
  const [busy, setBusy] = useState<number | null>(null);
  const today = manilaToday();

  const usage = useMemo(() => {
    const map = new Map<number, Usage>();
    for (const o of orders) {
      if (o.status === "cancelled" || o.voucher_id == null) continue;
      const row = map.get(o.voucher_id) ?? { uses: 0, discount: 0, sales: 0 };
      row.uses += 1;
      row.discount += Number(o.discount);
      row.sales += Number(o.total);
      map.set(o.voucher_id, row);
    }
    return map;
  }, [orders]);

  if (vouchers === undefined) return <Spinner label="Loading vouchers" />;
  if (vouchers === null) {
    return (
      <>
        <VoucherHead onNew={undefined} />
        <section className="panel voucher-missing">
          <Icon name="ticket" size={30} />
          <h3>Vouchers aren't switched on yet</h3>
          <p>
            Run the <code>supabase/migrations/20261127000000_vouchers.sql</code> migration in the Supabase SQL editor,
            then reload this page.
          </p>
        </section>
      </>
    );
  }

  const rows = vouchers
    .map((v) => ({ v, use: usage.get(v.id) ?? { uses: 0, discount: 0, sales: 0 } }))
    .map((r) => ({ ...r, state: voucherState(r.v, r.use.uses, today) }));
  const order: VoucherState[] = ["running", "scheduled", "claimed", "ended", "off"];
  rows.sort(
    (a, b) =>
      order.indexOf(a.state) - order.indexOf(b.state) ||
      (a.state === "scheduled" ? a.v.starts_on.localeCompare(b.v.starts_on) : b.v.ends_on.localeCompare(a.v.ends_on)),
  );
  const count = (s: VoucherState) => rows.filter((r) => r.state === s).length;
  const visible = filter === "all" ? rows : rows.filter((r) => r.state === filter);
  const totalUses = rows.reduce((n, r) => n + r.use.uses, 0);
  const totalDiscount = rows.reduce((n, r) => n + r.use.discount, 0);

  const toggle = async (v: Voucher) => {
    setBusy(v.id);
    try {
      await setVoucherActive(v.id, !v.active);
      await reload();
      notify(v.active ? `${v.code} turned off` : `${v.code} turned on`);
    } catch (e) {
      notify(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  };

  const tabs: ["all" | VoucherState, string, number][] = [
    ["all", "All", rows.length],
    ["running", "Running", count("running")],
    ["scheduled", "Scheduled", count("scheduled")],
    ["ended", "Ended", count("ended") + count("claimed")],
    ["off", "Off", count("off")],
  ];

  return (
    <>
      <VoucherHead onNew={() => setEditing({ draft: emptyVoucher() })} />
      <div className="chatbot-stats voucher-stats">
        {[
          ["ticket", String(count("running")), "Running today"],
          ["clock", String(count("scheduled")), "Scheduled"],
          ["check", String(totalUses), "Times used"],
          ["wallet", money(totalDiscount), "Discounts given"],
        ].map(([icon, value, label]) => (
          <div key={label}>
            <span>
              <Icon name={icon} />
            </span>
            <p>
              <strong>{value}</strong>
              <small>{label}</small>
            </p>
          </div>
        ))}
      </div>
      <div className="order-tabs">
        {tabs.map(([id, label, n]) => (
          <button key={id} className={filter === id ? "active" : ""} onClick={() => setFilter(id)}>
            {label}
            <span>{n}</span>
          </button>
        ))}
      </div>
      <section className="panel admin-table-wrap">
        <table className="admin-table voucher-table">
          <thead>
            <tr>
              <th>Voucher</th>
              <th>Discount</th>
              <th>Days</th>
              <th>Used</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={6} className="empty-cell">
                  {rows.length === 0
                    ? "No vouchers yet. Create one for your next special day."
                    : "No vouchers in this list."}
                </td>
              </tr>
            )}
            {visible.map(({ v, use, state }) => (
              <tr key={v.id} className={state === "running" ? "row-running" : ""}>
                <td>
                  <div className="voucher-cell">
                    <span className={`voucher-code ${v.kind}`}>{v.code}</span>
                    <div>
                      <strong>{v.title}</strong>
                      <small>{v.kind === "voucher" ? "Voucher · shown at checkout" : "Coupon · secret code"}</small>
                    </div>
                  </div>
                </td>
                <td>
                  <strong>{describeDiscount(v)}</strong>
                  <small>{Number(v.min_spend) > 0 ? `Min. spend ${money(v.min_spend)}` : "No minimum spend"}</small>
                </td>
                <td>
                  {formatDays(v.starts_on, v.ends_on)}
                  <small>
                    {state === "scheduled"
                      ? `Starts in ${daysBetween(today, v.starts_on)} day${daysBetween(today, v.starts_on) === 1 ? "" : "s"}`
                      : state === "running"
                        ? v.ends_on === today
                          ? "Last day today"
                          : `${daysBetween(today, v.ends_on) + 1} days left`
                        : ""}
                  </small>
                </td>
                <td>
                  <strong>
                    {use.uses}
                    {v.max_uses != null ? ` / ${v.max_uses}` : ""}
                  </strong>
                  <small>
                    {use.uses ? `${money(use.discount)} off · ` : ""}
                    {v.per_customer === 1 ? "1 per customer" : `${v.per_customer} per customer`}
                  </small>
                </td>
                <td>
                  <Status value={voucherStateLabel[state]} />
                </td>
                <td>
                  <div className="table-actions">
                    <button onClick={() => setEditing({ id: v.id, draft: toInput(v) })}>Edit</button>
                    <button
                      className={`avail-toggle ${v.active ? "on" : ""}`}
                      role="switch"
                      aria-checked={v.active}
                      disabled={busy === v.id}
                      onClick={() => void toggle(v)}
                    >
                      <span />
                      {v.active ? "On" : "Off"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <p className="prototype-note">
        Customers get one discount per order: the bigger of the voucher and the ₱30 first-order discount. Cancelled orders
        give the voucher back. Dates follow Philippine time and include the whole end day.
      </p>
      {editing && (
        <VoucherForm
          id={editing.id}
          initial={editing.draft}
          used={editing.id != null ? (usage.get(editing.id)?.uses ?? 0) : 0}
          onClose={() => setEditing(null)}
          onSaved={async (v, isNew) => {
            await reload();
            setEditing(null);
            notify(isNew ? `${v.code} created` : `${v.code} saved`);
          }}
          notify={notify}
        />
      )}
    </>
  );
}

function VoucherHead({ onNew }: { onNew?: () => void }) {
  return (
    <div className="admin-page-head">
      <div>
        <h2>Vouchers & coupons</h2>
        <p>
          Discounts for the special days you choose. Vouchers are listed for customers at checkout; coupons are secret
          codes you share, for example on Facebook.
        </p>
      </div>
      {onNew && (
        <button className="button button-primary" onClick={onNew}>
          <Icon name="plus" /> <span>New voucher</span>
        </button>
      )}
    </div>
  );
}

const daysBetween = (from: string, to: string) =>
  Math.round((new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / 86_400_000);

const toInput = (v: Voucher): VoucherInput => ({
  code: v.code,
  title: v.title,
  kind: v.kind,
  discount_type: v.discount_type,
  amount: v.amount,
  max_discount: v.max_discount,
  min_spend: v.min_spend,
  starts_on: v.starts_on,
  ends_on: v.ends_on,
  max_uses: v.max_uses,
  per_customer: v.per_customer,
  active: v.active,
});

function VoucherForm({
  id,
  initial,
  used,
  onClose,
  onSaved,
  notify,
}: {
  id?: number;
  initial: VoucherInput;
  used: number;
  onClose: () => void;
  onSaved: (v: Voucher, isNew: boolean) => Promise<void>;
  notify: Notify;
}) {
  const [v, setV] = useState(initial);
  // Number fields are kept as typed so they can be cleared while editing.
  const [text, setText] = useState({
    amount: String(initial.amount || ""),
    max_discount: initial.max_discount == null ? "" : String(initial.max_discount),
    min_spend: initial.min_spend ? String(initial.min_spend) : "",
    max_uses: initial.max_uses == null ? "" : String(initial.max_uses),
    per_customer: String(initial.per_customer),
  });
  const [busy, setBusy] = useState(false);
  const days = useMemo(() => specialDays(), []);
  const set = <K extends keyof VoucherInput>(key: K, value: VoucherInput[K]) => setV((d) => ({ ...d, [key]: value }));
  const num = (key: keyof typeof text) => (text[key].trim() === "" ? null : Number(text[key]));

  const amount = num("amount") ?? 0;
  const cap = num("max_discount");
  const preview = { discount_type: v.discount_type, amount, max_discount: cap };
  const problem = (() => {
    if (v.title.trim().length < 2) return "Give the voucher a name, like “Christmas Sale”.";
    if (!validCode(v.code)) return "The code needs 3 to 20 letters or numbers (dashes are OK).";
    if (v.discount_type === "amount" && !(amount > 0 && amount <= 10000)) return "Enter a peso discount from ₱1 to ₱10,000.";
    if (v.discount_type === "percent" && !(amount >= 1 && amount <= 100)) return "Enter a percentage from 1 to 100.";
    if (cap != null && !(cap > 0 && cap <= 10000)) return "The maximum discount must be from ₱1 to ₱10,000, or blank.";
    const min = num("min_spend");
    if (min != null && !(min >= 0 && min <= 100000)) return "The minimum spend must be ₱0 or more.";
    const maxUses = num("max_uses");
    if (maxUses != null && !(Number.isInteger(maxUses) && maxUses >= 1)) return "Total uses must be a whole number, or blank.";
    const per = num("per_customer");
    if (per == null || !(Number.isInteger(per) && per >= 1 && per <= 100)) return "Uses per customer must be 1 to 100.";
    if (!v.starts_on || !v.ends_on) return "Pick the start and end days.";
    if (v.ends_on < v.starts_on) return "The end day is before the start day.";
    return "";
  })();

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (problem) {
      notify(problem, "error");
      return;
    }
    const input: VoucherInput = {
      ...v,
      title: v.title.trim(),
      amount: v.discount_type === "free_delivery" ? 0 : Math.round(amount * 100) / 100,
      max_discount: v.discount_type === "amount" || cap == null ? null : Math.round(cap * 100) / 100,
      min_spend: Math.round((num("min_spend") ?? 0) * 100) / 100,
      max_uses: num("max_uses"),
      per_customer: num("per_customer") ?? 1,
    };
    setBusy(true);
    try {
      const saved = await saveVoucher(input, id);
      await onSaved(saved, id == null);
    } catch (err) {
      notify(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  };

  const pickDays = (d: { title: string; start: string; end: string }) =>
    setV((cur) => ({
      ...cur,
      starts_on: d.start,
      ends_on: d.end,
      title: cur.title.trim() || !d.title ? cur.title : d.title,
    }));

  const numberField = (key: keyof typeof text, label: string, hint?: string, placeholder?: string) => (
    <label>
      {label}
      <input
        type="number"
        inputMode="decimal"
        min={0}
        step="any"
        value={text[key]}
        placeholder={placeholder}
        onChange={(e) => setText((t) => ({ ...t, [key]: e.target.value }))}
      />
      {hint && <small className="field-hint">{hint}</small>}
    </label>
  );

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form className="admin-modal voucher-modal" onSubmit={save} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-title">
          <div>
            <p className="eyebrow">VOUCHERS & COUPONS</p>
            <h2>{id == null ? "New voucher" : `Edit ${initial.code}`}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>

        <div className="voucher-kinds" role="radiogroup" aria-label="Kind">
          {(
            [
              ["voucher", "Voucher", "Listed for every customer at checkout. They tap to use it."],
              ["coupon", "Coupon", "A secret code you share. Customers type it in at checkout."],
            ] as [VoucherKind, string, string][]
          ).map(([kind, label, help]) => (
            <button
              type="button"
              key={kind}
              role="radio"
              aria-checked={v.kind === kind}
              className={v.kind === kind ? "active" : ""}
              onClick={() => set("kind", kind)}
            >
              <span className="radio" />
              <div>
                <strong>{label}</strong>
                <small>{help}</small>
              </div>
            </button>
          ))}
        </div>

        <div className="field-grid">
          <label>
            Name customers see
            <input
              value={v.title}
              maxLength={60}
              onChange={(e) => set("title", e.target.value)}
              placeholder="Christmas Sale"
              required
            />
          </label>
          <label>
            Code
            <div className="code-input">
              <input
                value={v.code}
                maxLength={20}
                onChange={(e) => set("code", normalizeCode(e.target.value))}
                placeholder="XMAS2026"
                required
                aria-describedby="code-hint"
              />
              <button type="button" onClick={() => set("code", suggestCode(v.title))}>
                Suggest
              </button>
            </div>
            <small className="field-hint" id="code-hint">
              {used > 0 ? `Used ${used} time${used === 1 ? "" : "s"}; past orders keep the old code.` : "Letters, numbers and dashes."}
            </small>
          </label>
          <label>
            Discount
            <select value={v.discount_type} onChange={(e) => set("discount_type", e.target.value as DiscountType)}>
              <option value="amount">Peso amount off the items</option>
              <option value="percent">Percent off the items</option>
              <option value="free_delivery">Free delivery</option>
            </select>
          </label>
          {v.discount_type === "amount" && numberField("amount", "Amount off (₱)")}
          {v.discount_type === "percent" && numberField("amount", "Percent off (%)")}
          {v.discount_type !== "amount" &&
            numberField(
              "max_discount",
              v.discount_type === "percent" ? "Maximum discount (₱)" : "Covers delivery up to (₱)",
              "Leave blank for no limit.",
              "No limit",
            )}
          {numberField("min_spend", "Minimum spend on items (₱)", "Leave blank for no minimum.", "No minimum")}

          <div className="full-field">
            <span className="field-label">Special day</span>
            <div className="fee-chips day-chips">
              {days.map((d) => (
                <button
                  type="button"
                  key={d.label}
                  className={v.starts_on === d.start && v.ends_on === d.end ? "active" : ""}
                  onClick={() => pickDays(d)}
                  title={formatDays(d.start, d.end)}
                >
                  {d.label}
                  <small>{formatDays(d.start, d.end).replace(/, \d{4}/g, "")}</small>
                </button>
              ))}
            </div>
          </div>
          <label>
            First day
            <input type="date" value={v.starts_on} onChange={(e) => set("starts_on", e.target.value)} required />
          </label>
          <label>
            Last day
            <input
              type="date"
              value={v.ends_on}
              min={v.starts_on}
              onChange={(e) => set("ends_on", e.target.value)}
              required
            />
          </label>
          {numberField("max_uses", "Total uses", "For example the first 50 orders. Blank: no limit.", "No limit")}
          {numberField("per_customer", "Uses per customer")}
          <label className="check-label product-active">
            <input type="checkbox" checked={v.active} onChange={(e) => set("active", e.target.checked)} /> Turned on
          </label>
        </div>

        <p className={`voucher-preview ${problem ? "bad" : ""}`}>
          <Icon name={problem ? "alert" : "ticket"} size={18} />
          <span>
            {problem ||
              `${v.code}: ${describeDiscount(preview)}${
                (num("min_spend") ?? 0) > 0 ? ` on orders with items of ${money(num("min_spend") ?? 0)} or more` : ""
              }, ${formatDays(v.starts_on, v.ends_on)}${v.kind === "coupon" ? ", for customers who have the code" : ", shown to every customer"}.`}
          </span>
        </p>

        <div className="modal-buttons">
          <button type="button" className="button button-outline" onClick={onClose}>
            Cancel
          </button>
          <button className="button button-primary" disabled={busy}>
            {busy ? "Saving…" : id == null ? "Create voucher" : "Save voucher"}
          </button>
        </div>
      </form>
    </div>
  );
}
