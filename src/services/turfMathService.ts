import * as turf from '@turf/turf';
import { LatLng } from '../types';

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

// 1. Off-Route Distance in meters using Turf.js
export function getOffRouteDistance(currentPos: LatLng, geometry: LatLng[]): number {
  if (!geometry || geometry.length < 2) return 0;
  try {
    const pt = turf.point([currentPos[1], currentPos[0]]);
    const line = turf.lineString(geometry.map((c) => [c[1], c[0]]));
    const distKm = turf.pointToLineDistance(pt, line, { units: 'kilometers' });
    return Math.round(distKm * 1000);
  } catch (err) {
    console.warn('Turf off-route calculation error:', err);
    return 0;
  }
}

// 2. Map Matching / Snapping using Turf.js (snaps to nearest point on route line if within threshold)
export function snapToRoute(
  currentPos: LatLng,
  geometry: LatLng[],
  maxSnapDistanceMeters = 65
): { snapped: LatLng; distance: number; isSnapped: boolean; heading: number | null } {
  if (!geometry || geometry.length < 2) {
    return { snapped: currentPos, distance: 0, isSnapped: false, heading: null };
  }
  try {
    const pt = turf.point([currentPos[1], currentPos[0]]);
    const line = turf.lineString(geometry.map((c) => [c[1], c[0]]));
    const nearest = turf.nearestPointOnLine(line, pt, { units: 'kilometers' });
    const distMeters = Math.round((nearest.properties.dist ?? 0) * 1000);
    const index = nearest.properties.index ?? 0;

    let segmentHeading: number | null = null;
    if (index < geometry.length - 1) {
      segmentHeading = calculateBearing(geometry[index], geometry[index + 1]);
    } else if (geometry.length >= 2) {
      segmentHeading = calculateBearing(geometry[geometry.length - 2], geometry[geometry.length - 1]);
    }

    if (distMeters <= maxSnapDistanceMeters) {
      const [lng, lat] = nearest.geometry.coordinates;
      return { snapped: [lat, lng], distance: distMeters, isSnapped: true, heading: segmentHeading };
    }
    return { snapped: currentPos, distance: distMeters, isSnapped: false, heading: segmentHeading };
  } catch (err) {
    return { snapped: currentPos, distance: 0, isSnapped: false, heading: null };
  }
}

// 3. Local ETA & Remaining Distance Updating using Turf.js (turf.lineSlice & turf.length)
// Slices away the completed section of the route without making network API calls
export function calculateRemainingRouteTurf(
  currentPos: LatLng,
  geometry: LatLng[],
  destinationPos: LatLng
): { remainingDistanceMeters: number; snappedPos: LatLng; offRouteDistance: number } {
  if (!geometry || geometry.length < 2) {
    const directDist = calculateHaversineDistance(currentPos, destinationPos);
    return { remainingDistanceMeters: directDist, snappedPos: currentPos, offRouteDistance: 0 };
  }

  try {
    const pt = turf.point([currentPos[1], currentPos[0]]);
    const destPt = turf.point([destinationPos[1], destinationPos[0]]);
    const line = turf.lineString(geometry.map((c) => [c[1], c[0]]));

    const nearest = turf.nearestPointOnLine(line, pt, { units: 'kilometers' });
    const offRouteDist = Math.round((nearest.properties.dist ?? 0) * 1000);
    const [snappedLng, snappedLat] = nearest.geometry.coordinates;
    const snappedPt = turf.point([snappedLng, snappedLat]);

    const sliced = turf.lineSlice(snappedPt, destPt, line);
    const slicedLengthKm = turf.length(sliced, { units: 'kilometers' });
    const remainingDistanceMeters = Math.max(0, Math.round(slicedLengthKm * 1000));

    return {
      remainingDistanceMeters,
      snappedPos: [snappedLat, snappedLng],
      offRouteDistance: offRouteDist,
    };
  } catch (err) {
    const fallbackDist = calculateHaversineDistance(currentPos, destinationPos);
    return { remainingDistanceMeters: fallbackDist, snappedPos: currentPos, offRouteDistance: 0 };
  }
}

