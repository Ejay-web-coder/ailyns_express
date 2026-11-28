import { supabase } from "./supabase";
import type { Order } from "./types";

/** The customer's stars and note for the rider who delivered an order (one per order). */
export type RiderReview = {
  order_id: string;
  rider_id: string | null;
  rating: number;
  comment: string | null;
  created_at: string;
  updated_at: string;
};

/** The customer's stars and comment for one item they got. Everyone signed in can read these. */
export type ProductReview = {
  id: number;
  order_id: string;
  product_id: number;
  rating: number;
  comment: string | null;
  /** First name and last initial, e.g. "Maria S." */
  reviewer_name: string;
  created_at: string;
  updated_at: string;
};

export type OrderReview = { rider: RiderReview | null; items: ProductReview[] };

/** What the customer sends: null rider = no rider rating. Items left out aren't rated. */
export type ReviewDraft = {
  rider: { rating: number; comment: string } | null;
  items: { product_id: number; rating: number; comment: string }[];
};

/** Postgres/PostgREST codes for "this table or function doesn't exist yet". */
const MISSING = new Set(["42P01", "PGRST205", "PGRST202", "42883"]);
const isMissing = (error: unknown) => MISSING.has(String((error as { code?: string } | null)?.code ?? ""));

const ITEM_COLUMNS = "id, order_id, product_id, rating, comment, reviewer_name, created_at, updated_at";

/** Only delivered orders can be rated. */
export const canReview = (order: Pick<Order, "status" | "customer_id">) => order.status === "delivered";

export const RATING_WORDS = ["", "Poor", "Fair", "Good", "Very good", "Excellent"];

/** The customer's review of an order. null when the customer_reviews migration isn't applied yet. */
export async function fetchOrderReview(orderId: string): Promise<OrderReview | null> {
  const [rider, items] = await Promise.all([
    supabase.from("order_reviews").select("*").eq("order_id", orderId).maybeSingle(),
    supabase.from("product_reviews").select(ITEM_COLUMNS).eq("order_id", orderId),
  ]);
  if (rider.error && isMissing(rider.error)) return null;
  if (rider.error) throw rider.error;
  if (items.error) throw items.error;
  return { rider: (rider.data as RiderReview | null) ?? null, items: (items.data ?? []) as ProductReview[] };
}

/** Save the customer's review of a delivered order. Replaces their earlier review of it. */
export async function submitOrderReview(orderId: string, draft: ReviewDraft) {
  const { error } = await supabase.rpc("customer_review_order", {
    p_order: orderId,
    p_rider_rating: draft.rider?.rating ?? null,
    p_rider_comment: draft.rider?.comment.trim() || null,
    p_items: draft.items.map((i) => ({ product_id: i.product_id, rating: i.rating, comment: i.comment.trim() || null })),
  });
  if (!error) return;
  if (isMissing(error)) throw new Error("Reviews aren't switched on yet. Please try again later.");
  throw error;
}

/** Newest reviews of one product (null before the migration). */
export async function fetchProductReviews(productId: number, limit = 20): Promise<ProductReview[] | null> {
  const { data, error } = await supabase
    .from("product_reviews")
    .select(ITEM_COLUMNS)
    .eq("product_id", productId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error && isMissing(error)) return null;
  if (error) throw error;
  return (data ?? []) as ProductReview[];
}

export type RiderReviewWithOrder = RiderReview & { orders: { code: string; customer_name: string } | null };

/**
 * Rider reviews, newest first: the signed-in rider's own (row-level security), or every rider's
 * for an admin. Pass riderId to narrow it to one rider. null before the migration.
 */
export async function fetchRiderReviews(riderId?: string, limit = 50): Promise<RiderReviewWithOrder[] | null> {
  let query = supabase
    .from("order_reviews")
    .select("*, orders(code, customer_name)")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (riderId) query = query.eq("rider_id", riderId);
  const { data, error } = await query;
  if (error && isMissing(error)) return null;
  if (error) throw error;
  return (data ?? []) as RiderReviewWithOrder[];
}

export type ProductReviewWithOrder = ProductReview & {
  orders: { code: string; customer_name: string } | null;
  products: { name: string; image: string; type: string } | null;
};

/** Admin: newest item reviews with their order and product. null before the migration. */
export async function fetchAllProductReviews(limit = 300): Promise<ProductReviewWithOrder[] | null> {
  const { data, error } = await supabase
    .from("product_reviews")
    .select(`${ITEM_COLUMNS}, orders(code, customer_name), products(name, image, type)`)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error && isMissing(error)) return null;
  if (error) throw error;
  // Without generated types supabase-js guesses arrays for the embeds; many-to-one embeds are objects.
  return (data ?? []) as unknown as ProductReviewWithOrder[];
}

/** Admin: remove a review (e.g. abusive text). The averages update by themselves. */
export async function deleteProductReview(id: number) {
  const { data, error } = await supabase.from("product_reviews").delete().eq("id", id).select("id");
  if (error) throw error;
  if (!data?.length) throw new Error("That review couldn't be deleted. Refresh and try again.");
}

export async function deleteRiderReview(orderId: string) {
  const { data, error } = await supabase.from("order_reviews").delete().eq("order_id", orderId).select("order_id");
  if (error) throw error;
  if (!data?.length) throw new Error("That review couldn't be deleted. Refresh and try again.");
}

/** "4.8" for an average, as the app shows it. */
export const formatRating = (value: number | null | undefined) =>
  value == null || Number.isNaN(Number(value)) ? "—" : Number(value).toFixed(1);

export const countLabel = (n: number, one = "rating", many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
