import { Map as MapLibreMap, GeoJSONSource } from 'maplibre-gl';
import * as turf from '@turf/turf';
import { LatLng, MapStyle, RouteData } from '../../types';
import { ROUTE_PASSED_CASING_LAYER_ID, ROUTE_CASING_LAYER_ID } from './routeLayer';

export const STREET_LIGHTS_SOURCE_ID = 'street-lights-source';
export const STREET_LIGHTS_GLOW_LAYER_ID = 'street-lights-glow';
export const STREET_LIGHTS_MID_LAYER_ID = 'street-lights-mid';
export const STREET_LIGHTS_CORE_LAYER_ID = 'street-lights-core';

const WARM_CORE_COLORS = [
  '#fef3c7', // warm cream amber
  '#fde047', // golden yellow
  '#fef08a', // soft warm lemon
  '#fbbf24', // sodium amber
  '#fef9c3', // warm incandescent white
];

const WARM_GLOW_COLORS = [
  '#f59e0b', // vibrant amber
  '#d97706', // warm sodium orange
  '#eab308', // golden yellow glow
  '#b45309', // deep amber halo
];

/**
 * Procedurally generates authentic street lighting lamp fixtures along the route corridor:
 * Spaced organically every ~38 to 45 meters, placed on alternating road edges / curbs,
 * with subtle variations in warm color temperature and intensity.
 */
function generateRouteStreetLights(geometry: LatLng[]): GeoJSON.Feature<GeoJSON.Point>[] {
  if (!geometry || geometry.length < 2) return [];

  try {
    const coords = geometry.map((c) => [c[1], c[0]]);
    const line = turf.lineString(coords);
    const totalMeters = turf.length(line, { units: 'meters' });
    if (totalMeters < 30) return [];

    // Spacing between lamp posts (approx. 40 meters on typical urban & suburban roads)
    const spacing = 42;
    // Cap at 250 lights for peak 60 FPS mobile performance
    const count = Math.min(Math.floor(totalMeters / spacing), 250);
    if (count <= 1) return [];

    const stepMeters = totalMeters / count;
    const features: GeoJSON.Feature<GeoJSON.Point>[] = [];

    for (let i = 1; i < count; i++) {
      // Subtle pseudo-random spacing jitter (+- 3.5m) to feel organic rather than rigid
      const jitter = ((i * 13) % 7 - 3) * 1.2;
      const d = Math.max(8, Math.min(totalMeters - 8, i * stepMeters + jitter));

      const pt = turf.along(line, d, { units: 'meters' });
      const nextPt = turf.along(line, Math.min(d + 4, totalMeters), { units: 'meters' });
      const bearing = turf.bearing(pt, nextPt);

      // Alternate left and right curbs, with occasional double-sided placement at intersections
      const side = (i % 2 === 0) ? 1 : -1;
      const offsetKm = 0.0055 + (((i * 7) % 4) * 0.0008); // 5.5 to 8.0 meters lateral offset
      const offsetBearing = (bearing + side * 90 + 360) % 360;
      const lightPos = turf.destination(pt, offsetKm, offsetBearing, { units: 'kilometers' });

      features.push({
        type: 'Feature',
        properties: {
          id: i,
          coreColor: WARM_CORE_COLORS[i % WARM_CORE_COLORS.length],
          glowColor: WARM_GLOW_COLORS[i % WARM_GLOW_COLORS.length],
        },
        geometry: {
          type: 'Point',
          coordinates: lightPos.geometry.coordinates,
        },
      });

      // Occasional opposite-side twin light pole for wider avenues (every ~7 poles)
      if (i % 7 === 0) {
        const oppOffsetBearing = (bearing - side * 90 + 360) % 360;
        const oppLightPos = turf.destination(pt, offsetKm, oppOffsetBearing, { units: 'kilometers' });
        features.push({
          type: 'Feature',
          properties: {
            id: i * 1000,
            coreColor: WARM_CORE_COLORS[(i + 2) % WARM_CORE_COLORS.length],
            glowColor: WARM_GLOW_COLORS[(i + 1) % WARM_GLOW_COLORS.length],
          },
          geometry: {
            type: 'Point',
            coordinates: oppLightPos.geometry.coordinates,
          },
        });
      }
    }

    return features;
  } catch (err) {
    console.warn('Error generating street lights:', err);
    return [];
  }
}

