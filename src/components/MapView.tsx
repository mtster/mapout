import React, { useEffect, useRef } from 'react';
import { Map as MapLibreMap, Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { LatLng, MapStyle, RouteData, UserLocation } from '../types';
import { useExactViewport } from '../hooks/useExactViewport';
import {
  MAP_STYLES,
  updateRouteLayer,
  updateUserLocationMarker,
  updateDestinationMarker,
  fitRouteBounds,
  followNavigationCamera,
  recenterMapCamera,
} from './map';

interface Props {
  userLocation: UserLocation | null;
  destination: { lat: number; lng: number; name: string } | null;
  route: RouteData | null;
  mapStyle: MapStyle;
  isNavigating: boolean;
  activeNavLocation: LatLng | null;
  hasDestination: boolean;
  onMapClick: (coords: LatLng) => void;
  onMapTapWithDestination?: () => void;
  onMapReady?: (map: MapLibreMap) => void;
  isFollowingUser?: boolean;
  onUserPanOrZoom?: () => void;
  targetHeading?: number | null;
  standardNavZoom?: number;
  recenterTrigger?: number;
  onBearingChange?: (bearing: number) => void;
  isRouteSheetCollapsed?: boolean;
}

export const MapView: React.FC<Props> = ({
  userLocation,
  destination,
  route,
  mapStyle,
  isNavigating,
  activeNavLocation,
  hasDestination,
  onMapClick,
  onMapTapWithDestination,
  onMapReady,
  isFollowingUser = true,
  onUserPanOrZoom,
  targetHeading,
  standardNavZoom = 17,
  recenterTrigger,
  onBearingChange,
  isRouteSheetCollapsed = false,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<MapLibreMap | null>(null);
  const userMarkerRef = useRef<Marker | null>(null);
  const destMarkerRef = useRef<Marker | null>(null);
  const routeRef = useRef<RouteData | null>(route);
  routeRef.current = route;

  const isInitialMountRef = useRef(true);
  const lastFramedDestKeyRef = useRef<string | null>(null);

  // Apply unconstrained physical dimensions on mobile viewport
  useExactViewport(mapContainerRef, mapInstanceRef);

  // Fresh mutable refs for event handlers to avoid reattaching listeners
  const isNavigatingRef = useRef(isNavigating);
  isNavigatingRef.current = isNavigating;

  const hasDestinationRef = useRef(hasDestination);
  hasDestinationRef.current = hasDestination;

  const onMapClickRef = useRef(onMapClick);
  onMapClickRef.current = onMapClick;

  const onMapTapWithDestinationRef = useRef(onMapTapWithDestination);
  onMapTapWithDestinationRef.current = onMapTapWithDestination;

  const onUserPanOrZoomRef = useRef(onUserPanOrZoom);
  onUserPanOrZoomRef.current = onUserPanOrZoom;

  const onBearingChangeRef = useRef(onBearingChange);
  onBearingChangeRef.current = onBearingChange;

  // 1. Initialize MapLibre GL Map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    const initialCenter: [number, number] = userLocation
      ? [userLocation.lng, userLocation.lat]
      : [0, 20];
    const initialZoom = userLocation ? 14 : 2;

    const map = new MapLibreMap({
      container: mapContainerRef.current,
      style: MAP_STYLES[mapStyle] as any,
      center: initialCenter,
      zoom: initialZoom,
      pitchWithRotate: true,
      dragRotate: true,
      touchPitch: true,
      touchZoomRotate: true,
      trackResize: true,
      attributionControl: false,
    });

    mapInstanceRef.current = map;

    map.on('load', () => {
      map.resize();
      setTimeout(() => map.resize(), 100);
      setTimeout(() => map.resize(), 500);
      onMapReady?.(map);
      updateRouteLayer(map, routeRef.current);
    });

    map.on('style.load', () => {
      updateRouteLayer(map, routeRef.current);
    });

    map.on('rotate', () => {
      onBearingChangeRef.current?.(map.getBearing());
    });

    // Re-apply route after style changes
    map.on('styledata', () => {
      if (map.isStyleLoaded() && routeRef.current) {
        const sourceId = 'active-route-source';
        if (!map.getSource(sourceId)) {
          updateRouteLayer(map, routeRef.current);
        }
      }
    });

    let lastDblClickTime = 0;
    let lastGestureEndTime = 0;
    let clickDebounceTimer: ReturnType<typeof setTimeout> | null = null;

    const cancelPendingClick = () => {
      if (clickDebounceTimer) {
        clearTimeout(clickDebounceTimer);
        clickDebounceTimer = null;
      }
    };

    map.on('dblclick', () => {
      lastDblClickTime = Date.now();
      cancelPendingClick();
    });

    map.on('zoomend', () => {
      lastGestureEndTime = Date.now();
      cancelPendingClick();
    });
    map.on('dragend', () => {
      lastGestureEndTime = Date.now();
      cancelPendingClick();
    });

    // Detect user manual pan/zoom to suspend auto-centering & cancel clicks
    map.on('dragstart', (e) => {
      cancelPendingClick();
      if (e.originalEvent) onUserPanOrZoomRef.current?.();
    });
    map.on('rotatestart', (e) => {
      cancelPendingClick();
      if (e.originalEvent) onUserPanOrZoomRef.current?.();
    });
    map.on('pitchstart', (e) => {
      cancelPendingClick();
      if (e.originalEvent) onUserPanOrZoomRef.current?.();
    });
    map.on('zoomstart', (e) => {
      cancelPendingClick();
      if (e.originalEvent) onUserPanOrZoomRef.current?.();
    });
    map.on('movestart', cancelPendingClick);
    map.on('touchstart', (e) => {
      if (e.points && e.points.length > 1) {
        cancelPendingClick();
      }
    });

    // Click handler on map canvas with single-tap gesture debounce
    map.on('click', (e) => {
      if (isNavigatingRef.current) return;
      if (map.isMoving() || map.isZooming()) return;

      const originalEvent = e.originalEvent as MouseEvent;
      if (originalEvent && originalEvent.detail > 1) {
        cancelPendingClick();
        return;
      }

      if (Date.now() - lastDblClickTime < 600) {
        cancelPendingClick();
        return;
      }
      if (Date.now() - lastGestureEndTime < 400) {
        cancelPendingClick();
        return;
      }

      cancelPendingClick();

      const clickedLat = e.lngLat.lat;
      const clickedLng = e.lngLat.lng;

      clickDebounceTimer = setTimeout(() => {
        clickDebounceTimer = null;
        if (map.isMoving() || map.isZooming()) return;
        if (Date.now() - lastDblClickTime < 600) return;
        if (Date.now() - lastGestureEndTime < 400) return;

        if (hasDestinationRef.current) {
          onMapTapWithDestinationRef.current?.();
        } else {
          onMapClickRef.current?.([clickedLat, clickedLng]);
        }
      }, 260);
    });

    const handleResize = () => map.resize();
    const resizeObserver = new ResizeObserver(handleResize);
    if (mapContainerRef.current) {
      resizeObserver.observe(mapContainerRef.current);
    }

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleResize);
    }

    return () => {
      cancelPendingClick();
      resizeObserver.disconnect();
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', handleResize);
      }
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // 2. Map Style Switcher
  useEffect(() => {
    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
      return;
    }
    const map = mapInstanceRef.current;
    if (!map) return;
    map.setStyle(MAP_STYLES[mapStyle] as any);
  }, [mapStyle]);

  // 3. Update route on map and frame bounds ONLY when a new destination is selected
  // (Prevents jarring camera bouncing when minimizing/maximizing sheet or changing vehicle types)
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    updateRouteLayer(map, route);

    if (route && !isNavigating) {
      const destKey = `${route.destinationName}-${route.endPoint[0].toFixed(5)}-${route.endPoint[1].toFixed(5)}`;
      if (lastFramedDestKeyRef.current !== destKey) {
        lastFramedDestKeyRef.current = destKey;
        fitRouteBounds(map, route, isRouteSheetCollapsed);
      }
    } else if (!route) {
      lastFramedDestKeyRef.current = null;
    }
  }, [route, isNavigating]);

  // 4. Render and update User Location marker
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    updateUserLocationMarker(
      map,
      userMarkerRef,
      userLocation,
      activeNavLocation,
      isNavigating,
      targetHeading
    );
  }, [userLocation, activeNavLocation, isNavigating, targetHeading]);

  // 5. Render and update Destination marker
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    updateDestinationMarker(
      map,
      destMarkerRef,
      destination,
      isNavigating,
      (coords) => onMapClickRef.current?.(coords)
    );
  }, [destination, isNavigating]);

  // 6. Navigation Follow Camera Engine (Fluid 60 FPS GPU-Accelerated Perspective)
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !isNavigating || !isFollowingUser) return;

    const targetCoord =
      activeNavLocation || (userLocation ? [userLocation.lat, userLocation.lng] : null);
    if (!targetCoord) return;

    followNavigationCamera(map, targetCoord, targetHeading, standardNavZoom);
  }, [activeNavLocation, userLocation, isNavigating, isFollowingUser, targetHeading, standardNavZoom]);

  // 7. Recenter trigger
  useEffect(() => {
    if (recenterTrigger === 0) return;
    const map = mapInstanceRef.current;
    if (!map) return;

    const targetCoord =
      activeNavLocation || (userLocation ? [userLocation.lat, userLocation.lng] : null);
    if (!targetCoord) return;

    recenterMapCamera(map, targetCoord, isNavigating, targetHeading, standardNavZoom);
  }, [recenterTrigger]);

  return (
    <div
      ref={mapContainerRef}
      id="map-container"
      className="absolute inset-0 w-full h-full bg-black cursor-crosshair z-0"
    />
  );
};
