import { Map as MapLibreMap, GeoJSONSource } from 'maplibre-gl';
import * as turf from '@turf/turf';
import { LatLng, MapStyle, RouteData } from '../../types';

export const STREET_LIGHTS_SOURCE_ID = 'street-lights-source';
export const STREET_LIGHTS_GLOW_LAYER_ID = 'street-lights-glow';
export const STREET_LIGHTS_MID_LAYER_ID = 'street-lights-mid';
export const STREET_LIGHTS_CORE_LAYER_ID = 'street-lights-core';

const WARM_CORE_COLORS = [
  '#fef08a', // soft warm lemon yellow
  '#fde047', // golden incandescent yellow
  '#fef9c3', // warm cream white
  '#fef3c7', // warm sodium amber
  '#fed7aa', // warm peach amber
];

const WARM_GLOW_COLORS = [
  '#f59e0b', // radiant amber
  '#fbbf24', // golden amber glow
  '#d97706', // warm sodium orange
  '#eab308', // pure golden glow
];

/**
 * Procedurally generates authentic street lighting lamp fixtures along the route corridor:
 * Spaced organically every ~32 to 38 meters, placed on the sidewalks/curbs on alternating sides
 * (13m - 19m lateral offset from centerline so they are never obscured by the route line),
 * with subtle variations in warm color temperature and luminous halo intensity.
 */
function generateRouteStreetLights(geometry: LatLng[]): GeoJSON.Feature<GeoJSON.Point>[] {
  if (!geometry || geometry.length < 2) return [];

  try {
    const coords = geometry.map((c) => [c[1], c[0]]);
    const line = turf.lineString(coords);
    const totalMeters = turf.length(line, { units: 'meters' });
    if (totalMeters < 20) return [];

    // Spacing between lamp posts (~34 meters on standard urban & suburban roads)
    const spacing = 34;
    // Cap at 300 lights for peak 60 FPS mobile WebGL performance
    const count = Math.min(Math.floor(totalMeters / spacing), 300);
    if (count <= 1) return [];

    const stepMeters = totalMeters / count;
    const features: GeoJSON.Feature<GeoJSON.Point>[] = [];

    for (let i = 1; i < count; i++) {
      // Natural organic spacing jitter (+- 3.0m)
      const jitter = ((i * 11) % 5 - 2) * 1.5;
      const d = Math.max(6, Math.min(totalMeters - 6, i * stepMeters + jitter));

      const pt = turf.along(line, d, { units: 'meters' });
      const nextPt = turf.along(line, Math.min(d + 4, totalMeters), { units: 'meters' });
      const bearing = turf.bearing(pt, nextPt);

      // Alternate left and right curbs with 13m - 19m lateral offset to place lamps on sidewalks
      const side = (i % 2 === 0) ? 1 : -1;
      const offsetKm = 0.0135 + (((i * 7) % 4) * 0.0016); // 13.5m to 18.3m lateral offset
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

      // Avenue twin light pole on both sides of the street (every 5 poles)
      if (i % 5 === 0) {
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
 * Mounts, updates, or cleans up the ambient road street lighting GPU layers on dark map themes.
 * Gives an authentic, soothing nocturnal illumination along the road corridor during navigation.
 */
export function updateStreetLighting(
  map: MapLibreMap,
  currentRoute: RouteData | null,
  mapStyle: MapStyle
) {
  if (!map || !map.isStyleLoaded()) return;

  // Active in Darkness ('dark') and Night Life ('midnight') themes
  const isDarkTheme = mapStyle === 'dark' || mapStyle === 'midnight';
  const hasRoute = currentRoute?.geometry && currentRoute.geometry.length > 1;

  const features = isDarkTheme && hasRoute ? generateRouteStreetLights(currentRoute.geometry) : [];

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

      // 1. Broad outer diffuse warm amber ambient puddle / halo
      if (!map.getLayer(STREET_LIGHTS_GLOW_LAYER_ID)) {
        map.addLayer({
          id: STREET_LIGHTS_GLOW_LAYER_ID,
          type: 'circle',
          source: STREET_LIGHTS_SOURCE_ID,
          paint: {
            'circle-color': ['get', 'glowColor'],
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 4, 14, 10, 16, 18, 18, 28],
            'circle-blur': 0.65,
            'circle-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0.15, 14, 0.45, 16, 0.70, 18, 0.85],
          },
        });
      }

      // 2. Mid golden lamp corona
      if (!map.getLayer(STREET_LIGHTS_MID_LAYER_ID)) {
        map.addLayer({
          id: STREET_LIGHTS_MID_LAYER_ID,
          type: 'circle',
          source: STREET_LIGHTS_SOURCE_ID,
          paint: {
            'circle-color': ['get', 'coreColor'],
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2, 14, 5, 16, 9, 18, 14],
            'circle-blur': 0.40,
            'circle-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0.25, 14, 0.65, 16, 0.85, 18, 0.95],
          },
        });
      }

      // 3. Crisp, intensely warm incandescent lamp fixture bulb
      if (!map.getLayer(STREET_LIGHTS_CORE_LAYER_ID)) {
        map.addLayer({
          id: STREET_LIGHTS_CORE_LAYER_ID,
          type: 'circle',
          source: STREET_LIGHTS_SOURCE_ID,
          paint: {
            'circle-color': '#fffdf0',
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 1.2, 14, 2.5, 16, 4.2, 18, 6.0],
            'circle-blur': 0.10,
            'circle-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0.4, 14, 0.85, 16, 0.95, 18, 1.0],
          },
        });
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
