import { ComponentProps, Suspense, lazy } from "react";
import type { LocationPicker as LivePicker, OrderMap as LiveOrderMap } from "./LiveMap";

// Leaflet (~45 KB gzipped) loads the first time a map is on screen, not with the landing page.
const LazyOrderMap = lazy(() => import("./LiveMap").then((m) => ({ default: m.OrderMap })));
const LazyPicker = lazy(() => import("./LiveMap").then((m) => ({ default: m.LocationPicker })));

export type { Viewer } from "./LiveMap";

export function OrderMap(props: ComponentProps<typeof LiveOrderMap>) {
  return (
    <Suspense fallback={<div className="live-map" style={{ height: props.height ?? 300 }} />}>
      <LazyOrderMap {...props} />
    </Suspense>
  );
}

export function LocationPicker(props: ComponentProps<typeof LivePicker>) {
  return (
    <Suspense fallback={<div className="live-map" style={{ height: props.height ?? 240 }} />}>
      <LazyPicker {...props} />
    </Suspense>
  );
}
