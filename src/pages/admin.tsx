import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FALLBACK_IMAGE,
  Icon,
  Logo,
  Notify,
  Product,
  SearchBar,
  Spinner,
  Status,
  categories,
  imgFallback,
  money,
} from "../shared";
import {
  addChatSuggestion,
  adminAssignRider,
  adminSetRiderApproval,
  adminUpdateStatus,
  deleteChatSuggestion,
  deleteProduct,
  fetchChatLogs,
  fetchChatSuggestions,
  fetchOrders,
  fetchProducts,
  fetchProfiles,
  saveProduct,
  setProductStock,
  signOut,
  updateChatSuggestion,
  updateMyProfile,
  updateStoreSettings,
  useRealtime,
} from "../lib/api";
import { errorMessage, supabase } from "../lib/supabase";
import {
  ChatLog,
  ChatSuggestion,
  Order,
  OrderStatus,
  Profile,
  activeStatuses,
  formatDateTime,
  formatTime,
  initials,
  itemsSummary,
  statusLabel,
} from "../lib/types";
import { OrderDetailsModal } from "../components/OrderDetails";
import { LocationPicker } from "../components/Maps";
import { LatLng, refreshStoreLocation, toLatLng, useStoreSettings } from "../lib/geo";

const adminNav = [
  ["Dashboard", "dashboard"],
  ["Orders", "orders"],
  ["Riders", "bike"],
  ["Products", "box"],
  ["Customers", "customers"],
  ["Inventory", "bag"],
  ["Sales & Reports", "report"],
  ["Chatbot", "chat"],
  ["Settings", "settings"],
] as const;

const allStatuses = Object.keys(statusLabel) as OrderStatus[];
const LOW_STOCK = 10;
const DAY = 86_400_000;

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
};

// ------------------------------------------------------------------ app

