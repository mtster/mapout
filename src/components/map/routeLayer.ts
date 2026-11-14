import { Map as MapLibreMap, GeoJSONSource } from 'maplibre-gl';
import { LatLng, RouteData } from '../../types';
import {
  IndexedRoute,
  splitIndexedRouteAtDistance,
  splitRouteGeometry,
} from '../../services/turfMathService';

export const ROUTE_SOURCE_ID = 'active-route-source';
export const ROUTE_PASSED_CASING_LAYER_ID = 'active-route-passed-casing';
export const ROUTE_PASSED_LINE_LAYER_ID = 'active-route-passed-line';
export const ROUTE_CASING_LAYER_ID = 'active-route-casing';
export const ROUTE_LINE_LAYER_ID = 'active-route-line';

/**
 * Mounts, updates, or tears down the GeoJSON vector route layer on the map.
 * When navigating, the route already passed by the visible location dot is rendered
 * muted/grayed out, while the remaining path ahead remains glowing vibrant blue.
 */
export function updateRouteLayer(
  map: MapLibreMap,
  currentRoute: RouteData | null,
  isNavigating = false,
  activeLocation: LatLng | null = null,
  indexedRoute: IndexedRoute | null = null,
  distAlongRoute: number | null = null
) {
  if (!map || !map.isStyleLoaded()) return;

  const hasGeometry = currentRoute?.geometry && currentRoute.geometry.length > 0;

  let passedCoords: [number, number][] = [];
  let remainingCoords: [number, number][] = [];

  if (hasGeometry && currentRoute) {
    if (isNavigating && indexedRoute && distAlongRoute !== null && distAlongRoute !== undefined) {
      const { passed, remaining } = splitIndexedRouteAtDistance(indexedRoute, distAlongRoute);
      passedCoords = passed.map((pt) => [pt[1], pt[0]]);
      remainingCoords = remaining.map((pt) => [pt[1], pt[0]]);
    } else if (isNavigating && activeLocation) {
      const { passed, remaining } = splitRouteGeometry(activeLocation, currentRoute.geometry);
      passedCoords = passed.map((pt) => [pt[1], pt[0]]);
      remainingCoords = remaining.map((pt) => [pt[1], pt[0]]);
    } else {
      // Idle / preview mode or at starting position: full route is active
      remainingCoords = currentRoute.geometry.map((pt) => [pt[1], pt[0]]);
    }
  }

  const hasAnyCoords = passedCoords.length > 0 || remainingCoords.length > 0;

  const geojson: GeoJSON.FeatureCollection<GeoJSON.LineString> = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { segment: 'passed' },
        geometry: {
          type: 'LineString',
          coordinates: passedCoords,
        },
      },
      {
        type: 'Feature',
        properties: { segment: 'remaining' },
        geometry: {
          type: 'LineString',
          coordinates: remainingCoords,
        },
      },
    ],
  };

  const existingSource = map.getSource(ROUTE_SOURCE_ID) as GeoJSONSource | undefined;

  if (hasAnyCoords) {
    if (existingSource) {
      existingSource.setData(geojson);
    } else {
      map.addSource(ROUTE_SOURCE_ID, {
        type: 'geojson',
        data: geojson,
      });

      // 1. Passed route casing (subtle dark gray outline)
      if (!map.getLayer(ROUTE_PASSED_CASING_LAYER_ID)) {
        map.addLayer({
          id: ROUTE_PASSED_CASING_LAYER_ID,
          type: 'line',
          source: ROUTE_SOURCE_ID,
          filter: ['==', ['get', 'segment'], 'passed'],
          layout: {
            'line-join': 'round',
            'line-cap': 'round',
          },
          paint: {
            'line-color': '#27272a',
            'line-width': ['interpolate', ['linear'], ['zoom'], 10, 5, 16, 9, 20, 14],
            'line-opacity': 0.4,
          },
        });
      }

      // 2. Passed route inner line (muted zinc-500 gray indicating traveled path)
      if (!map.getLayer(ROUTE_PASSED_LINE_LAYER_ID)) {
        map.addLayer({
          id: ROUTE_PASSED_LINE_LAYER_ID,
          type: 'line',
          source: ROUTE_SOURCE_ID,
          filter: ['==', ['get', 'segment'], 'passed'],
          layout: {
            'line-join': 'round',
            'line-cap': 'round',
          },
          paint: {
            'line-color': '#71717a',
            'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3, 16, 5, 20, 8],
            'line-opacity': 0.5,
          },
        });
      }

      // 3. Active remaining route casing (deep vibrant sky blue glow)
      if (!map.getLayer(ROUTE_CASING_LAYER_ID)) {
        map.addLayer({
          id: ROUTE_CASING_LAYER_ID,
          type: 'line',
          source: ROUTE_SOURCE_ID,
          filter: ['==', ['get', 'segment'], 'remaining'],
          layout: {
            'line-join': 'round',
            'line-cap': 'round',
          },
          paint: {
            'line-color': '#0284c7',
            'line-width': ['interpolate', ['linear'], ['zoom'], 10, 6, 16, 11, 20, 16],
            'line-opacity': 0.85,
          },
        });
      }

      // 4. Active remaining route inner line (brilliant vibrant cyan #38bdf8)
      if (!map.getLayer(ROUTE_LINE_LAYER_ID)) {
        map.addLayer({
          id: ROUTE_LINE_LAYER_ID,
          type: 'line',
          source: ROUTE_SOURCE_ID,
          filter: ['==', ['get', 'segment'], 'remaining'],
          layout: {
            'line-join': 'round',
            'line-cap': 'round',
          },
          paint: {
            'line-color': '#38bdf8',
            'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3.5, 16, 6, 20, 10],
            'line-opacity': 1.0,
          },
        });
      }
    }
  } else {
    // Route cleared -> purge layers and source completely
    if (existingSource) {
      existingSource.setData({
        type: 'FeatureCollection',
        features: [],
      });
    }
    if (map.getLayer(ROUTE_LINE_LAYER_ID)) map.removeLayer(ROUTE_LINE_LAYER_ID);
    if (map.getLayer(ROUTE_CASING_LAYER_ID)) map.removeLayer(ROUTE_CASING_LAYER_ID);
    if (map.getLayer(ROUTE_PASSED_LINE_LAYER_ID)) map.removeLayer(ROUTE_PASSED_LINE_LAYER_ID);
    if (map.getLayer(ROUTE_PASSED_CASING_LAYER_ID)) map.removeLayer(ROUTE_PASSED_CASING_LAYER_ID);
    if (map.getSource(ROUTE_SOURCE_ID)) map.removeSource(ROUTE_SOURCE_ID);
  }
}

