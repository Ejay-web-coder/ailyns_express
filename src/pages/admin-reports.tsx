import { useMemo, useState } from "react";
import { FALLBACK_IMAGE, Icon, Notify, Product, imgFallback, money } from "../shared";
import { statusLabel, type Order, type Profile } from "../lib/types";
import {
  Bucket,
  LOW_STOCK,
  PeriodId,
  busiestHour,
  categorySales,
  change,
  dayKey,
  formatRange,
  inRange,
  periodRange,
  periods,
  previousRange,
  productSales,
  riderPerformance,
  salesBuckets,
  salesByDay,
  summarize,
  topCustomers,
  voucherUses,
} from "../lib/sales";

export function SalesChart({ buckets }: { buckets: Bucket[] }) {
  const max = Math.max(1, ...buckets.map((b) => Math.max(b.food, b.grocery)));
  return (
    <div className="bar-chart">
      {buckets.map((b, i) => (
        <div className="bar-group" key={i} title={`${b.title} · Meals ${money(b.food)} · Products ${money(b.grocery)}`}>
          <span style={{ height: `${Math.max(2, (b.food / max) * 90)}%` }} />
          <span style={{ height: `${Math.max(2, (b.grocery / max) * 90)}%` }} />
          <small>{b.label}</small>
        </div>
      ))}
    </div>
  );
}

const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);

function Share({ label, value, detail, of }: { label: string; value: number; detail: string; of: number }) {
  return (
    <div className="share-row">
      <div>
        <span>{label}</span>
        <small>{detail}</small>
      </div>
      <div className="pct-bar" aria-hidden="true">
        <i style={{ width: `${Math.max(2, pct(value, of))}%` }} />
      </div>
      <b>{pct(value, of)}%</b>
    </div>
  );
}

