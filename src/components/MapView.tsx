import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet-rotate';
import { LatLng, MapStyle, RouteData, UserLocation } from '../types';
import { createUserLocationIcon, createNavPuckIcon, createDestinationIcon } from '../utils/mapMarkers';

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
  targetHeading?: number | null;
  standardNavZoom?: number;
  recenterTrigger?: number;
  onBearingChange?: (bearing: number) => void;
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
  targetHeading,
  standardNavZoom = 17,
  recenterTrigger,
  onBearingChange,
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

  const onBearingChangeRef = useRef(onBearingChange);
  useEffect(() => {
    onBearingChangeRef.current = onBearingChange;
  }, [onBearingChange]);

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
      preferCanvas: true, // Canvas renderer is natively transformed and anchored in rotatePane
      rotate: true,
      touchRotate: true,
      rotateControl: false,
    } as any);

    // Track bearing changes (e.g. from 2-finger twist gesture or course-up navigation)
    map.on('rotate', () => {
      const b = typeof (map as any).getBearing === 'function' ? (map as any).getBearing() : 0;
      onBearingChangeRef.current?.(b);
      if (routePolylineBgRef.current) routePolylineBgRef.current.redraw();
      if (routePolylineFgRef.current) routePolylineFgRef.current.redraw();
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
    // Enhanced with strict anti-false-positive guards so single-finger
    // panning and dragging can NEVER be mistaken for double-tap-zoom.
    // ----------------------------------------------------
    let lastTapTime = 0;
    let lastTapX = 0;
    let lastTapY = 0;
    let pointerDownX = 0;
    let pointerDownY = 0;
    let pointerDownTime = 0;
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
      (map as any)._move(targetCenter, targetZoom, { pinch: true, round: false }, undefined);
    };

    const onPointerDown = (e: PointerEvent) => {
      // Allow primary button or touch only
      if (e.button !== 0 && e.pointerType === 'mouse') return;

      pointerDownX = e.clientX;
      pointerDownY = e.clientY;
      pointerDownTime = Date.now();

      const timeDiff = pointerDownTime - lastTapTime;
      const distX = Math.abs(e.clientX - lastTapX);
      const distY = Math.abs(e.clientY - lastTapY);

      // Strict criteria: only trigger if tap 2 is 60ms-300ms after a CLEAN stationary tap 1,
      // and within 24px of tap 1
      if (timeDiff >= 60 && timeDiff <= 300 && distX < 24 && distY < 24) {
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
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!isSecondTapHeld) {
        // If finger moved > 8px while down, user is panning/dragging the map!
        // Immediately invalidate any pending tap state so the subsequent touch
        // can NEVER be misidentified as a double tap!
        const movedDist = Math.hypot(e.clientX - pointerDownX, e.clientY - pointerDownY);
        if (movedDist > 8) {
          lastTapTime = 0;
        }
        return;
      }

      if (!touchPoint || !centerPoint || !pinchStartLatLng) return;

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
        // 160px vertical drag = factor of 2.0 (1 full zoom level)
        const scale = Math.pow(2, dy / 160);
        targetZoom = (map as any).getScaleZoom(scale, startZoom);
        targetZoom = Math.min(20, Math.max(2, targetZoom));

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

      // Check if touch 1 was a clean, stationary tap:
      // Must not have moved > 8px and duration must be < 260ms
      const touchDuration = Date.now() - pointerDownTime;
      const touchDist = Math.hypot(e.clientX - pointerDownX, e.clientY - pointerDownY);

      if (touchDist <= 8 && touchDuration < 260) {
        lastTapTime = Date.now();
        lastTapX = e.clientX;
        lastTapY = e.clientY;
      } else {
        lastTapTime = 0;
      }
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
      lastTapTime = 0;
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
      if (isNavigatingRef.current && !(map as any)._isProgrammaticMoving) {
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

    const icon = isNavigating ? createNavPuckIcon() : createUserLocationIcon(userLocation?.heading);

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
  }, [userLocation, activeNavLocation, isNavigating]);

  // Handle camera centering, navigation initial start zoom, and recentering:
  // When navigation starts, zoom camera to standardNavZoom.
  // When user clicks recenter, zoom camera to standardNavZoom and center.
  // When active in navigation and following user, pan camera smoothly.
  const prevIsNavigatingRef = useRef(isNavigating);
  const prevRecenterTriggerRef = useRef(recenterTrigger);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const currentCoords = isNavigating && activeNavLocation
      ? activeNavLocation
      : userLocation
      ? [userLocation.lat, userLocation.lng] as LatLng
      : null;

    if (!currentCoords) return;

    const stdZoom = standardNavZoom || 17;
    const isNavStarting = !prevIsNavigatingRef.current && isNavigating;
    const isRecentered = recenterTrigger !== undefined && recenterTrigger !== prevRecenterTriggerRef.current;

    prevIsNavigatingRef.current = isNavigating;
    prevRecenterTriggerRef.current = recenterTrigger;

    if (isNavStarting || isRecentered) {
      (map as any)._isProgrammaticMoving = true;
      map.flyTo(currentCoords, stdZoom, { duration: 0.8 });
      setTimeout(() => {
        if (map) (map as any)._isProgrammaticMoving = false;
      }, 900);
      return;
    }

    if (isNavigating && isFollowingUser && !(map as any)._isProgrammaticMoving) {
      map.panTo(currentCoords, { animate: true, duration: 0.6 });
    }
  }, [userLocation, activeNavLocation, isNavigating, isFollowingUser, recenterTrigger, standardNavZoom]);

  // Navigation Course-Up Heading Orientation:
  // When in active navigation and following user, rotate the map so the road points forward (UP).
  // When navigation stops, smoothly reset bearing to 0 (North up).
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || typeof (map as any).setBearing !== 'function') return;

    if (isNavigating && isFollowingUser && targetHeading !== null && targetHeading !== undefined) {
      // Course-up: align road ahead with 12 o'clock
      const courseUpBearing = (360 - (targetHeading % 360)) % 360;
      (map as any).setBearing(courseUpBearing);
    } else if (!isNavigating) {
      if ((map as any).getBearing && Math.abs((map as any).getBearing()) > 0.5) {
        (map as any).setBearing(0);
      }
    }
  }, [isNavigating, isFollowingUser, targetHeading]);

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

    // Use dedicated Canvas renderer attached to map's rotatePane
    const canvasRenderer = L.canvas();

    // Background casing (dark / glowing outline)
    const polyBg = L.polyline(route.geometry, {
      renderer: canvasRenderer,
      color: '#0284c7', // dark cyan/sky casing
      weight: 7,
      opacity: 0.5,
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(map);

    // Foreground line (electric cyan / crisp sky)
    const polyFg = L.polyline(route.geometry, {
      renderer: canvasRenderer,
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
