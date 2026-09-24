import { Map as MapLibreMap, LngLatBounds } from 'maplibre-gl';
import { LatLng, RouteData } from '../../types';
import { smoothAngle } from '../../services/turfMathService';

export interface SafePadding {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * Dynamically measures all physical UI obstructions on top of the map:
 * - Top: Search Bar (#search-bar-container) in preview mode, or Navigation Maneuver Card (#nav-top-card) in nav mode
 * - Bottom: Route Bottom Sheet (#route-bottom-sheet) in preview mode, or Navigation Dashboard HUD (#nav-bottom-hud) in nav mode
 * - Right: Floating action controls (compass, layer switcher, locate button, recenter button)
 *
 * Computes exact pixel padding bounds so the fitted route geometry sits perfectly in the unobstructed safe zone.
 */
export function getScreenSafePadding(
  container: HTMLElement | null,
  isNavigating: boolean,
  isRouteSheetCollapsed = false
): SafePadding {
  const containerW = container?.clientWidth || window.innerWidth || 400;
  const containerH = container?.clientHeight || window.innerHeight || 600;

  let topInset = 0;
  let bottomInset = 0;
  let leftInset = Math.max(Math.round(containerW * 0.06), 24);
  let rightInset = Math.max(Math.round(containerW * 0.06), 24);

  if (isNavigating) {
    // 1. Top Obstruction: Navigation Instructions Card (#nav-top-card)
    const topCard = document.getElementById('nav-top-card');
    if (topCard) {
      const rect = topCard.getBoundingClientRect();
      topInset = Math.round(rect.bottom);
    } else {
      topInset = Math.round(containerH * 0.24);
    }
    // Safe margin so top of route doesn't touch the maneuver card
    topInset += 20;

    // 2. Bottom Obstruction: Bottom Navigation HUD (#nav-bottom-hud)
    const bottomHud = document.getElementById('nav-bottom-hud');
    if (bottomHud) {
      const rect = bottomHud.getBoundingClientRect();
      bottomInset = Math.round(containerH - rect.top);
    } else {
      bottomInset = Math.round(containerH * 0.18);
    }
    // Safe margin so bottom of route doesn't touch the navigation HUD
    bottomInset += 20;

    // Right side margin to clear floating re-center / next step buttons
    rightInset = Math.max(rightInset, 64);
  } else {
    // 1. Top Obstruction: Search Bar (#search-bar-container)
    const searchBar = document.getElementById('search-bar-container');
    if (searchBar) {
      const rect = searchBar.getBoundingClientRect();
      topInset = Math.round(rect.bottom);
    } else {
      topInset = 110;
    }
    // Safe margin so top of route doesn't touch the search bar
    topInset += 22;

    // 2. Bottom Obstruction: Route Bottom Sheet (#route-bottom-sheet)
    const bottomSheet = document.getElementById('route-bottom-sheet');
    if (bottomSheet) {
      const rect = bottomSheet.getBoundingClientRect();
      if (rect.top > 0 && rect.top < containerH) {
        bottomInset = Math.round(containerH - rect.top);
      } else {
        bottomInset = isRouteSheetCollapsed ? 120 : 310;
      }
    } else {
      const cssHeight = parseInt(
        document.documentElement.style.getPropertyValue('--route-sheet-height') || '0',
        10
      );
      if (cssHeight > 0) {
        bottomInset = cssHeight;
      } else {
        bottomInset = isRouteSheetCollapsed ? 120 : 310;
      }
    }
    // Safe margin so bottom of route doesn't touch the route sheet
    bottomInset += 20;

    // Right side margin to clear floating map controls (compass, layers, locate)
    rightInset = Math.max(rightInset, 68);
  }

  // Safety clamps: ensure available height and width are never collapsed to 0
  const availableH = containerH - (topInset + bottomInset);
  if (availableH < 140) {
    const overflow = 140 - availableH;
    topInset = Math.max(60, topInset - Math.round(overflow * 0.4));
    bottomInset = Math.max(80, bottomInset - Math.round(overflow * 0.6));
  }

  const availableW = containerW - (leftInset + rightInset);
  if (availableW < 120) {
    leftInset = 20;
    rightInset = 20;
  }

  return {
    top: topInset,
    bottom: bottomInset,
    left: leftInset,
    right: rightInset,
  };
}

/**
 * Frames the route within the visible viewport above the route bottom sheet in a single smooth, direct motion.
 * Uses cameraForBounds + easeTo with dynamic safe padding and pitch normalization (pitch: 0, bearing: 0).
 */
export function fitRouteBounds(
  map: MapLibreMap,
  route: RouteData,
  isRouteSheetCollapsed = false,
  duration = 800
) {
  if (!route.geometry || route.geometry.length < 2) return;

  const bounds = new LngLatBounds();
  route.geometry.forEach((pt) => {
    bounds.extend([pt[1], pt[0]]);
  });

  const container = map.getContainer();
  const padding = getScreenSafePadding(container, false, isRouteSheetCollapsed);

  // Normalize pitch and bearing to 0 to eliminate 3D perspective distortion
  const targetCamera = map.cameraForBounds(bounds, {
    padding,
    maxZoom: 16.5,
  });

  if (targetCamera && targetCamera.center && typeof targetCamera.zoom === 'number') {
    map.easeTo({
      center: targetCamera.center,
      zoom: targetCamera.zoom,
      bearing: 0,
      pitch: 0,
      duration,
      easing: (t) => 1 - Math.pow(1 - t, 3), // Smooth cubic ease-out
    });
  }
}

/**
 * Frames the entire route overview during active turn-by-turn navigation.
 * Centers the route cleanly in the unobstructed safe zone between the upper navigation card
 * and the bottom navigation HUD, resetting pitch to 0 to prevent 3D tilt perspective distortion.
 */
export function fitNavRouteOverview(
  map: MapLibreMap,
  route: RouteData,
  duration = 750
) {
  if (!route.geometry || route.geometry.length < 2) return;

  const bounds = new LngLatBounds();
  route.geometry.forEach((pt) => {
    bounds.extend([pt[1], pt[0]]);
  });

  const container = map.getContainer();
  const padding = getScreenSafePadding(container, true);

  // CRITICAL PITCH NORMALIZATION:
  // Reset pitch to 0 and bearing to 0. During navigation, pitch is 48 deg.
  // Normalizing pitch to 0 removes 3D tilt perspective distortion, perfectly centering the route
  // between the upper navigation card and the lower navigation HUD without clipping!
  const targetCamera = map.cameraForBounds(bounds, {
    padding,
    maxZoom: 16.2,
  });

  if (targetCamera && targetCamera.center && typeof targetCamera.zoom === 'number') {
    map.easeTo({
      center: targetCamera.center,
      zoom: targetCamera.zoom,
      bearing: 0,
      pitch: 0,
      duration,
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
