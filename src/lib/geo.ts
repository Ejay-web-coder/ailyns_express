import { useEffect, useState, useSyncExternalStore } from "react";
import { fetchStoreSettings } from "./api";
import type { Order, StoreSettings } from "./types";

export type LatLng = { lat: number; lng: number };

/** Used only to centre an empty map. */
export const DEFAULT_CENTER: LatLng = { lat: 15.0286, lng: 120.6898 }; // San Fernando, Pampanga

export const toLatLng = (lat: number | null | undefined, lng: number | null | undefined): LatLng | null =>
  lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;

/** Straight-line distance in metres. */
export function distanceMeters(a: LatLng, b: LatLng) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

export const formatDistance = (meters: number) =>
  meters < 950 ? `${Math.max(10, Math.round(meters / 10) * 10)} m` : `${(meters / 1000).toFixed(1)} km`;

export const formatDuration = (seconds: number) => {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
};

/** Device GPS, as a promise. */
export function currentPosition(): Promise<LatLng> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("This device can't share its location."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) =>
        reject(
          new Error(
            err.code === err.PERMISSION_DENIED
              ? "Location permission was denied. Allow it in your browser settings, then try again."
              : "Couldn't get your location. Try again, or tap the map to drop the pin.",
          ),
        ),
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 },
    );
  });
}

// ------------------------------------------------------------------ store location

type StoreState = { status: "loading" | "ready" | "missing"; settings: StoreSettings | null };
let storeState: StoreState = { status: "loading", settings: null };
let storeRequest: Promise<void> | null = null;
const storeListeners = new Set<() => void>();

function setStoreState(next: StoreState) {
  storeState = next;
  storeListeners.forEach((fn) => fn());
}

/** Re-read the store row (after an admin saves it). */
export function refreshStoreLocation() {
  storeRequest = fetchStoreSettings()
    .then((settings) => setStoreState({ status: settings ? "ready" : "missing", settings }))
    .catch(() => setStoreState({ status: "missing", settings: null }));
  return storeRequest;
}

/** Ailyn's store location, shared by every map on the page. `missing` means the table isn't set up yet. */
export function useStoreSettings(): StoreState {
  const state = useSyncExternalStore(
    (fn) => {
      storeListeners.add(fn);
      return () => storeListeners.delete(fn);
    },
    () => storeState,
  );
  useEffect(() => {
    if (!storeRequest) void refreshStoreLocation();
  }, []);
  return state;
}

// ------------------------------------------------------------------ polite request queues

/** Runs one request at a time with a gap between them (both free services ask for ≤ 1 per second). */
function makeQueue(gapMs: number) {
  let tail: Promise<unknown> = Promise.resolve();
  return <T,>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task);
    tail = run.catch(() => undefined).then(() => new Promise((r) => setTimeout(r, gapMs)));
    return run;
  };
}

const geocodeQueue = makeQueue(1100);
const routeQueue = makeQueue(400);

const readCache = <T,>(key: string): T | undefined => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
};
const writeCache = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: we just look it up again next time.
  }
};

// ------------------------------------------------------------------ address → coordinates

export type Geocoded = LatLng & { approximate: boolean };

const geocodeMemory = new Map<string, Promise<Geocoded | null>>();