// Calculate bearing between two points in degrees using Turf
export function calculateBearing(start: LatLng, end: LatLng): number {
  try {
    const p1 = turf.point([start[1], start[0]]);
    const p2 = turf.point([end[1], end[0]]);
    const b = turf.bearing(p1, p2);
    return (b + 360) % 360;
  } catch {
    const lat1 = (start[0] * Math.PI) / 180;
    const lat2 = (end[0] * Math.PI) / 180;
    const dLng = ((end[1] - start[1]) * Math.PI) / 180;

    const y = Math.sin(dLng) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);

    const bearing = (Math.atan2(y, x) * 180) / Math.PI;
    return (bearing + 360) % 360;
  }
}

// Calculate the shortest signed angular difference (-180 to +180) between two bearings
export function getShortestAngleDiff(fromAngle: number, toAngle: number): number {
  return ((((toAngle - fromAngle) % 360) + 540) % 360) - 180;
}

// Exponential Moving Average angle smoother for smooth, jitter-free compass & road camera rotation
export function smoothAngle(currentAngle: number, targetAngle: number, factor = 0.35): number {
  const diff = getShortestAngleDiff(currentAngle, targetAngle);
  const smoothed = currentAngle + diff * factor;
  return (smoothed + 360) % 360;
}

// Calculate the road heading at a given coordinate along the route polyline using Turf
export function getRouteHeadingAtPoint(currentPos: LatLng, geometry: LatLng[]): number | null {
  if (!geometry || geometry.length < 2) return null;
  try {
    const pt = turf.point([currentPos[1], currentPos[0]]);
    const line = turf.lineString(geometry.map((c) => [c[1], c[0]]));
    const nearest = turf.nearestPointOnLine(line, pt, { units: 'kilometers' });
    const index = nearest.properties.index ?? 0;

    if (index < geometry.length - 1) {
      return calculateBearing(geometry[index], geometry[index + 1]);
    }
    return calculateBearing(geometry[geometry.length - 2], geometry[geometry.length - 1]);
  } catch {
    return null;
  }
}

/**
 * Splits a route polyline into two segments at the given current user/marker coordinate:
 * - passed: from route origin up to current position (rendered paled/grayed out)
 * - remaining: from current position to route destination (rendered vibrant active)
 */
export function splitRouteGeometry(
  currentPos: LatLng | null,
  geometry: LatLng[]
): {
  passed: LatLng[];
  remaining: LatLng[];
} {
  if (!geometry || geometry.length < 2) {
    return { passed: [], remaining: geometry || [] };
  }
  if (!currentPos) {
    return { passed: [], remaining: geometry };
  }

  try {
    const pt = turf.point([currentPos[1], currentPos[0]]);
    const line = turf.lineString(geometry.map((c) => [c[1], c[0]]));
    const nearest = turf.nearestPointOnLine(line, pt, { units: 'kilometers' });

    const nearestCoords = nearest.geometry.coordinates; // [lng, lat]
    const nearestIdx = nearest.properties.index ?? 0;

    // If near the very start of the route (< 15 meters and at index 0)
    const distToStart = calculateHaversineDistance(currentPos, geometry[0]);
    if (nearestIdx === 0 && distToStart < 15) {
      return { passed: [], remaining: geometry };
    }

    // If near the very end of the route
    const distToEnd = calculateHaversineDistance(currentPos, geometry[geometry.length - 1]);
    if (nearestIdx >= geometry.length - 2 && distToEnd < 15) {
      return { passed: geometry, remaining: [] };
    }

    const startPt = turf.point([geometry[0][1], geometry[0][0]]);
    const snappedPt = turf.point(nearestCoords);
    const endPt = turf.point([geometry[geometry.length - 1][1], geometry[geometry.length - 1][0]]);

    // turf.lineSlice creates sub-lineStrings
    const passedSlice = turf.lineSlice(startPt, snappedPt, line);
    const remainingSlice = turf.lineSlice(snappedPt, endPt, line);

    const passedCoords: LatLng[] = passedSlice.geometry.coordinates.map(
      (c: [number, number]) => [c[1], c[0]] as LatLng
    );
    const remainingCoords: LatLng[] = remainingSlice.geometry.coordinates.map(
      (c: [number, number]) => [c[1], c[0]] as LatLng
    );

    return {
      passed: passedCoords,
      remaining: remainingCoords,
    };
  } catch (err) {
    console.warn('Error splitting route geometry:', err);
    return { passed: [], remaining: geometry };
  }
}

