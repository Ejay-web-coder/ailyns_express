import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  CartItem,
  FALLBACK_IMAGE,
  Icon,
  Logo,
  Notify,
  Page,
  Product,
  SearchBar,
  Spinner,
  categories,
  imgFallback,
  money,
} from "../shared";
import {
  CheckoutDetails,
  cancelOrder,
  fetchActiveSuggestionTexts,
  fetchOrder,
  fetchOrders,
  fetchProducts,
  fetchProfile,
  logChat,
  askAilynAI,
  type AiChatTurn,
  placeOrder,
  setOrderDropOff,
  signOut,
  updateMyProfile,
  useRealtime,
} from "../lib/api";
import { errorMessage } from "../lib/supabase";
import {
  Order,
  Profile,
  activeStatuses,
  formatDateTime,
  formatTime,
  initials,
  itemsSummary,
  statusLabel,
  trackingStages,
} from "../lib/types";
import { OrderDetailsModal, OrderItemsList, OrderMap } from "../components/OrderDetails";
import { LocationPicker } from "../components/Maps";
import { LatLng, geocodeOrderAddress } from "../lib/geo";

const DELIVERY_FEE = 49;
const WELCOME_DISCOUNT = 30;

const priceRanges = [
  { id: "any", label: "Any price", min: 0, max: Infinity },
  { id: "under100", label: "Under ₱100", min: 0, max: 100 },
  { id: "100to200", label: "₱100 – ₱200", min: 100, max: 200 },
  { id: "over200", label: "₱200 and up", min: 200, max: Infinity },
] as const;

type SavedAddress = { address: string; city: string; province: string };

const readJson = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};
const writeJson = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
};

// ------------------------------------------------------------------ app