async function nominatim(q: string): Promise<LatLng | null> {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=ph&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Geocoding failed (${res.status})`);
  const rows = (await res.json()) as { lat: string; lon: string }[];
  return rows[0] ? { lat: Number(rows[0].lat), lng: Number(rows[0].lon) } : null;
}

/**
 * Look up the drop-off from the typed address, for orders the customer didn't pin. Tries the full
 * address, then without the house/street part, then just the city. Results are kept on the device.
 */
export function geocodeOrderAddress(order: Pick<Order, "address" | "city" | "province">) {
  const city = [order.city, order.province].map((s) => s?.trim()).filter(Boolean).join(", ");
  const street = order.address.trim();
  const key = `${street} | ${city}`.toLowerCase();
  const cached = geocodeMemory.get(key);
  if (cached) return cached;

  const storageKey = `ailyns:geocode:v1:${key}`;
  const stored = readCache<Geocoded | { none: true; at: number }>(storageKey);
  // Misses are retried after a day, hits are kept.
  if (stored && !("none" in stored && Date.now() - stored.at > 86400000)) {
    const hit = Promise.resolve("none" in stored ? null : stored);
    geocodeMemory.set(key, hit);
    return hit;
  }

  const afterStreet = street.split(",").slice(1).join(",").trim();
  const attempts: [string, boolean][] = [
    [`${street}, ${city}, Philippines`, false],
    ...(afterStreet ? ([[`${afterStreet}, ${city}, Philippines`, true]] as [string, boolean][]) : []),
    [`${city}, Philippines`, true],
  ];
  const lookup = (async () => {
    for (const [q, approximate] of attempts) {
      const point = await geocodeQueue(() => nominatim(q));
      if (point) {
        const hit = { ...point, approximate };
        writeCache(storageKey, hit);
        return hit;
      }
    }
    writeCache(storageKey, { none: true, at: Date.now() });
    return null;
  })().catch(() => {
    geocodeMemory.delete(key); // network trouble: try again on the next render
    return null;
  });
  geocodeMemory.set(key, lookup);
  return lookup;
}

/** The order's drop-off: the customer's pin, else the looked-up address. */
export function useDropOff(order: Order): {
  point: LatLng | null;
  pinned: boolean;
  approximate: boolean;
  searching: boolean;
} {
  const pin = toLatLng(order.dest_lat, order.dest_lng);
  const [found, setFound] = useState<{ key: string; value: Geocoded | null } | null>(null);
  const key = `${order.address}|${order.city}|${order.province}`;
  useEffect(() => {
    if (pin) return;
    let live = true;
    void geocodeOrderAddress(order).then((value) => live && setFound({ key, value }));
    return () => {
      live = false;
    };
  }, [key, pin == null]);
  if (pin) return { point: pin, pinned: true, approximate: false, searching: false };
  const done = found?.key === key;
  const value = done ? found.value : null;
  return { point: value, pinned: false, approximate: value?.approximate ?? false, searching: !done };
}

// ------------------------------------------------------------------ road routes

export type Route = { path: [number, number][]; meters: number; seconds: number };

const routeMemory = new Map<string, Promise<Route | null>>();
let routingDownUntil = 0;
const roundKey = (p: LatLng) => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`;

/** Road route between two points (OSRM). Resolves null when routing is unavailable. */
export function fetchRoute(from: LatLng, to: LatLng): Promise<Route | null> {
  const key = `${roundKey(from)};${roundKey(to)}`;
  const cached = routeMemory.get(key);
  if (cached) return cached;
  if (Date.now() < routingDownUntil) return Promise.resolve(null);
  const request = routeQueue(async () => {
    const res = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${key}?overview=full&geometries=geojson`,
    );
    if (!res.ok) throw new Error(`Routing failed (${res.status})`);
    const body = (await res.json()) as {
      code: string;
      routes?: { distance: number; duration: number; geometry: { coordinates: [number, number][] } }[];
    };
    const route = body.code === "Ok" ? body.routes?.[0] : undefined;
    if (!route) return null;
    return {
      path: route.geometry.coordinates.map(([lng, lat]) => [lat, lng] as [number, number]),
      meters: route.distance,
      seconds: route.duration,
    };
  }).catch(() => {
    routeMemory.delete(key);
    routingDownUntil = Date.now() + 60000; // back off for a minute, straight lines meanwhile
    return null;
  });
  routeMemory.set(key, request);
  if (routeMemory.size > 200) routeMemory.delete(routeMemory.keys().next().value!);
  return request;
}
