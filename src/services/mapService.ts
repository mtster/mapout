import { LatLng, PlaceResult, RouteData, RouteStep, TravelMode } from '../types';

// Debounce helper
export function debounce<T extends (...args: any[]) => any>(fn: T, ms = 300) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>): Promise<ReturnType<T>> => {
    if (timer) clearTimeout(timer);
    return new Promise((resolve) => {
      timer = setTimeout(() => {
        resolve(fn(...args));
      }, ms);
    });
  };
}

// Search places with Photon and fallback to Nominatim
export async function searchPlaces(query: string, userCoords?: LatLng): Promise<PlaceResult[]> {
  const trimmed = query.trim();
  if (!trimmed || trimmed.length < 2) return [];

  try {
    let url = `https://photon.komoot.io/api/?q=${encodeURIComponent(trimmed)}&limit=6`;
    if (userCoords) {
      url += `&lat=${userCoords[0]}&lon=${userCoords[1]}`;
    }

    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
      },
    });

    if (res.ok) {
      const data = await res.json();
      if (data && Array.isArray(data.features) && data.features.length > 0) {
        return data.features.map((feat: any, index: number) => {
          const props = feat.properties || {};
          const coords = feat.geometry?.coordinates || [0, 0];
          const name = props.name || props.street || props.city || trimmed;
          const details = [props.street, props.city, props.state, props.country]
            .filter(Boolean)
            .join(', ');

          return {
            id: `photon-${props.osm_id || index}-${coords[0]}`,
            name,
            label: details || name,
            lat: coords[1],
            lng: coords[0],
            category: props.osm_value || props.type || 'place',
            city: props.city,
            country: props.country,
          };
        });
      }
    }
  } catch (err) {
    console.warn('Photon search error, trying Nominatim fallback:', err);
  }

  // Fallback to OpenStreetMap Nominatim
  try {
    const nomUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
      trimmed
    )}&format=json&addressdetails=1&limit=6`;
    const nomRes = await fetch(nomUrl, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mapout-PWA-App',
      },
    });
    if (nomRes.ok) {
      const nomData = await nomRes.json();
      if (Array.isArray(nomData)) {
        return nomData.map((item: any) => ({
          id: `nom-${item.place_id}`,
          name: item.name || item.display_name.split(',')[0],
          label: item.display_name,
          lat: parseFloat(item.lat),
          lng: parseFloat(item.lon),
          category: item.type || item.class || 'place',
          city: item.address?.city || item.address?.town || item.address?.village,
          country: item.address?.country,
        }));
      }
    }
  } catch (err) {
    console.warn('Nominatim fallback failed:', err);
  }

  return [];
}

// Reverse geocode a tapped coordinate
export async function reverseGeocode(lat: number, lng: number): Promise<string> {
  try {
    const res = await fetch(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}`);
    if (res.ok) {
      const data = await res.json();
      if (data?.features?.[0]?.properties) {
        const p = data.features[0].properties;
        const parts = [p.name, p.street, p.city, p.country].filter(Boolean);
        if (parts.length > 0) return parts.slice(0, 3).join(', ');
      }
    }
  } catch {
    // fallback
  }

  try {
    const nomRes = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
      { headers: { 'User-Agent': 'Mapout-PWA-App' } }
    );
    if (nomRes.ok) {
      const data = await nomRes.json();
      if (data?.display_name) {
        return data.display_name.split(',').slice(0, 3).join(',').trim();
      }
    }
  } catch {
    // fallback
  }

  return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}

