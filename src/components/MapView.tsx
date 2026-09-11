import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import { LatLng, MapStyle, RouteData, UserLocation } from '../types';
import { createUserLocationIcon, createDestinationIcon } from '../utils/mapMarkers';

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
  onMapReady?: (map: L.Map) => void;
  isFollowingUser?: boolean;
  onUserPanOrZoom?: () => void;
}

interface TileDefinition {
  url: string;
  options: L.TileLayerOptions;
  referenceUrl?: string;
  referenceOptions?: L.TileLayerOptions;
}

const cartoKey = typeof import.meta !== 'undefined' && import.meta.env?.VITE_CARTO_API_KEY;

// 100% Free, zero watermark, no API key required default basemaps
const TILE_DEFINITIONS: Record<MapStyle, TileDefinition> = {
  // Obsidian Dark: Esri World Dark Gray Canvas with maxNativeZoom to avoid gray "Map data not available" tiles
  dark: cartoKey
    ? {
        url: `https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?api_key=${cartoKey}`,
        options: {
          subdomains: 'abcd',
          maxZoom: 20,
          maxNativeZoom: 20,
          attribution: '&copy; CARTO &copy; OpenStreetMap',
        },
      }
    : {
        url: 'https://services.arcgisonline.com/arcgis/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
        options: {
          maxZoom: 20,
          maxNativeZoom: 16, // Server natively hosts up to zoom 16; Leaflet interpolates beyond
          attribution: '&copy; Esri, HERE, Garmin, OpenStreetMap contributors',
        },
        referenceUrl: 'https://services.arcgisonline.com/arcgis/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
        referenceOptions: {
          maxZoom: 20,
          maxNativeZoom: 16,
          pane: 'tilePane',
          className: 'tile-reference',
        },
      },
  // Pure Midnight: High-contrast OpenStreetMap inverted to OLED pitch-black
  midnight: {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    options: {
      maxZoom: 20,
      maxNativeZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      className: 'tile-midnight',
    },
  },
  // Photorealistic Satellite with dark road & location labels
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    options: {
      maxZoom: 20,
      maxNativeZoom: 18,
      attribution: '&copy; Esri, Maxar, Earthstar Geographics',
    },
    referenceUrl: 'https://services.arcgisonline.com/arcgis/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
    referenceOptions: {
      maxZoom: 20,
      maxNativeZoom: 16,
      pane: 'tilePane',
      className: 'tile-reference',
    },
  },
};

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
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const baseLayerRef = useRef<L.TileLayer | null>(null);
  const referenceLayerRef = useRef<L.TileLayer | null>(null);
  const userMarkerRef = useRef<L.Marker | null>(null);
  const destinationMarkerRef = useRef<L.Marker | null>(null);
  const routePolylineBgRef = useRef<L.Polyline | null>(null);
  const routePolylineFgRef = useRef<L.Polyline | null>(null);

  // Fresh mutable refs to avoid stale closures in listeners
  const isNavigatingRef = useRef(isNavigating);
  useEffect(() => {
    isNavigatingRef.current = isNavigating;
    if (destinationMarkerRef.current) {
      if (isNavigating) {
        destinationMarkerRef.current.dragging?.disable();
      } else {
        destinationMarkerRef.current.dragging?.enable();
      }
    }
  }, [isNavigating]);

  const isFollowingUserRef = useRef(isFollowingUser);
  useEffect(() => {
    isFollowingUserRef.current = isFollowingUser;
  }, [isFollowingUser]);

  const onUserPanOrZoomRef = useRef(onUserPanOrZoom);
  useEffect(() => {
    onUserPanOrZoomRef.current = onUserPanOrZoom;
  }, [onUserPanOrZoom]);

  const hasDestinationRef = useRef(hasDestination);
  useEffect(() => {
    hasDestinationRef.current = hasDestination;
  }, [hasDestination]);

  const onMapClickRef = useRef(onMapClick);
  useEffect(() => {
    onMapClickRef.current = onMapClick;
  }, [onMapClick]);

  const onMapTapWithDestinationRef = useRef(onMapTapWithDestination);
  useEffect(() => {
    onMapTapWithDestinationRef.current = onMapTapWithDestination;
  }, [onMapTapWithDestination]);

  // Helper to mount tile layers
  const setTiles = (map: L.Map, style: MapStyle) => {
    if (baseLayerRef.current) {
      map.removeLayer(baseLayerRef.current);
      baseLayerRef.current = null;
    }
    if (referenceLayerRef.current) {
      map.removeLayer(referenceLayerRef.current);
      referenceLayerRef.current = null;
    }

    const def = TILE_DEFINITIONS[style] || TILE_DEFINITIONS.dark;
    const base = L.tileLayer(def.url, def.options).addTo(map);
    base.bringToBack();
    baseLayerRef.current = base;

    if (def.referenceUrl) {
      const ref = L.tileLayer(def.referenceUrl, def.referenceOptions).addTo(map);
      referenceLayerRef.current = ref;
    }
  };

  // Initialize Map
  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container || mapInstanceRef.current) return;

    // Initial center: user location or default NYC
    const initialCenter: LatLng = userLocation
      ? [userLocation.lat, userLocation.lng]
      : [40.7128, -74.006];

    const map = L.map(container, {
      center: initialCenter,
      zoom: 14,
      minZoom: 2,
      maxZoom: 20,
      zoomSnap: 0.1, // Smooth fractional zoom like Google Maps
      zoomControl: false,
      doubleClickZoom: false, // Handled exclusively by our custom Google Maps-style gesture
      attributionControl: true,
    });

    // Add Tile Layers
    setTiles(map, mapStyle);

    // Initial full size invalidation to ensure whole-screen coverage
    setTimeout(() => {
      map.invalidateSize({ pan: false });
    }, 50);
    setTimeout(() => {
      map.invalidateSize({ pan: false });
    }, 300);

    // ----------------------------------------------------
    // Google Maps One-Finger / Double-Click & Drag to Zoom
    // Uses Leaflet's EXACT pinch-zoom pipeline (_move with pinch: true)
    // to prevent tile thrashing and eliminate black screen flash.
    // ----------------------------------------------------
    let lastTapTime = 0;
    let lastTapX = 0;
    let lastTapY = 0;
    let isSecondTapHeld = false;
    let isDoubleTapDragging = false;
    let moved = false;
    let dragStartY = 0;
    let startZoom = 14;
    let targetZoom = 14;
    let pinchStartLatLng: L.LatLng | null = null;
    let centerPoint: L.Point | null = null;
    let targetCenter: L.LatLng | null = null;
    let touchPoint: L.Point | null = null;
    let suppressClickUntil = 0;
    let pendingClickTimer: ReturnType<typeof setTimeout> | null = null;
    let rafId: number | null = null;

    const preventSelection = (e: Event) => {
      e.preventDefault();
    };

    const updatePinchZoomFrame = () => {
      rafId = null;
      if (!isDoubleTapDragging || !targetCenter) return;
      // Use Leaflet's native pinch move which applies smooth GPU matrix transforms
      // without discarding or re-querying tiles
      (map as any)._move(targetCenter, targetZoom, { pinch: true, round: false }, undefined);
    };

    const onPointerDown = (e: PointerEvent) => {
      // Allow primary button or touch only
      if (e.button !== 0 && e.pointerType === 'mouse') return;

      const now = Date.now();
      const timeDiff = now - lastTapTime;
      const distX = Math.abs(e.clientX - lastTapX);
      const distY = Math.abs(e.clientY - lastTapY);

      if (timeDiff < 380 && distX < 40 && distY < 40) {
        // Second tap detected within double-tap window!
        e.preventDefault();

        if (pendingClickTimer) {
          clearTimeout(pendingClickTimer);
          pendingClickTimer = null;
        }

        // Halt any in-flight animations
        (map as any)._stop();

        isSecondTapHeld = true;
        isDoubleTapDragging = false;
        moved = false;
        dragStartY = e.clientY;
        startZoom = map.getZoom();
        targetZoom = startZoom;

        // Anchor calculations identical to Leaflet TouchZoom
        centerPoint = map.getSize().divideBy(2);
        touchPoint = map.mouseEventToContainerPoint(e as any);
        pinchStartLatLng = map.containerPointToLatLng(touchPoint);
        targetCenter = map.getCenter();
      } else {
        isSecondTapHeld = false;
        isDoubleTapDragging = false;
        moved = false;
        lastTapX = e.clientX;
        lastTapY = e.clientY;
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!isSecondTapHeld || !touchPoint || !centerPoint || !pinchStartLatLng) return;

      e.preventDefault();

      const dy = e.clientY - dragStartY;

      if (!isDoubleTapDragging) {
        // Activate drag-to-zoom once moved past deadzone (6px)
        if (Math.abs(dy) > 6) {
          isDoubleTapDragging = true;
          map.dragging.disable();
          (map as any)._moveStart(true, false);
          moved = true;
          if (isNavigatingRef.current) {
            onUserPanOrZoomRef.current?.();
          }
        }
      }

      if (isDoubleTapDragging) {
        // Drag down (dy > 0) -> Zoom in
        // Drag up (dy < 0) -> Zoom out
        // Use identical scale exponential formula as two-finger pinch:
        // 160px vertical drag = factor of 2.0 (1 full zoom level)
        const scale = Math.pow(2, dy / 160);
        targetZoom = (map as any).getScaleZoom(scale, startZoom);

        // Clamp between min and max zoom
        targetZoom = Math.min(20, Math.max(2, targetZoom));

        // Center calculation matching Leaflet TouchZoom: keeps the touched point stationary under finger
        const delta = touchPoint.subtract(centerPoint);
        targetCenter = map.unproject(
          map.project(pinchStartLatLng, targetZoom).subtract(delta),
          targetZoom
        );

        if (rafId === null) {
          rafId = requestAnimationFrame(updatePinchZoomFrame);
        }
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }

      if (isDoubleTapDragging) {
        e.preventDefault();
        map.dragging.enable();

        if (moved && targetCenter) {
          const limitZoom = (map as any)._limitZoom(targetZoom);
          if ((map as any).options.zoomAnimation) {
            (map as any)._animateZoom(targetCenter, limitZoom, true, (map as any).options.zoomSnap);
          } else {
            (map as any)._resetView(targetCenter, limitZoom);
          }
          (map as any)._moveEnd(true);
        }

        isDoubleTapDragging = false;
        isSecondTapHeld = false;
        moved = false;
        suppressClickUntil = Date.now() + 400;
        lastTapTime = 0;
        return;
      }

      if (isSecondTapHeld) {
        e.preventDefault();
        // Quick double tap without drag: smoothly zoom in 1 step around tap location
        if (pinchStartLatLng) {
          map.setZoomAround(pinchStartLatLng, Math.min(20, Math.round(map.getZoom() + 1)), { animate: true });
        } else {
          map.setZoom(Math.min(20, Math.round(map.getZoom() + 1)), { animate: true });
        }
        isSecondTapHeld = false;
        suppressClickUntil = Date.now() + 400;
        lastTapTime = 0;
        if (isNavigatingRef.current) {
          onUserPanOrZoomRef.current?.();
        }
        return;
      }

      // Record first tap time and position
      lastTapTime = Date.now();
      lastTapX = e.clientX;
      lastTapY = e.clientY;
    };

    const onPointerCancel = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      if (isDoubleTapDragging) {
        map.dragging.enable();
      }
      isSecondTapHeld = false;
      isDoubleTapDragging = false;
      moved = false;
    };

    // Kill text selection and long-press callout on the map container
    container.addEventListener('selectstart', preventSelection);
    container.addEventListener('contextmenu', preventSelection);
    container.addEventListener('pointerdown', onPointerDown, { passive: false });
    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp, { passive: false });
    window.addEventListener('pointercancel', onPointerCancel);

    // Map click handler (drop pin) with debounce to avoid collision with double-tap
    map.on('click', (e: L.LeafletMouseEvent) => {
      // Strictly prevent dropping pins during navigation
      if (isNavigatingRef.current) return;
      if (Date.now() < suppressClickUntil) return;

      if (pendingClickTimer) {
        clearTimeout(pendingClickTimer);
      }

      // 220ms grace window: if second tap begins, timer is cancelled
      pendingClickTimer = setTimeout(() => {
        if (!isNavigatingRef.current && Date.now() >= suppressClickUntil) {
          // If a pin is currently active, clicking the map MUST NOT drop a new pin;
          // instead it pulls down the popup sheet to the peek state
          if (hasDestinationRef.current) {
            onMapTapWithDestinationRef.current?.();
          } else {
            const clickedCoords: LatLng = [e.latlng.lat, e.latlng.lng];
            onMapClickRef.current(clickedCoords);
          }
        }
        pendingClickTimer = null;
      }, 220);
    });

    // User drag or zoom during active navigation unlocks the camera so the user can freely explore
    map.on('dragstart', () => {
      if (isNavigatingRef.current) {
        onUserPanOrZoomRef.current?.();
      }
    });

    map.on('zoomstart', () => {
      if (isNavigatingRef.current && !(map as any)._isProgrammaticMoving) {
        onUserPanOrZoomRef.current?.();
      }
    });

    // ResizeObserver ensures the map continuously and dynamically fills the entire screen
    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize({ pan: false });
    });
    resizeObserver.observe(container);

    const handleWindowResize = () => {
      map.invalidateSize({ pan: false });
    };
    window.addEventListener('resize', handleWindowResize);
    window.addEventListener('orientationchange', handleWindowResize);

    mapInstanceRef.current = map;
    if (onMapReady) onMapReady(map);

    return () => {
      if (pendingClickTimer) clearTimeout(pendingClickTimer);
      if (rafId !== null) cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      window.removeEventListener('resize', handleWindowResize);
      window.removeEventListener('orientationchange', handleWindowResize);
      container.removeEventListener('selectstart', preventSelection);
      container.removeEventListener('contextmenu', preventSelection);
      container.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Handle map style changes
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    setTiles(map, mapStyle);
  }, [mapStyle]);

  // Update User Marker
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const currentCoords = isNavigating && activeNavLocation
      ? activeNavLocation
      : userLocation
      ? [userLocation.lat, userLocation.lng] as LatLng
      : null;

    if (!currentCoords) {
      if (userMarkerRef.current) {
        map.removeLayer(userMarkerRef.current);
        userMarkerRef.current = null;
      }
      return;
    }

    const heading = userLocation?.heading;
    const icon = createUserLocationIcon(heading);

    if (userMarkerRef.current) {
      userMarkerRef.current.setLatLng(currentCoords);
      userMarkerRef.current.setIcon(icon);
    } else {
      userMarkerRef.current = L.marker(currentCoords, {
        icon,
        interactive: false,
        zIndexOffset: 1000,
      }).addTo(map);
    }

    // Auto-center camera only if in active navigation AND user has not panned away
    if (isNavigating && isFollowingUser) {
      map.panTo(currentCoords, { animate: true, duration: 0.6 });
    }
  }, [userLocation, activeNavLocation, isNavigating, isFollowingUser]);

  // Update Destination Marker
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (!destination) {
      if (destinationMarkerRef.current) {
        map.removeLayer(destinationMarkerRef.current);
        destinationMarkerRef.current = null;
      }
      return;
    }

    const destCoords: LatLng = [destination.lat, destination.lng];
    const icon = createDestinationIcon(destination.name);

    if (destinationMarkerRef.current) {
      destinationMarkerRef.current.setLatLng(destCoords);
      destinationMarkerRef.current.setIcon(icon);
      if (isNavigating) {
        destinationMarkerRef.current.dragging?.disable();
      } else {
        destinationMarkerRef.current.dragging?.enable();
      }
    } else {
      destinationMarkerRef.current = L.marker(destCoords, {
        icon,
        draggable: !isNavigating,
        zIndexOffset: 900,
      }).addTo(map);

      // Handle dragging the destination pin
      destinationMarkerRef.current.on('dragend', (e) => {
        if (isNavigatingRef.current) return;
        const marker = e.target;
        const pos = marker.getLatLng();
        onMapClickRef.current([pos.lat, pos.lng]);
      });
    }
  }, [destination, isNavigating]);

  // Update Route Polylines
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    // Clean up existing polylines
    if (routePolylineBgRef.current) {
      map.removeLayer(routePolylineBgRef.current);
      routePolylineBgRef.current = null;
    }
    if (routePolylineFgRef.current) {
      map.removeLayer(routePolylineFgRef.current);
      routePolylineFgRef.current = null;
    }

    if (!route || !route.geometry || route.geometry.length < 2) return;

    // Background casing (dark / glowing outline)
    const polyBg = L.polyline(route.geometry, {
      color: '#0284c7', // dark cyan/sky casing
      weight: 7,
      opacity: 0.5,
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(map);

    // Foreground line (electric cyan / crisp sky)
    const polyFg = L.polyline(route.geometry, {
      color: '#38bdf8', // crisp electric sky blue
      weight: 4.5,
      opacity: 0.95,
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(map);

    routePolylineBgRef.current = polyBg;
    routePolylineFgRef.current = polyFg;

    // If not actively navigating, fit bounds smoothly to route
    if (!isNavigating) {
      const bounds = L.latLngBounds(route.geometry);
      map.fitBounds(bounds, {
        paddingTopLeft: [40, 100],
        paddingBottomRight: [40, 240],
        maxZoom: 16,
        animate: true,
      });
    }
  }, [route, isNavigating]);

  return (
    <div
      ref={mapContainerRef}
      id="map-container"
      className="w-full h-full absolute inset-0 bg-black cursor-crosshair z-0"
      style={{ width: '100%', height: '100%' }}
    />
  );
};
