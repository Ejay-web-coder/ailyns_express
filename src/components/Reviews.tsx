import { FormEvent, KeyboardEvent, useCallback, useEffect, useState } from "react";
import { FALLBACK_IMAGE, Icon, Product, imgFallback } from "../shared";
import { fetchProfile } from "../lib/api";
import { errorMessage } from "../lib/supabase";
import { Order, OrderItem, Profile, formatDateTime, initials } from "../lib/types";
import {
  OrderReview,
  ProductReview,
  RATING_WORDS,
  RiderReviewWithOrder,
  canReview,
  countLabel,
  fetchOrderReview,
  fetchProductReviews,
  fetchRiderReviews,
  formatRating,
  submitOrderReview,
} from "../lib/reviews";
import "../reviews.css";

// ------------------------------------------------------------------ stars

/** Read-only stars, e.g. ★★★★☆ for 4. Averages fill part of a star (4.5 = four and a half). */
export function Stars({ value, size = 14 }: { value: number; size?: number }) {
  const v = Math.max(0, Math.min(5, Number(value) || 0));
  return (
    <span
      className="stars"
      style={{ fontSize: size }}
      role="img"
      aria-label={`${Number.isInteger(v) ? v : v.toFixed(1)} out of 5 stars`}
    >
      <span className="stars-off" aria-hidden="true">
        ★★★★★
      </span>
      <span className="stars-on" aria-hidden="true" style={{ width: `${(v / 5) * 100}%` }}>
        ★★★★★
      </span>
    </span>
  );
}

