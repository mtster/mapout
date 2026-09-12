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
 * Creates or updates the Destination Pin marker
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
    el.className = 'destination-marker cursor-grab active:cursor-grabbing transition-transform hover:scale-110 origin-bottom';
    el.style.width = '32px';
    el.style.height = '42px';

    el.innerHTML = `
      <div class="relative flex flex-col items-center justify-center translate-y-1/4">
        <div class="w-7 h-7 rounded-full bg-sky-500 border-[3px] border-black shadow-[0_0_20px_rgba(14,165,233,0.8)] flex items-center justify-center text-white relative z-10">
          <div class="w-2.5 h-2.5 bg-white rounded-full"></div>
        </div>
        <div class="w-1 h-5 bg-sky-500 -mt-1 shadow-lg relative z-0"></div>
        <div class="w-3 h-1 bg-black/60 rounded-full blur-[2px] mt-0.5"></div>
      </div>
    `;

    const marker = new Marker({
      element: el,
      draggable: !isNavigating,
      anchor: 'bottom',
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