export function AdminApp({
  profile,
  setProfile,
  notify,
}: {
  profile: Profile;
  setProfile: (p: Profile) => void;
  notify: Notify;
}) {
  const [section, setSection] = useState("Dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [orderSearch, setOrderSearch] = useState("");

  const loadProducts = useCallback(
    () => fetchProducts().then(setProducts).catch((e) => notify(errorMessage(e), "error")),
    [notify],
  );
  const loadOrders = useCallback(
    () => fetchOrders().then(setOrders).catch((e) => notify(errorMessage(e), "error")),
    [notify],
  );
  const loadProfiles = useCallback(
    () => fetchProfiles().then(setProfiles).catch((e) => notify(errorMessage(e), "error")),
    [notify],
  );

  useEffect(() => {
    Promise.all([loadProducts(), loadOrders(), loadProfiles()]).finally(() => setLoading(false));
  }, [loadProducts, loadOrders, loadProfiles]);

  useRealtime("admin-orders", [{ table: "orders" }, { table: "order_events" }], () => void loadOrders());
  // Stock moves with orders, and other admins may edit the catalog.
  useRealtime("admin-products", [{ table: "products" }], () => void loadProducts());
  useRealtime("admin-profiles", [{ table: "profiles" }], () => void loadProfiles());

  const riders = profiles.filter((p) => p.role === "rider");
  const customers = profiles.filter((p) => p.role === "customer");
  const profileById = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles]);
  const pendingCount = orders.filter((o) => o.status === "pending").length;

  const go = (next: string) => {
    setSection(next);
    setSidebarOpen(false);
  };

  return (
    <div className="admin-app">
      <aside className={`admin-sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="admin-logo">
          <Logo light />
          <button onClick={() => setSidebarOpen(false)} aria-label="Close menu">
            <Icon name="close" />
          </button>
        </div>
        <div className="admin-label">MANAGEMENT</div>
        <nav>
          {adminNav.map(([label, icon]) => (
            <button key={label} className={section === label ? "active" : ""} onClick={() => go(label)}>
              <Icon name={icon} />
              <span>{label}</span>
              {label === "Orders" && pendingCount > 0 && <b className="nav-badge">{pendingCount}</b>}
              {label === "Riders" && riders.some((r) => !r.rider_approved) && (
                <b className="nav-badge">{riders.filter((r) => !r.rider_approved).length}</b>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-user">
          <span>{initials(profile.full_name)}</span>
          <div>
            <strong>{profile.full_name || "Administrator"}</strong>
            <small>Administrator</small>
          </div>
        </div>
        <button className="sidebar-logout" onClick={() => void signOut()}>
          <Icon name="logout" /> Logout
        </button>
      </aside>
      <div className="admin-body">
        <header>
          <button className="admin-menu" onClick={() => setSidebarOpen(true)} aria-label="Open menu">
            <Icon name="menu" />
          </button>
          <div>
            <p>ADMIN PORTAL</p>
            <h1>{section}</h1>
          </div>
          <div className="admin-head-actions">
            <button aria-label="Go to products" onClick={() => go("Products")}>
              <Icon name="search" />
            </button>
            <button aria-label="Pending orders" onClick={() => go("Orders")}>
              <Icon name="bell" />
              {pendingCount > 0 && <span />}
            </button>
            <div className="admin-avatar">{initials(profile.full_name)}</div>
          </div>
        </header>
        <main>
          {loading ? (
            <Spinner label="Loading operations data" />
          ) : section === "Dashboard" ? (
            <AdminDashboard
              profile={profile}
              orders={orders}
              products={products}
              customers={customers}
              riders={riders}
              profileById={profileById}
              setSection={go}
              notify={notify}
            />
          ) : section === "Orders" ? (
            <AdminOrders
              orders={orders}
              riders={riders}
              profileById={profileById}
              search={orderSearch}
              setSearch={setOrderSearch}
              notify={notify}
              reload={loadOrders}
            />
          ) : section === "Riders" ? (
            <AdminRiders riders={riders} orders={orders} notify={notify} reload={loadProfiles} />
          ) : section === "Products" ? (
            <AdminProducts products={products} reload={loadProducts} notify={notify} />
          ) : section === "Customers" ? (
            <AdminCustomers
              customers={customers}
              orders={orders}
              onViewOrders={(name) => {
                setOrderSearch(name);
                go("Orders");
              }}
            />
          ) : section === "Inventory" ? (
            <AdminInventory products={products} reload={loadProducts} notify={notify} />
          ) : section === "Sales & Reports" ? (
            <AdminReports orders={orders} products={products} customers={customers} riders={riders} notify={notify} />
          ) : section === "Chatbot" ? (
            <AdminChatbot notify={notify} profileById={profileById} products={products} />
          ) : (
            <AdminSettings profile={profile} setProfile={setProfile} notify={notify} />
          )}
        </main>
      </div>
      {sidebarOpen && <button className="sidebar-scrim" aria-label="Close menu" onClick={() => setSidebarOpen(false)} />}
    </div>
  );
}

// ------------------------------------------------------------------ analytics helpers

type Bucket = { label: string; food: number; grocery: number };

function revenueBuckets(orders: Order[], products: Product[], range: string): Bucket[] {
  const typeOf = new Map(products.map((p) => [p.id, p.type]));
  const now = new Date();
  let buckets: { label: string; start: number; end: number }[];
  if (range === "Year") {
    buckets = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1);
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      return { label: d.toLocaleString("en", { month: "narrow" }), start: d.getTime(), end: end.getTime() };
    });
  } else {
    const days = range === "30 days" ? 30 : 7;
    const size = range === "30 days" ? 3 : 1;
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() + DAY;
    buckets = Array.from({ length: days / size }, (_, i) => {
      const start = today - (days - i * size) * DAY;
      const d = new Date(start);
      return {
        label: size === 1 ? d.toLocaleString("en", { weekday: "narrow" }) : String(d.getDate()),
        start,
        end: start + size * DAY,
      };
    });
  }
  return buckets.map((b) => {
    const bucket: Bucket = { label: b.label, food: 0, grocery: 0 };
    for (const order of orders) {
      if (order.status === "cancelled") continue;
      const t = new Date(order.created_at).getTime();
      if (t < b.start || t >= b.end) continue;
      for (const item of order.order_items ?? []) {
        const type = (item.product_id && typeOf.get(item.product_id)) || "food";
        bucket[type] += Number(item.price) * item.quantity;
      }
    }
    return bucket;
  });
}

const rangeStart = (range: string) =>
  Date.now() - (range === "Year" || range === "This year" ? 365 : range === "30 days" || range === "This month" ? 30 : 7) * DAY;

const inRange = (orders: Order[], range: string) => {
  const since = rangeStart(range);
  return orders.filter((o) => new Date(o.created_at).getTime() >= since);
};

const revenueOf = (orders: Order[]) =>
  orders.filter((o) => o.status !== "cancelled").reduce((sum, o) => sum + Number(o.total), 0);

function SalesChart({ buckets }: { buckets: Bucket[] }) {
  const max = Math.max(1, ...buckets.map((b) => Math.max(b.food, b.grocery)));
  return (
    <div className="bar-chart">
      {buckets.map((b, i) => (
        <div className="bar-group" key={i} title={`Food ${money(b.food)} · Grocery ${money(b.grocery)}`}>
          <span style={{ height: `${Math.max(2, (b.food / max) * 90)}%` }} />
          <span style={{ height: `${Math.max(2, (b.grocery / max) * 90)}%` }} />
          <small>{b.label}</small>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ dashboard

function AdminDashboard({
  profile,
  orders,
  products,
  customers,
  riders,
  profileById,
  setSection,
  notify,
}: {
  profile: Profile;
  orders: Order[];
  products: Product[];
  customers: Profile[];
  riders: Profile[];
  profileById: Map<string, Profile>;
  setSection: (s: string) => void;
  notify: Notify;
}) {
  const [range, setRange] = useState("7 days");
  const scoped = inRange(orders, range);
  const approved = riders.filter((r) => r.rider_approved);
  const online = approved.filter((r) => r.rider_online);
  const needsRider = orders.filter(
    (o) => !o.rider_id && ["confirmed", "preparing", "ready"].includes(o.status),
  );
  const stats: [string, string, string, string][] = [
    [money(revenueOf(scoped)), "Sales", `Last ${range}`, "report"],
    [String(scoped.length), "Orders", `Last ${range}`, "orders"],
    [String(customers.length), "Customers", "Registered", "customers"],
    [`${online.length}/${approved.length}`, "Riders online", `${riders.length - approved.length} awaiting approval`, "bike"],
    [String(orders.filter((o) => o.status === "pending").length), "Pending orders", "Needs review", "food"],
    [String(products.filter((p) => p.stock < LOW_STOCK).length), "Low stock", "Under 10 units", "bag"],
  ];

  const sold = new Map<string, { name: string; image: string; qty: number; price: number }>();
  for (const order of orders) {
    if (order.status === "cancelled") continue;
    for (const item of order.order_items ?? []) {
      const key = String(item.product_id ?? item.name);
      const row = sold.get(key) ?? { name: item.name, image: item.image, qty: 0, price: Number(item.price) };
      row.qty += item.quantity;
      sold.set(key, row);
    }
  }
  const best = [...sold.values()].sort((a, b) => b.qty - a.qty).slice(0, 4);
  const buckets = revenueBuckets(orders, products, range);

  return (
    <>
      <div className="admin-welcome">
        <div>
          <h2>
            {greeting()}, {profile.full_name.split(" ")[0] || "Admin"}
          </h2>
          <p>Here's what's happening with Ailyn's Express right now.</p>
        </div>
        <div className="date-filter">
          {["7 days", "30 days", "Year"].map((r) => (
            <button key={r} className={range === r ? "active" : ""} onClick={() => setRange(r)}>
              {r}
            </button>
          ))}
        </div>
      </div>
      <div className="stats-grid">
        {stats.map(([value, label, change, icon]) => (
          <div className="stat-card" key={label}>
            <span>
              <Icon name={icon} />
            </span>
            <div>
              <small>{label}</small>
              <strong>{value}</strong>
              <em>{change}</em>
            </div>
          </div>
        ))}
      </div>
      {needsRider.length > 0 && (
        <div className="inventory-alert dispatch-alert">
          <Icon name="bike" />
          <div>
            <strong>
              {needsRider.length} order{needsRider.length === 1 ? "" : "s"} waiting for a rider
            </strong>
            <p>Online riders can accept them from their job list, or you can assign one now.</p>
          </div>
          <button onClick={() => setSection("Orders")}>Dispatch</button>
        </div>
      )}
      <div className="admin-grid-main">
        <section className="panel sales-panel">
          <div className="panel-title">
            <div>
              <h3>Sales overview</h3>
              <p>Revenue by category · Last {range}</p>
            </div>
            <strong>
              {money(revenueOf(scoped))} <small>this period</small>
            </strong>
          </div>
          <SalesChart buckets={buckets} />
          <div className="chart-legend">
            <span>
              <i />
              Food sales
            </span>
            <span>
              <i />
              Grocery sales
            </span>
          </div>
        </section>
        <section className="panel best-panel">
          <div className="panel-title">
            <div>
              <h3>Rider activity</h3>
              <p>Live status of approved riders</p>
            </div>
            <button onClick={() => setSection("Riders")}>Manage</button>
          </div>
          {approved.length === 0 ? (
            <p className="muted small-note">No approved riders yet. Approve applicants in Riders.</p>
          ) : (
            approved.slice(0, 6).map((rider) => {
              const job = orders.find((o) => o.rider_id === rider.id && activeStatuses.includes(o.status));
              return (
                <div className="best-item rider-item" key={rider.id}>
                  <b className={`live-dot ${rider.rider_online ? "on" : ""}`} />
                  <span className="mini-avatar">{initials(rider.full_name)}</span>
                  <div>
                    <strong>{rider.full_name}</strong>
                    <small>
                      {job
                        ? `#${job.code} · ${statusLabel[job.status]}`
                        : rider.rider_online
                          ? "Available"
                          : "Offline"}
                    </small>
                  </div>
                  <span>{rider.vehicle ?? ""}</span>
                </div>
              );
            })
          )}
        </section>
      </div>
      <div className="admin-grid-main">
        <section className="panel recent-orders">
          <div className="panel-title">
            <div>
              <h3>Recent orders</h3>
              <p>Latest customer activity</p>
            </div>
            <button onClick={() => setSection("Orders")}>View all orders</button>
          </div>
          <OrderTable
            orders={orders.slice(0, 6)}
            riders={riders}
            profileById={profileById}
            compact
            notify={notify}
          />
        </section>
        <section className="panel best-panel">
          <div className="panel-title">
            <div>
              <h3>Best sellers</h3>
              <p>By units sold</p>
            </div>
            <button onClick={() => setSection("Products")}>View all</button>
          </div>
          {best.length === 0 ? (
            <p className="muted small-note">Sales will appear after the first orders.</p>
          ) : (
            best.map((p, i) => (
              <div className="best-item" key={p.name}>
                <b>{i + 1}</b>
                <img src={p.image || FALLBACK_IMAGE} alt="" onError={imgFallback} />
                <div>
                  <strong>{p.name}</strong>
                  <small>{p.qty} sold</small>
                </div>
                <span>{money(p.price)}</span>
              </div>
            ))
          )}
        </section>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ orders