/**
 * Pre-indexed route geometry with cumulative Turf distances in meters.
 * Enables allocation-free 60 FPS distance interpolation and deterministic
 * passed/remaining geometry splitting synchronized to the location dot.
 */
export interface IndexedRoute {
  key: string;
  geometry: LatLng[];
  line: ReturnType<typeof turf.lineString>;
  cumDistMeters: number[];
  totalMeters: number;
}

export function buildIndexedRoute(geometry: LatLng[]): IndexedRoute | null {
  if (!geometry || geometry.length < 2) return null;

  const lineCoords = geometry.map((c) => [c[1], c[0]] as [number, number]);
  const line = turf.lineString(lineCoords);
  const cumDistMeters: number[] = new Array(geometry.length);
  cumDistMeters[0] = 0;

  let total = 0;
  for (let i = 1; i < geometry.length; i++) {
    const p1 = turf.point(lineCoords[i - 1]);
    const p2 = turf.point(lineCoords[i]);
    const segLen = turf.distance(p1, p2, { units: 'meters' });
    total += isFinite(segLen) ? segLen : 0;
    cumDistMeters[i] = total;
  }

  const first = geometry[0];
  const last = geometry[geometry.length - 1];
  const key = `${geometry.length}:${Math.round(total)}:${first[0].toFixed(5)},${first[1].toFixed(5)}:${last[0].toFixed(5)},${last[1].toFixed(5)}`;

  return {
    key,
    geometry,
    line,
    cumDistMeters,
    totalMeters: total,
  };
}

/**
 * Finds the segment index containing `distMeters` via binary search.
 */
function findSegmentIndexForDistance(cumDistMeters: number[], distMeters: number): number {
  let lo = 0;
  let hi = cumDistMeters.length - 2;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (distMeters < cumDistMeters[mid]) {
      hi = mid - 1;
    } else if (distMeters > cumDistMeters[mid + 1]) {
      lo = mid + 1;
    } else {
      return mid;
    }
  }
  return Math.max(0, Math.min(cumDistMeters.length - 2, lo));
}

/**
 * Resolves the exact LatLng at `distMeters` along an IndexedRoute (60 FPS safe).
 */
export function getPointAtRouteDistance(indexed: IndexedRoute, distMeters: number): LatLng {
  const { geometry, cumDistMeters, totalMeters } = indexed;
  if (distMeters <= 0) return geometry[0];
  if (distMeters >= totalMeters) return geometry[geometry.length - 1];

  const segIdx = findSegmentIndexForDistance(cumDistMeters, distMeters);
  const segStartDist = cumDistMeters[segIdx];
  const segEndDist = cumDistMeters[segIdx + 1];
  const segLen = segEndDist - segStartDist;
  const t = segLen > 0.0001 ? (distMeters - segStartDist) / segLen : 0;

  const p1 = geometry[segIdx];
  const p2 = geometry[segIdx + 1];
  return [
    p1[0] + (p2[0] - p1[0]) * t,
    p1[1] + (p2[1] - p1[1]) * t,
  ];
}

/**
 * Resolves the forward road bearing at `distMeters` along an IndexedRoute.
 */
