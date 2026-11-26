import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Icon, Logo, Notify, Spinner, Status, money } from "../shared";
import {
  fetchMyProfile,
  fetchOrders,
  riderAccept,
  riderRelease,
  riderUpdateLocation,
  riderUpdateStatus,
  signOut,
  updateMyProfile,
  useRealtime,
} from "../lib/api";
import { errorMessage } from "../lib/supabase";
import {
  Order,
  Profile,
  directionsUrl,
  formatDateTime,
  formatTime,
  initials,
  statusLabel,
} from "../lib/types";
import { OrderDetailsModal, OrderItemsList, OrderMap } from "../components/OrderDetails";

type Tab = "jobs" | "active" | "history" | "profile";
const LOCATION_INTERVAL_MS = 10_000;
// Realtime can't tell a rider that someone else took a job (that row is no longer visible to
// them), so the lists also refresh on a timer and whenever the app comes back to the foreground.
const REFRESH_INTERVAL_MS = 30_000;

const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString();

export function RiderApp({
  profile,
  setProfile,
  notify,
}: {
  profile: Profile;
  setProfile: (p: Profile) => void;
  notify: Notify;
}) {
  const [tab, setTab] = useState<Tab>("jobs");
  const [openJobs, setOpenJobs] = useState<Order[]>([]);
  const [mine, setMine] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [details, setDetails] = useState<Order | null>(null);
  // Location sharing lives here (not in the deliveries tab) so it keeps running on every tab.
  const [sharing, setSharing] = useState(false);
  const [lastFix, setLastFix] = useState<Date | null>(null);
  const [geoError, setGeoError] = useState("");
  const lastSent = useRef(0);

  const refreshProfile = useCallback(() => {
    fetchMyProfile(profile.id)
      .then((p) => p && setProfile(p))
      .catch(() => undefined);
  }, [profile.id, setProfile]);
  useRealtime("rider-profile", [{ table: "profiles", filter: `id=eq.${profile.id}` }], refreshProfile);

  const load = useCallback(async () => {
    if (!profile.rider_approved) {
      setLoading(false);
      return;
    }
    try {
      const [jobs, assigned] = await Promise.all([
        fetchOrders({ openJobs: true }),
        fetchOrders({ riderId: profile.id }),
      ]);
      setOpenJobs(jobs);
      setMine(assigned);
    } catch (e) {
      notify(errorMessage(e), "error");
    } finally {
      setLoading(false);
    }
  }, [profile.id, profile.rider_approved, notify]);
  useEffect(() => {
    void load();
  }, [load]);
  useRealtime("rider-orders", [{ table: "orders" }], () => void load());
  useEffect(() => {
    if (!profile.rider_approved) return;
    const timer = window.setInterval(() => void load(), REFRESH_INTERVAL_MS);
    const onVisible = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load, profile.rider_approved]);

  const active = mine.filter((o) => !["delivered", "cancelled"].includes(o.status));
  const history = mine.filter((o) => ["delivered", "cancelled"].includes(o.status));
  const deliveredToday = history.filter((o) => o.status === "delivered" && isToday(o.updated_at));
  const earnedToday = deliveredToday.reduce((sum, o) => sum + Number(o.delivery_fee), 0);
  const activeIds = active.map((o) => o.id).join(",");

  useEffect(() => {
    if (!sharing || !activeIds) return;
    if (!("geolocation" in navigator)) {
      setGeoError("This device can't share its location.");
      setSharing(false);
      return;
    }
    const ids = activeIds.split(",");
    const watch = navigator.geolocation.watchPosition(
      (pos) => {
        const now = Date.now();
        if (now - lastSent.current < LOCATION_INTERVAL_MS) return;
        lastSent.current = now;
        setGeoError("");
        setLastFix(new Date());
        for (const id of ids) {
          riderUpdateLocation(id, pos.coords.latitude, pos.coords.longitude).catch((e) =>
            setGeoError(errorMessage(e)),
          );
        }
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setGeoError("Location permission was denied. Allow it in your browser settings, then try again.");
          setSharing(false);
        } else {
          setGeoError("Couldn't get your location. Trying again…");
        }
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, [sharing, activeIds]);

  const toggleSharing = () => {
    lastSent.current = 0;
    if (!sharing) {
      setGeoError("");
      notify("Location sharing on");
    }
    setSharing(!sharing);
  };

  const run = async (orderId: string, action: () => Promise<void>, message: string) => {
    setBusyId(orderId);
    try {
      await action();
      notify(message);
      await load();
    } catch (e) {
      notify(errorMessage(e), "error");
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const toggleOnline = async () => {
    try {
      await updateMyProfile(profile.id, { rider_online: !profile.rider_online });
      setProfile({ ...profile, rider_online: !profile.rider_online });
      notify(profile.rider_online ? "You're offline" : "You're online and visible to dispatch");
    } catch (e) {
      notify(errorMessage(e), "error");
    }
  };

  const nav: [Tab, string, string, number?][] = [
    ["jobs", "Open jobs", "bag", openJobs.length],
    ["active", "My deliveries", "bike", active.length],
    ["history", "History", "clock"],
    ["profile", "Profile", "user"],
  ];

  return (
    <div className="rider-app">
      <header className="rider-header">
        <Logo />
        <span className="portal-chip">RIDER</span>
        {profile.rider_approved && (
          <nav>
            {nav.map(([id, label, , count]) => (
              <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
                {label}
                {!!count && <b>{count}</b>}
              </button>
            ))}
          </nav>
        )}
        <div className="rider-head-actions">
          {sharing && active.length > 0 && (
            <button className="gps-chip" onClick={() => setTab("active")} title="Sharing live location">
              <span className="live-dot on" /> GPS live
            </button>
          )}
          {profile.rider_approved && (
            <button
              className={`online-toggle ${profile.rider_online ? "on" : ""}`}
              onClick={toggleOnline}
              aria-pressed={profile.rider_online}
            >
              <span />
              {profile.rider_online ? "Online" : "Offline"}
            </button>
          )}
          <button className="avatar" onClick={() => setTab("profile")} aria-label="Profile">
            {initials(profile.full_name)}
          </button>
        </div>
      </header>

      <main className="rider-main content-width">
        {!profile.rider_approved ? (
          <PendingApproval profile={profile} setProfile={setProfile} notify={notify} />
        ) : loading ? (
          <Spinner label="Loading deliveries" />
        ) : (
          <>
            {tab !== "profile" && (
              <div className="rider-stats">
                <div>
                  <Icon name="bag" />
                  <p>
                    <strong>{openJobs.length}</strong>
                    <small>Open jobs</small>
                  </p>
                </div>
                <div>
                  <Icon name="bike" />
                  <p>
                    <strong>{active.length}</strong>
                    <small>Active deliveries</small>
                  </p>
                </div>
                <div>
                  <Icon name="check" />
                  <p>
                    <strong>{deliveredToday.length}</strong>
                    <small>Delivered today</small>
                  </p>
                </div>
                <div>
                  <Icon name="wallet" />
                  <p>
                    <strong>{money(earnedToday)}</strong>
                    <small>Delivery fees today</small>
                  </p>
                </div>
              </div>
            )}

            {tab === "jobs" && (
              <section>
                <div className="rider-section-head">
                  <div>
                    <p className="eyebrow">AVAILABLE NOW</p>
                    <h1>Open delivery jobs</h1>
                    <p className="muted">
                      Orders the store has confirmed and that still need a rider. Updates live.
                    </p>
                  </div>
                  <button className="button button-outline" onClick={() => void load()}>
                    <Icon name="refresh" size={17} /> Refresh
                  </button>
                </div>
                {!profile.rider_online && (
                  <div className="rider-hint">
                    <Icon name="bell" />
                    <span>You're offline. Go online to accept jobs.</span>
                    <button className="button button-primary" onClick={toggleOnline}>
                      Go online
                    </button>
                  </div>
                )}
                {openJobs.length === 0 ? (
                  <div className="empty-state">
                    <Icon name="bag" size={36} />
                    <h3>No open jobs right now</h3>
                    <p>New jobs appear here the moment the store confirms an order.</p>
                  </div>
                ) : (
                  <div className="job-grid">
                    {openJobs.map((order) => (
                      <article className="job-card" key={order.id}>
                        <div className="job-card-head">
                          <div>
                            <strong>#{order.code}</strong>
                            <small>{formatDateTime(order.created_at)}</small>
                          </div>
                          <Status value={statusLabel[order.status]} />
                        </div>
                        <div className="job-route">
                          <div>
                            <span className="route-dot pickup" />
                            <p>
                              <small>PICK UP</small>
                              <strong>Ailyn's Express store</strong>
                            </p>
                          </div>
                          <div>
                            <span className="route-dot drop" />
                            <p>
                              <small>DROP OFF</small>
                              <strong>
                                {order.address}, {order.city}
                              </strong>
                            </p>
                          </div>
                        </div>
                        <div className="job-meta">
                          <span>{(order.order_items ?? []).reduce((n, i) => n + i.quantity, 0)} items</span>
                          <span>
                            {order.payment_method === "cod"
                              ? `Collect ${money(Number(order.total))}`
                              : `GCash · ${money(Number(order.total))}`}
                          </span>
                          <span className="fee">Fee {money(Number(order.delivery_fee))}</span>
                        </div>
                        <div className="job-actions">
                          <button className="button button-outline" onClick={() => setDetails(order)}>
                            Details
                          </button>
                          <button
                            className="button button-primary"
                            disabled={!profile.rider_online || busyId === order.id}
                            onClick={() =>
                              run(
                                order.id,
                                async () => {
                                  await riderAccept(order.id);
                                  setTab("active");
                                },
                                `Job #${order.code} accepted`,
                              )
                            }
                          >
                            {busyId === order.id ? "Accepting…" : "Accept job"}
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            )}

            {tab === "active" && (
              <ActiveDeliveries
                orders={active}
                busyId={busyId}
                run={run}
                sharing={sharing}
                lastFix={lastFix}
                geoError={geoError}
                onToggleSharing={toggleSharing}
                onDetails={setDetails}
                goToJobs={() => setTab("jobs")}
              />
            )}

            {tab === "history" && <RiderHistory orders={history} onDetails={setDetails} />}

            {tab === "profile" && <RiderProfile profile={profile} setProfile={setProfile} notify={notify} />}
          </>
        )}
      </main>

      {profile.rider_approved && (
        <nav className="bottom-nav rider-bottom-nav">
          {nav.map(([id, label, icon, count]) => (
            <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
              <span className="nav-cart">
                <Icon name={icon} />
                {!!count && <b>{count}</b>}
              </span>
              <span>{label}</span>
            </button>
          ))}
        </nav>
      )}

      {details && <OrderDetailsModal order={details} onClose={() => setDetails(null)} />}
    </div>
  );
}

function ActiveDeliveries({
  orders,
  busyId,
  run,
  sharing,
  lastFix,
  geoError,
  onToggleSharing,
  onDetails,
  goToJobs,
}: {
  orders: Order[];
  busyId: string | null;
  run: (id: string, action: () => Promise<void>, message: string) => Promise<void>;
  sharing: boolean;
  lastFix: Date | null;
  geoError: string;
  onToggleSharing: () => void;
  onDetails: (o: Order) => void;
  goToJobs: () => void;
}) {
  if (!orders.length) {
    return (
      <div className="empty-state">
        <Icon name="bike" size={36} />
        <h3>No active deliveries</h3>
        <p>Accept an open job to start delivering.</p>
        <button className="button button-primary" onClick={goToJobs}>
          See open jobs
        </button>
      </div>
    );
  }

  return (
    <section>
      <div className="rider-section-head">
        <div>
          <p className="eyebrow">ON THE ROAD</p>
          <h1>My deliveries</h1>
          <p className="muted">Customers and admins see each step and your location as you go.</p>
        </div>
      </div>
      <div className={`share-bar ${sharing ? "on" : ""}`}>
        <span className={`live-dot ${sharing ? "on" : ""}`} />
        <div>
          <strong>{sharing ? "Sharing live location" : "Live location is off"}</strong>
          <small>
            {geoError ||
              (sharing
                ? lastFix
                  ? `Last update ${formatTime(lastFix.toISOString())} · sent every 10 seconds`
                  : "Waiting for GPS…"
                : "Turn this on so customers can follow you on the map.")}
          </small>
        </div>
        <button className={`button ${sharing ? "button-outline" : "button-primary"}`} onClick={onToggleSharing}>
          {sharing ? "Stop sharing" : "Share location"}
        </button>
      </div>
      <div className="delivery-list">
        {orders.map((order) => {
          const busy = busyId === order.id;
          const beforePickup = ["confirmed", "preparing", "ready"].includes(order.status);
          return (
            <article className="delivery-card" key={order.id}>
              <OrderMap order={order} height={220} />
              <div className="delivery-body">
                <div className="job-card-head">
                  <div>
                    <strong>#{order.code}</strong>
                    <small>{formatDateTime(order.created_at)}</small>
                  </div>
                  <Status value={statusLabel[order.status]} />
                </div>
                <div className="delivery-customer">
                  <span className="rider-avatar">{initials(order.customer_name)}</span>
                  <div>
                    <strong>{order.customer_name}</strong>
                    <small>
                      {order.address}, {order.city}
                      {order.province ? `, ${order.province}` : ""}
                    </small>
                    {order.notes && <small className="note">Note: {order.notes}</small>}
                  </div>
                </div>
                <div className="delivery-links">
                  <a className="button button-soft" href={`tel:${order.customer_phone}`}>
                    <Icon name="phone" size={17} /> Call
                  </a>
                  <a className="button button-soft" href={directionsUrl(order)} target="_blank" rel="noreferrer">
                    <Icon name="map" size={17} /> Directions
                  </a>
                  <button className="button button-outline" onClick={() => onDetails(order)}>
                    Details
                  </button>
                </div>
                <details className="delivery-items">
                  <summary>
                    {(order.order_items ?? []).reduce((n, i) => n + i.quantity, 0)} items ·{" "}
                    {order.payment_method === "cod"
                      ? `collect ${money(Number(order.total))} cash`
                      : `GCash ${money(Number(order.total))}`}
                  </summary>
                  <OrderItemsList order={order} />
                </details>
                {beforePickup && order.status !== "ready" && (
                  <p className="rider-hint small">
                    <Icon name="clock" size={16} /> The store is still{" "}
                    {order.status === "preparing" ? "preparing" : "confirming"} this order.
                  </p>
                )}
                <div className="job-actions">
                  {beforePickup && (
                    <>
                      <button
                        className="button button-outline"
                        disabled={busy}
                        onClick={() =>
                          window.confirm(`Release job #${order.code} for another rider?`) &&
                          run(order.id, () => riderRelease(order.id), "Job released")
                        }
                      >
                        Release
                      </button>
                      <button
                        className="button button-primary"
                        disabled={busy}
                        onClick={() =>
                          run(order.id, () => riderUpdateStatus(order.id, "out_for_delivery"), "Marked as picked up")
                        }
                      >
                        Picked up · start delivery
                      </button>
                    </>
                  )}
                  {order.status === "out_for_delivery" && (
                    <button
                      className="button button-primary button-full"
                      disabled={busy}
                      onClick={() =>
                        window.confirm(`Confirm order #${order.code} was handed to the customer?`) &&
                        run(order.id, () => riderUpdateStatus(order.id, "delivered"), "Delivered. Nice work!")
                      }
                    >
                      <Icon name="check" /> Mark as delivered
                    </button>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function RiderHistory({ orders, onDetails }: { orders: Order[]; onDetails: (o: Order) => void }) {
  const delivered = orders.filter((o) => o.status === "delivered");
  const earned = delivered.reduce((sum, o) => sum + Number(o.delivery_fee), 0);
  return (
    <section>
      <div className="rider-section-head">
        <div>
          <p className="eyebrow">YOUR WORK</p>
          <h1>Delivery history</h1>
          <p className="muted">
            {delivered.length} delivered · {money(earned)} in delivery fees
          </p>
        </div>
      </div>
      {orders.length === 0 ? (
        <div className="empty-state">
          <Icon name="clock" size={36} />
          <h3>No completed deliveries yet</h3>
        </div>
      ) : (
        <div className="history-list">
          {orders.map((order) => (
            <button key={order.id} className="history-row" onClick={() => onDetails(order)}>
              <div>
                <strong>#{order.code}</strong>
                <small>{formatDateTime(order.updated_at)}</small>
              </div>
              <span>
                {order.customer_name}
                <small>{order.city}</small>
              </span>
              <Status value={statusLabel[order.status]} />
              <b>{order.status === "delivered" ? `+${money(Number(order.delivery_fee))}` : "—"}</b>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function RiderProfile({
  profile,
  setProfile,
  notify,
  compact = false,
}: {
  profile: Profile;
  setProfile: (p: Profile) => void;
  notify: Notify;
  compact?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const changes = {
      full_name: String(data.get("name") ?? "").trim(),
      phone: String(data.get("phone") ?? "").trim() || null,
      vehicle: String(data.get("vehicle") ?? "").trim() || null,
      plate_number: String(data.get("plate") ?? "").trim() || null,
    };
    setBusy(true);
    try {
      await updateMyProfile(profile.id, changes);
      setProfile({ ...profile, ...changes });
      notify("Profile saved");
    } catch (err) {
      notify(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className={`panel rider-profile ${compact ? "compact" : ""}`} onSubmit={save}>
      {!compact && (
        <div className="rider-profile-head">
          <span className="profile-avatar">{initials(profile.full_name)}</span>
          <div>
            <p className="eyebrow">RIDER PROFILE</p>
            <h2>{profile.full_name || "Your profile"}</h2>
            <p className="muted">{profile.email}</p>
          </div>
          <Status value={profile.rider_approved ? "Approved" : "Pending review"} />
        </div>
      )}
      <div className="field-grid">
        <label>
          Full name
          <input name="name" defaultValue={profile.full_name} required />
        </label>
        <label>
          Mobile number
          <input name="phone" defaultValue={profile.phone ?? ""} required />
        </label>
        <label>
          Vehicle
          <select name="vehicle" defaultValue={profile.vehicle ?? "Motorcycle"}>
            <option>Motorcycle</option>
            <option>Bicycle</option>
            <option>E-bike</option>
            <option>Car</option>
          </select>
        </label>
        <label>
          Plate number
          <input name="plate" defaultValue={profile.plate_number ?? ""} />
        </label>
      </div>
      <div className="rider-profile-actions">
        <button type="button" className="button button-outline" onClick={() => void signOut()}>
          <Icon name="logout" /> Log out
        </button>
        <button className="button button-primary" disabled={busy}>
          {busy ? "Saving…" : "Save profile"}
        </button>
      </div>
    </form>
  );
}

function PendingApproval({
  profile,
  setProfile,
  notify,
}: {
  profile: Profile;
  setProfile: (p: Profile) => void;
  notify: Notify;
}) {
  return (
    <div className="pending-approval">
      <span className="success-icon pending">
        <Icon name="clock" size={38} />
      </span>
      <p className="eyebrow">APPLICATION RECEIVED</p>
      <h1>Your rider account is under review</h1>
      <p className="muted">
        An Ailyn's Express admin will approve your account shortly. This page unlocks
        automatically once you're approved. Make sure your details below are correct.
      </p>
      <RiderProfile profile={profile} setProfile={setProfile} notify={notify} compact />
    </div>
  );
}