/** Pick 1-5 stars. Arrow keys move, and tapping the chosen star again keeps it. */
export function StarInput({
  value,
  onChange,
  label,
  size = 30,
}: {
  value: number;
  onChange: (n: number) => void;
  label: string;
  size?: number;
}) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      onChange(Math.min(5, (value || 0) + 1));
    } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      onChange(Math.max(1, (value || 1) - 1));
    }
  };
  return (
    <div className="star-input">
      <div role="radiogroup" aria-label={label} onKeyDown={onKey} onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} star${n === 1 ? "" : "s"}, ${RATING_WORDS[n]}`}
            tabIndex={value ? (value === n ? 0 : -1) : n === 1 ? 0 : -1}
            className={n <= shown ? "on" : ""}
            style={{ fontSize: size }}
            onMouseEnter={() => setHover(n)}
            onClick={() => onChange(n)}
          >
            ★
          </button>
        ))}
      </div>
      <small>{shown ? RATING_WORDS[shown] : "Tap to rate"}</small>
    </div>
  );
}

/** "★ 4.8 · 12 ratings" for a rider, or nothing before their first rating. */
export function RiderRatingTag({ rider }: { rider: Pick<Profile, "rider_rating" | "rider_rating_count"> | null | undefined }) {
  if (!rider?.rider_rating || !rider.rider_rating_count) return null;
  return (
    <span className="rating-tag" title={`Average from ${countLabel(rider.rider_rating_count)}`}>
      ★ {formatRating(rider.rider_rating)} <small>({rider.rider_rating_count})</small>
    </span>
  );
}

// ------------------------------------------------------------------ customer: rate an order

const RIDER_TAGS = ["On time", "Friendly", "Careful with my order", "Followed my delivery notes"];

type ItemDraft = { rating: number; comment: string; open: boolean };

/** The customer rates the rider and each item of a delivered order. Opening it again edits the review. */
export function ReviewModal({
  order,
  rider,
  onClose,
  onSaved,
}: {
  order: Order;
  rider: Profile | null | undefined;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const products = uniqueItems(order);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [riderRating, setRiderRating] = useState(0);
  const [riderComment, setRiderComment] = useState("");
  const [items, setItems] = useState<Record<number, ItemDraft>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  // From My orders there's no rider loaded yet: look them up (customers can see their riders).
  const [loadedRider, setLoadedRider] = useState<Profile | null>(null);
  const riderProfile = rider ?? loadedRider;
  useEffect(() => {
    if (rider || !order.rider_id) return;
    let live = true;
    fetchProfile(order.rider_id).then(
      (p) => live && setLoadedRider(p),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [rider, order.rider_id]);

  useEffect(() => {
    let live = true;
    fetchOrderReview(order.id).then(
      (review) => {
        if (!live) return;
        if (!review) setMissing(true);
        else {
          setEditing(!!review.rider || review.items.length > 0);
          setRiderRating(review.rider?.rating ?? 0);
          setRiderComment(review.rider?.comment ?? "");
          setItems(
            Object.fromEntries(
              review.items.map((r) => [r.product_id, { rating: r.rating, comment: r.comment ?? "", open: !!r.comment }]),
            ),
          );
        }
        setLoading(false);
      },
      (e) => {
        if (!live) return;
        setError(errorMessage(e));
        setLoading(false);
      },
    );
    return () => {
      live = false;
    };
  }, [order.id]);

  const item = (id: number): ItemDraft => items[id] ?? { rating: 0, comment: "", open: false };
  const setItem = (id: number, patch: Partial<ItemDraft>) =>
    setItems((all) => ({ ...all, [id]: { ...item(id), ...all[id], ...patch } }));

  const addTag = (tag: string) => {
    if (riderComment.toLowerCase().includes(tag.toLowerCase())) return;
    const base = riderComment.trim().replace(/[.,;]$/, "");
    setRiderComment(base ? `${base}, ${tag.toLowerCase()}` : tag);
  };

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const rated = products.filter((p) => item(p.product_id).rating > 0);
    if (!riderRating && riderComment.trim()) {
      setError("Pick a star rating for your rider too.");
      return;
    }
    const unratedNote = products.find((p) => !item(p.product_id).rating && item(p.product_id).comment.trim());
    if (unratedNote) {
      setError(`Pick a star rating for ${unratedNote.name} too.`);
      return;
    }
    if (!riderRating && rated.length === 0) {
      setError(order.rider_id ? "Rate your rider or at least one item." : "Rate at least one item.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await submitOrderReview(order.id, {
        rider: riderRating ? { rating: riderRating, comment: riderComment } : null,
        items: rated.map((p) => ({ product_id: p.product_id, rating: item(p.product_id).rating, comment: item(p.product_id).comment })),
      });
      setDone(true);
      onSaved?.();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form
        className="review-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="review-title"
        onSubmit={submit}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-title">
          <div>
            <p className="eyebrow">ORDER #{order.code}</p>
            <h2 id="review-title">{done ? "Thanks for your review!" : editing ? "Edit your review" : "Rate your order"}</h2>
          </div>
          <button type="button" aria-label="Close" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>

        {done ? (
          <div className="review-done">
            <span className="review-done-icon">
              <Icon name="star" size={30} />
            </span>
            <p>
              Your feedback helps Ailyn's and our riders get better. Item ratings show on the product pages with your first
              name and last initial.
            </p>
            <button type="button" className="button button-primary" onClick={onClose}>
              Done
            </button>
          </div>
        ) : loading ? (
          <p className="review-muted">Loading…</p>
        ) : missing ? (
          <p className="review-muted">Reviews aren't switched on yet. Please check back later.</p>
        ) : (
          <>
            {order.rider_id && (
              <section className="review-block">
                <div className="review-subject">
                  <span className="review-avatar">
                    {riderProfile ? initials(riderProfile.full_name) : <Icon name="bike" size={18} />}
                  </span>
                  <div>
                    <small>YOUR RIDER</small>
                    <strong>{riderProfile?.full_name || "Your rider"}</strong>
                  </div>
                </div>
                <StarInput value={riderRating} onChange={setRiderRating} label="Rate your rider" />
                <div className="review-tags">
                  {RIDER_TAGS.map((tag) => (
                    <button type="button" key={tag} onClick={() => addTag(tag)}>
                      + {tag}
                    </button>
                  ))}
                </div>
                <label className="review-field">
                  Feedback for your rider (optional)
                  <textarea
                    value={riderComment}
                    maxLength={500}
                    rows={2}
                    onChange={(e) => setRiderComment(e.target.value)}
                    placeholder="What went well, or what could be better?"
                  />
                  <small>Only your rider and Ailyn's see this.</small>
                </label>
              </section>
            )}

            {products.length > 0 && (
              <section className="review-block">
                <h3>Rate what you got</h3>
                <div className="review-items">
                  {products.map((p) => {
                    const d = item(p.product_id);
                    return (
                      <div key={p.product_id} className="review-item">
                        <img src={p.image || FALLBACK_IMAGE} alt="" onError={imgFallback} />
                        <div>
                          <strong>{p.name}</strong>
                          <small>{p.quantity}× ordered</small>
                          <StarInput
                            value={d.rating}
                            onChange={(n) => setItem(p.product_id, { rating: n })}
                            label={`Rate ${p.name}`}
                            size={24}
                          />
                          {d.open ? (
                            <textarea
                              value={d.comment}
                              maxLength={500}
                              rows={2}
                              aria-label={`Comment about ${p.name}`}
                              onChange={(e) => setItem(p.product_id, { comment: e.target.value })}
                              placeholder="Taste, freshness, portion, packaging…"
                            />
                          ) : (
                            <button type="button" className="review-link" onClick={() => setItem(p.product_id, { open: true })}>
                              + Add a comment
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <small className="review-muted">
                  Item ratings and comments show on the product page with your first name and last initial.
                </small>
              </section>
            )}

            {error && <p className="form-error review-error">{error}</p>}
            <div className="modal-buttons">
              <button type="button" className="button button-outline" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button type="submit" className="button button-primary" disabled={busy}>
                {busy ? "Sending…" : editing ? "Update review" : "Send review"}
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}

/** Items of an order that can be rated (still in the catalog), once each. */
function uniqueItems(order: Order) {
  const seen = new Set<number>();
  const list: (OrderItem & { product_id: number })[] = [];
  for (const i of order.order_items ?? []) {
    if (i.product_id == null || seen.has(i.product_id)) continue;
    seen.add(i.product_id);
    list.push({ ...i, product_id: i.product_id });
  }
  return list;
}

/** On a delivered order: ask for a review, or show the customer's review with an Edit button. */
export function RateOrderCard({ order, rider }: { order: Order; rider: Profile | null | undefined }) {
  const [review, setReview] = useState<OrderReview | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const reviewable = canReview(order);

  const load = useCallback(() => {
    if (!reviewable) return;
    fetchOrderReview(order.id).then(setReview, () => setReview(null));
  }, [order.id, reviewable]);
  useEffect(load, [load]);

  if (!reviewable || review === null) return null;
  const reviewed = !!review && (!!review.rider || review.items.length > 0);

  return (
    <section className={`rate-card ${reviewed ? "done" : ""}`}>
      <span className="rate-card-icon">
        <Icon name="star" size={22} />
      </span>
      <div>
        {reviewed && review ? (
          <>
            <strong>Thanks for rating this order</strong>
            <span>
              {review.rider && (
                <>
                  Rider <Stars value={review.rider.rating} />
                </>
              )}
              {review.rider && review.items.length > 0 && " · "}
              {review.items.length > 0 && countLabel(review.items.length, "item")} rated
            </span>
          </>
        ) : (
          <>
            <strong>How was your order?</strong>
            <span>Rate your rider and the {order.order_items?.length === 1 ? "item" : "items"} you got. It takes a few seconds.</span>
          </>
        )}
      </div>
      <button
        type="button"
        className={`button ${reviewed ? "button-outline" : "button-primary"}`}
        onClick={() => setOpen(true)}
        disabled={review === undefined}
      >
        {reviewed ? "Edit review" : "Rate your order"}
      </button>
      {open && <ReviewModal order={order} rider={rider} onClose={() => setOpen(false)} onSaved={load} />}
    </section>
  );
}

// ------------------------------------------------------------------ product page

/** The product's average and its newest reviews. */
export function ProductReviews({ product }: { product: Product }) {
  const [reviews, setReviews] = useState<ProductReview[] | null | undefined>(undefined);
  const [limit, setLimit] = useState(6);
  const count = product.review_count ?? 0;

  useEffect(() => {
    let live = true;
    setReviews(undefined);
    fetchProductReviews(product.id, 30).then(
      (r) => live && setReviews(r),
      () => live && setReviews(null),
    );
    return () => {
      live = false;
    };
  }, [product.id, count]);

  if (reviews === null) return null;
  return (
    <section className="product-reviews">
      <div className="product-reviews-head">
        <div>
          <h2>Customer reviews</h2>
          <p>{count ? `From ${countLabel(count, "customer")} who ordered it` : "From customers who ordered it"}</p>
        </div>
        {count > 0 && (
          <div className="product-reviews-score">
            <strong>{formatRating(product.rating)}</strong>
            <Stars value={product.rating} size={16} />
          </div>
        )}
      </div>
      {reviews === undefined ? (
        <p className="review-muted">Loading reviews…</p>
      ) : reviews.length === 0 ? (
        <p className="review-muted">No reviews yet. Customers can rate it after their order is delivered.</p>
      ) : (
        <>
          <ul className="review-list">
            {reviews.slice(0, limit).map((r) => (
              <li key={r.id}>
                <span className="review-avatar small">{initials(r.reviewer_name)}</span>
                <div>
                  <div className="review-line">
                    <strong>{r.reviewer_name}</strong>
                    <Stars value={r.rating} />
                    <time>{formatDateTime(r.created_at)}</time>
                  </div>
                  {r.comment ? <p>{r.comment}</p> : <p className="review-muted">{RATING_WORDS[r.rating]}</p>}
                </div>
              </li>
            ))}
          </ul>
          {reviews.length > limit && (
            <button type="button" className="button button-outline" onClick={() => setLimit(limit + 10)}>
              Show more reviews
            </button>
          )}
        </>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ rider + admin

/** Ratings and notes customers left for riders: the signed-in rider's own, or one rider's for an admin. */
export function RiderFeedback({
  riderId,
  refreshKey,
  emptyText = "No ratings yet. Customers can rate you after each delivery.",
  limit = 20,
}: {
  riderId?: string;
  /** Change it to reload (e.g. the rider's rating count). */
  refreshKey?: unknown;
  emptyText?: string;
  limit?: number;
}) {
  const [rows, setRows] = useState<RiderReviewWithOrder[] | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    fetchRiderReviews(riderId, limit).then(
      (r) => live && setRows(r),
      () => live && setRows(null),
    );
    return () => {
      live = false;
    };
  }, [riderId, limit, refreshKey]);

  if (rows === null) return null;
  if (rows === undefined) return <p className="review-muted">Loading feedback…</p>;
  if (!rows.length) return <p className="review-muted">{emptyText}</p>;
  return (
    <ul className="review-list">
      {rows.map((r) => (
        <li key={r.order_id}>
          <span className="review-avatar small">{initials(r.orders?.customer_name)}</span>
          <div>
            <div className="review-line">
              <strong>{r.orders?.customer_name ?? "Customer"}</strong>
              <Stars value={r.rating} />
              <time>
                {r.orders ? `#${r.orders.code} · ` : ""}
                {formatDateTime(r.created_at)}
              </time>
            </div>
            {r.comment ? <p>{r.comment}</p> : <p className="review-muted">{RATING_WORDS[r.rating]}</p>}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Admin order details: what the customer said about this order. */
export function OrderReviewSummary({ order }: { order: Order }) {
  const [review, setReview] = useState<OrderReview | null | undefined>(undefined);
  const reviewable = canReview(order);
  useEffect(() => {
    if (!reviewable) return;
    let live = true;
    fetchOrderReview(order.id).then(
      (r) => live && setReview(r),
      () => live && setReview(null),
    );
    return () => {
      live = false;
    };
  }, [order.id, order.updated_at, order.order_events?.length, reviewable]);

  if (!reviewable || !review || (!review.rider && !review.items.length)) return null;
  const names = new Map((order.order_items ?? []).map((i) => [i.product_id, i.name]));
  return (
    <section className="order-review">
      <small>CUSTOMER REVIEW</small>
      {review.rider && (
        <div className="order-review-row">
          <span>Rider</span>
          <Stars value={review.rider.rating} />
          {review.rider.comment && <p>“{review.rider.comment}”</p>}
        </div>
      )}
      {review.items.map((r) => (
        <div className="order-review-row" key={r.id}>
          <span>{names.get(r.product_id) ?? "Item"}</span>
          <Stars value={r.rating} />
          {r.comment && <p>“{r.comment}”</p>}
        </div>
      ))}
    </section>
  );
}