export function getHeadingAtRouteDistance(indexed: IndexedRoute, distMeters: number): number | null {
  const { geometry, cumDistMeters, totalMeters } = indexed;
  if (geometry.length < 2) return null;
  const clamped = Math.max(0, Math.min(totalMeters, distMeters));
  const segIdx = findSegmentIndexForDistance(cumDistMeters, clamped);

  // If the current segment is extremely short (< 1.5m), look ahead slightly for stable heading
  for (let i = segIdx; i < geometry.length - 1; i++) {
    const segLen = cumDistMeters[i + 1] - cumDistMeters[i];
    if (segLen >= 1.5 || i === geometry.length - 2) {
      return calculateBearing(geometry[i], geometry[i + 1]);
    }
  }
  return calculateBearing(geometry[geometry.length - 2], geometry[geometry.length - 1]);
}

/**
 * Snaps a GPS position to an IndexedRoute in a single Turf pass, returning
 * exact distance along the route, remaining distance, off-route distance, and tangent heading.
 */
export function snapPointToIndexedRoute(
  currentPos: LatLng,
  indexed: IndexedRoute
): {
  snappedPos: LatLng;
  distAlongMeters: number;
  remainingDistanceMeters: number;
  offRouteDistance: number;
  routeTangent: number | null;
} {
  try {
    const pt = turf.point([currentPos[1], currentPos[0]]);
    const nearest = turf.nearestPointOnLine(indexed.line, pt, { units: 'meters' });
    const offRouteDistance = Math.round(nearest.properties.dist ?? 0);
    const [snappedLng, snappedLat] = nearest.geometry.coordinates;
    const snappedPos: LatLng = [snappedLat, snappedLng];

    const segIdx = Math.max(
      0,
      Math.min(indexed.geometry.length - 2, nearest.properties.index ?? 0)
    );
    const segStartCoord = indexed.geometry[segIdx];
    const segStartPt = turf.point([segStartCoord[1], segStartCoord[0]]);
    const snappedPt = turf.point([snappedLng, snappedLat]);
    const distIntoSeg = turf.distance(segStartPt, snappedPt, { units: 'meters' });

    const distAlongMeters = Math.max(
      0,
      Math.min(
        indexed.totalMeters,
        indexed.cumDistMeters[segIdx] + (isFinite(distIntoSeg) ? distIntoSeg : 0)
      )
    );
    const remainingDistanceMeters = Math.max(0, Math.round(indexed.totalMeters - distAlongMeters));
    const routeTangent = getHeadingAtRouteDistance(indexed, distAlongMeters);

    return {
      snappedPos,
      distAlongMeters,
      remainingDistanceMeters,
      offRouteDistance,
      routeTangent,
    };
  } catch {
    const fallbackRemaining = calculateHaversineDistance(
      currentPos,
      indexed.geometry[indexed.geometry.length - 1]
    );
    return {
      snappedPos: currentPos,
      distAlongMeters: 0,
      remainingDistanceMeters: fallbackRemaining,
      offRouteDistance: 0,
      routeTangent: null,
    };
  }
}

/**
 * Deterministically splits an IndexedRoute into `passed` and `remaining` coordinate arrays
 * right at `distMeters`, ensuring passed geometry never extends ahead of the location dot.
 */
export function splitIndexedRouteAtDistance(
  indexed: IndexedRoute,
  distMeters: number
): { passed: LatLng[]; remaining: LatLng[] } {
  const { geometry, cumDistMeters, totalMeters } = indexed;
  if (geometry.length < 2) {
    return { passed: [], remaining: geometry };
  }
  if (distMeters <= 0.5) {
    return { passed: [], remaining: geometry };
  }
  if (distMeters >= totalMeters - 0.5) {
    return { passed: geometry, remaining: [] };
  }

  const segIdx = findSegmentIndexForDistance(cumDistMeters, distMeters);
  const splitPoint = getPointAtRouteDistance(indexed, distMeters);

  const passed: LatLng[] = geometry.slice(0, segIdx + 1);
  passed.push(splitPoint);

  const remaining: LatLng[] = [splitPoint];
  for (let i = segIdx + 1; i < geometry.length; i++) {
    remaining.push(geometry[i]);
  }

  return { passed, remaining };
}