// Calculate route between start and end coordinates
export async function calculateRoute(
  start: LatLng,
  end: LatLng,
  mode: TravelMode = 'driving',
  destinationName = 'Destination'
): Promise<RouteData | null> {
  // Public OSRM routing server
  // OSRM expects: /route/v1/{profile}/{lon1},{lat1};{lon2},{lat2}?overview=full&geometries=geojson&steps=true
  const profile = mode === 'cycling' ? 'cycling' : mode === 'walking' ? 'walking' : 'driving';
  const url = `https://router.project-osrm.org/route/v1/${profile}/${start[1]},${start[0]};${end[1]},${end[0]}?overview=full&geometries=geojson&steps=true`;

  try {
    let res = await fetch(url);
    if (!res.ok && profile !== 'driving') {
      // Fallback to driving profile if cycling/walking profile is unavailable on public server
      const fallbackUrl = `https://router.project-osrm.org/route/v1/driving/${start[1]},${start[0]};${end[1]},${end[0]}?overview=full&geometries=geojson&steps=true`;
      res = await fetch(fallbackUrl);
    }

    if (!res.ok) {
      throw new Error(`Routing request failed with status ${res.status}`);
    }

    const data = await res.json();
    if (!data.routes || data.routes.length === 0) {
      return null;
    }

    const route = data.routes[0];
    const geoCoordinates: LatLng[] = route.geometry.coordinates.map(
      (c: [number, number]) => [c[1], c[0]] as LatLng
    );

    let duration = route.duration; // seconds
    const distance = route.distance; // meters

    // Adjust duration if fell back to driving profile
    if (mode === 'walking') {
      // average walking speed ~ 4.8 km/h = 1.33 m/s
      duration = Math.round(distance / 1.33);
    } else if (mode === 'cycling') {
      // average cycling speed ~ 16 km/h = 4.44 m/s
      duration = Math.round(distance / 4.44);
    }

    // Parse turn-by-turn steps
    const rawLeg = route.legs?.[0];
    const rawSteps = rawLeg?.steps || [];
    const steps: RouteStep[] = rawSteps.map((step: any, idx: number) => {
      const maneuver = step.maneuver || {};
      const type = maneuver.type || 'continue';
      const modifier = maneuver.modifier || '';
      const street = step.name || '';
      const loc: LatLng = [maneuver.location[1], maneuver.location[0]];

      let instruction = '';
      if (type === 'depart') {
        instruction = street ? `Head toward ${street}` : 'Start route';
      } else if (type === 'arrive') {
        instruction = `Arrive at ${destinationName}`;
      } else if (type === 'turn') {
        const modClean = modifier.replace('-', ' ');
        instruction = street ? `Turn ${modClean} onto ${street}` : `Turn ${modClean}`;
      } else if (type === 'new name') {
        instruction = `Continue onto ${street || 'road'}`;
      } else if (type === 'roundabout' || type === 'rotary') {
        instruction = `Take exit ${maneuver.exit || 1} at the roundabout`;
      } else if (type === 'fork') {
        instruction = `Take the ${modifier || 'slight right'} fork`;
      } else {
        const modText = modifier ? ` ${modifier.replace('-', ' ')}` : '';
        instruction = street ? `Continue${modText} on ${street}` : `Continue${modText}`;
      }

      return {
        id: `step-${idx}`,
        instruction,
        distance: Math.round(step.distance || 0),
        duration: Math.round(step.duration || 0),
        modifier,
        type,
        location: loc,
        streetName: street,
      };
    });

    return {
      distance,
      duration,
      geometry: geoCoordinates,
      steps: steps.length > 0 ? steps : [
        {
          id: 'step-0',
          instruction: `Head toward ${destinationName}`,
          distance,
          duration,
          location: start,
          type: 'depart',
        },
        {
          id: 'step-1',
          instruction: `Arrive at ${destinationName}`,
          distance: 0,
          duration: 0,
          location: end,
          type: 'arrive',
        },
      ],
      startPoint: start,
      endPoint: end,
      destinationName,
    };
  } catch (error) {
    console.error('Calculate route error:', error);
    // Create a direct path fallback if routing server is temporarily unreachable
    const directDistance = calculateHaversineDistance(start, end);
    const fallbackSpeed = mode === 'walking' ? 1.33 : mode === 'cycling' ? 4.44 : 11.1; // m/s
    const fallbackDuration = Math.round(directDistance / fallbackSpeed);

    return {
      distance: directDistance,
      duration: fallbackDuration,
      geometry: [start, end],
      steps: [
        {
          id: 'step-direct-0',
          instruction: `Head toward ${destinationName}`,
          distance: directDistance,
          duration: fallbackDuration,
          location: start,
          type: 'depart',
        },
        {
          id: 'step-direct-1',
          instruction: `Arrive at ${destinationName}`,
          distance: 0,
          duration: 0,
          location: end,
          type: 'arrive',
        },
      ],
      startPoint: start,
      endPoint: end,
      destinationName,
    };
  }
}

// Format distance: 1.2 km or 450 m
export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(1)} km`;
}

// Format duration: 18 min or 1 h 24 min
export function formatDuration(seconds: number): string {
  const mins = Math.round(seconds / 60);
  if (mins < 60) {
    return `${mins} min`;
  }
  const hours = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  return remainingMins > 0 ? `${hours} h ${remainingMins} min` : `${hours} h`;
}

// Format ETA timestamp (e.g., "5:42 PM")
export function formatETA(durationSeconds: number): string {
  const arrival = new Date(Date.now() + durationSeconds * 1000);
  return arrival.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Haversine distance in meters
export function calculateHaversineDistance(p1: LatLng, p2: LatLng): number {
  const R = 6371e3; // Earth radius in meters
  const lat1 = (p1[0] * Math.PI) / 180;
  const lat2 = (p2[0] * Math.PI) / 180;
  const deltaLat = ((p2[0] - p1[0]) * Math.PI) / 180;
  const deltaLng = ((p2[1] - p1[1]) * Math.PI) / 180;

  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(R * c);
}
