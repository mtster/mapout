import { LatLng, RouteData, RouteStep, TravelMode } from '../types';
import { calculateHaversineDistance } from './turfMathService';

// Calculate route between start and end coordinates
export async function calculateRoute(
  start: LatLng,
  end: LatLng,
  mode: TravelMode = 'driving',
  destinationName = 'Destination'
): Promise<RouteData | null> {
  // Use OpenStreetMap dedicated routing profiles for authentic vehicle routing
  // routed-car for driving, routed-bike for cycling paths, routed-foot for pedestrian paths
  const osmProfile = mode === 'cycling' ? 'routed-bike' : mode === 'walking' ? 'routed-foot' : 'routed-car';
  const primaryUrl = `https://routing.openstreetmap.de/${osmProfile}/route/v1/driving/${start[1]},${start[0]};${end[1]},${end[0]}?overview=full&geometries=geojson&steps=true`;
  const fallbackUrl = `https://router.project-osrm.org/route/v1/driving/${start[1]},${start[0]};${end[1]},${end[0]}?overview=full&geometries=geojson&steps=true`;

  try {
    let res: Response;
    let isFallback = false;
    try {
      res = await fetch(primaryUrl);
      if (!res.ok) throw new Error('Primary routing error');
    } catch {
      // Fallback to project-osrm driving endpoint
      res = await fetch(fallbackUrl);
      isFallback = true;
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

    // Adjust duration ONLY if fell back to generic driving server
    if (isFallback) {
      if (mode === 'walking') {
        // average walking speed ~ 4.8 km/h = 1.33 m/s
        duration = Math.round(distance / 1.33);
      } else if (mode === 'cycling') {
        // average cycling speed ~ 16 km/h = 4.44 m/s
        duration = Math.round(distance / 4.44);
      }
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
