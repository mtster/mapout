import { Map as MapLibreMap, LngLatBounds } from 'maplibre-gl';
import { LatLng, RouteData } from '../../types';
import { smoothAngle } from '../../services/turfMathService';

/**
 * Frames the route within the visible viewport above the route bottom sheet in a single smooth, direct motion.
 * Uses cameraForBounds + easeTo to completely eliminate the zoom-out-then-zoom-in flight arc.
 * Provides comfortable margins from the search bar, side edges, and route bottom sheet without zooming out too far.
 */
export function fitRouteBounds(
  map: MapLibreMap,
  route: RouteData,
  isRouteSheetCollapsed = false
) {
  if (!route.geometry || route.geometry.length < 2) return;

  const bounds = new LngLatBounds();
  route.geometry.forEach((pt) => {
    bounds.extend([pt[1], pt[0]]);
  });

  const container = map.getContainer();
  const containerH = container?.clientHeight || window.innerHeight || 600;
  const containerW = container?.clientWidth || window.innerWidth || 400;

  // Space for search bar at top (~64px + margin) and route sheet at bottom
  let topPadding = Math.min(Math.round(containerH * 0.12), 85);
  let bottomPadding = isRouteSheetCollapsed
    ? Math.min(Math.round(containerH * 0.14), 100)
    : Math.min(Math.round(containerH * 0.38), 255);
  let sidePadding = Math.min(Math.round(containerW * 0.07), 32);

  // Safeguard against padding consuming too much container height
  const availableH = containerH - (topPadding + bottomPadding);
  if (availableH < 180) {
    const excess = 180 - availableH;
    bottomPadding = Math.max(70, bottomPadding - Math.round(excess * 0.65));
    topPadding = Math.max(50, topPadding - Math.round(excess * 0.35));
  }

  // Calculate target camera options directly
  const targetCamera = map.cameraForBounds(bounds, {
    padding: { top: topPadding, bottom: bottomPadding, left: sidePadding, right: sidePadding },
    maxZoom: 16.8,
  });

  if (targetCamera && targetCamera.center && typeof targetCamera.zoom === 'number') {
    // Single fluid smooth motion directly to the destination bounds without zooming out first
    map.easeTo({
      center: targetCamera.center,
      zoom: targetCamera.zoom,
      bearing: 0,
      pitch: 0,
      duration: 850,
      easing: (t) => 1 - Math.pow(1 - t, 3), // Smooth cubic ease-out
    });
  }
}

/**
 * Frames the entire route overview during active turn-by-turn navigation.
 * Centers the route cleanly between the upper navigation maneuver card and the bottom navigation HUD.
 */
export function fitNavRouteOverview(
  map: MapLibreMap,
  route: RouteData
) {
  if (!route.geometry || route.geometry.length < 2) return;

  const bounds = new LngLatBounds();
  route.geometry.forEach((pt) => {
    bounds.extend([pt[1], pt[0]]);
  });

  const container = map.getContainer();
  const containerH = container?.clientHeight || window.innerHeight || 600;
  const containerW = container?.clientWidth || window.innerWidth || 400;

  // Upper navigation instructions card ~130px, bottom navigation HUD ~115px
  const topPad = Math.min(Math.round(containerH * 0.22), 140);
  const bottomPad = Math.min(Math.round(containerH * 0.20), 125);
  const sidePad = Math.min(Math.round(containerW * 0.08), 36);

  const targetCamera = map.cameraForBounds(bounds, {
    padding: { top: topPad, bottom: bottomPad, left: sidePad, right: sidePad },
    maxZoom: 16.5,
  });

  if (targetCamera && targetCamera.center && typeof targetCamera.zoom === 'number') {
    map.easeTo({
      center: targetCamera.center,
      zoom: targetCamera.zoom,
      bearing: 0,
      pitch: 0,
      duration: 750,
      easing: (t) => 1 - Math.pow(1 - t, 3), // Smooth cubic ease-out
    });
  }
}

/**
 * 60 FPS Follow Camera during active turn-by-turn navigation (48 deg Perspective)
 * Synchronized with the constant-speed marker interpolation for fluid, Google Maps-like driving movement.
 */
export function followNavigationCamera(
  map: MapLibreMap,
  targetCoord: LatLng,
  targetHeading: number | null | undefined,
  standardNavZoom: number
) {
  const currentBearing = map.getBearing();
  let bearingToUse = currentBearing;
  if (typeof targetHeading === 'number' && !isNaN(targetHeading)) {
    bearingToUse = smoothAngle(currentBearing, targetHeading, 0.45);
  }

  // Balanced positioning: ~52% from top, ~48% from bottom
  const viewportHeight = window.innerHeight || 600;
  const navTopPadding = Math.min(viewportHeight * 0.52, viewportHeight - 150);

  map.easeTo({
    center: [targetCoord[1], targetCoord[0]],
    zoom: standardNavZoom,
    bearing: bearingToUse,
    pitch: 48,
    padding: { top: navTopPadding, bottom: 0, left: 0, right: 0 },
    duration: 1000,
    easing: (t) => t, // Constant velocity linear pacing
  });
}

/**
 * Recenters the map to the target location
 */
export function recenterMapCamera(
  map: MapLibreMap,
  targetCoord: LatLng,
  isNavigating: boolean,
  targetHeading?: number | null,
  standardNavZoom = 17
) {
  const bearing =
    typeof targetHeading === 'number' && !isNaN(targetHeading) ? targetHeading : 0;

  const viewportHeight = window.innerHeight || 600;
  const navTopPadding = Math.min(viewportHeight * 0.52, viewportHeight - 150);

  map.flyTo({
    center: [targetCoord[1], targetCoord[0]],
    zoom: isNavigating ? standardNavZoom : 16,
    bearing: isNavigating ? bearing : 0,
    pitch: isNavigating ? 48 : 0,
    padding: isNavigating
      ? { top: navTopPadding, bottom: 0, left: 0, right: 0 }
      : { top: 0, bottom: 0, left: 0, right: 0 },
    duration: 800,
  });
}
