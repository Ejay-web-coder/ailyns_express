import { useRef } from "react";

export type Page =
  | "home"
  | "food"
  | "grocery"
  | "details"
  | "cart"
  | "checkout"
  | "confirmation"
  | "tracking"
  | "orders"
  | "account";

export type Product = {
  id: number;
  name: string;
  category: string;
  price: number;
  rating: number;
  image: string;
  description: string;
  stock: number;
  ingredients?: string | null;
  type: "food" | "grocery";
  active?: boolean;
};

export type CartItem = Product & { quantity: number };

export type Tone = "success" | "error" | "info";
/** Show a toast. Pass "error" for failures so they aren't shown with a check mark. */
export type Notify = (message: string, tone?: Tone) => void;

export const FALLBACK_IMAGE =
  "https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=900&q=80";

/** onError handler for product images: swap a broken URL for the fallback photo once. */
export const imgFallback = (event: React.SyntheticEvent<HTMLImageElement>) => {
  const img = event.currentTarget;
  if (!img.dataset.fallback) {
    img.dataset.fallback = "1";
    img.src = FALLBACK_IMAGE;
  }
};

export const categories = [
  "Meals",
  "Snacks",
  "Beverages",
  "Fruits & Vegetables",
  "Meat & Seafood",
  "Dairy Products",
  "Grocery Essentials",
];

export const money = (value: number) =>
  `₱${value.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;

const iconPaths: Record<string, React.ReactNode> = {
  home: (
    <>
      <path d="m3 11 9-8 9 8" />
      <path d="M5 10v10h14V10M9 20v-6h6v6" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </>
  ),
  cart: (
    <>
      <path d="M3 4h2l2 11h10l3-8H6" />
      <circle cx="9" cy="20" r="1" />
      <circle cx="17" cy="20" r="1" />
    </>
  ),
  bell: (
    <>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
      <path d="M10 21h4" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  bag: (
    <>
      <path d="M5 8h14l-1 13H6L5 8Z" />
      <path d="M9 9V6a3 3 0 0 1 6 0v3" />
    </>
  ),
  food: (
    <>
      <path d="M6 3v8M3 3v5c0 2 6 2 6 0V3M6 11v10" />
      <path d="M17 3v18M17 3c-4 3-4 8 0 9" />
    </>
  ),
  arrow: <path d="m9 18 6-6-6-6" />,
  back: (
    <>
      <path d="m15 18-6-6 6-6" />
      <path d="M9 12h11" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5v14M5 12h14" />
    </>
  ),
  minus: <path d="M5 12h14" />,
  trash: (
    <>
      <path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6" />
    </>
  ),
  location: (
    <>
      <path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  chat: (
    <>
      <path d="M21 12a8 8 0 0 1-8 8H4l2-4a8 8 0 1 1 15-4Z" />
      <path d="M9 12h.01M13 12h.01M17 12h.01" />
    </>
  ),
  close: (
    <>
      <path d="m6 6 12 12M18 6 6 18" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  alert: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5M12 16.5h.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5M12 7.5h.01" />
    </>
  ),
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </>
  ),
  box: (
    <>
      <path d="m4 7 8-4 8 4-8 4-8-4ZM4 7v10l8 4 8-4V7M12 11v10" />
    </>
  ),
  orders: (
    <>
      <path d="M6 3h12v18H6zM9 8h6M9 12h6M9 16h4" />
    </>
  ),
  customers: (
    <>
      <circle cx="9" cy="8" r="3" />
      <circle cx="17" cy="9" r="2" />
      <path d="M3 20a6 6 0 0 1 12 0M15 15a5 5 0 0 1 6 5" />
    </>
  ),
  report: (
    <>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1a8 8 0 0 0-1.7-1L14.5 3h-5l-.4 3a8 8 0 0 0-1.7 1l-2.4-1-2 3.4L5.1 11a7 7 0 0 0 0 2L3 14.5 5 18l2.4-1a8 8 0 0 0 1.7 1l.4 3h5l.4-3a8 8 0 0 0 1.7-1l2.4 1 2-3.4-2.1-1.6a7 7 0 0 0 .1-1Z" />
    </>
  ),
  logout: (
    <>
      <path d="M10 4H4v16h6M14 8l4 4-4 4M18 12H8" />
    </>
  ),
  menu: (
    <>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </>
  ),
  filter: <path d="M4 5h16l-6 7v6l-4 2v-8L4 5Z" />,
  bike: (
    <>
      <circle cx="5.5" cy="17" r="3.5" />
      <circle cx="18.5" cy="17" r="3.5" />
      <path d="M5.5 17 9 9h5l4.5 8M9 9 7.5 6H5M14 9l1.5-3H18" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  phone: (
    <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" />
  ),
  map: (
    <>
      <path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z" />
      <path d="M9 3v15M15 6v15" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  wallet: (
    <>
      <path d="M4 7h15a1 1 0 0 1 1 1v11H5a1 1 0 0 1-1-1V7Z" />
      <path d="M4 7V6a2 2 0 0 1 2-2h11v3M16 13h2" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 11a8 8 0 0 0-14.9-3M4 4v4h4M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4" />
    </>
  ),
  download: <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />,
  share: (
    <>
      <path d="M12 15V3M8 7l4-4 4 4" />
      <path d="M7 10H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-1" />
    </>
  ),
  addbox: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M12 8.5v7M8.5 12h7" />
    </>
  ),
  smartphone: (
    <>
      <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
      <path d="M11 18.5h2" />
    </>
  ),
  monitor: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </>
  ),
  bolt: <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />,
  dots: (
    <>
      <circle cx="12" cy="5" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="12" cy="19" r="1" />
    </>
  ),
};

export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {iconPaths[name]}
    </svg>
  );
}

export function Logo({ compact = false, light = false }: { compact?: boolean; light?: boolean }) {
  return (
    <div className={`logo ${light ? "logo-light" : ""}`}>
      <span className="logo-mark">AE</span>
      {!compact && (
        <span className="logo-type">
          <strong>Ailyn's</strong>
          <small>EXPRESS</small>
        </span>
      )}
    </div>
  );
}

export function SearchBar({
  placeholder,
  value,
  onChange,
  onSearch,
}: {
  placeholder: string;
  value?: string;
  onChange?: (value: string) => void;
  onSearch?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="search-bar">
      <Icon name="search" />
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onSearch?.()}
        placeholder={placeholder}
      />
      <button
        type="button"
        onClick={() => {
          if (onSearch) onSearch();
          else if (value) onChange?.("");
          else inputRef.current?.focus();
        }}
      >
        {value ? "Clear" : "Search"}
      </button>
    </div>
  );
}

export function Status({ value }: { value: string }) {
  const cls = value.toLowerCase().replace(/&/g, "").replace(/\s+/g, "-");
  return <span className={`status status-${cls}`}>{value}</span>;
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="spinner-wrap" role="status">
      <span className="spinner" />
      <span>{label}…</span>
    </div>
  );
}
