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
  maxSnapDistanceMeters = 35
): { snapped: LatLng; distance: number } {
  if (!geometry || geometry.length < 2) {
    return { snapped: currentPos, distance: 0 };
  }
  try {
    const pt = turf.point([currentPos[1], currentPos[0]]);
    const line = turf.lineString(geometry.map((c) => [c[1], c[0]]));
    const nearest = turf.nearestPointOnLine(line, pt, { units: 'kilometers' });
    const distMeters = Math.round((nearest.properties.dist ?? 0) * 1000);

    if (distMeters <= maxSnapDistanceMeters) {
      const [lng, lat] = nearest.geometry.coordinates;
      return { snapped: [lat, lng], distance: distMeters };
    }
    return { snapped: currentPos, distance: distMeters };
  } catch (err) {
    return { snapped: currentPos, distance: 0 };
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
