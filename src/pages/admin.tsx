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
  fetchChatLogs,
  fetchChatSuggestions,
  fetchOrders,
  fetchProducts,
  fetchProfiles,
  fetchVouchers,
  saveProduct,
  setProductAvailable,
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
  OrderEvent,
  OrderStatus,
  Profile,
  Voucher,
  activeStatuses,
  formatDateTime,
  formatTime,
  initials,
  itemsSummary,
  statusLabel,
} from "../lib/types";
import { OrderDetailsModal } from "../components/OrderDetails";
import { LocationPicker } from "../components/Maps";
import { DeliveryFeeEditor } from "../components/DeliveryFee";
import { GcashReviewPanel, GcashSettingsPanel, PaymentTag } from "../components/GcashPayment";
import { cancelOrderQuestion, paymentBlocksConfirm } from "../lib/gcash";
import { LatLng, refreshStoreLocation, toLatLng, useStoreSettings } from "../lib/geo";
import { FeeRule, describeFeeRule, feeForKm, feeRule, hasFeeRule } from "../lib/fees";
import {
  DAY,
  LOW_STOCK,
  PeriodId,
  busiestHour,
  change,
  inRange,
  isSale,
  lowStock,
  periodRange,
  previousRange,
  productSales,
  salesBuckets,
  summarize,
} from "../lib/sales";
import { voucherState } from "../lib/vouchers";
import { AdminReports, SalesChart } from "./admin-reports";
import { AdminVouchers } from "./admin-vouchers";
import { AdminReviews } from "./admin-reviews";
import { OrderReviewSummary, RiderRatingTag } from "../components/Reviews";

const adminNav = [
  ["Dashboard", "dashboard"],
  ["Orders", "orders"],
  ["Riders", "bike"],
  ["Products", "box"],
  ["Customers", "customers"],
  ["Reviews", "star"],
  ["Vouchers", "ticket"],
  ["Sales & Reports", "report"],
  ["Chatbot", "chat"],
  ["Settings", "settings"],
] as const;

