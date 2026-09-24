import React from 'react';
import { Map as MapLibreMap, Marker } from 'maplibre-gl';
import { LatLng, UserLocation } from '../../types';

export interface MarkerRefs {
  userMarker: Marker | null;
  destMarker: Marker | null;
}

interface UserMarkerAnimationState {
  rafId: number | null;
  startLng: number;
  startLat: number;
  targetLng: number;
  targetLat: number;
  startTime: number;
  duration: number;
  speed: number;
  lastUpdateTimestamp: number;
}

const markerAnimState: UserMarkerAnimationState = {
  rafId: null,
  startLng: 0,
  startLat: 0,
  targetLng: 0,
  targetLat: 0,
  startTime: 0,
  duration: 1000,
  speed: 0,
  lastUpdateTimestamp: 0,
};

/**
 * Creates or updates the User Location GPS marker with accuracy pulse & rotating heading cone.
 * In navigation mode, uses continuous 60 FPS constant-speed linear interpolation with dead-reckoning
 * forward extrapolation so the marker never teleports or lags behind during high-speed driving.
 */
export function updateUserLocationMarker(
  map: MapLibreMap,
  userMarkerRef: React.MutableRefObject<Marker | null>,
  userLocation: UserLocation | null,
  activeNavLocation: LatLng | null,
  isNavigating: boolean,
  targetHeading?: number | null,
  speedKmh?: number
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

  const currentSpeed = typeof speedKmh === 'number' ? speedKmh : (userLocation?.speed || 0);

  if (!userMarkerRef.current) {
    const el = document.createElement('div');
    el.className = 'user-location-marker relative flex items-center justify-center pointer-events-none';
    el.style.width = '36px';
    el.style.height = '36px';

    el.innerHTML = `
      <div class="accuracy-pulse absolute inset-0 rounded-full bg-sky-500/25 animate-ping"></div>
      <div class="heading-cone absolute -top-2 w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-b-[10px] border-b-sky-400 opacity-0 transition-opacity"></div>
      <div class="center-dot w-4 h-4 rounded-full bg-sky-400 border-2 border-white shadow-[0_0_12px_rgba(56,189,248,0.9)] relative z-10"></div>
    `;

    const marker = new Marker({ element: el, anchor: 'center' })
      .setLngLat([activeLoc[1], activeLoc[0]])
      .addTo(map);

    userMarkerRef.current = marker;
    markerAnimState.startLng = activeLoc[1];
    markerAnimState.startLat = activeLoc[0];
    markerAnimState.targetLng = activeLoc[1];
    markerAnimState.targetLat = activeLoc[0];
  } else {
    const marker = userMarkerRef.current;
    const targetLng = activeLoc[1];
    const targetLat = activeLoc[0];

    if (!isNavigating) {
      // Idle mode: immediate update
      if (markerAnimState.rafId) {
        cancelAnimationFrame(markerAnimState.rafId);
        markerAnimState.rafId = null;
      }
      marker.setLngLat([targetLng, targetLat]);
      markerAnimState.lastUpdateTimestamp = 0;
    } else {
      // Navigation mode: 60 FPS continuous glide with constant speed
      const now = performance.now();
      const timeDelta =
        markerAnimState.lastUpdateTimestamp > 0
          ? now - markerAnimState.lastUpdateTimestamp
          : 1000;
      markerAnimState.lastUpdateTimestamp = now;

      // Pacing duration adapts dynamically to device GPS interval (bounded between 500ms and 1800ms)
      const dynamicDuration = Math.min(Math.max(timeDelta, 500), 1800);

      const curLngLat = marker.getLngLat();
      const currentLng = curLngLat.lng;
      const currentLat = curLngLat.lat;

      const dLng = targetLng - currentLng;
      const dLat = targetLat - currentLat;
      const distSq = dLng * dLng + dLat * dLat;

      // If position jumped dramatically (e.g. initial start, > 500m), snap directly
      if (distSq > 0.0005) {
        if (markerAnimState.rafId) {
          cancelAnimationFrame(markerAnimState.rafId);
          markerAnimState.rafId = null;
        }
        marker.setLngLat([targetLng, targetLat]);
        markerAnimState.startLng = targetLng;
        markerAnimState.startLat = targetLat;
        markerAnimState.targetLng = targetLng;
        markerAnimState.targetLat = targetLat;
      } else if (distSq < 0.000000005) {
        // Less than ~0.2m movement: lock without continuous animation loop
        if (markerAnimState.rafId) {
          cancelAnimationFrame(markerAnimState.rafId);
          markerAnimState.rafId = null;
        }
        marker.setLngLat([targetLng, targetLat]);
      } else {
        // Start smooth constant-speed interpolation towards target
        if (markerAnimState.rafId) {
          cancelAnimationFrame(markerAnimState.rafId);
        }

        markerAnimState.startLng = currentLng;
        markerAnimState.startLat = currentLat;
        markerAnimState.targetLng = targetLng;
        markerAnimState.targetLat = targetLat;
        markerAnimState.startTime = now;
        markerAnimState.duration = dynamicDuration;
        markerAnimState.speed = currentSpeed;

        const animateGlide = (frameTime: number) => {
          const elapsed = frameTime - markerAnimState.startTime;
          const progress = elapsed / markerAnimState.duration;

          if (progress <= 1) {
            const interpolatedLng =
              markerAnimState.startLng + (markerAnimState.targetLng - markerAnimState.startLng) * progress;
            const interpolatedLat =
              markerAnimState.startLat + (markerAnimState.targetLat - markerAnimState.startLat) * progress;
            marker.setLngLat([interpolatedLng, interpolatedLat]);
            markerAnimState.rafId = requestAnimationFrame(animateGlide);
          } else if (markerAnimState.speed >= 5) {
            // Forward dead-reckoning extrapolation only when actively moving (>= 5 km/h)
            // Capped at 0.3 (300ms) with exponential velocity decay to prevent wandering off road
            const extra = Math.min(progress - 1, 0.3);
            const dampedExtra = extra * Math.exp(-extra * 4);
            const deltaLng = markerAnimState.targetLng - markerAnimState.startLng;
            const deltaLat = markerAnimState.targetLat - markerAnimState.startLat;
            const extrapolatedLng = markerAnimState.targetLng + deltaLng * dampedExtra;
            const extrapolatedLat = markerAnimState.targetLat + deltaLat * dampedExtra;
            marker.setLngLat([extrapolatedLng, extrapolatedLat]);

            if (extra < 0.3) {
              markerAnimState.rafId = requestAnimationFrame(animateGlide);
            } else {
              markerAnimState.rafId = null;
            }
          } else {
            // When stopped or slow (speed < 5 km/h), lock firmly at target without drifting
            marker.setLngLat([markerAnimState.targetLng, markerAnimState.targetLat]);
            markerAnimState.rafId = null;
          }
        };

        markerAnimState.rafId = requestAnimationFrame(animateGlide);
      }
    }
  }

  // Update heading rotation cone if available
  const el = userMarkerRef.current.getElement();
  const cone = el.querySelector('.heading-cone') as HTMLElement | null;
  if (cone) {
    if (typeof heading === 'number' && !isNaN(heading)) {
      cone.style.transition = 'transform 0.8s cubic-bezier(0.25, 1, 0.5, 1), opacity 0.3s ease';
      cone.style.opacity = '1';
      cone.style.transform = `rotate(${heading}deg) translateY(-8px)`;
    } else {
      cone.style.opacity = '0';
    }
  }
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
