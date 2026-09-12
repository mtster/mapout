import { Map as MapLibreMap, LngLatBounds } from 'maplibre-gl';
import { LatLng, RouteData } from '../../types';
import { smoothAngle } from '../../services/turfMathService';

/**
 * Frames the route within the visible viewport above the route bottom sheet in a single smooth motion
 */
export function fitRouteBounds(
  map: MapLibreMap,
  route: RouteData,
  isRouteSheetCollapsed = false
) {
  if (!route.geometry || route.geometry.length < 2) return;

  const bounds = new LngLatBounds();
  let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;

  route.geometry.forEach((pt) => {
    bounds.extend([pt[1], pt[0]]);
    if (pt[0] < minLat) minLat = pt[0];
    if (pt[0] > maxLat) maxLat = pt[0];
    if (pt[1] < minLng) minLng = pt[1];
    if (pt[1] > maxLng) maxLng = pt[1];
  });

  const container = map.getContainer();
  const containerH = container?.clientHeight || window.innerHeight || 600;
  const containerW = container?.clientWidth || window.innerWidth || 400;

  let topPadding = Math.min(Math.round(containerH * 0.12), 90);
  let bottomPadding = isRouteSheetCollapsed
    ? Math.min(Math.round(containerH * 0.18), 120)
    : Math.min(Math.round(containerH * 0.38), 260);
  let sidePadding = Math.min(Math.round(containerW * 0.08), 40);

  // Safeguard against padding exceeding container height
  if (containerH - (topPadding + bottomPadding) < 180) {
    const excess = (topPadding + bottomPadding) - (containerH - 180);
    if (excess > 0) {
      bottomPadding = Math.max(40, bottomPadding - Math.round(excess * 0.7));
      topPadding = Math.max(30, topPadding - Math.round(excess * 0.3));
    }
  }

  // Safe minimum zoom based on route extent so it never zooms out to world view
  const maxSpan = Math.max(Math.abs(maxLat - minLat), Math.abs(maxLng - minLng));
  let safeMinZoom = 13;
  if (maxSpan > 2.0) safeMinZoom = 6;
  else if (maxSpan > 0.5) safeMinZoom = 9;
  else if (maxSpan > 0.1) safeMinZoom = 11;

  // Single fluid motion: directly fly / ease without bouncing
  map.fitBounds(bounds, {
    padding: { top: topPadding, bottom: bottomPadding, left: sidePadding, right: sidePadding },
    maxZoom: 16.5,
    minZoom: safeMinZoom,
    duration: 850,
    animate: true,
  });
}

/**
 * 60 FPS Follow Camera during active turn-by-turn navigation (45-50 deg Perspective)
 * The location circle sits at a balanced ~52% vertical offset, leaving ample forward road visibility
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
    duration: 950,
    easing: (t) => t,
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
