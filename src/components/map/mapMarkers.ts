import React from 'react';
import { Map as MapLibreMap, Marker } from 'maplibre-gl';
import { LatLng, UserLocation } from '../../types';
import {
  IndexedRoute,
  calculateHaversineDistance,
  getPointAtRouteDistance,
  getShortestAngleDiff,
} from '../../services/turfMathService';

export interface MarkerRefs {
  userMarker: Marker | null;
  destMarker: Marker | null;
}

export type MarkerFrameCallback = (pos: LatLng, routeDistMeters: number | null) => void;

interface UserMarkerAnimationState {
  rafId: number | null;
  mode: 'route' | 'coords';
  routeKey: string | null;
  indexedRoute: IndexedRoute | null;
  // Route-distance interpolation state (meters)
  startDist: number;
  currentDist: number;
  targetDist: number;
  // Coordinate fallback interpolation state
  startLng: number;
  startLat: number;
  currentLng: number;
  currentLat: number;
  targetLng: number;
  targetLat: number;
  // Timing & pacing
  startTime: number;
  duration: number;
  smoothedCadenceMs: number;
  speed: number;
  lastUpdateTimestamp: number;
  lastFrameCallbackTime: number;
  onFrame: MarkerFrameCallback | null;
  // Unwrapped heading angle (degrees clockwise from True North)
  unwrappedHeading: number | null;
}

const markerAnimState: UserMarkerAnimationState = {
  rafId: null,
  mode: 'coords',
  routeKey: null,
  indexedRoute: null,
  startDist: 0,
  currentDist: 0,
  targetDist: 0,
  startLng: 0,
  startLat: 0,
  currentLng: 0,
  currentLat: 0,
  targetLng: 0,
  targetLat: 0,
  startTime: 0,
  duration: 1000,
  smoothedCadenceMs: 950,
  speed: 0,
  lastUpdateTimestamp: 0,
  lastFrameCallbackTime: 0,
  onFrame: null,
  unwrappedHeading: null,
};

/**
 * Returns the current live visual coordinates and route distance of the user dot.
 */
export function getVisualMarkerState(): {
  pos: LatLng | null;
  routeDistMeters: number | null;
} {
  if (markerAnimState.currentLat === 0 && markerAnimState.currentLng === 0) {
    return { pos: null, routeDistMeters: null };
  }
  return {
    pos: [markerAnimState.currentLat, markerAnimState.currentLng],
    routeDistMeters: markerAnimState.mode === 'route' ? markerAnimState.currentDist : null,
  };
}

export function getMarkerGlideDuration(): number {
  return Math.min(Math.max(Math.round(markerAnimState.smoothedCadenceMs * 1.04), 450), 1850);
}

/**
 * Keeps the directional blue heading cone orbiting accurately around the center dot
 * in true map-relative orientation (`heading - map.getBearing()`), preventing wraparound flips.
 */
export function syncUserMarkerHeadingRotation(
  map: MapLibreMap,
  userMarkerRef: React.MutableRefObject<Marker | null>,
  targetHeading?: number | null
) {
  const marker = userMarkerRef.current;
  if (!marker) return;

  const el = marker.getElement();
  const coneWrapper = el.querySelector('.heading-cone-wrapper') as HTMLElement | null;
  if (!coneWrapper) return;

  if (typeof targetHeading === 'number' && !isNaN(targetHeading)) {
    if (markerAnimState.unwrappedHeading === null) {
      markerAnimState.unwrappedHeading = targetHeading;
    } else {
      const diff = getShortestAngleDiff(
        ((markerAnimState.unwrappedHeading % 360) + 360) % 360,
        targetHeading
      );
      markerAnimState.unwrappedHeading += diff;
    }

    const screenAngle = markerAnimState.unwrappedHeading - map.getBearing();
    coneWrapper.style.opacity = '1';
    coneWrapper.style.transform = `rotate(${screenAngle}deg)`;
  } else {
    coneWrapper.style.opacity = '0';
  }
}

/**
 * Creates or updates the User Location GPS marker with accuracy pulse & rotating heading arrow.
 * In navigation mode, interpolates smoothly at 60 FPS *along the Turf IndexedRoute polyline*
 * and invokes `onFrame` on each visual step so passed-route paling never advances ahead of the dot.
 */