const allStatuses = Object.keys(statusLabel) as OrderStatus[];

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
  const [productStatus, setProductStatus] = useState("All status");
  // undefined while loading, null when the vouchers migration isn't applied yet.
  const [vouchers, setVouchers] = useState<Voucher[] | null | undefined>(undefined);

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
  const loadVouchers = useCallback(
    () =>
      fetchVouchers()
        .then(setVouchers)
        .catch((e) => {
          setVouchers((v) => v ?? []);
          notify(errorMessage(e), "error");
        }),
    [notify],
  );

  useEffect(() => {
    Promise.all([loadProducts(), loadOrders(), loadProfiles()]).finally(() => setLoading(false));
    void loadVouchers();
  }, [loadProducts, loadOrders, loadProfiles, loadVouchers]);

  useRealtime("admin-orders", [{ table: "orders" }, { table: "order_events" }], () => void loadOrders());
  // Stock moves with orders, and other admins may edit the catalog.
  useRealtime("admin-products", [{ table: "products" }], () => void loadProducts());
  useRealtime("admin-profiles", [{ table: "profiles" }], () => void loadProfiles());
  useRealtime("admin-vouchers", vouchers === null ? [] : [{ table: "vouchers" }], () => void loadVouchers());

  const riders = profiles.filter((p) => p.role === "rider");
  const customers = profiles.filter((p) => p.role === "customer");
  const profileById = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles]);
  const pendingCount = orders.filter((o) => o.status === "pending").length;
  const notices = useMemo(
    () => adminNotices(orders, profiles, profileById, profile.id),
    [orders, profiles, profileById, profile.id],
  );
  // Reviews are logged on the order timeline, so a new or edited review reloads the Reviews page.
  const reviewKey = useMemo(
    () =>
      orders
        .flatMap((o) => o.order_events ?? [])
        .filter((e) => isReviewNote(e.note))
        .map((e) => e.id)
        .sort((a, b) => b - a)
        .slice(0, 1)
        .join(),
    [orders],
  );
  // An order opened from a notification, kept by id so it follows live updates.
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);
  const openOrder = openOrderId ? (orders.find((o) => o.id === openOrderId) ?? null) : null;

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
            <NotificationBell
              notices={notices}
              seenKey={`ae_admin_notices_seen_${profile.id}`}
              onOpenOrder={setOpenOrderId}
              onGo={go}
            />
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
              vouchers={vouchers}
              profileById={profileById}
              setSection={go}
              showLowStock={() => {
                setProductStatus("Low stock");
                go("Products");
              }}
              reloadProducts={loadProducts}
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
            <AdminProducts
              products={products}
              statusFilter={productStatus}
              setStatusFilter={setProductStatus}
              reload={loadProducts}
              notify={notify}
            />
          ) : section === "Customers" ? (
            <AdminCustomers
              customers={customers}
              orders={orders}
              onViewOrders={(name) => {
                setOrderSearch(name);
                go("Orders");
              }}
            />
          ) : section === "Reviews" ? (
            <AdminReviews profileById={profileById} refreshKey={reviewKey} notify={notify} />
          ) : section === "Vouchers" ? (
            <AdminVouchers vouchers={vouchers} orders={orders} reload={loadVouchers} notify={notify} />
          ) : section === "Sales & Reports" ? (
            <AdminReports
              orders={orders}
              products={products}
              customers={customers}
              riders={riders}
              profileById={profileById}
              downloadOrders={(list, name) => downloadOrdersCsv(list, profileById, name)}
              notify={notify}
            />
          ) : section === "Chatbot" ? (
            <AdminChatbot notify={notify} profileById={profileById} products={products} />
          ) : (
            <AdminSettings profile={profile} setProfile={setProfile} notify={notify} />
          )}
        </main>
      </div>
      {sidebarOpen && <button className="sidebar-scrim" aria-label="Close menu" onClick={() => setSidebarOpen(false)} />}
      {openOrder && (
        <AdminOrderModal
          order={openOrder}
          profileById={profileById}
          notify={notify}
          reload={loadOrders}
          onClose={() => setOpenOrderId(null)}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ notifications

type Notice = {
  id: string;
  at: string;
  icon: string;
  tone: "new" | "good" | "bad" | "info";
  title: string;
  text: string;
  /** Opens this order when clicked… */
  orderId?: string;
  /** …or this admin section. */
  section?: string;
};

const isReviewNote = (note: string | null | undefined) =>
  !!note && (note.startsWith("Customer left a review") || note.startsWith("Customer updated their review"));

const NOTICE_DAYS = 7;
const NOTICE_LIMIT = 40;
const time = (iso: string) => new Date(iso).getTime();

/** What happened in the last week that this admin didn't do themselves: order activity and rider sign-ups. */
function adminNotices(
  orders: Order[],
  profiles: Profile[],
  profileById: Map<string, Profile>,
  me: string,
): Notice[] {
  const since = Date.now() - NOTICE_DAYS * DAY;
  const list: Notice[] = [];
  for (const order of orders) {
    for (const ev of order.order_events ?? []) {
      if (ev.actor_id === me || time(ev.created_at) < since) continue;
      list.push(orderNotice(order, ev, profileById));
    }
  }
  for (const p of profiles) {
    if (p.role !== "rider" || p.rider_approved || time(p.created_at) < since) continue;
    list.push({
      id: `rider-${p.id}`,
      at: p.created_at,
      icon: "bike",
      tone: "new",
      title: "Rider waiting for approval",
      text: `${p.full_name || "A new rider"} signed up${p.vehicle ? ` · ${p.vehicle}` : ""}`,
      section: "Riders",
    });
  }
  return list.sort((a, b) => time(b.at) - time(a.at)).slice(0, NOTICE_LIMIT);
}

function orderNotice(order: Order, ev: OrderEvent, profileById: Map<string, Profile>): Notice {
  const base = { id: `event-${ev.id}`, at: ev.created_at, orderId: order.id };
  const code = `#${order.code}`;
  const note = ev.note ?? statusLabel[ev.status];
  const who =
    (ev.actor_id && profileById.get(ev.actor_id)?.full_name) ||
    (ev.actor_role === "rider" ? "The rider" : ev.actor_role === "customer" ? order.customer_name : "Someone");

  if (note === "Order placed") {
    return {
      ...base,
      icon: "bag",
      tone: "new",
      title: `New order ${code}`,
      text: `${order.customer_name} · ${money(Number(order.total))} · ${itemsSummary(order.order_items)}`,
    };
  }
  if (ev.status === "cancelled") {
    return {
      ...base,
      icon: "close",
      tone: "bad",
      title: `Order ${code} cancelled`,
      text: ev.actor_role === "customer" ? `${order.customer_name} cancelled it` : note,
    };
  }
  // Reviews are logged with the order's status (delivered), so check them before "delivered".
  if (isReviewNote(note)) {
    const stars = Number(/rider (\d)★/.exec(note)?.[1] ?? 0);
    return {
      ...base,
      icon: "star",
      tone: stars && stars <= 2 ? "bad" : "good",
      title: `${note.startsWith("Customer updated") ? "Review updated" : "New review"} on ${code}`,
      text: `${order.customer_name} · ${note.slice(note.indexOf(":") + 1).trim()}`,
    };
  }
  if (ev.status === "delivered") {
    return { ...base, icon: "check", tone: "good", title: `Order ${code} delivered`, text: `${who} delivered it to ${order.customer_name}` };
  }
  if (note.startsWith("GCash payment sent")) {
    return {
      ...base,
      icon: "wallet",
      tone: "new",
      title: `GCash payment to check on ${code}`,
      text: `${order.customer_name} · ${money(Number(order.total))} · ${note.split(" · ")[1] ?? "receipt sent"}`,
    };
  }
  if (note.startsWith("Delivery fee changed")) {
    return {
      ...base,
      icon: "wallet",
      tone: "info",
      title: `Delivery fee changed on ${code}`,
      text: `${who} changed it ${note.slice("Delivery fee changed ".length)}`,
    };
  }
  if (note === "Rider released the delivery") {
    return { ...base, icon: "alert", tone: "bad", title: `${code} needs a new rider`, text: `${who} released the delivery` };
  }
  if (note === "Rider accepted the delivery") {
    return { ...base, icon: "bike", tone: "info", title: `Rider accepted ${code}`, text: `${who} will deliver to ${order.city}` };
  }
  if (ev.status === "out_for_delivery") {
    return { ...base, icon: "bike", tone: "info", title: `${code} is out for delivery`, text: `${who} picked up the order` };
  }
  return { ...base, icon: "orders", tone: "info", title: `Order ${code} · ${statusLabel[ev.status]}`, text: note };
}

function readSeen(key: string) {
  try {
    return Number(localStorage.getItem(key)) || 0;
  } catch {
    return 0;
  }
}

function NotificationBell({
  notices,
  seenKey,
  onOpenOrder,
  onGo,
}: {
  notices: Notice[];
  /** localStorage key for when this admin last opened the list. */
  seenKey: string;
  onOpenOrder: (orderId: string) => void;
  onGo: (section: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [seenAt, setSeenAt] = useState(() => readSeen(seenKey));
  // Items newer than this stay highlighted while the list is open, even though opening marks them read.
  const [freshSince, setFreshSince] = useState(seenAt);
  const wrap = useRef<HTMLDivElement>(null);
  const unread = notices.filter((n) => time(n.at) > seenAt).length;

  const markSeen = useCallback(() => {
    const now = Date.now();
    setSeenAt(now);
    try {
      localStorage.setItem(seenKey, String(now));
    } catch {
      // private mode etc.: unread counts just won't survive a reload
    }
  }, [seenKey]);

  const close = useCallback(() => {
    setOpen(false);
    markSeen();
  }, [markSeen]);

  const toggle = () => {
    if (open) return close();
    setFreshSince(seenAt);
    markSeen();
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  const pick = (n: Notice) => {
    close();
    if (n.orderId) onOpenOrder(n.orderId);
    else if (n.section) onGo(n.section);
  };

  return (
    <div className="notif-wrap" ref={wrap}>
      <button
        className="notif-bell"
        aria-label={unread ? `Notifications, ${unread} new` : "Notifications"}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={toggle}
      >
        <Icon name="bell" />
        {unread > 0 && <span>{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <section className="notif-panel" role="dialog" aria-label="Notifications">
          <div className="notif-head">
            <strong>Notifications</strong>
            <small>Last {NOTICE_DAYS} days</small>
          </div>
          {notices.length === 0 ? (
            <div className="notif-empty">
              <Icon name="bell" size={28} />
              <strong>You're all caught up</strong>
              <p>New orders, cancellations and rider updates will show up here.</p>
            </div>
          ) : (
            <ul className="notif-list">
              {notices.map((n) => (
                <li key={n.id}>
                  <button className={time(n.at) > freshSince ? "fresh" : ""} onClick={() => pick(n)}>
                    <span className={`notif-icon ${n.tone}`}>
                      <Icon name={n.icon} size={17} />
                    </span>
                    <span className="notif-text">
                      <strong>{n.title}</strong>
                      <small>{n.text}</small>
                      <time dateTime={n.at}>{timeAgo(n.at)}</time>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button
            className="notif-foot"
            onClick={() => {
              close();
              onGo("Orders");
            }}
          >
            Go to all orders
          </button>
        </section>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ dashboard

const revenueOf = (orders: Order[]) => orders.filter(isSale).reduce((sum, o) => sum + Number(o.total), 0);

const dashRanges: [PeriodId, string, string][] = [
  ["today", "Today", "today"],
  ["7d", "7 days", "last 7 days"],
  ["30d", "30 days", "last 30 days"],
  ["12m", "12 months", "last 12 months"],
];

/** Stock count with a Save button, for restocking right from a list. */
function StockEditor({
  product,
  reload,
  notify,
}: {
  product: Product;
  reload: () => Promise<unknown>;
  notify: Notify;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const value = draft ?? String(product.stock);
  const dirty = draft != null && draft.trim() !== String(product.stock);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const n = Number(value);
    if (value.trim() === "" || !Number.isInteger(n) || n < 0 || n > 100000) {
      notify("Stock must be a whole number, 0 or more", "error");
      return;
    }
    setBusy(true);
    try {
      await setProductStock(product.id, n);
      await reload();
      setDraft(null);
      notify(`${product.name}: ${n} in stock`);
    } catch (err) {
      notify(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="stock-edit" onSubmit={save}>
      <input
        type="number"
        min="0"
        step="1"
        inputMode="numeric"
        value={value}
        onChange={(e) => setDraft(e.target.value)}
        aria-label={`Stock for ${product.name}`}
      />
      <button disabled={!dirty || busy}>{busy ? "…" : "Save"}</button>
    </form>
  );
}

function StockBadge({ stock }: { stock: number }) {
  if (stock === 0) return <span className="stock-badge out">Out of stock</span>;
  if (stock < LOW_STOCK) return <span className="stock-badge low">{stock} left</span>;
  return null;
}

function AdminDashboard({
  profile,
  orders,
  products,
  customers,
  riders,
  vouchers,
  profileById,
  setSection,
  showLowStock,
  reloadProducts,
  notify,
}: {
  profile: Profile;
  orders: Order[];
  products: Product[];
  customers: Profile[];
  riders: Profile[];
  vouchers: Voucher[] | null | undefined;
  profileById: Map<string, Profile>;
  setSection: (s: string) => void;
  showLowStock: () => void;
  reloadProducts: () => Promise<unknown>;
  notify: Notify;
}) {
  const [rangeId, setRangeId] = useState<PeriodId>("7d");
  const [bestType, setBestType] = useState<"all" | Product["type"]>("all");
  const rangeLabel = dashRanges.find(([id]) => id === rangeId)?.[2] ?? "";

  const range = useMemo(() => periodRange(rangeId), [rangeId]);
  const scoped = useMemo(() => inRange(orders, range), [orders, range]);
  const s = useMemo(() => summarize(scoped), [scoped]);
  const prev = useMemo(() => summarize(inRange(orders, previousRange(range))), [orders, range]);
  // The summary compares today with the chosen period (or with yesterday when that is today).
  const today = useMemo(() => inRange(orders, periodRange("today")), [orders]);
  const other = useMemo(
    () => (rangeId === "today" ? inRange(orders, periodRange("yesterday")) : scoped),
    [orders, scoped, rangeId],
  );
  const sToday = useMemo(() => summarize(today), [today]);
  const sOther = useMemo(() => summarize(other), [other]);
  const sold = useMemo(() => productSales(scoped, products), [scoped, products]);
  const sold30 = useMemo(
    () => new Map(productSales(inRange(orders, periodRange("30d")), products).map((r) => [r.productId, r.qty])),
    [orders, products],
  );
  const buckets = useMemo(() => salesBuckets(scoped, products, range), [scoped, products, range]);
  const low = useMemo(() => lowStock(products), [products]);
  const peak = useMemo(() => busiestHour(scoped), [scoped]);

  const approved = riders.filter((r) => r.rider_approved);
  const available = approved.filter((r) => r.rider_online);
  const pending = orders.filter((o) => o.status === "pending").length;
  const needsRider = orders.filter((o) => !o.rider_id && ["confirmed", "preparing", "ready"].includes(o.status));
  const newCustomers = customers.filter((c) => {
    const t = new Date(c.created_at).getTime();
    return t >= range.start && t < range.end;
  }).length;
  const best = sold.filter((r) => bestType === "all" || r.type === bestType).slice(0, 5);
  const voucherUses = new Map<number, number>();
  for (const o of orders) {
    if (o.voucher_id != null && isSale(o)) voucherUses.set(o.voucher_id, (voucherUses.get(o.voucher_id) ?? 0) + 1);
  }
  const running = (vouchers ?? []).filter((v) => voucherState(v, voucherUses.get(v.id) ?? 0) === "running");
  const outCount = low.filter((p) => p.stock === 0).length;
  const vs = (now: number, before: number) => {
    const c = change(now, before);
    return c ? `${c} vs previous ${rangeId === "today" ? "day" : "period"}` : `Same as previous ${rangeId === "today" ? "day" : "period"}`;
  };

  const stats: { value: string; label: string; detail: string; icon: string; down?: boolean; go?: () => void }[] = [
    { value: money(s.sales), label: "Sales", detail: vs(s.sales, prev.sales), icon: "report", down: s.sales < prev.sales },
    { value: String(s.paid), label: "Orders", detail: vs(s.paid, prev.paid), icon: "orders", down: s.paid < prev.paid },
    {
      value: String(customers.length),
      label: "Customers",
      detail: newCustomers ? `${newCustomers} new · ${rangeLabel}` : "Registered",
      icon: "customers",
    },
    {
      value: `${available.length}/${approved.length}`,
      label: "Riders available",
      detail: `${riders.length - approved.length} awaiting approval`,
      icon: "bike",
      go: () => setSection("Riders"),
    },
    {
      value: String(pending),
      label: "Pending orders",
      detail: pending ? "Needs review" : "All caught up",
      icon: "food",
      down: pending > 0,
      go: () => setSection("Orders"),
    },
    {
      value: String(low.length),
      label: "Low stock",
      detail: low.length ? (outCount ? `${outCount} out of stock` : `Under ${LOW_STOCK} units`) : "All stocked",
      icon: "stock",
      down: low.length > 0,
      go: showLowStock,
    },
  ];

  const summaryRows: [string, (x: ReturnType<typeof summarize>) => string][] = [
    ["Net sales", (x) => money(x.sales)],
    ["Orders", (x) => String(x.paid)],
    ["Delivered", (x) => String(x.delivered)],
    ["In progress", (x) => String(x.inProgress)],
    ["Cancelled", (x) => String(x.cancelled)],
    ["Items sold", (x) => String(x.itemsSold)],
    ["Average order", (x) => money(x.avgOrder)],
    ["Delivery fees", (x) => money(x.deliveryFees)],
    ["Discounts given", (x) => (x.discounts ? `−${money(x.discounts)}` : money(0))],
  ];
  const otherTitle = rangeId === "today" ? "Yesterday" : dashRanges.find(([id]) => id === rangeId)?.[1] ?? "";

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
          {dashRanges.map(([id, text]) => (
            <button key={id} className={rangeId === id ? "active" : ""} onClick={() => setRangeId(id)}>
              {text}
            </button>
          ))}
        </div>
      </div>
      <div className="stats-grid">
        {stats.map(({ value, label, detail, icon, down, go }) => {
          const body = (
            <>
              <span>
                <Icon name={icon} />
              </span>
              <div>
                <small>{label}</small>
                <strong>{value}</strong>
                <em className={down ? "down" : ""}>{detail}</em>
              </div>
            </>
          );
          return go ? (
            <button className={`stat-card clickable ${label === "Low stock" && low.length ? "alert" : ""}`} key={label} onClick={go}>
              {body}
            </button>
          ) : (
            <div className="stat-card" key={label}>
              {body}
            </div>
          );
        })}
      </div>
      {needsRider.length > 0 && (
        <div className="inventory-alert dispatch-alert">
          <Icon name="bike" />
          <div>
            <strong>
              {needsRider.length} order{needsRider.length === 1 ? "" : "s"} waiting for a rider
            </strong>
            <p>Available riders can accept them from their job list, or you can assign one now.</p>
          </div>
          <button onClick={() => setSection("Orders")}>Dispatch</button>
        </div>
      )}

      <div className="admin-grid-main">
        <section className="panel sales-panel summary-panel">
          <div className="panel-title">
            <div>
              <h3>Summary</h3>
              <p>
                Today vs {rangeId === "today" ? "yesterday" : `the ${rangeLabel}`}
              </p>
            </div>
            <button onClick={() => setSection("Sales & Reports")}>Full report</button>
          </div>
          <table className="summary-table">
            <thead>
              <tr>
                <th />
                <th>Today</th>
                <th>{otherTitle}</th>
              </tr>
            </thead>
            <tbody>
              {summaryRows.map(([label, value]) => (
                <tr key={label}>
                  <th scope="row">{label}</th>
                  <td>{value(sToday)}</td>
                  <td>{value(sOther)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="summary-notes">
            <li>
              <Icon name="food" size={16} />
              {sold[0] ? (
                <span>
                  Top seller ({rangeLabel}): <b>{sold[0].name}</b>, {sold[0].qty} sold
                </span>
              ) : (
                <span>No sales in the {rangeLabel} yet</span>
              )}
            </li>
            {peak && (
              <li>
                <Icon name="clock" size={16} />
                <span>
                  Busiest time: <b>{peak.label}</b> ({peak.orders} order{peak.orders === 1 ? "" : "s"})
                </span>
              </li>
            )}
            <li>
              <Icon name="ticket" size={16} />
              {vouchers === null ? (
                <span>Vouchers aren't switched on yet</span>
              ) : running.length ? (
                <span>
                  Vouchers running: <b>{running.map((v) => v.code).join(", ")}</b>
                </span>
              ) : (
                <span>
                  No vouchers running.{" "}
                  <button className="text-link" onClick={() => setSection("Vouchers")}>
                    Create one
                  </button>
                </span>
              )}
            </li>
            <li className={low.length ? "warn" : ""}>
              <Icon name="stock" size={16} />
              <span>
                {low.length
                  ? `${low.length} product${low.length === 1 ? " is" : "s are"} low on stock${outCount ? `, ${outCount} sold out` : ""}`
                  : "Every product is well stocked"}
              </span>
            </li>
          </ul>
        </section>

        <section className={`panel best-panel low-panel ${low.length ? "has-low" : ""}`}>
          <div className="panel-title">
            <div>
              <h3>Low stock</h3>
              <p>Under {LOW_STOCK} units · restock right here</p>
            </div>
            <button onClick={showLowStock}>View in products</button>
          </div>
          {low.length === 0 ? (
            <div className="low-empty">
              <Icon name="check" size={22} />
              <p>Every available product has {LOW_STOCK} or more units.</p>
            </div>
          ) : (
            low.slice(0, 7).map((p) => (
              <div className={`best-item low-item ${p.stock === 0 ? "out" : ""}`} key={p.id}>
                <img src={p.image || FALLBACK_IMAGE} alt="" onError={imgFallback} />
                <div>
                  <strong>{p.name}</strong>
                  <small>
                    <StockBadge stock={p.stock} /> {sold30.get(p.id) ? `${sold30.get(p.id)} sold in 30 days` : p.category}
                  </small>
                </div>
                <StockEditor product={p} reload={reloadProducts} notify={notify} />
              </div>
            ))
          )}
          {low.length > 7 && (
            <button className="show-more" onClick={showLowStock}>
              +{low.length - 7} more low-stock products
            </button>
          )}
        </section>
      </div>

      <div className="admin-grid-main">
        <section className="panel sales-panel">
          <div className="panel-title">
            <div>
              <h3>Sales overview</h3>
              <p>Item sales by type · {rangeLabel}</p>
            </div>
            <strong>
              {money(s.sales)} <small>net sales</small>
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
        <section className="panel best-panel">
          <div className="panel-title">
            <div>
              <h3>Best sellers</h3>
              <p>By units sold · {rangeLabel}</p>
            </div>
            <button onClick={() => setSection("Sales & Reports")}>All sales</button>
          </div>
          <div className="date-filter type-filter">
            {(
              [
                ["all", "All"],
                ["food", "Meals"],
                ["grocery", "Products"],
              ] as const
            ).map(([id, text]) => (
              <button key={id} className={bestType === id ? "active" : ""} onClick={() => setBestType(id)}>
                {text}
              </button>
            ))}
          </div>
          {best.length === 0 ? (
            <p className="muted small-note">
              {sold.length ? `No ${bestType === "food" ? "meals" : "products"} sold in the ${rangeLabel}.` : `No sales in the ${rangeLabel} yet.`}
            </p>
          ) : (
            best.map((r, i) => {
              const stock = r.product?.stock;
              const isLow = stock != null && r.product?.active !== false && stock < LOW_STOCK;
              return (
                <div className={`best-item ${isLow ? "low-item" : ""} ${stock === 0 ? "out" : ""}`} key={r.key}>
                  <b>{i + 1}</b>
                  <img src={r.image || FALLBACK_IMAGE} alt="" onError={imgFallback} />
                  <div>
                    <strong>{r.name}</strong>
                    <small>
                      {r.qty} sold · {money(r.revenue)}
                      {r.type ? ` · ${r.type === "food" ? "Meal" : "Product"}` : ""}
                    </small>
                  </div>
                  {isLow ? <StockBadge stock={stock} /> : <span>{r.product ? money(r.product.price) : "—"}</span>}
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
          <OrderTable orders={orders.slice(0, 6)} riders={riders} profileById={profileById} compact notify={notify} />
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
                          : "Unavailable"}
                    </small>
                  </div>
                  <span>{rider.vehicle ?? ""}</span>
                </div>
              );
            })
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
    if (status === "cancelled" && !window.confirm(cancelOrderQuestion(order))) return;
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
                  <small>
                    {order.payment_status ? (
                      <PaymentTag order={order} short />
                    ) : order.payment_method === "cod" ? (
                      "COD"
                    ) : (
                      "GCash"
                    )}
                  </small>
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
                            {r.full_name} {r.rider_online ? "● available" : "○ unavailable"}
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
        <AdminOrderModal
          order={live}
          profileById={profileById}
          notify={notify}
          reload={reload}
          onClose={() => setDetails(null)}
        />
      )}
    </div>
  );
}

/** An order's details with the admin's next-step buttons and fee editor. */
function AdminOrderModal({
  order,
  profileById,
  notify,
  reload,
  onClose,
}: {
  order: Order;
  profileById: Map<string, Profile>;
  notify: Notify;
  reload?: () => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);

  const changeStatus = async (status: OrderStatus) => {
    if (status === "cancelled" && !window.confirm(cancelOrderQuestion(order))) return;
    setBusy(true);
    try {
      await adminUpdateStatus(order.id, status);
      notify(`#${order.code} → ${statusLabel[status]}`);
      reload?.();
    } catch (e) {
      notify(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const step = (status: OrderStatus, label: string) => (
    <button className="button button-primary" disabled={busy} onClick={() => void changeStatus(status)}>
      {label}
    </button>
  );

  return (
    <OrderDetailsModal
      order={order}
      rider={order.rider_id ? profileById.get(order.rider_id) : null}
      onClose={onClose}
      showMap
      showMissingProof
      top={<GcashReviewPanel key={order.id} order={order} notify={notify} onDone={() => reload?.()} />}
      actions={
        order.status === "pending" ? (
          <>
            <button className="button button-outline" disabled={busy} onClick={() => void changeStatus("cancelled")}>
              Cancel order
            </button>
            {/* A GCash order is confirmed by verifying its payment, in the panel at the top. */}
            {!paymentBlocksConfirm(order) && step("confirmed", "Confirm order")}
          </>
        ) : order.status === "confirmed" ? (
          step("preparing", "Start preparing")
        ) : order.status === "preparing" ? (
          step("ready", "Ready for pickup")
        ) : undefined
      }
    >
      <OrderReviewSummary order={order} />
      <DeliveryFeeEditor order={order} viewer="admin" notify={notify} onSaved={() => reload?.()} />
    </OrderDetailsModal>
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
  const [filter, setFilter] = useState<"all" | OrderStatus | "unassigned" | "payment">("all");
  const q = search.toLowerCase();
  const matches = orders.filter(
    (o) =>
      !q ||
      o.code.toLowerCase().includes(q) ||
      o.customer_name.toLowerCase().includes(q) ||
      o.city.toLowerCase().includes(q),
  );
  const unassigned = (o: Order) => !o.rider_id && ["confirmed", "preparing", "ready"].includes(o.status);
  const toCheck = (o: Order) => o.payment_status === "submitted" && o.status !== "cancelled";
  const visible = matches.filter((o) =>
    filter === "all"
      ? true
      : filter === "unassigned"
        ? unassigned(o)
        : filter === "payment"
          ? toCheck(o)
          : o.status === filter,
  );
  const tabs: ["all" | OrderStatus | "unassigned" | "payment", string, number][] = [
    ["all", "All orders", matches.length],
    ["pending", "Pending", matches.filter((o) => o.status === "pending").length],
    ["payment", "GCash to check", matches.filter(toCheck).length],
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
        Riders see unassigned confirmed orders in their job list. A GCash QR order is confirmed by verifying its
        payment: open it from “GCash to check”.
      </p>
    </>
  );
}

function downloadOrdersCsv(orders: Order[], profileById: Map<string, Profile>, name: string) {
  const header = [
    "Order", "Placed", "Customer", "Phone", "City", "Status", "Rider", "Payment",
    "Payment status", "GCash ref", "GCash received",
    "Subtotal", "Distance km", "Checkout fee", "Fee", "Fee note", "Voucher", "Discount", "Total",
  ];
  const rows = orders.map((o) => [
    o.code,
    o.created_at,
    o.customer_name,
    o.customer_phone,
    o.city,
    statusLabel[o.status],
    (o.rider_id && profileById.get(o.rider_id)?.full_name) || "",
    o.payment_method,
    o.payment_status ?? "",
    o.gcash_reference ?? "",
    o.paid_amount ?? "",
    o.subtotal,
    o.delivery_km ?? "",
    o.quoted_delivery_fee ?? o.delivery_fee,
    o.delivery_fee,
    o.delivery_fee_note ?? "",
    o.voucher_code ?? "",
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
            Approve new riders, see who's available and what each rider is delivering.
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
              <th>Rating</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="empty-cell">
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
                    <Status value={r.rider_approved && r.rider_online ? "Available" : "Unavailable"} />
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
                  <td>{r.rider_rating_count ? <RiderRatingTag rider={r} /> : <span className="muted">—</span>}</td>
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

/** Available products under LOW_STOCK units: listed first and highlighted. */
const isLow = (p: Product) => p.active !== false && p.stock < LOW_STOCK;

const productStatus = (p: Product) =>
  p.active === false ? "Unavailable" : p.stock === 0 ? "Out of stock" : p.stock < LOW_STOCK ? "Low stock" : "Available";

function AdminProducts({
  products,
  statusFilter,
  setStatusFilter,
  reload,
  notify,
}: {
  products: Product[];
  statusFilter: string;
  setStatusFilter: (v: string) => void;
  reload: () => Promise<unknown>;
  notify: Notify;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All categories");
  const [editing, setEditing] = useState<Product | Omit<Product, "id"> | null>(null);
  const [busy, setBusy] = useState(false);
  const [switching, setSwitching] = useState<number | null>(null);
  const low = products.filter(isLow);

  const filtered = products
    .filter(
      (p) =>
        p.name.toLowerCase().includes(query.toLowerCase()) &&
        (category === "All categories" || p.category === category) &&
        (statusFilter === "All status" ||
          (statusFilter === "Available" && p.active !== false) ||
          (statusFilter === "Unavailable" && p.active === false) ||
          (statusFilter === "Low stock" && isLow(p))),
    )
    // Low stock on top, emptiest first; the rest keep catalog order.
    .sort((a, b) => Number(isLow(b)) - Number(isLow(a)) || (isLow(a) ? a.stock - b.stock : 0) || a.id - b.id);

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
      // Reviewed products have no rating field: their rating is the customers' average.
      rating: data.has("rating") ? Math.min(5, Math.max(0, Number(data.get("rating")) || 0)) : editing.rating,
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

  const toggleAvailable = async (p: Product) => {
    const next = p.active === false;
    setSwitching(p.id);
    try {
      await setProductAvailable(p.id, next);
      await reload();
      notify(next ? `${p.name} is available to customers` : `${p.name} is now unavailable to customers`);
    } catch (err) {
      notify(errorMessage(err), "error");
    } finally {
      setSwitching(null);
    }
  };

  return (
    <>
      <div className="admin-page-head">
        <div>
          <h2>Product management</h2>
          <p>
            Manage meals, groceries, prices, stock and availability. Stock drops when customers order and comes back when
            an order is cancelled.
          </p>
        </div>
        <button className="button button-primary" onClick={() => setEditing({ ...emptyProduct })}>
          <Icon name="plus" /> <span>Add product</span>
        </button>
      </div>
      {low.length > 0 && (
        <div className="inventory-alert">
          <Icon name="stock" />
          <div>
            <strong>
              {low.length} product{low.length === 1 ? " is" : "s are"} low on stock
            </strong>
            <p>
              {low
                .slice(0, 4)
                .map((p) => `${p.name} (${p.stock === 0 ? "sold out" : `${p.stock} left`})`)
                .join(", ")}
              {low.length > 4 ? ` and ${low.length - 4} more` : ""}. They're listed first.
            </p>
          </div>
          <button onClick={() => setStatusFilter(statusFilter === "Low stock" ? "All status" : "Low stock")}>
            {statusFilter === "Low stock" ? "Show all" : "Only low stock"}
          </button>
        </div>
      )}
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
          <option>Available</option>
          <option>Unavailable</option>
          <option>Low stock</option>
        </select>
      </div>
      <section className="panel admin-table-wrap">
        <table className="admin-table product-table">
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
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="empty-cell">
                  No products match these filters.
                </td>
              </tr>
            )}
            {filtered.map((p) => {
              const available = p.active !== false;
              return (
                <tr key={p.id} className={isLow(p) ? (p.stock === 0 ? "row-out" : "row-low") : available ? "" : "row-off"}>
                  <td>
                    <div className="table-product">
                      <img src={p.image || FALLBACK_IMAGE} alt="" onError={imgFallback} />
                      <div>
                        <strong>{p.name}</strong>
                        <small>
                          #PRD-{String(p.id).padStart(4, "0")}
                          {p.review_count ? ` · ★ ${p.rating} (${p.review_count})` : ""}
                        </small>
                      </div>
                    </div>
                  </td>
                  <td>
                    {p.category}
                    <small>{p.type === "food" ? "Meal" : "Product"}</small>
                  </td>
                  <td>
                    <strong>{money(p.price)}</strong>
                  </td>
                  <td>
                    <StockEditor product={p} reload={reload} notify={notify} />
                    {isLow(p) && <small className="stock-note">{p.stock === 0 ? "Sold out" : `Only ${p.stock} left`}</small>}
                  </td>
                  <td>
                    <Status value={productStatus(p)} />
                  </td>
                  <td>
                    <div className="table-actions">
                      <button onClick={() => setEditing(p)}>Edit</button>
                      <button
                        className={`avail-toggle ${available ? "on" : ""}`}
                        role="switch"
                        aria-checked={available}
                        aria-label={`${p.name} available to customers`}
                        disabled={switching === p.id}
                        onClick={() => void toggleAvailable(p)}
                      >
                        <span />
                        {available ? "Available" : "Unavailable"}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
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
                  <option value="food">Meal</option>
                  <option value="grocery">Product (grocery)</option>
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
                {"review_count" in editing && editing.review_count ? (
                  <>
                    {/* Customers' average; the database keeps it, so the form doesn't send it. */}
                    <input value={`★ ${editing.rating}`} readOnly aria-describedby="rating-note" />
                    <small id="rating-note" className="muted">
                      Average of {editing.review_count} customer review{editing.review_count === 1 ? "" : "s"}
                    </small>
                  </>
                ) : (
                  <input name="rating" type="number" min="0" max="5" step="0.1" defaultValue={editing.rating} />
                )}
              </label>
              <label className="check-label product-active">
                <input name="active" type="checkbox" defaultChecked={editing.active !== false} /> Available to customers
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
    <DeliveryFeePanel notify={notify} />
    <GcashSettingsPanel notify={notify} />
    </>
  );
}

/** How delivery is priced: a base fee for the first km, then a rate per extra km, plus the riders' allowance. */
function DeliveryFeePanel({ notify }: { notify: Notify }) {
  const store = useStoreSettings();
  const saved = feeRule(store.settings);
  const [draft, setDraft] = useState<Partial<Record<keyof FeeRule, string>>>({});
  const [busy, setBusy] = useState(false);
  const ready = store.status === "ready" && hasFeeRule(store.settings);
  const hasStorePin = toLatLng(store.settings?.lat, store.settings?.lng) != null;

  const text = (key: keyof FeeRule) => draft[key] ?? String(saved[key]);
  const parsed = (key: keyof FeeRule) => {
    const raw = text(key).trim();
    return raw === "" ? NaN : Number(raw);
  };
  const next: FeeRule = {
    baseFee: parsed("baseFee"),
    baseKm: parsed("baseKm"),
    perKm: parsed("perKm"),
    riderMaxExtra: parsed("riderMaxExtra"),
  };
  const valid = Object.values(next).every((v) => Number.isFinite(v) && v >= 0 && v <= 10000) && next.baseKm <= 500;
  const dirty = Object.keys(draft).length > 0;
  const preview = valid ? next : saved;

  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!valid) {
      notify("Enter amounts from 0 to 10,000 (and at most 500 km)", "error");
      return;
    }
    const round2 = (n: number) => Math.round(n * 100) / 100;
    setBusy(true);
    try {
      await updateStoreSettings({
        delivery_base_fee: round2(next.baseFee),
        delivery_base_km: round2(next.baseKm),
        delivery_per_km: round2(next.perKm),
        rider_fee_max_extra: round2(next.riderMaxExtra),
      });
      await refreshStoreLocation();
      setDraft({});
      notify("Delivery fee saved. New orders use it right away.");
    } catch (err) {
      notify(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  };

  const field = (key: keyof FeeRule, label: string) => (
    <label>
      {label}
      <input
        type="number"
        inputMode="decimal"
        min={0}
        step="any"
        value={text(key)}
        onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
        required
      />
    </label>
  );

  return (
    <form className="panel store-location-panel" onSubmit={save}>
      <div className="store-location-head">
        <div>
          <h3>Delivery fee</h3>
          <p>
            Worked out from the road distance between the store pin and the customer's drop-off. Riders can
            raise it for heavy, bulky or many items, up to the allowance below, and must give a reason the
            customer sees.
          </p>
        </div>
        <button type="submit" className="button button-primary" disabled={busy || !dirty || !ready}>
          {busy ? "Saving…" : "Save fee"}
        </button>
      </div>
      {store.status === "loading" ? (
        <Spinner label="Loading delivery fee" />
      ) : !ready ? (
        <p className="muted small-note">
          Distance pricing isn't set up yet. Apply the <code>distance_delivery_fee</code> migration in
          Supabase, then reload this page. Until then every order pays a flat {money(saved.baseFee)}.
        </p>
      ) : (
        <>
          <div className="field-grid">
            {field("baseFee", "Base fee (₱)")}
            {field("baseKm", "Base fee covers the first (km)")}
            {field("perKm", "Each extra km (₱)")}
            {field("riderMaxExtra", "Riders can add up to (₱)")}
          </div>
          <div className="fee-examples">
            {[1, 3, 5, 8, 12].map((km) => (
              <span key={km}>
                {km} km <b>{money(feeForKm(km, preview))}</b>
              </span>
            ))}
          </div>
          <small className="muted">
            {hasStorePin
              ? `Customers pay ${describeFeeRule(preview)}.`
              : `Set the store location above first. Until then every order pays a flat ${money(preview.baseFee)}.`}
          </small>
        </>
      )}
    </form>
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
