import { useCallback, useEffect, useMemo, useState } from "react";
import { FALLBACK_IMAGE, Notify, Spinner, imgFallback } from "../shared";
import { errorMessage } from "../lib/supabase";
import { Profile, formatDateTime, initials } from "../lib/types";
import { Stars } from "../components/Reviews";
import {
  ProductReviewWithOrder,
  RiderReviewWithOrder,
  countLabel,
  deleteProductReview,
  deleteRiderReview,
  fetchAllProductReviews,
  fetchRiderReviews,
  formatRating,
} from "../lib/reviews";

type Tab = "items" | "riders";
type StarFilter = "all" | "low" | "mid" | "high";

const DAY = 24 * 60 * 60 * 1000;
const average = (list: { rating: number }[]) =>
  list.length ? list.reduce((sum, r) => sum + r.rating, 0) / list.length : null;
const starMatch = (rating: number, filter: StarFilter) =>
  filter === "all" || (filter === "low" ? rating <= 2 : filter === "mid" ? rating === 3 : rating >= 4);

/** What customers said about the items and riders, newest first, with delete for abusive reviews. */
export function AdminReviews({
  profileById,
  refreshKey,
  notify,
}: {
  profileById: Map<string, Profile>;
  /** Changes when a customer leaves or edits a review (from the live order timeline). */
  refreshKey: string;
  notify: Notify;
}) {
  const [items, setItems] = useState<ProductReviewWithOrder[] | null | undefined>(undefined);
  const [riders, setRiders] = useState<RiderReviewWithOrder[] | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>("items");
  const [stars, setStars] = useState<StarFilter>("all");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [i, r] = await Promise.all([fetchAllProductReviews(), fetchRiderReviews(undefined, 300)]);
      setItems(i);
      setRiders(r);
    } catch (e) {
      notify(errorMessage(e), "error");
      setItems((v) => v ?? []);
      setRiders((v) => v ?? []);
    }
  }, [notify]);
  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const weekAgo = Date.now() - 7 * DAY;
  const summary = useMemo(() => {
    const all = [...(items ?? []), ...(riders ?? [])];
    return {
      itemAvg: average(items ?? []),
      riderAvg: average(riders ?? []),
      week: all.filter((r) => new Date(r.created_at).getTime() >= weekAgo).length,
      low: all.filter((r) => r.rating <= 2 && new Date(r.created_at).getTime() >= weekAgo).length,
    };
  }, [items, riders, weekAgo]);

  if (items === undefined || riders === undefined) return <Spinner label="Loading reviews" />;
  if (items === null || riders === null) {
    return (
      <section className="panel empty-panel">
        <h3>Reviews aren't set up yet</h3>
        <p className="muted">
          Apply the <code>customer_reviews</code> migration in Supabase, then reload this page. Customers can then rate
          their rider and the items they got once an order is delivered.
        </p>
      </section>
    );
  }

  const remove = async (key: string, fn: () => Promise<void>, what: string) => {
    if (!window.confirm(`Delete this review ${what}? The average rating updates right away. This can't be undone.`)) return;
    setBusy(key);
    try {
      await fn();
      notify("Review deleted");
      await load();
    } catch (e) {
      notify(errorMessage(e), "error");
    } finally {
      setBusy(null);
    }
  };

  const itemRows = items.filter((r) => starMatch(r.rating, stars));
  const riderRows = riders.filter((r) => starMatch(r.rating, stars));

  return (
    <>
      <div className="admin-page-head">
        <div>
          <h2>Customer reviews</h2>
          <p>
            Stars and feedback customers leave after delivery. Item reviews show on the product pages; rider feedback is
            only seen by that rider and admins. Delete a review only if it's abusive or not about the order.
          </p>
        </div>
      </div>
      <div className="review-stats">
        <div>
          <small>Items</small>
          <strong>★ {formatRating(summary.itemAvg)}</strong>
          <span>{countLabel(items.length, "review")}</span>
        </div>
        <div>
          <small>Riders</small>
          <strong>★ {formatRating(summary.riderAvg)}</strong>
          <span>{countLabel(riders.length)}</span>
        </div>
        <div>
          <small>Last 7 days</small>
          <strong>{summary.week}</strong>
          <span>new reviews</span>
        </div>
        <div className={summary.low ? "attention" : ""}>
          <small>1–2 stars, last 7 days</small>
          <strong>{summary.low}</strong>
          <span>{summary.low ? "worth a look" : "none"}</span>
        </div>
      </div>
      <div className="admin-filters">
        <div className="order-tabs">
          <button className={tab === "items" ? "active" : ""} onClick={() => setTab("items")}>
            Food & groceries <span>{items.length}</span>
          </button>
          <button className={tab === "riders" ? "active" : ""} onClick={() => setTab("riders")}>
            Riders <span>{riders.length}</span>
          </button>
        </div>
        <select value={stars} onChange={(e) => setStars(e.target.value as StarFilter)} aria-label="Stars">
          <option value="all">All stars</option>
          <option value="low">1–2 stars</option>
          <option value="mid">3 stars</option>
          <option value="high">4–5 stars</option>
        </select>
      </div>
      <section className="panel admin-table-wrap">
        <table className="admin-table review-table">
          <thead>
            <tr>
              <th>{tab === "items" ? "Item" : "Rider"}</th>
              <th>Rating</th>
              <th>Feedback</th>
              <th>Customer</th>
              <th>Date</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {(tab === "items" ? itemRows : riderRows).length === 0 && (
              <tr>
                <td colSpan={6} className="empty-cell">
                  {stars === "all" ? "No reviews yet." : "No reviews with these stars."}
                </td>
              </tr>
            )}
            {tab === "items"
              ? itemRows.map((r) => (
                  <tr key={`i${r.id}`}>
                    <td>
                      <div className="table-product">
                        <img src={r.products?.image || FALLBACK_IMAGE} alt="" onError={imgFallback} />
                        <div>
                          <strong>{r.products?.name ?? "Removed product"}</strong>
                          <small>{r.products?.type === "grocery" ? "Product" : "Meal"}</small>
                        </div>
                      </div>
                    </td>
                    <td>
                      <Stars value={r.rating} />
                    </td>
                    <td className="review-comment">{r.comment ?? <span className="muted">No comment</span>}</td>
                    <td>
                      {r.orders?.customer_name ?? r.reviewer_name}
                      <small>
                        Shown as {r.reviewer_name}
                        {r.orders ? ` · #${r.orders.code}` : ""}
                      </small>
                    </td>
                    <td>{formatDateTime(r.created_at)}</td>
                    <td>
                      <div className="table-actions">
                        <button
                          className="danger"
                          disabled={busy === `i${r.id}`}
                          onClick={() => void remove(`i${r.id}`, () => deleteProductReview(r.id), `of ${r.products?.name ?? "this item"}`)}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              : riderRows.map((r) => {
                  const rider = r.rider_id ? profileById.get(r.rider_id) : null;
                  return (
                    <tr key={`r${r.order_id}`}>
                      <td>
                        <div className="customer-cell">
                          <span>{initials(rider?.full_name)}</span>
                          <div>
                            <strong>{rider?.full_name ?? "Former rider"}</strong>
                            <small>
                              {rider?.rider_rating ? `★ ${formatRating(rider.rider_rating)} overall` : "No average yet"}
                            </small>
                          </div>
                        </div>
                      </td>
                      <td>
                        <Stars value={r.rating} />
                      </td>
                      <td className="review-comment">{r.comment ?? <span className="muted">No comment</span>}</td>
                      <td>
                        {r.orders?.customer_name ?? "Customer"}
                        {r.orders && <small>#{r.orders.code}</small>}
                      </td>
                      <td>{formatDateTime(r.created_at)}</td>
                      <td>
                        <div className="table-actions">
                          <button
                            className="danger"
                            disabled={busy === `r${r.order_id}`}
                            onClick={() =>
                              void remove(`r${r.order_id}`, () => deleteRiderReview(r.order_id), `for ${rider?.full_name ?? "this rider"}`)
                            }
                          >
                            Delete
                          </button>
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