export function updateUserLocationMarker(
  map: MapLibreMap,
  userMarkerRef: React.MutableRefObject<Marker | null>,
  userLocation: UserLocation | null,
  activeNavLocation: LatLng | null,
  isNavigating: boolean,
  targetHeading?: number | null,
  speedKmh?: number,
  indexedRoute?: IndexedRoute | null,
  targetRouteDistMeters?: number | null,
  onFrame?: MarkerFrameCallback
) {
  const activeLoc: LatLng | null =
    isNavigating && activeNavLocation
      ? activeNavLocation
      : userLocation
      ? [userLocation.lat, userLocation.lng]
      : null;

  if (!activeLoc) {
    if (markerAnimState.rafId) {
      cancelAnimationFrame(markerAnimState.rafId);
      markerAnimState.rafId = null;
    }
    markerAnimState.lastUpdateTimestamp = 0;
    markerAnimState.routeKey = null;
    markerAnimState.indexedRoute = null;
    markerAnimState.unwrappedHeading = null;
    if (userMarkerRef.current) {
      userMarkerRef.current.remove();
      userMarkerRef.current = null;
    }
    return;
  }

  const heading =
    isNavigating && targetHeading !== null && targetHeading !== undefined
      ? targetHeading
      : userLocation?.heading;

  const currentSpeed = typeof speedKmh === 'number' ? speedKmh : userLocation?.speed || 0;
  markerAnimState.speed = currentSpeed;
  markerAnimState.onFrame = onFrame || null;
  markerAnimState.indexedRoute = indexedRoute || null;

  if (!userMarkerRef.current) {
    const el = document.createElement('div');
    el.className = 'user-location-marker relative flex items-center justify-center pointer-events-none';
    el.style.width = '36px';
    el.style.height = '36px';

    el.innerHTML = `
      <div class="accuracy-pulse absolute inset-0 rounded-full bg-sky-500/25 animate-ping"></div>
      <div class="heading-cone-wrapper absolute inset-0 flex items-start justify-center pointer-events-none opacity-0 transition-opacity duration-200" style="transform-origin: center center;">
        <div class="w-0 h-0 -mt-1.5 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-b-[10px] border-b-sky-400 drop-shadow-[0_0_4px_rgba(56,189,248,0.85)]"></div>
      </div>
      <div class="center-dot w-4 h-4 rounded-full bg-sky-400 border-2 border-white shadow-[0_0_12px_rgba(56,189,248,0.9)] relative z-10"></div>
    `;

    const initPos: LatLng =
      isNavigating && indexedRoute && targetRouteDistMeters !== null && targetRouteDistMeters !== undefined
        ? getPointAtRouteDistance(indexedRoute, targetRouteDistMeters)
        : activeLoc;

    const marker = new Marker({ element: el, anchor: 'center' })
      .setLngLat([initPos[1], initPos[0]])
      .addTo(map);

    userMarkerRef.current = marker;
    markerAnimState.startLng = initPos[1];
    markerAnimState.startLat = initPos[0];
    markerAnimState.currentLng = initPos[1];
    markerAnimState.currentLat = initPos[0];
    markerAnimState.targetLng = initPos[1];
    markerAnimState.targetLat = initPos[0];
    markerAnimState.routeKey = indexedRoute?.key ?? null;

    if (indexedRoute && targetRouteDistMeters !== null && targetRouteDistMeters !== undefined) {
      markerAnimState.mode = 'route';
      markerAnimState.startDist = targetRouteDistMeters;
      markerAnimState.currentDist = targetRouteDistMeters;
      markerAnimState.targetDist = targetRouteDistMeters;
    } else {
      markerAnimState.mode = 'coords';
    }

    syncUserMarkerHeadingRotation(map, userMarkerRef, heading);
    return;
  }

  const marker = userMarkerRef.current;

  if (!isNavigating) {
    // Idle mode: immediate update
    if (markerAnimState.rafId) {
      cancelAnimationFrame(markerAnimState.rafId);
      markerAnimState.rafId = null;
    }
    marker.setLngLat([activeLoc[1], activeLoc[0]]);
    markerAnimState.currentLng = activeLoc[1];
    markerAnimState.currentLat = activeLoc[0];
    markerAnimState.targetLng = activeLoc[1];
    markerAnimState.targetLat = activeLoc[0];
    markerAnimState.lastUpdateTimestamp = 0;
    markerAnimState.routeKey = null;
    markerAnimState.mode = 'coords';
    syncUserMarkerHeadingRotation(map, userMarkerRef, heading);
    return;
  }

  const now = performance.now();
  const useRouteInterpolation =
    Boolean(indexedRoute) &&
    targetRouteDistMeters !== null &&
    targetRouteDistMeters !== undefined;

  if (useRouteInterpolation && indexedRoute && targetRouteDistMeters !== null && targetRouteDistMeters !== undefined) {
    const isNewRoute = markerAnimState.routeKey !== indexedRoute.key;
    const wasCoordsMode = markerAnimState.mode !== 'route';

    if (isNewRoute) {
      // Reroute or navigation start: reset route tracking smoothly
      if (markerAnimState.rafId) {
        cancelAnimationFrame(markerAnimState.rafId);
        markerAnimState.rafId = null;
      }
      markerAnimState.routeKey = indexedRoute.key;
      markerAnimState.mode = 'route';

      const pt = getPointAtRouteDistance(indexedRoute, targetRouteDistMeters);
      markerAnimState.startDist = targetRouteDistMeters;
      markerAnimState.currentDist = targetRouteDistMeters;
      markerAnimState.targetDist = targetRouteDistMeters;
      markerAnimState.currentLat = pt[0];
      markerAnimState.currentLng = pt[1];
      marker.setLngLat([pt[1], pt[0]]);
      markerAnimState.onFrame?.(pt, targetRouteDistMeters);
      markerAnimState.lastUpdateTimestamp = now;
    } else {
      markerAnimState.mode = 'route';
      const curDist = wasCoordsMode ? targetRouteDistMeters : markerAnimState.currentDist;

      // Ignore duplicate React renders with unchanged target distance
      if (!wasCoordsMode && Math.abs(targetRouteDistMeters - markerAnimState.targetDist) < 0.05) {
        syncUserMarkerHeadingRotation(map, userMarkerRef, heading);
        return;
      }

      // Suppress tiny backward GPS noise (< 12m) when stationary or creeping
      let effectiveTargetDist = targetRouteDistMeters;
      if (!wasCoordsMode && effectiveTargetDist < curDist && curDist - effectiveTargetDist < 12) {
        effectiveTargetDist = curDist;
      }

      const deltaMeters = Math.abs(effectiveTargetDist - curDist);

      const rawDeltaMs =
        markerAnimState.lastUpdateTimestamp > 0 ? now - markerAnimState.lastUpdateTimestamp : 950;
      markerAnimState.lastUpdateTimestamp = now;
      if (rawDeltaMs >= 200 && rawDeltaMs <= 3000) {
        const clamped = Math.min(Math.max(rawDeltaMs, 400), 1800);
        markerAnimState.smoothedCadenceMs = 0.35 * clamped + 0.65 * markerAnimState.smoothedCadenceMs;
      }

      if (deltaMeters > 600 || wasCoordsMode) {
        if (markerAnimState.rafId) {
          cancelAnimationFrame(markerAnimState.rafId);
          markerAnimState.rafId = null;
        }
        const pt = getPointAtRouteDistance(indexedRoute, effectiveTargetDist);
        markerAnimState.startDist = effectiveTargetDist;
        markerAnimState.currentDist = effectiveTargetDist;
        markerAnimState.targetDist = effectiveTargetDist;
        markerAnimState.currentLat = pt[0];
        markerAnimState.currentLng = pt[1];
        marker.setLngLat([pt[1], pt[0]]);
        markerAnimState.onFrame?.(pt, effectiveTargetDist);
        syncUserMarkerHeadingRotation(map, userMarkerRef, heading);
        return;
      }

      if (deltaMeters < 0.05) {
        if (markerAnimState.rafId) {
          cancelAnimationFrame(markerAnimState.rafId);
          markerAnimState.rafId = null;
        }
        const pt = getPointAtRouteDistance(indexedRoute, effectiveTargetDist);
        markerAnimState.currentDist = effectiveTargetDist;
        markerAnimState.targetDist = effectiveTargetDist;
        markerAnimState.currentLat = pt[0];
        markerAnimState.currentLng = pt[1];
        marker.setLngLat([pt[1], pt[0]]);
        markerAnimState.onFrame?.(pt, effectiveTargetDist);
        syncUserMarkerHeadingRotation(map, userMarkerRef, heading);
        return;
      }

      if (markerAnimState.rafId) {
        cancelAnimationFrame(markerAnimState.rafId);
      }

      markerAnimState.startDist = curDist;
      markerAnimState.targetDist = effectiveTargetDist;
      markerAnimState.startTime = now;
      // 4% overlap prevents micro-pauses just before the next GPS packet arrives
      markerAnimState.duration = Math.min(Math.max(markerAnimState.smoothedCadenceMs * 1.04, 450), 1850);

      const animateRouteGlide = (frameTime: number) => {
        const activeIdxRoute = markerAnimState.indexedRoute;
        if (!activeIdxRoute) {
          markerAnimState.rafId = null;
          return;
        }

        const elapsed = frameTime - markerAnimState.startTime;
        const progress = elapsed / markerAnimState.duration;
        const distSpan = markerAnimState.targetDist - markerAnimState.startDist;
        let nextDist: number;
        let shouldContinue = false;

        if (progress <= 1) {
          nextDist = markerAnimState.startDist + distSpan * progress;
          shouldContinue = true;
        } else if (markerAnimState.speed >= 3 && distSpan > 0) {
          // Gentle along-route coasting capped at 0.3 (~300ms) so marker never freezes between packets
          const extra = Math.min(progress - 1, 0.3);
          const dampedExtra = extra * Math.exp(-extra * 4);
          nextDist = Math.min(
            activeIdxRoute.totalMeters,
            markerAnimState.targetDist + distSpan * dampedExtra
          );
          shouldContinue = extra < 0.3 && nextDist < activeIdxRoute.totalMeters;
        } else {
          nextDist = markerAnimState.targetDist;
          shouldContinue = false;
        }

        const pt = getPointAtRouteDistance(activeIdxRoute, nextDist);
        markerAnimState.currentDist = nextDist;
        markerAnimState.currentLat = pt[0];
        markerAnimState.currentLng = pt[1];
        marker.setLngLat([pt[1], pt[0]]);

        // Synchronize passed-route paling directly to the dot's visual route distance (throttled ~30fps)
        if (!shouldContinue || frameTime - markerAnimState.lastFrameCallbackTime >= 33) {
          markerAnimState.lastFrameCallbackTime = frameTime;
          markerAnimState.onFrame?.(pt, nextDist);
        }

        if (shouldContinue) {
          markerAnimState.rafId = requestAnimationFrame(animateRouteGlide);
        } else {
          markerAnimState.rafId = null;
        }
      };

      markerAnimState.rafId = requestAnimationFrame(animateRouteGlide);
    }
  } else {
    // Off-route or unindexed coordinate fallback: 60 FPS smooth coordinate glide
    markerAnimState.mode = 'coords';
    const targetLng = activeLoc[1];
    const targetLat = activeLoc[0];

    // Ignore duplicate target calls
    const targetShiftMeters = calculateHaversineDistance(
      [markerAnimState.targetLat, markerAnimState.targetLng],
      activeLoc
    );
    if (markerAnimState.rafId && targetShiftMeters < 0.1) {
      syncUserMarkerHeadingRotation(map, userMarkerRef, heading);
      return;
    }

    const curLngLat = marker.getLngLat();
    const currentLng = curLngLat.lng;
    const currentLat = curLngLat.lat;
    const moveMeters = calculateHaversineDistance([currentLat, currentLng], activeLoc);

    const rawDeltaMs =
      markerAnimState.lastUpdateTimestamp > 0 ? now - markerAnimState.lastUpdateTimestamp : 950;
    markerAnimState.lastUpdateTimestamp = now;
    if (rawDeltaMs >= 200 && rawDeltaMs <= 3000) {
      const clamped = Math.min(Math.max(rawDeltaMs, 400), 1800);
      markerAnimState.smoothedCadenceMs = 0.35 * clamped + 0.65 * markerAnimState.smoothedCadenceMs;
    }

    if (moveMeters > 600) {
      if (markerAnimState.rafId) {
        cancelAnimationFrame(markerAnimState.rafId);
        markerAnimState.rafId = null;
      }
      marker.setLngLat([targetLng, targetLat]);
      markerAnimState.startLng = targetLng;
      markerAnimState.startLat = targetLat;
      markerAnimState.currentLng = targetLng;
      markerAnimState.currentLat = targetLat;
      markerAnimState.targetLng = targetLng;
      markerAnimState.targetLat = targetLat;
    } else if (moveMeters < 0.1) {
      if (markerAnimState.rafId) {
        cancelAnimationFrame(markerAnimState.rafId);
        markerAnimState.rafId = null;
      }
      marker.setLngLat([targetLng, targetLat]);
      markerAnimState.currentLng = targetLng;
      markerAnimState.currentLat = targetLat;
      markerAnimState.targetLng = targetLng;
      markerAnimState.targetLat = targetLat;
    } else {
      if (markerAnimState.rafId) {
        cancelAnimationFrame(markerAnimState.rafId);
      }

      markerAnimState.startLng = currentLng;
      markerAnimState.startLat = currentLat;
      markerAnimState.targetLng = targetLng;
      markerAnimState.targetLat = targetLat;
      markerAnimState.startTime = now;
      markerAnimState.duration = Math.min(Math.max(markerAnimState.smoothedCadenceMs * 1.04, 450), 1850);

      const animateCoordGlide = (frameTime: number) => {
        const elapsed = frameTime - markerAnimState.startTime;
        const progress = elapsed / markerAnimState.duration;
        let nextLng: number;
        let nextLat: number;
        let shouldContinue = false;

        if (progress <= 1) {
          nextLng =
            markerAnimState.startLng + (markerAnimState.targetLng - markerAnimState.startLng) * progress;
          nextLat =
            markerAnimState.startLat + (markerAnimState.targetLat - markerAnimState.startLat) * progress;
          shouldContinue = true;
        } else if (markerAnimState.speed >= 4) {
          const extra = Math.min(progress - 1, 0.25);
          const dampedExtra = extra * Math.exp(-extra * 4);
          nextLng =
            markerAnimState.targetLng + (markerAnimState.targetLng - markerAnimState.startLng) * dampedExtra;
          nextLat =
            markerAnimState.targetLat + (markerAnimState.targetLat - markerAnimState.startLat) * dampedExtra;
          shouldContinue = extra < 0.25;
        } else {
          nextLng = markerAnimState.targetLng;
          nextLat = markerAnimState.targetLat;
          shouldContinue = false;
        }

        markerAnimState.currentLng = nextLng;
        markerAnimState.currentLat = nextLat;
        marker.setLngLat([nextLng, nextLat]);

        if (shouldContinue) {
          markerAnimState.rafId = requestAnimationFrame(animateCoordGlide);
        } else {
          markerAnimState.rafId = null;
        }
      };

      markerAnimState.rafId = requestAnimationFrame(animateCoordGlide);
    }
  }

  syncUserMarkerHeadingRotation(map, userMarkerRef, heading);
}

