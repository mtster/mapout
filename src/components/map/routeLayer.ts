import { Map as MapLibreMap, GeoJSONSource } from 'maplibre-gl';
import { RouteData } from '../../types';

export const ROUTE_SOURCE_ID = 'active-route-source';
export const ROUTE_CASING_LAYER_ID = 'active-route-casing';
export const ROUTE_LINE_LAYER_ID = 'active-route-line';

/**
 * Mounts, updates, or tears down the GeoJSON vector route layer on the map
 */
export function updateRouteLayer(map: MapLibreMap, currentRoute: RouteData | null) {
  if (!map || !map.isStyleLoaded()) return;

  const coords =
    currentRoute?.geometry && currentRoute.geometry.length > 0
      ? currentRoute.geometry.map((pt) => [pt[1], pt[0]])
      : [];

  const geojson: GeoJSON.Feature<GeoJSON.LineString> = {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'LineString',
      coordinates: coords,
    },
  };

  const existingSource = map.getSource(ROUTE_SOURCE_ID) as GeoJSONSource | undefined;

  if (coords.length > 0) {
    if (existingSource) {
      existingSource.setData(geojson);
    } else {
      map.addSource(ROUTE_SOURCE_ID, {
        type: 'geojson',
        data: geojson,
      });

      if (!map.getLayer(ROUTE_CASING_LAYER_ID)) {
        map.addLayer({
          id: ROUTE_CASING_LAYER_ID,
          type: 'line',
          source: ROUTE_SOURCE_ID,
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

      if (!map.getLayer(ROUTE_LINE_LAYER_ID)) {
        map.addLayer({
          id: ROUTE_LINE_LAYER_ID,
          type: 'line',
          source: ROUTE_SOURCE_ID,
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
    // Coordinates empty / route cleared -> purge layer and source completely
    if (existingSource) {
      existingSource.setData({
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: [] },
      });
    }
    if (map.getLayer(ROUTE_LINE_LAYER_ID)) map.removeLayer(ROUTE_LINE_LAYER_ID);
    if (map.getLayer(ROUTE_CASING_LAYER_ID)) map.removeLayer(ROUTE_CASING_LAYER_ID);
    if (map.getSource(ROUTE_SOURCE_ID)) map.removeSource(ROUTE_SOURCE_ID);
  }
}