/**
 * Mounts, updates, or cleans up the ambient road street lighting GPU layers on the dark map theme.
 * Gives an elegant, soothing nocturnal illumination along the road corridor during navigation.
 */
export function updateStreetLighting(
  map: MapLibreMap,
  currentRoute: RouteData | null,
  mapStyle: MapStyle
) {
  if (!map || !map.isStyleLoaded()) return;

  const isDarkMode = mapStyle === 'dark';
  const hasRoute = currentRoute?.geometry && currentRoute.geometry.length > 1;

  const features = isDarkMode && hasRoute ? generateRouteStreetLights(currentRoute.geometry) : [];

  const geojson: GeoJSON.FeatureCollection<GeoJSON.Point> = {
    type: 'FeatureCollection',
    features,
  };

  const existingSource = map.getSource(STREET_LIGHTS_SOURCE_ID) as GeoJSONSource | undefined;

  if (features.length > 0) {
    if (existingSource) {
      existingSource.setData(geojson);
    } else {
      map.addSource(STREET_LIGHTS_SOURCE_ID, {
        type: 'geojson',
        data: geojson,
      });

      // Find insertion point before route layers so street lights sit on the road surface below the route line
      const beforeLayerId =
        map.getLayer(ROUTE_PASSED_CASING_LAYER_ID)
          ? ROUTE_PASSED_CASING_LAYER_ID
          : map.getLayer(ROUTE_CASING_LAYER_ID)
          ? ROUTE_CASING_LAYER_ID
          : undefined;

      // 1. Broad outer diffuse warm amber ambient halo
      if (!map.getLayer(STREET_LIGHTS_GLOW_LAYER_ID)) {
        map.addLayer(
          {
            id: STREET_LIGHTS_GLOW_LAYER_ID,
            type: 'circle',
            source: STREET_LIGHTS_SOURCE_ID,
            paint: {
              'circle-color': ['get', 'glowColor'],
              'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 4, 14, 9, 17, 18, 20, 26],
              'circle-blur': 1.0,
              'circle-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0.08, 14, 0.22, 17, 0.35, 20, 0.45],
            },
          },
          beforeLayerId
        );
      }

      // 2. Mid warm golden corona
      if (!map.getLayer(STREET_LIGHTS_MID_LAYER_ID)) {
        map.addLayer(
          {
            id: STREET_LIGHTS_MID_LAYER_ID,
            type: 'circle',
            source: STREET_LIGHTS_SOURCE_ID,
            paint: {
              'circle-color': ['get', 'coreColor'],
              'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 1.8, 14, 4.0, 17, 7.5, 20, 12],
              'circle-blur': 0.65,
              'circle-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0.15, 14, 0.45, 17, 0.65, 20, 0.8],
            },
          },
          beforeLayerId
        );
      }

      // 3. Intensely warm incandescent lamp fixture core
      if (!map.getLayer(STREET_LIGHTS_CORE_LAYER_ID)) {
        map.addLayer(
          {
            id: STREET_LIGHTS_CORE_LAYER_ID,
            type: 'circle',
            source: STREET_LIGHTS_SOURCE_ID,
            paint: {
              'circle-color': '#fffbeb',
              'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 1.0, 14, 1.8, 17, 3.2, 20, 5.0],
              'circle-blur': 0.25,
              'circle-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0.35, 14, 0.85, 17, 0.95, 20, 1.0],
            },
          },
          beforeLayerId
        );
      }
    }
  } else {
    // Light features empty or not dark mode -> set empty or tear down cleanly
    if (existingSource) {
      existingSource.setData({
        type: 'FeatureCollection',
        features: [],
      });
    }
    if (map.getLayer(STREET_LIGHTS_CORE_LAYER_ID)) map.removeLayer(STREET_LIGHTS_CORE_LAYER_ID);
    if (map.getLayer(STREET_LIGHTS_MID_LAYER_ID)) map.removeLayer(STREET_LIGHTS_MID_LAYER_ID);
    if (map.getLayer(STREET_LIGHTS_GLOW_LAYER_ID)) map.removeLayer(STREET_LIGHTS_GLOW_LAYER_ID);
    if (map.getSource(STREET_LIGHTS_SOURCE_ID)) map.removeSource(STREET_LIGHTS_SOURCE_ID);
  }
}
