import { Icon, Status, imgFallback, money } from "../shared";
import { Order, Profile, directionsUrl, formatDateTime, formatTime, statusLabel } from "../lib/types";
import { OrderMap, Viewer } from "./Maps";
import { feeWasAdjusted, formatKm } from "../lib/fees";

export { OrderMap };

export function OrderTimeline({ order }: { order: Order }) {
  const events = order.order_events ?? [];
  if (!events.length) return <p className="muted small-note">No updates yet.</p>;
  return (
    <ol className="event-list">
      {events.map((event) => (
        <li key={event.id}>
          <span className={`event-dot event-${event.status}`} />
          <div>
            <strong>{statusLabel[event.status]}</strong>
            <small>
              {event.note ?? ""}
              {event.actor_role ? ` · ${event.actor_role}` : ""}
            </small>
          </div>
          <time>{formatTime(event.created_at)}</time>
        </li>
      ))}
    </ol>
  );
}

export function OrderItemsList({ order }: { order: Order }) {
  return (
    <div className="order-lines">
      {(order.order_items ?? []).map((item) => (
        <div key={item.id} className="order-line">
          {item.image ? <img src={item.image} alt="" onError={imgFallback} /> : <span className="order-line-ph" />}
          <span>
            <strong>{item.name}</strong>
            <small>
              {item.quantity} × {money(Number(item.price))}
            </small>
          </span>
          <b>{money(Number(item.price) * item.quantity)}</b>
        </div>
      ))}
      <div className="order-totals">
        <div>
          <span>Subtotal</span>
          <span>{money(Number(order.subtotal))}</span>
        </div>
        <div>
          <span>
            Delivery fee{order.delivery_km != null ? ` · ${formatKm(Number(order.delivery_km))}` : ""}
          </span>
          <span>{money(Number(order.delivery_fee))}</span>
        </div>
        {feeWasAdjusted(order) && (
          <p className="fee-adjusted">
            Changed from {money(Number(order.quoted_delivery_fee))}
            {order.delivery_fee_note ? `: ${order.delivery_fee_note}` : ""}
          </p>
        )}
        {Number(order.discount) > 0 && (
          <div className="discount">
            <span>Discount</span>
            <span>−{money(Number(order.discount))}</span>
          </div>
        )}
        <div className="grand">
          <span>Total · {order.payment_method === "cod" ? "Cash on delivery" : "GCash"}</span>
          <strong>{money(Number(order.total))}</strong>
        </div>
      </div>
    </div>
  );
}

export function OrderDetailsModal({
  order,
  rider,
  onClose,
  actions,
  showMap = false,
  viewer = "admin",
  children,
}: {
  order: Order;
  rider?: Profile | null;
  onClose: () => void;
  actions?: React.ReactNode;
  showMap?: boolean;
  viewer?: Viewer;
  /** Extra controls under the items (e.g. the admin's delivery fee editor). */
  children?: React.ReactNode;
}) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section
        className="order-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="order-modal-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-title">
          <div>
            <p className="eyebrow">ORDER #{order.code}</p>
            <h2 id="order-modal-title">
              {order.customer_name} <Status value={statusLabel[order.status]} />
            </h2>
            <small className="muted">Placed {formatDateTime(order.created_at)}</small>
          </div>
          <button type="button" aria-label="Close" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <div className="order-modal-grid">
          <div>
            <h3>Delivery</h3>
            <p className="order-address">
              <Icon name="location" size={16} />
              <span>
                {order.address}, {order.city}
                {order.province ? `, ${order.province}` : ""}
                {order.notes && <small>Note: {order.notes}</small>}
              </span>
            </p>
            <p className="order-address">
              <Icon name="phone" size={16} />
              <span>
                <a href={`tel:${order.customer_phone}`}>{order.customer_phone}</a>
                {order.customer_email && <small>{order.customer_email}</small>}
              </span>
            </p>
            <p className="order-address">
              <Icon name="bike" size={16} />
              <span>
                {rider ? (
                  <>
                    {rider.full_name}
                    <small>
                      {[rider.phone, rider.vehicle, rider.plate_number].filter(Boolean).join(" · ")}
                    </small>
                  </>
                ) : order.rider_id ? (
                  "Rider assigned"
                ) : (
                  "No rider assigned yet"
                )}
              </span>
            </p>
            <a className="text-link" href={directionsUrl(order)} target="_blank" rel="noreferrer">
              Open directions in Google Maps ↗
            </a>
            {showMap && <OrderMap order={order} rider={rider} viewer={viewer} height={260} />}
            <h3>Items</h3>
            <OrderItemsList order={order} />
            {children}
          </div>
          <div>
            <h3>Timeline</h3>
            <OrderTimeline order={order} />
          </div>
        </div>
        {actions && <div className="modal-buttons">{actions}</div>}
      </section>
    </div>
  );
}