function OrderTable({
  orders,
  riders,
  profileById,
  compact = false,
  notify,
  reload,
}: {
  orders: Order[];
  riders: Profile[];
  profileById: Map<string, Profile>;
  compact?: boolean;
  notify: Notify;
  reload?: () => void;
}) {
  const [details, setDetails] = useState<Order | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const approved = riders.filter((r) => r.rider_approved);

  const act = async (id: string, fn: () => Promise<void>, message: string) => {
    setBusy(id);
    try {
      await fn();
      notify(message);
      reload?.();
    } catch (e) {
      notify(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  };

  const changeStatus = (order: Order, status: OrderStatus) => {
    if (status === "cancelled" && !window.confirm(`Cancel order #${order.code}? Stock will be restored.`)) return;
    void act(order.id, () => adminUpdateStatus(order.id, status), `#${order.code} → ${statusLabel[status]}`);
  };

  const live = details ? (orders.find((o) => o.id === details.id) ?? details) : null;

  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead>
          <tr>
            <th>Order</th>
            <th>Customer</th>
            {!compact && <th>Items</th>}
            <th>Total</th>
            <th>Status</th>
            {!compact && <th>Rider</th>}
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {orders.length === 0 && (
            <tr>
              <td colSpan={compact ? 5 : 7} className="empty-cell">
                No orders yet.
              </td>
            </tr>
          )}
          {orders.map((order) => {
            const closed = order.status === "delivered" || order.status === "cancelled";
            const rider = order.rider_id ? profileById.get(order.rider_id) : null;
            return (
              <tr key={order.id}>
                <td>
                  <strong>#{order.code}</strong>
                  <small>{formatDateTime(order.created_at)}</small>
                </td>
                <td>
                  {order.customer_name}
                  <small>{order.customer_phone}</small>
                </td>
                {!compact && <td>{itemsSummary(order.order_items)}</td>}
                <td>
                  <strong>{money(Number(order.total))}</strong>
                  <small>{order.payment_method === "cod" ? "COD" : "GCash"}</small>
                </td>
                <td>
                  {compact || closed ? (
                    <Status value={statusLabel[order.status]} />
                  ) : (
                    <select
                      value={order.status}
                      disabled={busy === order.id}
                      onChange={(e) => changeStatus(order, e.target.value as OrderStatus)}
                      aria-label={`Status for ${order.code}`}
                    >
                      {allStatuses.map((s) => (
                        <option key={s} value={s}>
                          {statusLabel[s]}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
                {!compact && (
                  <td>
                    {closed ? (
                      rider?.full_name ?? "—"
                    ) : (
                      <select
                        value={order.rider_id ?? ""}
                        disabled={busy === order.id}
                        aria-label={`Rider for ${order.code}`}
                        onChange={(e) => {
                          const id = e.target.value || null;
                          const name = id ? profileById.get(id)?.full_name : null;
                          void act(
                            order.id,
                            () => adminAssignRider(order.id, id),
                            id ? `${name} assigned to #${order.code}` : `Rider removed from #${order.code}`,
                          );
                        }}
                      >
                        <option value="">Unassigned</option>
                        {rider && !rider.rider_approved && (
                          <option value={rider.id}>{rider.full_name} (not approved)</option>
                        )}
                        {approved.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.full_name} {r.rider_online ? "● online" : "○ offline"}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                )}
                <td>
                  <button className="view-link" onClick={() => setDetails(order)}>
                    View details
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {live && (
        <OrderDetailsModal
          order={live}
          rider={live.rider_id ? profileById.get(live.rider_id) : null}
          onClose={() => setDetails(null)}
          showMap
          actions={
            live.status === "pending" ? (
              <>
                <button className="button button-outline" onClick={() => changeStatus(live, "cancelled")}>
                  Cancel order
                </button>
                <button className="button button-primary" onClick={() => changeStatus(live, "confirmed")}>
                  Confirm order
                </button>
              </>
            ) : live.status === "confirmed" ? (
              <button className="button button-primary" onClick={() => changeStatus(live, "preparing")}>
                Start preparing
              </button>
            ) : live.status === "preparing" ? (
              <button className="button button-primary" onClick={() => changeStatus(live, "ready")}>
                Ready for pickup
              </button>
            ) : undefined
          }
        />
      )}
    </div>
  );
}

function AdminOrders({
  orders,
  riders,
  profileById,
  search,
  setSearch,
  notify,
  reload,
}: {
  orders: Order[];
  riders: Profile[];
  profileById: Map<string, Profile>;
  search: string;
  setSearch: (v: string) => void;
  notify: Notify;
  reload: () => void;
}) {
  const [filter, setFilter] = useState<"all" | OrderStatus | "unassigned">("all");
  const q = search.toLowerCase();
  const matches = orders.filter(
    (o) =>
      !q ||
      o.code.toLowerCase().includes(q) ||
      o.customer_name.toLowerCase().includes(q) ||
      o.city.toLowerCase().includes(q),
  );
  const unassigned = (o: Order) => !o.rider_id && ["confirmed", "preparing", "ready"].includes(o.status);
  const visible = matches.filter((o) =>
    filter === "all" ? true : filter === "unassigned" ? unassigned(o) : o.status === filter,
  );
  const tabs: ["all" | OrderStatus | "unassigned", string, number][] = [
    ["all", "All orders", matches.length],
    ["pending", "Pending", matches.filter((o) => o.status === "pending").length],
    ["unassigned", "Needs rider", matches.filter(unassigned).length],
    ["preparing", "Preparing", matches.filter((o) => o.status === "preparing").length],
    ["out_for_delivery", "Out for delivery", matches.filter((o) => o.status === "out_for_delivery").length],
    ["delivered", "Delivered", matches.filter((o) => o.status === "delivered").length],
    ["cancelled", "Cancelled", matches.filter((o) => o.status === "cancelled").length],
  ];
  return (
    <>
      <div className="admin-page-head">
        <div>
          <h2>Order management</h2>
          <p>Confirm orders, move them through the kitchen and dispatch riders. Updates live.</p>
        </div>
        <button className="button button-outline" onClick={() => downloadOrdersCsv(visible, profileById, "orders")}>
          Export CSV
        </button>
      </div>
      <div className="admin-filters">
        <SearchBar placeholder="Search order #, customer or city..." value={search} onChange={setSearch} />
      </div>
      <div className="order-tabs">
        {tabs.map(([id, label, count]) => (
          <button className={filter === id ? "active" : ""} key={id} onClick={() => setFilter(id)}>
            {label}
            <span>{count}</span>
          </button>
        ))}
      </div>
      <section className="panel">
        <OrderTable orders={visible} riders={riders} profileById={profileById} notify={notify} reload={reload} />
      </section>
      <p className="prototype-note">
        Flow: Pending → Confirmed → Preparing → Ready for pickup → Out for delivery (rider) → Delivered (rider).
        Riders see unassigned confirmed orders in their job list.
      </p>
    </>
  );
}

function downloadOrdersCsv(orders: Order[], profileById: Map<string, Profile>, name: string) {
  const header = ["Order", "Placed", "Customer", "Phone", "City", "Status", "Rider", "Payment", "Subtotal", "Fee", "Discount", "Total"];
  const rows = orders.map((o) => [
    o.code,
    o.created_at,
    o.customer_name,
    o.customer_phone,
    o.city,
    statusLabel[o.status],
    (o.rider_id && profileById.get(o.rider_id)?.full_name) || "",
    o.payment_method,
    o.subtotal,
    o.delivery_fee,
    o.discount,
    o.total,
  ]);
  const csv = [header, ...rows]
    .map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `ailyns-${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ------------------------------------------------------------------ riders

function AdminRiders({
  riders,
  orders,
  notify,
  reload,
}: {
  riders: Profile[];
  orders: Order[];
  notify: Notify;
  reload: () => void;
}) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const rows = riders.filter((r) =>
    [r.full_name, r.email, r.phone, r.plate_number].join(" ").toLowerCase().includes(query.toLowerCase()),
  );
  const pending = riders.filter((r) => !r.rider_approved).length;
  const inviteLink = `${window.location.origin}/?portal=rider`;

  const setApproval = async (rider: Profile, approved: boolean) => {
    setBusy(rider.id);
    try {
      await adminSetRiderApproval(rider.id, approved);
      notify(approved ? `${rider.full_name} approved` : `${rider.full_name} suspended`);
      reload();
    } catch (e) {
      notify(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="admin-page-head">
        <div>
          <h2>Rider management</h2>
          <p>
            Approve new riders, see who's online and what each rider is delivering.
            {pending > 0 && ` ${pending} awaiting approval.`}
          </p>
        </div>
        <button
          className="button button-primary"
          onClick={() =>
            navigator.clipboard
              .writeText(inviteLink)
              .then(() => notify("Rider sign-up link copied"))
              .catch(() => notify(inviteLink))
          }
        >
          <Icon name="plus" /> Copy rider sign-up link
        </button>
      </div>
      <div className="admin-filters">
        <SearchBar placeholder="Search riders..." value={query} onChange={setQuery} />
      </div>
      <section className="panel admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Rider</th>
              <th>Contact</th>
              <th>Vehicle</th>
              <th>Account</th>
              <th>Availability</th>
              <th>Current job</th>
              <th>Delivered</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="empty-cell">
                  No riders yet. Share the rider sign-up link to onboard riders.
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const mine = orders.filter((o) => o.rider_id === r.id);
              const job = mine.find((o) => activeStatuses.includes(o.status));
              const delivered = mine.filter((o) => o.status === "delivered").length;
              return (
                <tr key={r.id}>
                  <td>
                    <div className="customer-cell">
                      <span>{initials(r.full_name)}</span>
                      <div>
                        <strong>{r.full_name}</strong>
                        <small>Joined {formatDateTime(r.created_at)}</small>
                      </div>
                    </div>
                  </td>
                  <td>
                    {r.email}
                    <small>{r.phone ?? "No phone"}</small>
                  </td>
                  <td>
                    {r.vehicle ?? "—"}
                    <small>{r.plate_number ?? ""}</small>
                  </td>
                  <td>
                    <Status value={r.rider_approved ? "Approved" : "Pending review"} />
                  </td>
                  <td>
                    <Status value={r.rider_approved && r.rider_online ? "Online" : "Offline"} />
                  </td>
                  <td>
                    {job ? (
                      <>
                        #{job.code}
                        <small>
                          {statusLabel[job.status]}
                          {job.rider_location_at ? ` · GPS ${formatTime(job.rider_location_at)}` : ""}
                        </small>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    <strong>{delivered}</strong>
                  </td>
                  <td>
                    <div className="table-actions">
                      {r.rider_approved ? (
                        <button
                          className="danger"
                          disabled={busy === r.id}
                          onClick={() => window.confirm(`Suspend ${r.full_name}?`) && setApproval(r, false)}
                        >
                          Suspend
                        </button>
                      ) : (
                        <button disabled={busy === r.id} onClick={() => setApproval(r, true)}>
                          Approve
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </>
  );
}

// ------------------------------------------------------------------ products

const emptyProduct: Omit<Product, "id"> = {
  name: "",
  category: "Meals",
  type: "food",
  price: 0,
  rating: 4.5,
  image: "",
  description: "",
  ingredients: "",
  stock: 0,
  active: true,
};

function AdminProducts({
  products,
  reload,
  notify,
}: {
  products: Product[];
  reload: () => Promise<unknown>;
  notify: Notify;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All categories");
  const [statusFilter, setStatusFilter] = useState("All status");
  const [editing, setEditing] = useState<Product | Omit<Product, "id"> | null>(null);
  const [busy, setBusy] = useState(false);

  const filtered = products.filter(
    (p) =>
      p.name.toLowerCase().includes(query.toLowerCase()) &&
      (category === "All categories" || p.category === category) &&
      (statusFilter === "All status" ||
        (statusFilter === "Active" && p.active !== false) ||
        (statusFilter === "Hidden" && p.active === false) ||
        (statusFilter === "Low stock" && p.stock < LOW_STOCK)),
  );

  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editing) return;
    const data = new FormData(e.currentTarget);
    const product = {
      name: String(data.get("name")).trim(),
      category: String(data.get("category")),
      type: String(data.get("type")) as "food" | "grocery",
      price: Number(data.get("price")),
      stock: Math.max(0, Math.floor(Number(data.get("stock")))),
      rating: Math.min(5, Math.max(0, Number(data.get("rating")) || 0)),
      image: String(data.get("image")).trim(),
      description: String(data.get("description")).trim(),
      ingredients: String(data.get("ingredients")).trim() || null,
      active: data.get("active") === "on",
    };
    setBusy(true);
    try {
      await saveProduct(product, "id" in editing ? editing.id : undefined);
      await reload();
      setEditing(null);
      notify("id" in editing ? "Product updated" : "Product added");
    } catch (err) {
      notify(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (p: Product) => {
    if (!window.confirm(`Delete ${p.name}? Past orders keep their copy of the item.`)) return;
    try {
      await deleteProduct(p.id);
      await reload();
      notify("Product deleted");
    } catch (err) {
      notify(errorMessage(err), "error");
    }
  };

  return (
    <>
      <div className="admin-page-head">
        <div>
          <h2>Product management</h2>
          <p>Manage food, groceries, pricing and availability. Changes go live immediately.</p>
        </div>
        <button className="button button-primary" onClick={() => setEditing({ ...emptyProduct })}>
          <Icon name="plus" /> Add product
        </button>
      </div>
      <div className="admin-filters">
        <SearchBar placeholder="Search products..." value={query} onChange={setQuery} />
        <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
          <option>All categories</option>
          {categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
          <option>All status</option>
          <option>Active</option>
          <option>Hidden</option>
          <option>Low stock</option>
        </select>
      </div>
      <section className="panel admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Product</th>
              <th>Category</th>
              <th>Price</th>
              <th>Stock</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr key={p.id}>
                <td>
                  <div className="table-product">
                    <img src={p.image || FALLBACK_IMAGE} alt="" onError={imgFallback} />
                    <div>
                      <strong>{p.name}</strong>
                      <small>#PRD-{String(p.id).padStart(4, "0")}</small>
                    </div>
                  </div>
                </td>
                <td>
                  {p.category}
                  <small>{p.type}</small>
                </td>
                <td>
                  <strong>{money(p.price)}</strong>
                </td>
                <td>{p.stock}</td>
                <td>
                  <Status value={p.active === false ? "Hidden" : p.stock === 0 ? "Out of stock" : p.stock < LOW_STOCK ? "Low stock" : "Active"} />
                </td>
                <td>
                  <div className="table-actions">
                    <button onClick={() => setEditing(p)}>Edit</button>
                    <button className="danger" onClick={() => void remove(p)}>
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {editing && (
        <div className="modal-backdrop" onMouseDown={() => setEditing(null)}>
          <form className="admin-modal" onSubmit={save} onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-title">
              <div>
                <p className="eyebrow">PRODUCT CATALOG</p>
                <h2>{"id" in editing ? "Edit product" : "Add new product"}</h2>
              </div>
              <button type="button" onClick={() => setEditing(null)} aria-label="Close">
                <Icon name="close" />
              </button>
            </div>
            <div className="field-grid">
              <label className="full-field">
                Product name
                <input name="name" defaultValue={editing.name} placeholder="Enter product name" required />
              </label>
              <label>
                Category
                <select name="category" defaultValue={editing.category}>
                  {categories.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label>
                Type
                <select name="type" defaultValue={editing.type}>
                  <option value="food">Food</option>
                  <option value="grocery">Grocery</option>
                </select>
              </label>
              <label>
                Price (₱)
                <input name="price" type="number" min="0" step="0.01" defaultValue={editing.price || ""} required />
              </label>
              <label>
                Stock quantity
                <input name="stock" type="number" min="0" step="1" defaultValue={editing.stock} required />
              </label>
              <label>
                Rating
                <input name="rating" type="number" min="0" max="5" step="0.1" defaultValue={editing.rating} />
              </label>
              <label className="check-label product-active">
                <input name="active" type="checkbox" defaultChecked={editing.active !== false} /> Visible to customers
              </label>
              <label className="full-field">
                Image URL
                <input name="image" type="url" defaultValue={editing.image} placeholder="https://…" />
              </label>
              <label className="full-field">
                Description
                <textarea name="description" defaultValue={editing.description} placeholder="Tell customers about this product" />
              </label>
              <label className="full-field">
                Ingredients / product information
                <textarea name="ingredients" defaultValue={editing.ingredients ?? ""} />
              </label>
            </div>
            <div className="modal-buttons">
              <button type="button" className="button button-outline" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button className="button button-primary" disabled={busy}>
                {busy ? "Saving…" : "Save product"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

// ------------------------------------------------------------------ customers

function AdminCustomers({
  customers,
  orders,
  onViewOrders,
}: {
  customers: Profile[];
  orders: Order[];
  onViewOrders: (name: string) => void;
}) {
  const [query, setQuery] = useState("");
  const rows = customers.filter((c) =>
    [c.full_name, c.email, c.phone].join(" ").toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <div className="admin-page-head">
        <div>
          <h2>Customer management</h2>
          <p>Registered customers and their order activity.</p>
        </div>
      </div>
      <div className="admin-filters">
        <SearchBar placeholder="Search customers..." value={query} onChange={setQuery} />
      </div>
      <section className="panel admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Customer</th>
              <th>Contact</th>
              <th>Registered</th>
              <th>Orders</th>
              <th>Total spent</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="empty-cell">
                  No customers yet.
                </td>
              </tr>
            )}
            {rows.map((c) => {
              const mine = orders.filter((o) => o.customer_id === c.id);
              return (
                <tr key={c.id}>
                  <td>
                    <div className="customer-cell">
                      <span>{initials(c.full_name)}</span>
                      <div>
                        <strong>{c.full_name}</strong>
                        <small>{c.id.slice(0, 8)}</small>
                      </div>
                    </div>
                  </td>
                  <td>
                    {c.email}
                    <small>{c.phone ?? ""}</small>
                  </td>
                  <td>{formatDateTime(c.created_at)}</td>
                  <td>
                    <strong>{mine.length}</strong>
                  </td>
                  <td>{money(revenueOf(mine))}</td>
                  <td>
                    <button className="view-link" onClick={() => onViewOrders(c.full_name)}>
                      View orders
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </>
  );
}

// ------------------------------------------------------------------ inventory

function AdminInventory({
  products,
  reload,
  notify,
}: {
  products: Product[];
  reload: () => Promise<unknown>;
  notify: Notify;
}) {
  const [onlyLow, setOnlyLow] = useState(false);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const low = products.filter((p) => p.stock < LOW_STOCK);
  const rows = onlyLow ? low : products;

  const update = async (p: Product) => {
    const value = Number(drafts[p.id] ?? p.stock);
    if (!Number.isInteger(value) || value < 0) {
      notify("Stock must be a whole number, 0 or more");
      return;
    }
    try {
      await setProductStock(p.id, value);
      await reload();
      setDrafts(({ [p.id]: _, ...rest }) => rest);
      notify(`${p.name} stock set to ${value}`);
    } catch (e) {
      notify(errorMessage(e), "error");
    }
  };

  return (
    <>
      <div className="admin-page-head">
        <div>
          <h2>Inventory management</h2>
          <p>Stock drops automatically when customers order and returns when orders are cancelled.</p>
        </div>
      </div>
      {low.length > 0 && (
        <div className="inventory-alert">
          <Icon name="bell" />
          <div>
            <strong>
              {low.length} product{low.length === 1 ? "" : "s"} need your attention
            </strong>
            <p>Low-stock items may become unavailable soon.</p>
          </div>
          <button onClick={() => setOnlyLow(!onlyLow)}>{onlyLow ? "Show all" : "Review low stock"}</button>
        </div>
      )}
      <section className="panel admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Product</th>
              <th>Category</th>
              <th>Current stock</th>
              <th>Availability</th>
              <th>Stock status</th>
              <th>Update</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td>
                  <div className="table-product">
                    <img src={p.image || FALLBACK_IMAGE} alt="" onError={imgFallback} />
                    <strong>{p.name}</strong>
                  </div>
                </td>
                <td>{p.category}</td>
                <td>
                  <strong>{p.stock} units</strong>
                </td>
                <td>{p.active === false ? "Hidden" : p.stock > 0 ? "Available" : "Unavailable"}</td>
                <td>
                  <Status value={p.stock === 0 ? "Out of stock" : p.stock < LOW_STOCK ? "Low stock" : "In stock"} />
                </td>
                <td>
                  <div className="stock-edit">
                    <input
                      type="number"
                      min="0"
                      value={drafts[p.id] ?? String(p.stock)}
                      onChange={(e) => setDrafts({ ...drafts, [p.id]: e.target.value })}
                      aria-label={`Stock for ${p.name}`}
                    />
                    <button onClick={() => void update(p)}>Update</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

// ------------------------------------------------------------------ reports

function AdminReports({
  orders,
  products,
  customers,
  riders,
  notify,
}: {
  orders: Order[];
  products: Product[];
  customers: Profile[];
  riders: Profile[];
  notify: Notify;
}) {
  const [period, setPeriod] = useState("This month");
  const scoped = inRange(orders, period);
  const revenue = revenueOf(scoped);
  const paid = scoped.filter((o) => o.status !== "cancelled");
  const delivered = scoped.filter((o) => o.status === "delivered");
  const cancelled = scoped.filter((o) => o.status === "cancelled");
  const inProgress = scoped.filter((o) => activeStatuses.includes(o.status));
  const closed = delivered.length + cancelled.length;
  const newCustomers = customers.filter((c) => new Date(c.created_at).getTime() >= rangeStart(period));
  const range = period === "This year" ? "Year" : period === "This month" ? "30 days" : "7 days";
  const buckets = revenueBuckets(orders, products, range);
  const food = buckets.reduce((s, b) => s + b.food, 0);
  const grocery = buckets.reduce((s, b) => s + b.grocery, 0);
  const foodPct = food + grocery ? Math.round((food / (food + grocery)) * 100) : 50;
  const profileById = new Map(riders.map((r) => [r.id, r]));
  const riderRows = riders
    .map((r) => {
      const mine = scoped.filter((o) => o.rider_id === r.id && o.status === "delivered");
      return { rider: r, count: mine.length, fees: mine.reduce((s, o) => s + Number(o.delivery_fee), 0) };
    })
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count);

  return (
    <>
      <div className="admin-page-head">
        <div>
          <h2>Sales & reports</h2>
          <p>Revenue, product mix and fulfilment, computed from live orders.</p>
        </div>
        <div className="report-actions">
          <select value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Report period">
            <option>This week</option>
            <option>This month</option>
            <option>This year</option>
          </select>
          <button
            className="button button-primary"
            onClick={() => {
              downloadOrdersCsv(scoped, profileById, period.toLowerCase().replace(/\s+/g, "-"));
              notify(`${period} report downloaded`);
            }}
          >
            Download report
          </button>
        </div>
      </div>
      <div className="report-kpis">
        <div>
          <small>TOTAL REVENUE</small>
          <strong>{money(revenue)}</strong>
          <span>{paid.length} paid orders</span>
        </div>
        <div>
          <small>AVERAGE ORDER</small>
          <strong>{money(paid.length ? revenue / paid.length : 0)}</strong>
          <span>Excluding cancelled</span>
        </div>
        <div>
          <small>ORDERS DELIVERED</small>
          <strong>{delivered.length}</strong>
          <span>{closed ? Math.round((delivered.length / closed) * 100) : 0}% of closed orders</span>
        </div>
        <div>
          <small>NEW CUSTOMERS</small>
          <strong>{newCustomers.length}</strong>
          <span>{period.toLowerCase()}</span>
        </div>
      </div>
      <div className="reports-grid">
        <section className="panel">
          <div className="panel-title">
            <div>
              <h3>Revenue trend</h3>
              <p>{period} · food vs grocery</p>
            </div>
          </div>
          <SalesChart buckets={buckets} />
        </section>
        <section className="panel donut-panel">
          <div className="panel-title">
            <div>
              <h3>Food vs grocery sales</h3>
              <p>Sales category distribution</p>
            </div>
          </div>
          <div
            className="donut"
            style={{ background: `conic-gradient(var(--pink) 0 ${foodPct}%, #f1b5c5 ${foodPct}%)` }}
          >
            <div>
              <strong>{money(food + grocery).replace(/\.00$/, "")}</strong>
              <small>Item sales</small>
            </div>
          </div>
          <div className="donut-legend">
            <span>
              <i />
              Food <strong>{foodPct}%</strong>
            </span>
            <span>
              <i />
              Grocery <strong>{100 - foodPct}%</strong>
            </span>
          </div>
        </section>
      </div>
      <div className="reports-grid small">
        <section className="panel">
          <div className="panel-title">
            <div>
              <h3>Order statistics</h3>
              <p>Fulfilment overview</p>
            </div>
          </div>
          <div className="order-stat-list">
            <div>
              <span className="dot green" />
              <p>
                <strong>{delivered.length}</strong>
                <small>Delivered</small>
              </p>
            </div>
            <div>
              <span className="dot yellow" />
              <p>
                <strong>{inProgress.length}</strong>
                <small>In progress</small>
              </p>
            </div>
            <div>
              <span className="dot red" />
              <p>
                <strong>{cancelled.length}</strong>
                <small>Cancelled</small>
              </p>
            </div>
          </div>
        </section>
        <section className="panel">
          <div className="panel-title">
            <div>
              <h3>Rider performance</h3>
              <p>Deliveries completed · {period.toLowerCase()}</p>
            </div>
          </div>
          {riderRows.length === 0 ? (
            <p className="muted small-note">No completed deliveries in this period.</p>
          ) : (
            riderRows.map(({ rider, count, fees }, i) => (
              <div className="faq-item" key={rider.id}>
                <b>{i + 1}</b>
                <span>{rider.full_name}</span>
                <small>
                  {count} delivered · {money(fees)}
                </small>
              </div>
            ))
          )}
        </section>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ chatbot

const timeAgo = (iso: string) => {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return formatDateTime(iso);
};

function AdminChatbot({
  notify,
  profileById,
  products,
}: {
  notify: Notify;
  profileById: Map<string, Profile>;
  products: Product[];
}) {
  const [logs, setLogs] = useState<ChatLog[]>([]);
  const [suggestions, setSuggestions] = useState<ChatSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const [nextLogs, nextSuggestions] = await Promise.all([fetchChatLogs(30), fetchChatSuggestions()]);
      setLogs(nextLogs);
      setSuggestions(nextSuggestions);
    } catch (e) {
      notify(errorMessage(e), "error");
    } finally {
      setLoading(false);
    }
  }, [notify]);
  useEffect(() => {
    void load();
  }, [load]);

  const productName = new Map(products.map((p) => [p.id, p.name]));
  const customersUsing = new Set(logs.map((l) => l.customer_id)).size;
  const recommendations = logs.filter((l) => l.product_id != null).length;
  const answeredPct = logs.length ? Math.round((logs.filter((l) => l.matched).length / logs.length) * 100) : 0;
  const top = [
    ...logs
      .reduce((map, l) => {
        const key = l.question.trim().toLowerCase().replace(/[?!.\s]+$/, "");
        const row = map.get(key) ?? { text: l.question.trim(), count: 0 };
        row.count += 1;
        map.set(key, row);
        return map;
      }, new Map<string, { text: string; count: number }>())
      .values(),
  ]
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  const unanswered = logs.filter((l) => !l.matched).slice(0, 6);

  const guard = async (action: () => Promise<void>, message: string) => {
    setBusy(true);
    try {
      await action();
      await load();
      notify(message);
    } catch (e) {
      notify(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const add = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const question = draft.trim();
    if (question.length < 3 || question.length > 120) {
      notify("A suggested question needs 3 to 120 characters", "error");
      return;
    }
    const next = Math.max(0, ...suggestions.map((s) => s.sort_order)) + 1;
    void guard(async () => {
      await addChatSuggestion(question, next);
      setDraft("");
    }, "Suggested question added");
  };

  const move = (index: number, delta: -1 | 1) => {
    const order = [...suggestions];
    const [item] = order.splice(index, 1);
    order.splice(index + delta, 0, item);
    void guard(
      () =>
        Promise.all(
          order.map((s, i) => (s.sort_order === i + 1 ? null : updateChatSuggestion(s.id, { sort_order: i + 1 }))),
        ).then(() => undefined),
      "Order updated",
    );
  };

  return (
    <>
      <div className="admin-page-head">
        <div>
          <h2>AI chatbot management</h2>
          <p>
            What customers ask the shopping assistant over the last 30 days, and the suggested questions it
            shows them.
          </p>
        </div>
        <div className="report-actions">
          <button className="button button-outline" onClick={() => void load()} disabled={loading}>
            <Icon name="refresh" size={17} /> Refresh
          </button>
          <button className="button button-primary" onClick={() => inputRef.current?.focus()}>
            <Icon name="plus" /> Add suggested question
          </button>
        </div>
      </div>
      {loading ? (
        <Spinner label="Loading chatbot activity" />
      ) : (
        <>
          <div className="chatbot-stats">
            {[
              ["chat", String(logs.length), `Questions · ${customersUsing} customer${customersUsing === 1 ? "" : "s"}`],
              ["check", logs.length ? `${answeredPct}%` : "—", "Questions the bot understood"],
              ["food", String(recommendations), "Product recommendations"],
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
          <div className="admin-chat-grid">
            <section className="panel">
              <div className="panel-title">
                <div>
                  <h3>Recent interactions</h3>
                  <p>Latest customer questions</p>
                </div>
              </div>
              {logs.length === 0 ? (
                <p className="muted small-note">
                  No questions yet. They appear here as customers use “Ask Ailyn AI”.
                </p>
              ) : (
                logs.slice(0, 6).map((l) => {
                  const name = profileById.get(l.customer_id)?.full_name || "Customer";
                  return (
                    <div className="interaction" key={l.id}>
                      <span>{initials(name)}</span>
                      <div>
                        <strong>{name}</strong>
                        <p>{l.question}</p>
                        {l.product_id != null && (
                          <small className="muted">→ {productName.get(l.product_id) ?? "a product"}</small>
                        )}
                      </div>
                      <small>{timeAgo(l.created_at)}</small>
                    </div>
                  );
                })
              )}
            </section>
            <section className="panel">
              <div className="panel-title">
                <div>
                  <h3>Top questions</h3>
                  <p>Most asked · last 30 days</p>
                </div>
              </div>
              {top.length === 0 ? (
                <p className="muted small-note">Nothing asked yet.</p>
              ) : (
                top.map((row, i) => (
                  <div className="faq-item" key={row.text}>
                    <b>{i + 1}</b>
                    <span>{row.text}</span>
                    <small>
                      {row.count} ask{row.count === 1 ? "" : "s"}
                    </small>
                  </div>
                ))
              )}
            </section>
          </div>
          <div className="admin-chat-grid">
            <section className="panel">
              <div className="panel-title">
                <div>
                  <h3>Suggested questions</h3>
                  <p>Shown as quick replies in the customer chat</p>
                </div>
              </div>
              <form className="suggestion-form" onSubmit={add}>
                <input
                  ref={inputRef}
                  value={draft}
                  maxLength={120}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="e.g. Is the bread baked today?"
                  aria-label="New suggested question"
                />
                <button className="button button-primary" disabled={busy || !draft.trim()}>
                  Add
                </button>
              </form>
              {suggestions.length === 0 && (
                <p className="muted small-note">No suggestions yet. Customers see the built-in defaults.</p>
              )}
              {suggestions.map((s, i) => (
                <div className={`suggestion-row ${s.active ? "" : "hidden"}`} key={s.id}>
                  <b className={`live-dot ${s.active ? "on" : ""}`} />
                  <p>{s.question}</p>
                  <div className="table-actions">
                    <button disabled={busy || i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                      ↑
                    </button>
                    <button
                      disabled={busy || i === suggestions.length - 1}
                      onClick={() => move(i, 1)}
                      aria-label="Move down"
                    >
                      ↓
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void guard(
                          () => updateChatSuggestion(s.id, { active: !s.active }),
                          s.active ? "Hidden from customers" : "Shown to customers",
                        )
                      }
                    >
                      {s.active ? "Hide" : "Show"}
                    </button>
                    <button
                      className="danger"
                      disabled={busy}
                      onClick={() =>
                        window.confirm(`Delete “${s.question}”?`) &&
                        void guard(() => deleteChatSuggestion(s.id), "Suggested question deleted")
                      }
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </section>
            <section className="panel">
              <div className="panel-title">
                <div>
                  <h3>Couldn't answer</h3>
                  <p>Ideas for new products or suggested questions</p>
                </div>
              </div>
              {unanswered.length === 0 ? (
                <p className="muted small-note">Every recent question got a direct answer.</p>
              ) : (
                unanswered.map((l) => (
                  <div className="faq-item" key={l.id}>
                    <b>?</b>
                    <span>{l.question}</span>
                    <small>{timeAgo(l.created_at)}</small>
                  </div>
                ))
              )}
            </section>
          </div>
        </>
      )}
    </>
  );
}

// ------------------------------------------------------------------ settings

function AdminSettings({
  profile,
  setProfile,
  notify,
}: {
  profile: Profile;
  setProfile: (p: Profile) => void;
  notify: Notify;
}) {
  const [busy, setBusy] = useState(false);
  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // React clears e.currentTarget once the handler yields, so keep the form element.
    const form = e.currentTarget;
    const data = new FormData(form);
    const changes = {
      full_name: String(data.get("name") ?? "").trim(),
      phone: String(data.get("phone") ?? "").trim() || null,
    };
    const password = String(data.get("password") ?? "");
    if (password && password.length < 6) {
      notify("New password must be at least 6 characters", "error");
      return;
    }
    setBusy(true);
    try {
      await updateMyProfile(profile.id, changes);
      setProfile({ ...profile, ...changes });
      if (password) {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        (form.elements.namedItem("password") as HTMLInputElement).value = "";
      }
      notify(password ? "Settings and password saved" : "Settings saved");
    } catch (err) {
      notify(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
    <form onSubmit={save}>
      <div className="admin-page-head">
        <div>
          <h2>Profile & settings</h2>
          <p>Manage your administrator account.</p>
        </div>
        <button className="button button-primary" disabled={busy}>
          {busy ? "Saving…" : "Save changes"}
        </button>
      </div>
      <div className="settings-grid">
        <section className="panel settings-profile">
          <div className="settings-avatar">{initials(profile.full_name)}</div>
          <h3>{profile.full_name || "Administrator"}</h3>
          <p>Administrator · {profile.email}</p>
        </section>
        <section className="panel settings-form">
          <h3>Profile information</h3>
          <div className="field-grid">
            <label className="full-field">
              Full name
              <input name="name" defaultValue={profile.full_name} required />
            </label>
            <label className="full-field">
              Email address
              <input defaultValue={profile.email ?? ""} disabled />
            </label>
            <label className="full-field">
              Contact number
              <input name="phone" defaultValue={profile.phone ?? ""} />
            </label>
          </div>
          <hr />
          <h3>Security</h3>
          <div className="field-grid">
            <label className="full-field">
              New password
              <input name="password" type="password" autoComplete="new-password" placeholder="Leave blank to keep current password" />
            </label>
          </div>
        </section>
      </div>
    </form>
    <StoreLocationPanel notify={notify} />
    </>
  );
}

/** Where Ailyn's is. Every live map draws its routes from this pin. */
function StoreLocationPanel({ notify }: { notify: Notify }) {
  const store = useStoreSettings();
  const saved = toLatLng(store.settings?.lat, store.settings?.lng);
  const [point, setPoint] = useState<LatLng | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const current = point ?? saved;
  const dirty = point != null || address != null;

  const save = async () => {
    if (!current) {
      notify("Drop the pin on Ailyn's store first", "error");
      return;
    }
    setBusy(true);
    try {
      await updateStoreSettings({
        address: (address ?? store.settings?.address ?? "").trim() || null,
        lat: current.lat,
        lng: current.lng,
      });
      await refreshStoreLocation();
      setPoint(null);
      setAddress(null);
      notify("Store location saved");
    } catch (err) {
      notify(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel store-location-panel">
      <div className="store-location-head">
        <div>
          <h3>Ailyn's store location</h3>
          <p>
            The live map draws each delivery route from here. At the store, use your current location, or
            tap the map and drag the pin onto the shop.
          </p>
        </div>
        <button
          type="button"
          className="button button-primary"
          onClick={save}
          disabled={busy || !dirty || store.status !== "ready"}
        >
          {busy ? "Saving…" : "Save location"}
        </button>
      </div>
      {store.status === "loading" ? (
        <Spinner label="Loading store location" />
      ) : store.status === "missing" ? (
        <p className="muted small-note">
          The store location table isn't set up yet. Apply the <code>live_route_map</code> migration in
          Supabase, then reload this page.
        </p>
      ) : (
        <div className="field-grid">
          <label className="full-field">
            Store address
            <input
              value={address ?? store.settings?.address ?? ""}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Street, barangay, city"
            />
          </label>
          <div className="full-field">
            <LocationPicker value={current} onChange={setPoint} kind="store" height={320} />
            {!saved && <small className="muted">Not set yet: the maps show only the rider and the customer.</small>}
          </div>
        </div>
      )}
    </section>
  );
}