export function CustomerApp({
  profile,
  setProfile,
  notify,
}: {
  profile: Profile;
  setProfile: (p: Profile) => void;
  notify: Notify;
}) {
  const cartKey = `ae_cart_${profile.id}`;
  const addressKey = `ae_address_${profile.id}`;
  const [page, setPage] = useState<Page>("home");
  const [products, setProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [selected, setSelected] = useState<Product | null>(null);
  const [cart, setCart] = useState<CartItem[]>(() => readJson(cartKey, []));
  const [orders, setOrders] = useState<Order[]>([]);
  const [trackingId, setTrackingId] = useState<string | null>(null);
  const [lastOrder, setLastOrder] = useState<Order | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");
  const [dialog, setDialog] = useState<{ title: string; message: string } | null>(null);
  // The saved address lives on the profile (all devices); localStorage is only a fallback.
  const [address, setAddress] = useState<SavedAddress>(() =>
    profile.address
      ? { address: profile.address, city: profile.city ?? "", province: profile.province ?? "" }
      : readJson(addressKey, { address: "", city: "San Fernando", province: "Pampanga" }),
  );

  const loadProducts = useCallback(() => {
    fetchProducts()
      .then((list) => {
        setProducts(list);
        // Keep cart prices and stock in line with the live catalog.
        setCart((current) =>
          current
            .map((item) => {
              const fresh = list.find((p) => p.id === item.id && p.active !== false);
              return fresh ? { ...fresh, quantity: Math.min(item.quantity, fresh.stock) } : null;
            })
            .filter((item): item is CartItem => !!item && item.quantity > 0),
        );
      })
      .catch((e) => notify(errorMessage(e), "error"))
      .finally(() => setProductsLoading(false));
  }, [notify]);
  useEffect(loadProducts, [loadProducts]);
  // Price, stock and visibility changes made by the store show up without a reload.
  useRealtime("customer-catalog", [{ table: "products" }], loadProducts);

  const loadOrders = useCallback(() => {
    fetchOrders({ customerId: profile.id })
      .then(setOrders)
      .catch((e) => notify(errorMessage(e), "error"));
  }, [profile.id, notify]);
  useEffect(loadOrders, [loadOrders]);
  useRealtime(
    "customer-orders",
    [{ table: "orders", filter: `customer_id=eq.${profile.id}` }],
    loadOrders,
  );

  useEffect(() => writeJson(cartKey, cart), [cart, cartKey]);
  useEffect(() => writeJson(addressKey, address), [address, addressKey]);

  /** Save the delivery address locally right away and to the profile in the background. */
  const persistAddress = useCallback(
    async (next: SavedAddress) => {
      setAddress(next);
      const changes = {
        address: next.address.trim() || null,
        city: next.city.trim() || null,
        province: next.province.trim() || null,
      };
      await updateMyProfile(profile.id, changes);
      setProfile({ ...profile, ...changes });
    },
    [profile, setProfile],
  );

  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const firstOrder = !orders.some((o) => o.status !== "cancelled");
  const discount = firstOrder ? WELCOME_DISCOUNT : 0;

  const navigate = (next: Page) => {
    setPage(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const openDialog = (title: string, message: string) => setDialog({ title, message });

  const addToCart = (product: Product, goToCart = false, amount = 1) => {
    const inCart = cart.find((item) => item.id === product.id)?.quantity ?? 0;
    if (inCart + amount > product.stock) {
      notify(product.stock ? `Only ${product.stock} left of ${product.name}` : `${product.name} is sold out`, "error");
      return;
    }
    setCart((current) =>
      inCart
        ? current.map((item) =>
            item.id === product.id ? { ...item, quantity: item.quantity + amount } : item,
          )
        : [...current, { ...product, quantity: amount }],
    );
    if (goToCart) navigate("checkout");
    else notify(`${product.name} added to cart`);
  };

  const updateQuantity = (id: number, amount: number) => {
    setCart((current) =>
      current.map((item) =>
        item.id === id
          ? { ...item, quantity: Math.min(item.stock, Math.max(1, item.quantity + amount)) }
          : item,
      ),
    );
  };

  const openProduct = (product: Product) => {
    setSelected(product);
    navigate("details");
  };

  const track = (orderId: string) => {
    setTrackingId(orderId);
    navigate("tracking");
  };

  const activeOrders = orders.filter((o) => activeStatuses.includes(o.status));
  // Product details follow the live catalog (stock, price) instead of a stale snapshot.
  const liveSelected = selected ? (products.find((p) => p.id === selected.id) ?? selected) : null;

  /** Search from the home page: open whichever catalog actually has matches. */
  const searchFromHome = () => {
    const q = search.trim().toLowerCase();
    const hits = (type: Product["type"]) =>
      products.filter(
        (p) => p.type === type && (p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q)),
      ).length;
    setActiveCategory("All");
    navigate(q && hits("food") === 0 && hits("grocery") > 0 ? "grocery" : "food");
  };

  return (
    <>
      <CustomerShell
        page={page}
        navigate={navigate}
        cartCount={cartCount}
        profile={profile}
        city={address.city}
        onChat={() => setChatOpen(true)}
        onNotifications={() =>
          activeOrders.length
            ? track(activeOrders[0].id)
            : openDialog("Notifications", "You're all caught up. Order updates will appear here.")
        }
        activeCount={activeOrders.length}
      >
        {productsLoading && ["home", "food", "grocery"].includes(page) ? (
          <Spinner label="Loading the menu" />
        ) : (
          <>
            {page === "home" && (
              <Home
                products={products}
                navigate={navigate}
                openProduct={openProduct}
                addToCart={addToCart}
                search={search}
                setSearch={setSearch}
                onSearch={searchFromHome}
                activeOrder={activeOrders[0]}
                onTrack={track}
              />
            )}
            {(page === "food" || page === "grocery") && (
              <Catalog
                products={products}
                type={page}
                search={search}
                setSearch={setSearch}
                activeCategory={activeCategory}
                setActiveCategory={setActiveCategory}
                openProduct={openProduct}
                addToCart={addToCart}
              />
            )}
          </>
        )}
        {page === "details" && liveSelected && (
          <ProductDetails
            key={liveSelected.id}
            product={liveSelected}
            addToCart={addToCart}
            navigate={navigate}
            city={address.city}
          />
        )}
        {page === "cart" && (
          <Cart
            cart={cart}
            subtotal={subtotal}
            discount={discount}
            updateQuantity={updateQuantity}
            remove={(id) => setCart((items) => items.filter((item) => item.id !== id))}
            navigate={navigate}
          />
        )}
        {page === "checkout" && (
          <Checkout
            cart={cart}
            subtotal={subtotal}
            discount={discount}
            profile={profile}
            address={address}
            navigate={navigate}
            onPlaced={(order, details) => {
              persistAddress({ address: details.address, city: details.city, province: details.province }).catch(
                () => undefined, // the order went through; a failed address sync isn't worth an error
              );
              setCart([]);
              setLastOrder(order);
              setTrackingId(order.id);
              loadOrders();
              navigate("confirmation");
            }}
          />
        )}
        {page === "confirmation" && lastOrder && (
          <Confirmation order={lastOrder} profile={profile} navigate={navigate} onTrack={track} />
        )}
        {page === "tracking" && (
          <Tracking
            orderId={trackingId ?? activeOrders[0]?.id ?? null}
            navigate={navigate}
            notify={notify}
          />
        )}
        {page === "orders" && <MemberOrders orders={orders} navigate={navigate} onTrack={track} />}
        {page === "account" && (
          <Account
            profile={profile}
            setProfile={setProfile}
            orders={orders}
            address={address}
            saveAddress={persistAddress}
            navigate={navigate}
            notify={notify}
          />
        )}
      </CustomerShell>
      {chatOpen && (
        <Chatbot
          products={products}
          hasActiveOrder={activeOrders.length > 0}
          onTrack={() => {
            setChatOpen(false);
            if (activeOrders[0]) track(activeOrders[0].id);
            else navigate("orders");
          }}
          onClose={() => setChatOpen(false)}
          openProduct={(product) => {
            setChatOpen(false);
            openProduct(product);
          }}
        />
      )}
      {dialog && (
        <InfoModal title={dialog.title} message={dialog.message} onClose={() => setDialog(null)} />
      )}
    </>
  );
}

// ------------------------------------------------------------------ shell

export function CustomerShell({
  page,
  navigate,
  cartCount,
  profile,
  city,
  onChat,
  onNotifications,
  activeCount,
  children,
}: {
  page: Page;
  navigate: (page: Page) => void;
  cartCount: number;
  profile: Profile;
  city: string;
  onChat: () => void;
  onNotifications: () => void;
  activeCount: number;
  children: React.ReactNode;
}) {
  const nav = [
    { id: "home", label: "Home", icon: "home" },
    { id: "food", label: "Food", icon: "food" },
    { id: "grocery", label: "Grocery", icon: "bag" },
    { id: "orders", label: "Orders", icon: "orders" },
  ];
  return (
    <div className="customer-app">
      <header className="customer-header">
        <button onClick={() => navigate("home")}>
          <Logo />
        </button>
        <div className="header-location">
          <Icon name="location" />
          <div>
            <small>DELIVER TO</small>
            <strong>{city || "Set your address"}</strong>
          </div>
        </div>
        <nav>
          {nav.map((item) => (
            <button
              key={item.id}
              className={page === item.id ? "active" : ""}
              onClick={() => navigate(item.id as Page)}
            >
              {item.id === "orders" ? "My orders" : item.label}
            </button>
          ))}
        </nav>
        <div className="header-actions">
          <button aria-label="Order updates" onClick={onNotifications}>
            <Icon name="bell" />
            {activeCount > 0 && <span>{activeCount}</span>}
          </button>
          <button className="header-cart" aria-label="Shopping cart" onClick={() => navigate("cart")}>
            <Icon name="cart" />
            {cartCount > 0 && <span>{cartCount}</span>}
          </button>
          <button className="avatar" onClick={() => navigate("account")} aria-label="My account">
            {initials(profile.full_name)}
          </button>
        </div>
      </header>
      <main className="customer-main">{children}</main>
      <button className="chat-fab" onClick={onChat}>
        <Icon name="chat" />
        <span>Ask Ailyn AI</span>
      </button>
      <nav className="bottom-nav">
        {nav.map((item) => (
          <button
            key={item.id}
            className={page === item.id ? "active" : ""}
            onClick={() => navigate(item.id as Page)}
          >
            <Icon name={item.icon} />
            <span>{item.label}</span>
          </button>
        ))}
        <button className={page === "cart" ? "active" : ""} onClick={() => navigate("cart")}>
          <span className="nav-cart">
            <Icon name="cart" />
            {cartCount > 0 && <b>{cartCount}</b>}
          </span>
          <span>Cart</span>
        </button>
      </nav>
    </div>
  );
}

// ------------------------------------------------------------------ home & catalog

export function Home({
  products,
  navigate,
  openProduct,
  addToCart,
  search,
  setSearch,
  onSearch,
  activeOrder,
  onTrack,
}: {
  products: Product[];
  navigate: (p: Page) => void;
  openProduct: (p: Product) => void;
  addToCart: (p: Product) => void;
  search: string;
  setSearch: (value: string) => void;
  onSearch: () => void;
  activeOrder?: Order;
  onTrack: (id: string) => void;
}) {
  const food = products.filter((p) => p.type === "food").slice(0, 4);
  const grocery = products.filter((p) => p.type === "grocery").slice(0, 4);
  return (
    <>
      {activeOrder && (
        <button className="active-order-banner content-width" onClick={() => onTrack(activeOrder.id)}>
          <span className="live-dot on" />
          <div>
            <strong>
              Order #{activeOrder.code} · {statusLabel[activeOrder.status]}
            </strong>
            <small>Tap to follow your delivery live</small>
          </div>
          <Icon name="arrow" />
        </button>
      )}
      <section className="home-hero content-width">
        <div className="hero-copy">
          <span className="promo-tag">₱30 OFF YOUR FIRST ORDER</span>
          <h1>
            Your cravings,
            <br />
            <em>delivered express.</em>
          </h1>
          <p>
            Great meals and fresh groceries from trusted local stores, all in one thoughtful
            delivery.
          </p>
          <div className="hero-buttons">
            <button className="button button-primary" onClick={() => navigate("food")}>
              Order food
            </button>
            <button className="button button-soft" onClick={() => navigate("grocery")}>
              Shop groceries
            </button>
          </div>
        </div>
        <img src="/assets/ailyns-hero.png" alt="Fresh groceries and a warm meal" />
      </section>
      <div className="mobile-search content-width">
        <SearchBar
          placeholder="Search meals, groceries, stores..."
          value={search}
          onChange={setSearch}
          onSearch={onSearch}
        />
      </div>
      <section className="content-width section-block">
        <div className="section-heading">
          <div>
            <p className="eyebrow">BROWSE YOUR WAY</p>
            <h2>What are you looking for?</h2>
          </div>
        </div>
        <div className="service-grid">
          <button className="service-card service-food" onClick={() => navigate("food")}>
            <div>
              <span>READY TO EAT</span>
              <h3>Food delivery</h3>
              <p>Local favorites, made fresh</p>
            </div>
            <Icon name="arrow" />
          </button>
          <button className="service-card service-grocery" onClick={() => navigate("grocery")}>
            <div>
              <span>MARKETPLACE</span>
              <h3>Groceries & more</h3>
              <p>Fresh picks and daily essentials</p>
            </div>
            <Icon name="arrow" />
          </button>
        </div>
      </section>
      {food.length > 0 && (
        <ProductSection
          title="Popular near you"
          eyebrow="CUSTOMER FAVORITES"
          products={food}
          openProduct={openProduct}
          addToCart={addToCart}
          navigate={navigate}
        />
      )}
      <section className="content-width perk-strip">
        <div>
          <span className="perk-icon">
            <Icon name="food" />
          </span>
          <p>
            <strong>Freshly prepared</strong>
            <small>Quality you can taste</small>
          </p>
        </div>
        <div>
          <span className="perk-icon">
            <Icon name="location" />
          </span>
          <p>
            <strong>Live rider tracking</strong>
            <small>Follow your order to the door</small>
          </p>
        </div>
        <div>
          <span className="perk-icon">
            <Icon name="bag" />
          </span>
          <p>
            <strong>One easy basket</strong>
            <small>Food and grocery together</small>
          </p>
        </div>
      </section>
      {grocery.length > 0 && (
        <ProductSection
          title="Pantry favorites"
          eyebrow="GROCERY BEST SELLERS"
          products={grocery}
          openProduct={openProduct}
          addToCart={addToCart}
          navigate={navigate}
        />
      )}
    </>
  );
}

export function ProductSection({
  title,
  eyebrow,
  products: items,
  openProduct,
  addToCart,
  navigate,
}: {
  title: string;
  eyebrow: string;
  products: Product[];
  openProduct: (p: Product) => void;
  addToCart: (p: Product) => void;
  navigate: (p: Page) => void;
}) {
  return (
    <section className="content-width section-block">
      <div className="section-heading">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
        </div>
        <button onClick={() => navigate(items[0]?.type ?? "food")}>
          View all <Icon name="arrow" size={17} />
        </button>
      </div>
      <div className="product-grid">
        {items.map((product) => (
          <ProductCard
            key={product.id}
            product={product}
            openProduct={openProduct}
            addToCart={addToCart}
          />
        ))}
      </div>
    </section>
  );
}

export function ProductCard({
  product,
  openProduct,
  addToCart,
}: {
  product: Product;
  openProduct: (p: Product) => void;
  addToCart: (p: Product) => void;
}) {
  const soldOut = product.stock <= 0;
  return (
    <article className={`product-card ${soldOut ? "sold-out" : ""}`}>
      <button className="product-image" onClick={() => openProduct(product)}>
        <img src={product.image || FALLBACK_IMAGE} alt={product.name} onError={imgFallback} loading="lazy" />
        <span className="rating">★ {product.rating}</span>
        {soldOut && <span className="sold-out-tag">Sold out</span>}
      </button>
      <div className="product-info">
        <small>{product.category}</small>
        <button className="product-name" onClick={() => openProduct(product)}>
          {product.name}
        </button>
        <div className="price-row">
          <strong>{money(product.price)}</strong>
          <button
            aria-label={`Add ${product.name} to cart`}
            onClick={() => addToCart(product)}
            disabled={soldOut}
          >
            <Icon name="plus" size={18} />
          </button>
        </div>
      </div>
    </article>
  );
}

export function Catalog({
  products,
  type,
  search,
  setSearch,
  activeCategory,
  setActiveCategory,
  openProduct,
  addToCart,
}: {
  products: Product[];
  type: "food" | "grocery";
  search: string;
  setSearch: (v: string) => void;
  activeCategory: string;
  setActiveCategory: (v: string) => void;
  openProduct: (p: Product) => void;
  addToCart: (p: Product) => void;
}) {
  const [sortBy, setSortBy] = useState("Popular");
  const [showFilters, setShowFilters] = useState(false);
  const [inStockOnly, setInStockOnly] = useState(false);
  const [price, setPrice] = useState<(typeof priceRanges)[number]["id"]>("any");
  const relevantCategories =
    type === "food" ? ["All", "Meals", "Snacks", "Beverages"] : ["All", ...categories.slice(3)];
  const category = relevantCategories.includes(activeCategory) ? activeCategory : "All";
  const q = search.trim().toLowerCase();
  const range = priceRanges.find((r) => r.id === price) ?? priceRanges[0];
  const filtered = products.filter(
    (p) =>
      p.type === type &&
      (category === "All" || p.category === category) &&
      (!q || p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q)) &&
      (!inStockOnly || p.stock > 0) &&
      p.price >= range.min &&
      p.price < range.max,
  );
  const activeFilters = (inStockOnly ? 1 : 0) + (price !== "any" ? 1 : 0);
  const sorted =
    sortBy === "Price: Low to high"
      ? [...filtered].sort((a, b) => a.price - b.price)
      : sortBy === "Price: High to low"
        ? [...filtered].sort((a, b) => b.price - a.price)
        : sortBy === "Top rated"
          ? [...filtered].sort((a, b) => b.rating - a.rating)
          : // Popular: the store's own order, with sold-out items moved to the end.
            [...filtered].sort((a, b) => Number(a.stock <= 0) - Number(b.stock <= 0));
  return (
    <div className="catalog-page content-width">
      <div className="catalog-heading">
        <div>
          <p className="eyebrow">
            {type === "food" ? "MADE FRESH, DELIVERED FAST" : "YOUR EVERYDAY MARKETPLACE"}
          </p>
          <h1>{type === "food" ? "Food delivery" : "Groceries & essentials"}</h1>
          <p>
            {type === "food"
              ? "Comfort food, local favorites and fresh meals for every craving."
              : "Fresh produce and pantry staples, selected with care."}
          </p>
        </div>
        <SearchBar
          placeholder={`Search ${type === "food" ? "dishes" : "products and categories"}...`}
          value={search}
          onChange={setSearch}
        />
      </div>
      <div className="catalog-toolbar">
        <div className="category-chips">
          {relevantCategories.map((c) => (
            <button key={c} className={category === c ? "active" : ""} onClick={() => setActiveCategory(c)}>
              {c}
            </button>
          ))}
        </div>
        <div className="toolbar-actions">
          <button
            className={showFilters || activeFilters ? "active" : ""}
            aria-expanded={showFilters}
            onClick={() => setShowFilters(!showFilters)}
          >
            <Icon name="filter" size={17} /> Filters
            {activeFilters > 0 && <b className="filter-count">{activeFilters}</b>}
          </button>
          <select aria-label="Sort products" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            <option>Popular</option>
            <option>Price: Low to high</option>
            <option>Price: High to low</option>
            <option>Top rated</option>
          </select>
        </div>
      </div>
      {showFilters && (
        <div className="filter-panel">
          <div>
            <strong>Price</strong>
            <div className="filter-chips">
              {priceRanges.map((r) => (
                <button key={r.id} className={price === r.id ? "active" : ""} onClick={() => setPrice(r.id)}>
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          <label className="check-label">
            <input type="checkbox" checked={inStockOnly} onChange={(e) => setInStockOnly(e.target.checked)} />
            In stock only
          </label>
          {activeFilters > 0 && (
            <button
              className="link"
              onClick={() => {
                setPrice("any");
                setInStockOnly(false);
              }}
            >
              Clear filters
            </button>
          )}
        </div>
      )}
      <div className="catalog-layout">
        <aside>
          <h3>Categories</h3>
          {relevantCategories.map((c) => (
            <button key={c} className={category === c ? "active" : ""} onClick={() => setActiveCategory(c)}>
              {c}
              <span>›</span>
            </button>
          ))}
          <div className="sidebar-promo">
            <strong>₱30 off</strong>
            <p>Your first order gets an automatic welcome discount</p>
            <small>APPLIED AT CHECKOUT</small>
          </div>
        </aside>
        <section className="catalog-results">
          <div className="result-title">
            <p>
              <strong>{filtered.length} items</strong> available
            </p>
            <span>Delivering in 30–45 min</span>
          </div>
          <div className="product-grid">
            {sorted.map((product) => (
              <ProductCard key={product.id} product={product} openProduct={openProduct} addToCart={addToCart} />
            ))}
          </div>
          {filtered.length === 0 && (
            <div className="empty-state">
              <Icon name="search" size={32} />
              <h3>No products found</h3>
              <p>Try another search, category or filter.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export function ProductDetails({
  product,
  addToCart,
  navigate,
  city,
}: {
  product: Product;
  addToCart: (p: Product, buy?: boolean, amount?: number) => void;
  navigate: (p: Page) => void;
  city: string;
}) {
  const [quantity, setQuantity] = useState(1);
  const soldOut = product.stock <= 0;
  return (
    <div className="details-page content-width">
      <button className="back-link" onClick={() => navigate(product.type)}>
        <Icon name="back" /> Back to {product.type}
      </button>
      <div className="details-grid">
        <div className="details-image">
          <img src={product.image || FALLBACK_IMAGE} alt={product.name} onError={imgFallback} />
          <span>FRESH PICK</span>
        </div>
        <div className="details-copy">
          <p className="eyebrow">{product.category}</p>
          <h1>{product.name}</h1>
          <div className="details-rating">
            <strong>★ {product.rating}</strong>
            <span>Customer rating</span>
          </div>
          <p className="details-price">{money(product.price)}</p>
          <p className="details-description">{product.description}</p>
          {product.ingredients && (
            <div className="info-box">
              <strong>{product.type === "food" ? "Ingredients" : "Product information"}</strong>
              <p>{product.ingredients}</p>
            </div>
          )}
          <div className="stock-row">
            <span className={product.stock < 10 ? "low" : ""}>
              {soldOut ? "Sold out" : product.stock < 10 ? "Low stock" : "In stock"}
            </span>
            <small>{product.stock} available</small>
          </div>
          <div className="quantity-label">
            Quantity
            <div className="quantity-control">
              <button aria-label="Decrease quantity" onClick={() => setQuantity(Math.max(1, quantity - 1))}>
                <Icon name="minus" size={17} />
              </button>
              <span aria-live="polite">{quantity}</span>
              <button
                aria-label="Increase quantity"
                onClick={() => setQuantity(Math.min(Math.max(1, product.stock), quantity + 1))}
              >
                <Icon name="plus" size={17} />
              </button>
            </div>
          </div>
          <div className="details-buttons">
            <button
              className="button button-primary"
              disabled={soldOut}
              onClick={() => addToCart(product, false, quantity)}
            >
              <Icon name="cart" /> Add to cart
            </button>
            <button
              className="button button-outline-primary"
              disabled={soldOut}
              onClick={() => addToCart(product, true, quantity)}
            >
              Buy now
            </button>
          </div>
          <div className="delivery-note">
            <Icon name="location" />
            <div>
              <strong>Delivery to {city || "your address"}</strong>
              <small>Estimated arrival in 30–45 minutes</small>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ cart & checkout

export function Cart({
  cart,
  subtotal,
  discount,
  updateQuantity,
  remove,
  navigate,
}: {
  cart: CartItem[];
  subtotal: number;
  discount: number;
  updateQuantity: (id: number, n: number) => void;
  remove: (id: number) => void;
  navigate: (p: Page) => void;
}) {
  return (
    <div className="checkout-page content-width">
      <div className="page-title">
        <p className="eyebrow">YOUR ORDER</p>
        <h1>Shopping cart</h1>
        <p>
          {cart.length} {cart.length === 1 ? "item" : "items"} ready for delivery
        </p>
      </div>
      {cart.length ? (
        <div className="cart-layout">
          <section className="cart-list">
            {cart.map((item) => (
              <article className="cart-item" key={item.id}>
                <img src={item.image || FALLBACK_IMAGE} alt={item.name} onError={imgFallback} />
                <div className="cart-item-copy">
                  <small>{item.category}</small>
                  <h3>{item.name}</h3>
                  <p>{money(item.price)} each</p>
                  <button className="remove-mobile" onClick={() => remove(item.id)}>
                    Remove
                  </button>
                </div>
                <div className="quantity-control">
                  <button onClick={() => updateQuantity(item.id, -1)}>
                    <Icon name="minus" size={16} />
                  </button>
                  <span>{item.quantity}</span>
                  <button onClick={() => updateQuantity(item.id, 1)}>
                    <Icon name="plus" size={16} />
                  </button>
                </div>
                <strong>{money(item.price * item.quantity)}</strong>
                <button className="trash-button" onClick={() => remove(item.id)} aria-label={`Remove ${item.name}`}>
                  <Icon name="trash" />
                </button>
              </article>
            ))}
          </section>
          <OrderSummary subtotal={subtotal} fee={DELIVERY_FEE} discount={discount}>
            <button className="button button-primary button-full" onClick={() => navigate("checkout")}>
              Proceed to checkout <Icon name="arrow" />
            </button>
          </OrderSummary>
        </div>
      ) : (
        <div className="empty-state">
          <Icon name="cart" size={40} />
          <h2>Your cart is empty</h2>
          <p>Discover something delicious or pick up your essentials.</p>
          <button className="button button-primary" onClick={() => navigate("home")}>
            Start shopping
          </button>
        </div>
      )}
    </div>
  );
}

export function OrderSummary({
  subtotal,
  fee,
  discount,
  children,
}: {
  subtotal: number;
  fee: number;
  discount: number;
  children?: React.ReactNode;
}) {
  return (
    <aside className="order-summary">
      <h2>Order summary</h2>
      <div>
        <span>Subtotal</span>
        <strong>{money(subtotal)}</strong>
      </div>
      <div>
        <span>Delivery fee</span>
        <strong>{money(fee)}</strong>
      </div>
      {discount > 0 && (
        <div className="discount">
          <span>First order discount</span>
          <strong>−{money(discount)}</strong>
        </div>
      )}
      <div className="summary-total">
        <span>Total</span>
        <strong>{money(Math.max(0, subtotal + fee - discount))}</strong>
      </div>
      {children}
      <p className="secure-note">Prices and stock are confirmed when you place the order</p>
    </aside>
  );
}

export function Checkout({
  cart,
  subtotal,
  discount,
  profile,
  address,
  navigate,
  onPlaced,
}: {
  cart: CartItem[];
  subtotal: number;
  discount: number;
  profile: Profile;
  address: SavedAddress;
  navigate: (p: Page) => void;
  onPlaced: (order: Order, details: CheckoutDetails) => void;
}) {
  const [payment, setPayment] = useState<"cod" | "gcash">("cod");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [picking, setPicking] = useState(false);
  const [pin, setPin] = useState<LatLng | null>(null);
  const [pinHint, setPinHint] = useState<LatLng | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const openPicker = () => {
    setPicking(true);
    // Centre the map on the typed address while GPS (or the customer's tap) sets the pin.
    const form = formRef.current;
    const field = (name: string) => String((form?.elements.namedItem(name) as HTMLInputElement | null)?.value ?? "");
    if (field("address").trim() && field("city").trim()) {
      void geocodeOrderAddress({ address: field("address"), city: field("city"), province: field("province") }).then(
        (point) => point && setPinHint(point),
      );
    }
  };

  if (!cart.length) {
    return (
      <div className="checkout-page content-width">
        <div className="empty-state">
          <Icon name="cart" size={40} />
          <h2>Nothing to check out</h2>
          <p>Add something to your cart first.</p>
          <button className="button button-primary" onClick={() => navigate("home")}>
            Start shopping
          </button>
        </div>
      </div>
    );
  }

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const details: CheckoutDetails = {
      name: String(data.get("name") ?? ""),
      phone: String(data.get("phone") ?? ""),
      email: String(data.get("email") ?? ""),
      address: String(data.get("address") ?? ""),
      city: String(data.get("city") ?? ""),
      province: String(data.get("province") ?? ""),
      notes: String(data.get("notes") ?? ""),
      payment,
    };
    setBusy(true);
    setError("");
    try {
      let order = await placeOrder(
        cart.map((item) => ({ product_id: item.id, quantity: item.quantity })),
        details,
      );
      if (pin) {
        // The order is placed either way; without the pin the map falls back to the typed address.
        const pinned = await setOrderDropOff(order.id, pin.lat, pin.lng).then(
          () => true,
          () => false,
        );
        if (pinned) order = { ...order, dest_lat: pin.lat, dest_lng: pin.lng };
      }
      onPlaced(order, details);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="checkout-page content-width" onSubmit={submit} ref={formRef}>
      <button type="button" className="back-link" onClick={() => navigate("cart")}>
        <Icon name="back" /> Back to cart
      </button>
      <div className="page-title">
        <p className="eyebrow">ALMOST THERE</p>
        <h1>Checkout</h1>
        <p>Review your details and place your order.</p>
      </div>
      <div className="checkout-layout">
        <section className="checkout-forms">
          <div className="form-card">
            <div className="form-card-title">
              <span>1</span>
              <div>
                <h2>Customer information</h2>
                <p>Your rider uses this to reach you.</p>
              </div>
            </div>
            <div className="field-grid">
              <label>
                Full name
                <input name="name" defaultValue={profile.full_name} required autoComplete="name" />
              </label>
              <label>
                Contact number
                <input name="phone" defaultValue={profile.phone ?? ""} required autoComplete="tel" placeholder="+63 917 123 4567" />
              </label>
              <label className="full-field">
                Email address
                <input name="email" type="email" defaultValue={profile.email ?? ""} autoComplete="email" />
              </label>
            </div>
          </div>
          <div className="form-card">
            <div className="form-card-title">
              <span>2</span>
              <div>
                <h2>Delivery address</h2>
                <p>Confirm where you'd like us to deliver.</p>
              </div>
            </div>
            <div className="field-grid">
              <label className="full-field">
                Street and house number
                <input
                  name="address"
                  defaultValue={address.address}
                  required
                  autoComplete="street-address"
                  placeholder="23 Mabini Street, Barangay Dolores"
                />
              </label>
              <label>
                City
                <input name="city" defaultValue={address.city} required autoComplete="address-level2" />
              </label>
              <label>
                Province
                <input name="province" defaultValue={address.province} autoComplete="address-level1" />
              </label>
              <label className="full-field">
                Delivery notes
                <textarea name="notes" placeholder="Landmark, gate color, or other helpful notes" />
              </label>
              <div className="full-field pin-field">
                <div className="pin-field-head">
                  <div>
                    <strong>Drop-off pin</strong>
                    <small>Optional. Your rider gets the exact spot, and the live map draws the route to it.</small>
                  </div>
                  {picking ? (
                    <button
                      type="button"
                      className="button button-outline"
                      onClick={() => {
                        setPicking(false);
                        setPin(null);
                      }}
                    >
                      Remove pin
                    </button>
                  ) : (
                    <button type="button" className="button button-soft" onClick={openPicker}>
                      <Icon name="location" size={16} /> Pin my location
                    </button>
                  )}
                </div>
                {picking && <LocationPicker value={pin} onChange={setPin} hint={pinHint} locateOnMount />}
              </div>
            </div>
          </div>
          <div className="form-card">
            <div className="form-card-title">
              <span>3</span>
              <div>
                <h2>Payment method</h2>
                <p>Choose how you'd like to pay.</p>
              </div>
            </div>
            <div className="payment-options">
              <button type="button" className={payment === "cod" ? "active" : ""} onClick={() => setPayment("cod")}>
                <span className="radio" />
                <div>
                  <strong>Cash on delivery</strong>
                  <small>Pay the rider when your order arrives</small>
                </div>
              </button>
              <button type="button" className={payment === "gcash" ? "active" : ""} onClick={() => setPayment("gcash")}>
                <span className="radio" />
                <div>
                  <strong>GCash</strong>
                  <small>Pay the rider via GCash on arrival</small>
                </div>
              </button>
            </div>
          </div>
        </section>
        <OrderSummary subtotal={subtotal} fee={DELIVERY_FEE} discount={discount}>
          <div className="summary-items">
            {cart.slice(0, 3).map((item) => (
              <div key={item.id}>
                <img src={item.image || FALLBACK_IMAGE} alt="" onError={imgFallback} />
                <span>
                  {item.quantity}× {item.name}
                </span>
              </div>
            ))}
            {cart.length > 3 && <small>+{cart.length - 3} more</small>}
          </div>
          {error && <p className="form-error">{error}</p>}
          <button className="button button-primary button-full" type="submit" disabled={busy}>
            {busy ? "Placing order…" : "Place order"}
          </button>
        </OrderSummary>
      </div>
    </form>
  );
}

export function Confirmation({
  order,
  profile,
  navigate,
  onTrack,
}: {
  order: Order;
  profile: Profile;
  navigate: (p: Page) => void;
  onTrack: (id: string) => void;
}) {
  const placed = new Date(order.created_at).getTime();
  const from = formatTime(new Date(placed + 30 * 60000).toISOString());
  const to = formatTime(new Date(placed + 45 * 60000).toISOString());
  return (
    <div className="confirmation">
      <span className="success-icon">
        <Icon name="check" size={42} />
      </span>
      <p className="eyebrow">ORDER PLACED</p>
      <h1>Thanks, {profile.full_name.split(" ")[0] || "friend"}!</h1>
      <p>
        Your order <strong>#{order.code}</strong> was sent to the store. Total{" "}
        <strong>{money(Number(order.total))}</strong>.
      </p>
      <div className="eta-card">
        <small>ESTIMATED DELIVERY</small>
        <strong>
          Today, {from}–{to}
        </strong>
        <span>You'll see every update live as the store and your rider work on it.</span>
      </div>
      <div className="confirmation-buttons">
        <button className="button button-primary" onClick={() => onTrack(order.id)}>
          Track your order
        </button>
        <button className="button button-outline" onClick={() => navigate("home")}>
          Back to home
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ tracking

export function Tracking({
  orderId,
  navigate,
  notify,
}: {
  orderId: string | null;
  navigate: (p: Page) => void;
  notify: Notify;
}) {
  const [order, setOrder] = useState<Order | null>(null);
  const [rider, setRider] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [showDetails, setShowDetails] = useState(false);

  const load = useCallback(async () => {
    if (!orderId) {
      setLoading(false);
      return;
    }
    try {
      const next = await fetchOrder(orderId);
      setOrder(next);
      setRider(next?.rider_id ? await fetchProfile(next.rider_id) : null);
    } catch (e) {
      notify(errorMessage(e), "error");
    } finally {
      setLoading(false);
    }
  }, [orderId, notify]);
  useEffect(() => {
    void load();
  }, [load]);
  useRealtime(
    `track-${orderId ?? "none"}`,
    orderId
      ? [
          { table: "orders", filter: `id=eq.${orderId}` },
          { table: "order_events", filter: `order_id=eq.${orderId}` },
        ]
      : [],
    () => void load(),
  );

  if (loading) return <Spinner label="Loading your order" />;
  if (!order) {
    return (
      <div className="tracking-page content-width">
        <div className="empty-state">
          <Icon name="location" size={40} />
          <h2>No active delivery</h2>
          <p>When you place an order you can follow it here, live.</p>
          <button className="button button-primary" onClick={() => navigate("orders")}>
            View my orders
          </button>
        </div>
      </div>
    );
  }

  const cancelled = order.status === "cancelled";
  const stageIndex = trackingStages.indexOf(order.status);
  const stageTime = (status: string) =>
    order.order_events?.find((e) => e.status === status)?.created_at;
  const eta = formatTime(new Date(new Date(order.created_at).getTime() + 45 * 60000).toISOString());

  return (
    <div className="tracking-page content-width">
      <div className="tracking-top">
        <div>
          <p className="eyebrow">LIVE ORDER TRACKING</p>
          <h1>Track your delivery</h1>
          <p>
            Order #{order.code} · placed {formatDateTime(order.created_at)}
          </p>
        </div>
        <div className="eta-big">
          <small>{cancelled ? "ORDER STATUS" : "ESTIMATED ARRIVAL"}</small>
          <strong>
            {cancelled ? "Cancelled" : order.status === "delivered" ? "Delivered" : `By ${eta}`}
          </strong>
        </div>
      </div>
      <div className="tracking-layout">
        <section className="tracking-card">
          <OrderMap order={order} rider={rider} height={360} />
          <div className="rider-strip">
            <span className="rider-avatar">{rider ? initials(rider.full_name) : <Icon name="bike" size={18} />}</span>
            <div>
              <strong>{rider ? rider.full_name : "Waiting for a rider"}</strong>
              <small>
                {rider
                  ? [rider.vehicle, rider.plate_number].filter(Boolean).join(" · ") || "Ailyn's Express rider"
                  : "The store will assign a rider once your order is confirmed."}
              </small>
            </div>
            {rider?.phone && (
              <a className="button button-soft" href={`tel:${rider.phone}`}>
                <Icon name="phone" size={17} /> Call rider
              </a>
            )}
          </div>
        </section>
        <aside className="timeline-card">
          <h2>Order status</h2>
          {cancelled ? (
            <div className="cancelled-note">
              <strong>This order was cancelled.</strong>
              <small>{order.order_events?.at(-1)?.note}</small>
            </div>
          ) : (
            trackingStages.map((stage, i) => {
              const done = i < stageIndex || (i === stageIndex && stage === "delivered");
              const current = i === stageIndex && stage !== "delivered";
              const at = stageTime(stage);
              return (
                <div className={`timeline-step ${i <= stageIndex ? "done" : ""} ${current ? "current" : ""}`} key={stage}>
                  <span>{done ? <Icon name="check" size={15} /> : i + 1}</span>
                  <div>
                    <strong>{statusLabel[stage]}</strong>
                    <small>{at ? formatTime(at) : current ? "In progress" : "Pending"}</small>
                  </div>
                </div>
              );
            })
          )}
        </aside>
      </div>
      <section className="ordered-items">
        <div>
          <h2>Order details</h2>
          <p>
            {itemsSummary(order.order_items)} · {money(Number(order.total))} ·{" "}
            {order.payment_method === "cod" ? "Cash on delivery" : "GCash"}
          </p>
        </div>
        <div className="ordered-actions">
          {order.status === "pending" && (
            <button
              className="button button-outline"
              onClick={async () => {
                if (!window.confirm(`Cancel order #${order.code}?`)) return;
                try {
                  await cancelOrder(order.id);
                  notify("Order cancelled");
                  void load();
                } catch (e) {
                  notify(errorMessage(e), "error");
                }
              }}
            >
              Cancel order
            </button>
          )}
          <button className="button button-outline" onClick={() => setShowDetails(true)}>
            View order details
          </button>
        </div>
      </section>
      {showDetails && <OrderDetailsModal order={order} rider={rider} onClose={() => setShowDetails(false)} />}
    </div>
  );
}

export function MemberOrders({
  orders,
  navigate,
  onTrack,
}: {
  orders: Order[];
  navigate: (p: Page) => void;
  onTrack: (id: string) => void;
}) {
  const [details, setDetails] = useState<Order | null>(null);
  return (
    <div className="member-orders content-width">
      <div className="page-title">
        <p className="eyebrow">YOUR ACCOUNT</p>
        <h1>My orders</h1>
        <p>Check delivery progress or revisit a previous order.</p>
      </div>
      {orders.length === 0 ? (
        <div className="empty-state">
          <Icon name="orders" size={40} />
          <h2>No orders yet</h2>
          <p>Your orders will show up here once you check out.</p>
          <button className="button button-primary" onClick={() => navigate("home")}>
            Start shopping
          </button>
        </div>
      ) : (
        <div className="member-order-list">
          {orders.map((order) => {
            const active = activeStatuses.includes(order.status);
            return (
              <article className="member-order-card" key={order.id}>
                <div className="member-order-heading">
                  <div>
                    <strong>#{order.code}</strong>
                    <small>{formatDateTime(order.created_at)}</small>
                  </div>
                  <span className={`order-status ${active ? "in-progress" : ""} ${order.status === "cancelled" ? "cancelled" : ""}`}>
                    {statusLabel[order.status]}
                  </span>
                </div>
                <p>{(order.order_items ?? []).map((i) => `${i.quantity}× ${i.name}`).join(", ")}</p>
                <div className="member-order-footer">
                  <strong>{money(Number(order.total))}</strong>
                  <div>
                    {active && (
                      <button className="button button-primary" onClick={() => onTrack(order.id)}>
                        Track order
                      </button>
                    )}
                    <button className="button button-outline" onClick={() => setDetails(order)}>
                      Order details
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
      <button className="back-link" onClick={() => navigate("account")}>
        <Icon name="back" /> Back to my account
      </button>
      {details && <OrderDetailsModal order={details} onClose={() => setDetails(null)} />}
    </div>
  );
}

// ------------------------------------------------------------------ account

export function Account({
  profile,
  setProfile,
  orders,
  address,
  saveAddress: persistAddress,
  navigate,
  notify,
}: {
  profile: Profile;
  setProfile: (p: Profile) => void;
  orders: Order[];
  address: SavedAddress;
  saveAddress: (a: SavedAddress) => Promise<void>;
  navigate: (p: Page) => void;
  notify: Notify;
}) {
  const [editing, setEditing] = useState<"profile" | "address" | null>(null);
  const [busy, setBusy] = useState(false);
  const active = orders.filter((o) => activeStatuses.includes(o.status)).length;
  const saveProfile = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const changes = {
      full_name: String(data.get("name") ?? "").trim(),
      phone: String(data.get("phone") ?? "").trim() || null,
    };
    setBusy(true);
    try {
      await updateMyProfile(profile.id, changes);
      setProfile({ ...profile, ...changes });
      setEditing(null);
      notify("Profile saved");
    } catch (err) {
      notify(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  };
  const saveAddress = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await persistAddress({
        address: String(data.get("address") ?? "").trim(),
        city: String(data.get("city") ?? "").trim(),
        province: String(data.get("province") ?? "").trim(),
      });
      setEditing(null);
      notify("Address saved");
    } catch (err) {
      notify(`Saved on this device only: ${errorMessage(err)}`, "error");
      setEditing(null);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="account-page content-width">
      <div className="profile-card">
        <span className="profile-avatar">{initials(profile.full_name)}</span>
        <div>
          <p className="eyebrow">AILYN'S MEMBER</p>
          <h1>{profile.full_name || "Your profile"}</h1>
          <p>{[profile.email, profile.phone].filter(Boolean).join(" · ")}</p>
        </div>
        <button className="button button-outline" onClick={() => setEditing("profile")}>
          Edit profile
        </button>
      </div>
      <div className="account-grid">
        <button onClick={() => setEditing("address")}>
          <span>
            <Icon name="location" />
          </span>
          <div>
            <strong>Saved address</strong>
            <small>
              {address.address ? `${address.address}, ${address.city}` : "Add your delivery address"}
            </small>
          </div>
          <Icon name="arrow" />
        </button>
        <button onClick={() => navigate("orders")}>
          <span>
            <Icon name="orders" />
          </span>
          <div>
            <strong>Order history</strong>
            <small>
              {active} active · {orders.length - active} previous
            </small>
          </div>
          <Icon name="arrow" />
        </button>
        <button onClick={() => navigate("cart")}>
          <span>
            <Icon name="cart" />
          </span>
          <div>
            <strong>My cart</strong>
            <small>Review saved items</small>
          </div>
          <Icon name="arrow" />
        </button>
        <button onClick={() => navigate("tracking")}>
          <span>
            <Icon name="map" />
          </span>
          <div>
            <strong>Live tracking</strong>
            <small>{active ? "Follow your active delivery" : "No delivery in progress"}</small>
          </div>
          <Icon name="arrow" />
        </button>
      </div>
      <button className="logout-customer" onClick={() => void signOut()}>
        <Icon name="logout" /> Log out
      </button>
      {editing && (
        <div className="modal-backdrop" onMouseDown={() => setEditing(null)}>
          <form
            className="info-modal"
            onMouseDown={(e) => e.stopPropagation()}
            onSubmit={editing === "profile" ? saveProfile : saveAddress}
          >
            <div className="modal-title">
              <div>
                <p className="eyebrow">YOUR ACCOUNT</p>
                <h2>{editing === "profile" ? "Edit profile" : "Delivery address"}</h2>
              </div>
              <button type="button" aria-label="Close" onClick={() => setEditing(null)}>
                <Icon name="close" />
              </button>
            </div>
            <div className="field-grid single">
              {editing === "profile" ? (
                <>
                  <label>
                    Full name
                    <input name="name" defaultValue={profile.full_name} required />
                  </label>
                  <label>
                    Mobile number
                    <input name="phone" defaultValue={profile.phone ?? ""} />
                  </label>
                </>
              ) : (
                <>
                  <label>
                    Street and house number
                    <input name="address" defaultValue={address.address} required />
                  </label>
                  <label>
                    City
                    <input name="city" defaultValue={address.city} required />
                  </label>
                  <label>
                    Province
                    <input name="province" defaultValue={address.province} />
                  </label>
                </>
              )}
            </div>
            <div className="modal-buttons">
              <button type="button" className="button button-outline" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button className="button button-primary" disabled={busy}>
                {busy ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ misc

export function InfoModal({
  title,
  message,
  onClose,
}: {
  title: string;
  message: string;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section
        className="info-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="info-modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-title">
          <div>
            <p className="eyebrow">AILYN'S EXPRESS</p>
            <h2 id="info-modal-title">{title}</h2>
          </div>
          <button type="button" aria-label="Close dialog" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <p>{message}</p>
        <div className="modal-buttons">
          <button className="button button-primary" onClick={onClose}>
            Got it
          </button>
        </div>
      </section>
    </div>
  );
}

type ChatMessage = {
  from: "bot" | "user";
  text: string;
  /** Up to three product cards under the answer. */
  products?: Product[];
  action?: "track";
  /** The bot understood the question (false = generic fallback). Used for admin stats. */
  matched?: boolean;
};

const STOPWORDS = new Set(
  "the and you have what whats with for any can are your there some does how much want need get give show please this that about would which today sell buy order recommend suggest good something like best popular".split(
    " ",
  ),
);

export function Chatbot({
  products,
  hasActiveOrder,
  onTrack,
  onClose,
  openProduct,
}: {
  products: Product[];
  hasActiveOrder: boolean;
  onTrack: () => void;
  onClose: () => void;
  openProduct: (p: Product) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      from: "bot",
      text: "Hi, I'm Ailyn AI. I can help you find meals, groceries and product information, or check on your order. What can I find for you?",
    },
  ]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    void fetchActiveSuggestionTexts().then((list) => live && setSuggestions(list));
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, thinking]);

  const answer = (question: string): ChatMessage => {
    const q = question.toLowerCase();
    const has = (...keys: string[]) => keys.some((k) => q.includes(k));
    const words = q.split(/[^a-z]+/).filter((w) => w.length > 2 && !STOPWORDS.has(w));
    const bot = (text: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
      from: "bot",
      text,
      matched: true,
      ...extra,
    });

    if (!products.length) return bot("Our menu is still loading. Please try again in a moment.", { matched: false });

    if (has("where is my", "where's my", "wheres my", "track", "my order", "my rider", "order status")) {
      return hasActiveOrder
        ? bot("Your order is being handled right now. Tap below to follow it live, including your rider on the map.", {
            action: "track",
          })
        : bot("You don't have an active order at the moment. Your past orders are under “My orders”.", {
            action: "track",
          });
    }
    if (has("fee", "shipping", "delivery cost", "delivery charge", "how much is delivery")) {
      return bot(
        `Delivery is a flat ${money(DELIVERY_FEE)}, and your first order gets ${money(WELCOME_DISCOUNT)} off automatically.`,
      );
    }
    if (has("discount", "promo", "voucher", "coupon")) {
      return bot(`Your first order gets ${money(WELCOME_DISCOUNT)} off, applied automatically at checkout.`);
    }
    if (has("gcash", "payment", "pay ", "cash", "cod")) {
      return bot("You can pay cash on delivery, or pay the rider with GCash when your order arrives.");
    }
    if (has("how long", "eta", "arrive", "minutes", "how fast")) {
      return bot("Most deliveries arrive in 30–45 minutes. You can follow every step live once you order.");
    }
    if (has("cancel")) {
      return bot("You can cancel an order while it's still pending: open it in “My orders” and choose “Cancel order”.");
    }

    // Rank products by how well they match the question (name counts more than category).
    const ranked = products
      .map((p) => {
        const name = p.name.toLowerCase();
        const category = p.category.toLowerCase();
        const score = words.reduce((s, w) => s + (name.includes(w) ? 2 : 0) + (category.includes(w) ? 1 : 0), 0);
        return { p, score };
      })
      .filter((x) => x.score > 0)
      .sort(
        (a, b) =>
          b.score - a.score || Number(b.p.stock > 0) - Number(a.p.stock > 0) || b.p.rating - a.p.rating,
      )
      .map((x) => x.p);
    const match = ranked[0];

    if (match && has("ingredient", "what's in", "whats in", "what is in", "contain", "made of", "allerg")) {
      return bot(
        match.ingredients ? `${match.name} contains: ${match.ingredients}` : `${match.name}: ${match.description}`,
        { products: [match] },
      );
    }

    if (has("recommend", "suggest", "best", "popular", "what should", "hungry", "craving")) {
      const pool = (ranked.length ? ranked : products).filter((p) => p.stock > 0);
      const wantsFood = has("meal", "food", "eat", "lunch", "dinner", "breakfast", "hungry", "craving");
      const wantsGrocery = has("grocery", "groceries", "pantry");
      const typed = pool.filter((p) => (wantsFood ? p.type === "food" : wantsGrocery ? p.type === "grocery" : true));
      const pick = [...(typed.length ? typed : pool)].sort((a, b) => b.rating - a.rating)[0];
      if (pick) {
        return bot(`I recommend ${pick.name} (★ ${pick.rating}, ${money(pick.price)}). ${pick.description}`, {
          products: [pick],
        });
      }
    }

    if (match) {
      return bot(
        match.stock > 0
          ? `Yes! ${match.name} is available for ${money(match.price)} (${match.stock} in stock).`
          : `${match.name} is sold out right now. Check back soon!`,
        { products: [match] },
      );
    }

    if (/\b(hi|hello|hey|good (morning|afternoon|evening))\b/.test(q)) {
      return bot("Hello! Ask me about a dish, a grocery item, delivery fees or your order.");
    }

    const favorite = [...products].filter((p) => p.stock > 0).sort((a, b) => b.rating - a.rating)[0];
    return favorite
      ? {
          from: "bot",
          text: `I couldn't find that in our catalog. A customer favorite right now is ${favorite.name}, rated ${favorite.rating}.`,
          products: [favorite],
          matched: false,
        }
      : { from: "bot", text: "I couldn't find that in our catalog right now.", matched: false };
  };

  const send = async (question?: string) => {
    const value = (question ?? input).trim();
    if (!value || thinking) return;
    // The conversation so far (minus the greeting), so follow-ups like "how much is it?" make sense.
    const history: AiChatTurn[] = messages
      .slice(1)
      .slice(-8)
      .map((m) => ({ role: m.from === "user" ? "user" : "assistant", text: m.text }));
    setMessages((current) => [...current, { from: "user", text: value }]);
    setInput("");
    setThinking(true);

    let reply: ChatMessage;
    try {
      const ai = await askAilynAI(value, history);
      const byId = new Map(products.map((p) => [p.id, p]));
      reply = {
        from: "bot",
        text: ai.answer,
        products: ai.product_ids.map((id) => byId.get(id)).filter((p): p is Product => !!p),
        action: ai.show_order_tracking ? "track" : undefined,
        matched: ai.understood,
      };
      // The Edge Function already saved this question to chat_logs.
    } catch {
      // No Gemini key yet, rate limited or offline: answer from the built-in rules instead.
      reply = answer(value);
      logChat({
        question: value,
        answer: reply.text,
        product_id: reply.products?.[0]?.id ?? null,
        matched: reply.matched ?? false,
      });
    }
    setMessages((current) => [...current, reply]);
    setThinking(false);
  };

  return (
    <div className="chat-overlay" onMouseDown={onClose}>
      <aside className="chat-panel" onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <span>
            <Icon name="chat" />
          </span>
          <div>
            <strong>Ailyn AI</strong>
            <small>
              <i /> Online · AI shopping assistant
            </small>
          </div>
          <button onClick={onClose} aria-label="Close chat">
            <Icon name="close" />
          </button>
        </header>
        <div className="chat-messages" aria-live="polite">
          {messages.map((message, i) => (
            <div key={i}>
              <div className={`message ${message.from}`}>{message.text}</div>
              {message.products?.map((product) => (
                <button key={product.id} className="chat-product" onClick={() => openProduct(product)}>
                  <img src={product.image || FALLBACK_IMAGE} alt="" onError={imgFallback} />
                  <div>
                    <small>{product.stock > 0 ? "RECOMMENDED" : "SOLD OUT"}</small>
                    <strong>{product.name}</strong>
                    <span>{money(product.price)}</span>
                  </div>
                  <Icon name="arrow" />
                </button>
              ))}
              {message.action === "track" && (
                <button className="button button-soft chat-action" onClick={onTrack}>
                  <Icon name="map" size={17} /> {hasActiveOrder ? "Track my order" : "View my orders"}
                </button>
              )}
            </div>
          ))}
          {thinking && (
            <div className="message bot typing" role="status" aria-label="Ailyn AI is typing">
              <span />
              <span />
              <span />
            </div>
          )}
          <div ref={endRef} />
        </div>
        {suggestions.length > 0 && (
          <div className="suggested">
            <span>Try asking</span>
            <div>
              {suggestions.map((q) => (
                <button key={q} disabled={thinking} onClick={() => void send(q)}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="chat-input">
          <input
            placeholder="Ask about food or groceries..."
            value={input}
            maxLength={500}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void send()}
          />
          <button onClick={() => void send()} disabled={thinking || !input.trim()}>
            Send
          </button>
        </div>
      </aside>
    </div>
  );
}