/**
 * Creates or updates the Destination Pin marker.
 * The bottom pointer tip of the pin is anchored strictly at the exact dropped coordinate.
 * Any scaling transforms grow upwards from the needle tip (origin: 16px 44px).
 */
export function updateDestinationMarker(
  map: MapLibreMap,
  destMarkerRef: React.MutableRefObject<Marker | null>,
  destination: { lat: number; lng: number; name: string } | null,
  isNavigating: boolean,
  onMapClick: (coords: LatLng) => void
) {
  if (!destination) {
    if (destMarkerRef.current) {
      destMarkerRef.current.remove();
      destMarkerRef.current = null;
    }
    return;
  }

  if (!destMarkerRef.current) {
    const el = document.createElement('div');
    el.className = 'destination-marker cursor-grab active:cursor-grabbing transition-transform duration-200 hover:scale-110 animate-in fade-in zoom-in-75 duration-200';
    el.style.width = '32px';
    el.style.height = '44px';
    el.style.transformOrigin = '16px 44px'; // Strictly pivot around the needle tip

    // Crisp SVG Pin with needle tip terminating precisely at bottom-center (16px, 44px)
    el.innerHTML = `
      <svg width="32" height="44" viewBox="0 0 32 44" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:block; overflow:visible;">
        <!-- Needle shadow -->
        <ellipse cx="16" cy="43.5" rx="3.5" ry="1.2" fill="rgba(0,0,0,0.6)" />
        <!-- Pin Body -->
        <path d="M16 43.5 C 16 43.5, 2.5 24, 2.5 15 C 2.5 7.544 8.544 1.5 16 1.5 C 23.456 1.5 29.5 7.544 29.5 15 C 29.5 24, 16 43.5, 16 43.5 Z" fill="#0ea5e9" stroke="#000000" stroke-width="2.5" stroke-linejoin="round"/>
        <!-- Inner Core -->
        <circle cx="16" cy="15" r="5" fill="#ffffff" stroke="#0284c7" stroke-width="1.5"/>
      </svg>
    `;

    const marker = new Marker({
      element: el,
      draggable: !isNavigating,
      anchor: 'bottom', // Anchors (16px, 44px) to the exact GPS coordinate
    })
      .setLngLat([destination.lng, destination.lat])
      .addTo(map);

    marker.on('dragend', () => {
      const lngLat = marker.getLngLat();
      onMapClick([lngLat.lat, lngLat.lng]);
    });

    destMarkerRef.current = marker;
  } else {
    destMarkerRef.current.setLngLat([destination.lng, destination.lat]);
    destMarkerRef.current.setDraggable(!isNavigating);
  }
}
