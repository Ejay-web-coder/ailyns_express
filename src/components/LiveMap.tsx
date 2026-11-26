import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Icon } from "../shared";
import { Order, OrderStatus, Profile, formatTime, statusLabel } from "../lib/types";
import {
  DEFAULT_CENTER,
  LatLng,
  Route,
  currentPosition,
  distanceMeters,
  fetchRoute,
  formatDistance,
  formatDuration,
  toLatLng,
  useDropOff,
  useStoreSettings,
} from "../lib/geo";

// ------------------------------------------------------------------ map basics

const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const PIN_SVG = {
  store: svg('<path d="M5 8h14l-1 13H6L5 8Z"/><path d="M9 9V6a3 3 0 0 1 6 0v3"/>'),
  rider: svg(
    '<circle cx="5.5" cy="17" r="3.5"/><circle cx="18.5" cy="17" r="3.5"/><path d="M5.5 17 9 9h5l4.5 8M9 9 7.5 6H5M14 9l1.5-3H18"/>',
  ),
  home: svg('<path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10M9 20v-6h6v6"/>'),
};
const FIT_SVG = svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/><circle cx="12" cy="12" r="2.5"/>');

type PinKind = keyof typeof PIN_SVG;

const pinIcon = (kind: PinKind, extra = "") =>
  L.divIcon({
    className: "map-pin-wrap",
    html: `<span class="map-pin map-pin-${kind} ${extra}">${PIN_SVG[kind]}</span>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    tooltipAnchor: [0, -20],
  });

const ll = (p: LatLng): L.LatLngTuple => [p.lat, p.lng];

/** Leaflet renders tooltip strings as HTML; names are user input, so pass a text node instead. */
const label = (text: string) => {
  const span = document.createElement("span");
  span.textContent = text;
  return span;
};

/** A Leaflet map on OpenStreetMap tiles, sized by its container. */
function createMap(container: HTMLElement, center: LatLng, zoom: number) {
  // Quarter-step zoom lets "fit the route" use the small maps' space instead of rounding far out.
  const map = L.map(container, {
    attributionControl: false,
    scrollWheelZoom: false,
    zoomSnap: 0.25,
  }).setView(ll(center), zoom);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
  }).addTo(map);
  L.control.attribution({ position: "topright", prefix: false }).addTo(map);
  return map;
}

// ------------------------------------------------------------------ which lines to draw

type LegKind = "active" | "planned" | "done";
type Leg = { id: string; from: LatLng; to: LatLng; kind: LegKind };

/**
 * Before pickup the rider heads to Ailyn's (active) and the trip to the customer is still ahead
 * (planned). Out for delivery, the store → rider stretch is done and rider → customer is active.
 */
function planLegs(status: OrderStatus, store: LatLng | null, rider: LatLng | null, customer: LatLng | null) {
  const legs: Leg[] = [];
  const add = (id: string, from: LatLng | null, to: LatLng | null, kind: LegKind) => {
    if (from && to && distanceMeters(from, to) > 15) legs.push({ id, from, to, kind });
  };
  if (status === "delivered" || status === "cancelled") {
    add("trip", store, customer, "done");
  } else if (status === "out_for_delivery") {
    if (rider) {
      add("travelled", store, rider, "done");
      add("to-customer", rider, customer, "active");
    } else {
      add("trip", store, customer, "active");
    }
  } else {
    add("to-store", rider, store, "active");
    add("trip", store, customer, "planned");
  }
  return legs;
}

const LINE_STYLE: Record<LegKind, L.PolylineOptions> = {
  active: { color: "#e92968", weight: 5, opacity: 0.95 },
  planned: { color: "#5f0a27", weight: 4, opacity: 0.6, dashArray: "1 9" },
  done: { color: "#5b4f54", weight: 4, opacity: 0.75 },
};

type RoutedLeg = Route & { from: LatLng; to: LatLng };

/**
 * Road routes per leg. A moving rider re-routes only after moving ~80 m, and an older route keeps
 * showing (joined to the rider's new position) while the new one loads. Straight lines until then.
 */
function useLegRoutes(legs: Leg[]) {
  const known = useRef(new Map<string, RoutedLeg>());
  const pending = useRef(new Set<string>());
  const mounted = useRef(true);
  const [version, setVersion] = useState(0);
  const signature = legs
    .map((l) => `${l.id}:${l.from.lat.toFixed(5)},${l.from.lng.toFixed(5)}>${l.to.lat.toFixed(5)},${l.to.lng.toFixed(5)}`)
    .join("|");

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    for (const leg of legs) {
      const prev = known.current.get(leg.id);
      if (prev && distanceMeters(prev.from, leg.from) < 80 && distanceMeters(prev.to, leg.to) < 80) continue;
      if (pending.current.has(leg.id)) continue;
      pending.current.add(leg.id);
      void fetchRoute(leg.from, leg.to).then((route) => {
        pending.current.delete(leg.id);
        if (!route || !mounted.current) return;
        known.current.set(leg.id, { ...route, from: leg.from, to: leg.to });
        setVersion((v) => v + 1);
      });
    }
    // `legs` is described by `signature`; `version` re-checks after each answer.
  }, [signature, version]);

  const routeFor = (leg: Leg) => {
    const r = known.current.get(leg.id);
    return r && distanceMeters(r.from, leg.from) < 300 && distanceMeters(r.to, leg.to) < 300 ? r : null;
  };
  return { routeFor, version };
}

// ------------------------------------------------------------------ live order map

export type Viewer = "customer" | "rider" | "admin";

/** Live map of an order: Ailyn's store, the rider and the drop-off, joined by the route. */
export function OrderMap({
  order,
  rider,
  viewer = "customer",
  height = 300,
}: {
  order: Order;
  rider?: Profile | null;
  viewer?: Viewer;
  height?: number;
}) {
  const store = useStoreSettings();
  const storePoint = toLatLng(store.settings?.lat, store.settings?.lng);
  const drop = useDropOff(order);
  const riderPoint = toLatLng(order.rider_lat, order.rider_lng);
  const riderFresh =
    !!riderPoint &&
    !!order.rider_location_at &&
    Date.now() - new Date(order.rider_location_at).getTime() < 3 * 60000;
  const legs = planLegs(order.status, storePoint, riderPoint, drop.point);
  const { routeFor, version } = useLegRoutes(legs);

  const el = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const fitRef = useRef<() => void>(() => undefined);
  const fittedFor = useRef("");

  useEffect(() => {
    const container = el.current!;
    const map = createMap(container, DEFAULT_CENTER, 13);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    fittedFor.current = ""; // a fresh map needs a fresh fit

    const FitControl = L.Control.extend({
      onAdd() {
        const button = L.DomUtil.create("button", "leaflet-bar map-fit");
        button.type = "button";
        button.title = "Show the whole route";
        button.setAttribute("aria-label", "Show the whole route");
        button.innerHTML = FIT_SVG;
        L.DomEvent.disableClickPropagation(button);
        L.DomEvent.on(button, "click", () => fitRef.current());
        return button;
      },
    });
    new FitControl({ position: "topleft" }).addTo(map);

    // Maps inside modals or hidden tabs start at 0 × 0; fit again once they get a size.
    let wasEmpty = !container.clientWidth || !container.clientHeight;
    const observer = new ResizeObserver(() => {
      map.invalidateSize();
      const empty = !container.clientWidth || !container.clientHeight;
      if (wasEmpty && !empty) fitRef.current();
      wasEmpty = empty;
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  const drawKey = JSON.stringify([
    storePoint,
    drop.point,
    riderPoint,
    riderFresh,
    legs.map((l) => l.kind),
    version,
    viewer,
    rider?.full_name,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();

    for (const leg of legs) {
      const route = routeFor(leg);
      const path = route ? [ll(leg.from), ...route.path, ll(leg.to)] : [ll(leg.from), ll(leg.to)];
      const style = LINE_STYLE[leg.kind];
      if (leg.kind === "active") L.polyline(path, { color: "#ffffff", weight: 9, opacity: 0.85 }).addTo(layer);
      // A straight dashed line means "as the crow flies" while the road route loads (or can't).
      L.polyline(path, route || leg.kind !== "active" ? style : { ...style, dashArray: "10 8" }).addTo(layer);
    }

    if (storePoint) {
      L.marker(ll(storePoint), { icon: pinIcon("store"), zIndexOffset: 100, keyboard: false })
        .bindTooltip(label("Ailyn's Express"))
        .addTo(layer);
    }
    if (drop.point) {
      const who = viewer === "customer" ? "Your drop-off" : order.customer_name;
      L.marker(ll(drop.point), { icon: pinIcon("home"), zIndexOffset: 200, keyboard: false })
        .bindTooltip(label(drop.approximate ? `${who} (approximate)` : who))
        .addTo(layer);
    }
    if (riderPoint) {
      L.marker(ll(riderPoint), {
        icon: pinIcon("rider", riderFresh ? "live" : "stale"),
        zIndexOffset: 300,
        keyboard: false,
      })
        .bindTooltip(label(rider?.full_name || (viewer === "rider" ? "You" : "Rider")))
        .addTo(layer);
    }

    const points = [storePoint, drop.point, riderPoint].filter((p): p is LatLng => !!p);
    fitRef.current = () => {
      if (!points.length) return;
      if (points.length === 1) {
        map.setView(ll(points[0]), 15);
        return;
      }
      const bottom = (card.current?.offsetHeight ?? 60) + 22;
      map.fitBounds(L.latLngBounds(points.map(ll)), {
        paddingTopLeft: [50, 30],
        paddingBottomRight: [30, bottom],
        maxZoom: 16,
      });
    };
    // Fit when a pin appears or disappears, or when the rider drives out of view.
    const which = `${order.id}:${points.length}:${!!storePoint}${!!drop.point}${!!riderPoint}`;
    if (which !== fittedFor.current) {
      fittedFor.current = which;
      fitRef.current();
    } else if (riderPoint && !map.getBounds().contains(ll(riderPoint))) {
      fitRef.current();
    }
  }, [drawKey]);

  // ---- the text card under the map
  const active = legs.find((l) => l.kind === "active");
  const activeRoute = active ? routeFor(active) : null;
  const span = active
    ? activeRoute
      ? `${formatDistance(activeRoute.meters)} · about ${formatDuration(activeRoute.seconds)}`
      : `${formatDistance(distanceMeters(active.from, active.to))} away`
    : "";
  let line: string;
  if (order.status === "delivered") line = "Delivered";
  else if (order.status === "cancelled") line = "This order was cancelled";
  else if (active?.id === "to-customer")
    line = viewer === "customer" ? `Your rider is ${span}` : `To the customer: ${span}`;
  else if (active?.id === "to-store")
    line = viewer === "rider" ? `To Ailyn's for pickup: ${span}` : `Rider is heading to Ailyn's · ${span}`;
  else if (!order.rider_id) line = "Waiting for a rider to take this order";
  else if (!riderPoint)
    line = viewer === "rider" ? "Share your location to show your route" : "Waiting for the rider's live location";
  else line = "Live route";
  if (riderPoint && order.rider_location_at && !["delivered", "cancelled"].includes(order.status)) {
    line += riderFresh ? ` · updated ${formatTime(order.rider_location_at)}` : ` · last seen ${formatTime(order.rider_location_at)}`;
  }

  const notes: string[] = [];
  if (!storePoint && store.status !== "loading")
    notes.push(viewer === "admin" ? "Set Ailyn's location in Settings to draw the full route." : "Store location not set yet.");
  if (drop.searching) notes.push("Finding the delivery address on the map…");
  else if (!drop.point) notes.push("Couldn't find the delivery address on the map.");
  else if (drop.approximate) notes.push("Drop-off is approximate (from the typed address).");

  return (
    <div className="live-map" style={{ height }}>
      <div ref={el} className="live-map-canvas" />
      <div className="live-map-card" ref={card}>
        <span className={`live-dot ${riderFresh ? "on" : ""}`} />
        <div>
          <strong>
            {rider ? rider.full_name || "Your rider" : order.rider_id ? "Rider assigned" : "Finding a rider"}
            {" · "}
            {statusLabel[order.status]}
          </strong>
          <small>{line}</small>
          {notes.length > 0 && <small className="live-map-note">{notes.join(" ")}</small>}
          <p className="map-legend">
            <span>
              <i className="legend-store" /> Ailyn's
            </span>
            <span>
              <i className="legend-rider" /> Rider
            </span>
            <span>
              <i className="legend-home" /> {viewer === "customer" ? "You" : "Customer"}
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ pin picker

/** Map for choosing a point: tap the map, drag the pin, or use the device's GPS. */
export function LocationPicker({
  value,
  onChange,
  hint,
  kind = "home",
  height = 240,
  locateOnMount = false,
}: {
  value: LatLng | null;
  onChange: (point: LatLng) => void;
  /** Where to look when nothing is pinned yet. */
  hint?: LatLng | null;
  kind?: PinKind;
  height?: number;
  locateOnMount?: boolean;
}) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const onChangeRef = useRef(onChange);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    const container = el.current!;
    const start = value ?? hint ?? DEFAULT_CENTER;
    const map = createMap(container, start, value ? 17 : hint ? 15 : 13);
    map.on("click", (e: L.LeafletMouseEvent) => onChangeRef.current({ lat: e.latlng.lat, lng: e.latlng.lng }));
    mapRef.current = map;
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(container);
    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!value) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }
    if (!markerRef.current) {
      const marker = L.marker(ll(value), { icon: pinIcon(kind), draggable: true, autoPan: true }).addTo(map);
      marker.on("dragend", () => {
        const p = marker.getLatLng();
        onChangeRef.current({ lat: p.lat, lng: p.lng });
      });
      markerRef.current = marker;
    } else {
      markerRef.current.setLatLng(ll(value));
    }
    if (!map.getBounds().contains(ll(value))) map.setView(ll(value), Math.max(map.getZoom(), 16));
  }, [value?.lat, value?.lng, kind]);

  useEffect(() => {
    if (!value && hint) mapRef.current?.setView(ll(hint), 15);
  }, [hint?.lat, hint?.lng]);

  const locate = async () => {
    setLocating(true);
    setError("");
    try {
      const point = await currentPosition();
      onChangeRef.current(point);
      mapRef.current?.setView(ll(point), 17);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't get your location.");
    } finally {
      setLocating(false);
    }
  };

  useEffect(() => {
    if (locateOnMount) void locate();
  }, []);

  return (
    <div className="location-picker">
      <div className="live-map" style={{ height }}>
        <div ref={el} className="live-map-canvas" />
      </div>
      <div className="picker-bar">
        <button type="button" className="button button-soft" onClick={locate} disabled={locating}>
          <Icon name="location" size={16} /> {locating ? "Finding you…" : "Use my current location"}
        </button>
        <small className={error ? "picker-error" : ""}>
          {error ||
            (value
              ? `Pinned at ${value.lat.toFixed(5)}, ${value.lng.toFixed(5)}. Drag the pin or tap the map to adjust.`
              : "Tap the map to drop the pin.")}
        </small>
      </div>
    </div>
  );
}
