import React from 'react';
import { Map as MapLibreMap, Marker } from 'maplibre-gl';
import { LatLng, UserLocation } from '../../types';

export interface MarkerRefs {
  userMarker: Marker | null;
  destMarker: Marker | null;
}

/**
 * Creates or updates the User Location GPS marker with accuracy pulse & rotating heading cone
 */
export function updateUserLocationMarker(
  map: MapLibreMap,
  userMarkerRef: React.MutableRefObject<Marker | null>,
  userLocation: UserLocation | null,
  activeNavLocation: LatLng | null,
  isNavigating: boolean,
  targetHeading?: number | null
) {
  const activeLoc: LatLng | null =
    isNavigating && activeNavLocation
      ? activeNavLocation
      : userLocation
      ? [userLocation.lat, userLocation.lng]
      : null;

  if (!activeLoc) {
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
  } else {
    userMarkerRef.current.setLngLat([activeLoc[1], activeLoc[0]]);
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
 * Any scaling transforms grow upwards from the needle tip (origin: 50% 100%).
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
    el.className = 'destination-marker cursor-grab active:cursor-grabbing transition-transform duration-200 hover:scale-110';
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