function csv(name: string, header: string[], rows: (string | number | null | undefined)[][]) {
  const text = [header, ...rows]
    .map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `ailyns-${name}-${dayKey(Date.now())}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function AdminReports({
  orders,
  products,
  customers,
  riders,
  profileById,
  downloadOrders,
  notify,
}: {
  orders: Order[];
  products: Product[];
  customers: Profile[];
  riders: Profile[];
  profileById: Map<string, Profile>;
  downloadOrders: (orders: Order[], name: string) => void;
  notify: Notify;
}) {
  const [period, setPeriod] = useState<PeriodId>("month");
  const [custom, setCustom] = useState(() => ({ from: dayKey(Date.now() - 6 * 86_400_000), to: dayKey(Date.now()) }));
  const [productType, setProductType] = useState<"all" | Product["type"]>("all");
  const [showAllProducts, setShowAllProducts] = useState(false);

  const range = useMemo(() => periodRange(period, custom), [period, custom]);
  const scoped = useMemo(() => inRange(orders, range), [orders, range]);
  const before = useMemo(() => summarize(inRange(orders, previousRange(range))), [orders, range]);
  const s = useMemo(() => summarize(scoped), [scoped]);
  const buckets = useMemo(() => salesBuckets(scoped, products, range), [scoped, products, range]);
  const days = useMemo(() => salesByDay(scoped, range), [scoped, range]);
  const sold = useMemo(() => productSales(scoped, products), [scoped, products]);
  const categories = useMemo(() => categorySales(sold), [sold]);
  const customersTop = useMemo(() => topCustomers(scoped, profileById).slice(0, 8), [scoped, profileById]);
  const ridersTop = useMemo(() => riderPerformance(scoped, riders), [scoped, riders]);
  const vouchers = useMemo(() => voucherUses(scoped), [scoped]);
  const peak = useMemo(() => busiestHour(scoped), [scoped]);

  const label = periods.find(([id]) => id === period)?.[1] ?? "";
  const rangeText = formatRange(range);
  const fileName = (what: string) => `${what}-${dayKey(range.start)}-to-${dayKey(range.end - 1)}`;
  const newCustomers = customers.filter((c) => {
    const t = new Date(c.created_at).getTime();
    return t >= range.start && t < range.end;
  }).length;
  const food = buckets.reduce((n, b) => n + b.food, 0);
  const grocery = buckets.reduce((n, b) => n + b.grocery, 0);
  const foodPct = food + grocery ? Math.round((food / (food + grocery)) * 100) : 50;
  const soldShown = sold.filter((r) => productType === "all" || r.type === productType);
  const soldVisible = showAllProducts ? soldShown : soldShown.slice(0, 10);
  const unsold = products.filter((p) => p.active !== false && !sold.some((r) => r.productId === p.id));
  const vsBefore = (now: number, prev: number) => {
    const c = change(now, prev);
    return c ? `${c} vs previous period` : "Same as previous period";
  };

  const kpis: [string, string, string, string?][] = [
    ["NET SALES", money(s.sales), vsBefore(s.sales, before.sales), s.sales >= before.sales ? "up" : "down"],
    ["ORDERS", String(s.paid), `${s.orders} placed · ${vsBefore(s.paid, before.paid)}`, s.paid >= before.paid ? "up" : "down"],
    ["AVERAGE ORDER", money(s.avgOrder), "Excluding cancelled orders"],
    ["ITEMS SOLD", String(s.itemsSold), `${sold.length} different products`],
    ["ITEM SALES", money(s.itemSales), "Before delivery and discounts"],
    ["DELIVERY FEES", money(s.deliveryFees), `${money(s.paid ? s.deliveryFees / s.paid : 0)} per order`],
    ["DISCOUNTS GIVEN", money(s.discounts), `${s.voucherOrders} order${s.voucherOrders === 1 ? "" : "s"} with a voucher`],
    ["CANCELLED", String(s.cancelled), `${money(s.cancelledValue)} not collected`, s.cancelled ? "down" : undefined],
  ];

  return (
    <div className="report-page">
      <div className="admin-page-head report-head">
        <div>
          <h2>Sales report</h2>
          <p>
            {label} · {rangeText}. Computed from live orders; cancelled orders are left out of sales.
          </p>
        </div>
        <div className="report-actions">
          <select value={period} onChange={(e) => setPeriod(e.target.value as PeriodId)} aria-label="Report period">
            {periods.map(([id, text]) => (
              <option key={id} value={id}>
                {text}
              </option>
            ))}
          </select>
          {period === "custom" && (
            <span className="custom-dates">
              <input
                type="date"
                value={custom.from}
                max={custom.to}
                onChange={(e) => e.target.value && setCustom((c) => ({ ...c, from: e.target.value }))}
                aria-label="From"
              />
              <span>to</span>
              <input
                type="date"
                value={custom.to}
                min={custom.from}
                onChange={(e) => e.target.value && setCustom((c) => ({ ...c, to: e.target.value }))}
                aria-label="To"
              />
            </span>
          )}
          <button className="button button-outline" onClick={() => window.print()}>
            <Icon name="report" size={17} /> <span>Print</span>
          </button>
        </div>
      </div>

      <div className="report-kpis detailed">
        {kpis.map(([title, value, detail, trend]) => (
          <div key={title}>
            <small>{title}</small>
            <strong>{value}</strong>
            <span className={trend === "down" ? "trend-down" : trend === "up" ? "trend-up" : "trend-flat"}>{detail}</span>
          </div>
        ))}
      </div>

      <div className="reports-grid">
        <section className="panel">
          <div className="panel-title">
            <div>
              <h3>Sales trend</h3>
              <p>Item sales · meals vs products</p>
            </div>
            <strong>
              {money(food + grocery)} <small>item sales</small>
            </strong>
          </div>
          <SalesChart buckets={buckets} />
          <div className="chart-legend">
            <span>
              <i />
              Meals
            </span>
            <span>
              <i />
              Products
            </span>
          </div>
        </section>
        <section className="panel donut-panel">
          <div className="panel-title">
            <div>
              <h3>Meals vs products</h3>
              <p>Share of item sales</p>
            </div>
          </div>
          <div className="donut" style={{ background: `conic-gradient(var(--pink) 0 ${foodPct}%, #f1b5c5 ${foodPct}%)` }}>
            <div>
              <strong>{money(food + grocery).replace(/\.00$/, "")}</strong>
              <small>Item sales</small>
            </div>
          </div>
          <div className="donut-legend">
            <span>
              <i />
              Meals <strong>{foodPct}%</strong>
            </span>
            <span>
              <i />
              Products <strong>{100 - foodPct}%</strong>
            </span>
            <small className="muted">
              {peak ? `Busiest time: ${peak.label} (${peak.orders} order${peak.orders === 1 ? "" : "s"})` : ""}
              {peak && newCustomers ? " · " : ""}
              {newCustomers ? `${newCustomers} new customer${newCustomers === 1 ? "" : "s"}` : ""}
            </small>
          </div>
        </section>
      </div>

      <section className="panel report-section">
        <div className="panel-title">
          <div>
            <h3>{(range.end - range.start) / 86_400_000 > 62 ? "Sales by month" : "Sales by day"}</h3>
            <p>Only days with orders are listed</p>
          </div>
          <button
            onClick={() => {
              csv(
                fileName("daily-sales"),
                ["Date", "Orders", "Cancelled", "Items sold", "Item sales", "Delivery fees", "Discounts", "Net sales"],
                days.map((d) => [d.key, d.orders, d.cancelled, d.itemsSold, d.itemSales, d.deliveryFees, d.discounts, d.sales]),
              );
              notify("Daily sales downloaded");
            }}
            disabled={!days.length}
          >
            <Icon name="download" size={15} /> CSV
          </button>
        </div>
        <div className="admin-table-wrap">
          <table className="admin-table report-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Orders</th>
                <th>Items</th>
                <th>Item sales</th>
                <th>Delivery</th>
                <th>Discounts</th>
                <th>Net sales</th>
                <th>Cancelled</th>
              </tr>
            </thead>
            <tbody>
              {days.length === 0 && (
                <tr>
                  <td colSpan={8} className="empty-cell">
                    No orders in this period.
                  </td>
                </tr>
              )}
              {days.map((d) => (
                <tr key={d.key}>
                  <td>
                    <strong>{d.label}</strong>
                  </td>
                  <td>{d.orders - d.cancelled}</td>
                  <td>{d.itemsSold}</td>
                  <td>{money(d.itemSales)}</td>
                  <td>{money(d.deliveryFees)}</td>
                  <td>{d.discounts ? `−${money(d.discounts)}` : "—"}</td>
                  <td>
                    <strong>{money(d.sales)}</strong>
                  </td>
                  <td>{d.cancelled || "—"}</td>
                </tr>
              ))}
            </tbody>
            {days.length > 1 && (
              <tfoot>
                <tr>
                  <td>Total</td>
                  <td>{s.paid}</td>
                  <td>{s.itemsSold}</td>
                  <td>{money(s.itemSales)}</td>
                  <td>{money(s.deliveryFees)}</td>
                  <td>{s.discounts ? `−${money(s.discounts)}` : "—"}</td>
                  <td>{money(s.sales)}</td>
                  <td>{s.cancelled || "—"}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>

      <section className="panel report-section">
        <div className="panel-title">
          <div>
            <h3>Product sales</h3>
            <p>Units sold and item sales per product, best sellers first</p>
          </div>
          <button
            onClick={() => {
              csv(
                fileName("product-sales"),
                ["Rank", "Product", "Type", "Category", "Units sold", "Orders", "Item sales", "Share %", "Stock now"],
                sold.map((r, i) => [
                  i + 1,
                  r.name,
                  r.type === "grocery" ? "Product" : r.type === "food" ? "Meal" : "",
                  r.category,
                  r.qty,
                  r.orders,
                  r.revenue,
                  pct(r.revenue, s.itemSales),
                  r.product?.stock ?? "",
                ]),
              );
              notify("Product sales downloaded");
            }}
            disabled={!sold.length}
          >
            <Icon name="download" size={15} /> CSV
          </button>
        </div>
        <div className="date-filter type-filter">
          {(
            [
              ["all", "All"],
              ["food", "Meals"],
              ["grocery", "Products"],
            ] as const
          ).map(([id, text]) => (
            <button key={id} className={productType === id ? "active" : ""} onClick={() => setProductType(id)}>
              {text}
            </button>
          ))}
        </div>
        <div className="admin-table-wrap">
          <table className="admin-table report-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Product</th>
                <th>Units sold</th>
                <th>Item sales</th>
                <th>Share</th>
                <th>Stock now</th>
              </tr>
            </thead>
            <tbody>
              {soldVisible.length === 0 && (
                <tr>
                  <td colSpan={6} className="empty-cell">
                    Nothing sold in this period.
                  </td>
                </tr>
              )}
              {soldVisible.map((r, i) => {
                const stock = r.product?.stock;
                return (
                  <tr key={r.key} className={stock === 0 ? "row-out" : stock != null && stock < LOW_STOCK ? "row-low" : ""}>
                    <td>
                      <b className="rank">{i + 1}</b>
                    </td>
                    <td>
                      <div className="table-product">
                        <img src={r.image || FALLBACK_IMAGE} alt="" onError={imgFallback} />
                        <div>
                          <strong>{r.name}</strong>
                          <small>
                            {r.type === "grocery" ? "Product" : r.type === "food" ? "Meal" : "—"} · {r.category}
                          </small>
                        </div>
                      </div>
                    </td>
                    <td>
                      <strong>{r.qty}</strong>
                      <small>
                        in {r.orders} order{r.orders === 1 ? "" : "s"}
                      </small>
                    </td>
                    <td>{money(r.revenue)}</td>
                    <td>
                      <div className="share-cell">
                        <div className="pct-bar">
                          <i style={{ width: `${Math.max(2, pct(r.revenue, s.itemSales))}%` }} />
                        </div>
                        <span>{pct(r.revenue, s.itemSales)}%</span>
                      </div>
                    </td>
                    <td>
                      {stock == null ? (
                        "—"
                      ) : stock === 0 ? (
                        <span className="stock-badge out">Out of stock</span>
                      ) : stock < LOW_STOCK ? (
                        <span className="stock-badge low">{stock} left</span>
                      ) : (
                        stock
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {soldShown.length > 10 && (
          <button className="show-more" onClick={() => setShowAllProducts(!showAllProducts)}>
            {showAllProducts ? "Show top 10" : `Show all ${soldShown.length} products`}
          </button>
        )}
        {unsold.length > 0 && productType === "all" && (
          <p className="muted small-note unsold-note">
            Not sold in this period: {unsold.map((p) => p.name).join(", ")}.
          </p>
        )}
      </section>

      <div className="reports-grid even">
        <section className="panel">
          <div className="panel-title">
            <div>
              <h3>Sales by category</h3>
              <p>Share of item sales</p>
            </div>
          </div>
          {categories.length === 0 ? (
            <p className="muted small-note">Nothing sold in this period.</p>
          ) : (
            categories.map((c) => (
              <Share key={c.label} label={c.label} value={c.revenue} of={s.itemSales} detail={`${money(c.revenue)} · ${c.qty} sold`} />
            ))
          )}
        </section>
        <section className="panel">
          <div className="panel-title">
            <div>
              <h3>Payments & orders</h3>
              <p>How customers paid and how orders ended</p>
            </div>
          </div>
          <Share label="Cash on delivery" value={s.cod.amount} of={s.sales} detail={`${money(s.cod.amount)} · ${s.cod.count} orders`} />
          <Share label="GCash" value={s.gcash.amount} of={s.sales} detail={`${money(s.gcash.amount)} · ${s.gcash.count} orders`} />
          <div className="order-stat-list">
            {(
              [
                ["green", s.delivered, statusLabel.delivered],
                ["yellow", s.inProgress, "In progress"],
                ["red", s.cancelled, statusLabel.cancelled],
              ] as const
            ).map(([dot, n, text]) => (
              <div key={text}>
                <span className={`dot ${dot}`} />
                <p>
                  <strong>{n}</strong>
                  <small>{text}</small>
                </p>
              </div>
            ))}
          </div>
          <p className="muted small-note">
            {s.orders ? `${pct(s.delivered, s.delivered + s.cancelled)}% of finished orders were delivered.` : ""}
          </p>
        </section>
      </div>

      <div className="reports-grid even">
        <section className="panel">
          <div className="panel-title">
            <div>
              <h3>Vouchers & coupons used</h3>
              <p>Orders and discounts per code</p>
            </div>
          </div>
          {vouchers.length === 0 ? (
            <p className="muted small-note">No vouchers used in this period.</p>
          ) : (
            vouchers.map((v) => (
              <div className="faq-item" key={v.code}>
                <b>
                  <Icon name="ticket" size={13} />
                </b>
                <span>
                  {v.code}
                  <small className="muted"> · {money(v.sales)} sales</small>
                </span>
                <small>
                  {v.uses} use{v.uses === 1 ? "" : "s"} · −{money(v.discount)}
                </small>
              </div>
            ))
          )}
        </section>
        <section className="panel">
          <div className="panel-title">
            <div>
              <h3>Rider performance</h3>
              <p>Deliveries completed and fees earned</p>
            </div>
          </div>
          {ridersTop.length === 0 ? (
            <p className="muted small-note">No completed deliveries in this period.</p>
          ) : (
            ridersTop.map(({ rider, delivered, fees }, i) => (
              <div className="faq-item" key={rider.id}>
                <b>{i + 1}</b>
                <span>{rider.full_name}</span>
                <small>
                  {delivered} delivered · {money(fees)}
                </small>
              </div>
            ))
          )}
        </section>
      </div>

      <section className="panel report-section">
        <div className="panel-title">
          <div>
            <h3>Top customers</h3>
            <p>By amount spent in this period</p>
          </div>
          <button
            onClick={() => {
              downloadOrders(scoped, fileName("orders"));
              notify(`${scoped.length} orders downloaded`);
            }}
            disabled={!scoped.length}
          >
            <Icon name="download" size={15} /> All orders CSV
          </button>
        </div>
        {customersTop.length === 0 ? (
          <p className="muted small-note">No orders in this period.</p>
        ) : (
          <div className="top-customers">
            {customersTop.map((c, i) => (
              <div className="faq-item" key={c.id}>
                <b>{i + 1}</b>
                <span>{c.name}</span>
                <small>
                  {c.orders} order{c.orders === 1 ? "" : "s"} · {money(c.spent)}
                </small>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
