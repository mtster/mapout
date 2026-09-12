import React, { useEffect, useRef } from 'react';
import { Map as MapLibreMap, Marker, LngLatBounds, GeoJSONSource, AttributionControl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { LatLng, MapStyle, RouteData, UserLocation } from '../types';
import { smoothAngle } from '../services/mapService';

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
}

// 100% Free, Vector, Hardware-Accelerated Basemap Styles from OpenFreeMap
// Zero API Keys, Zero Watermarks, Native 60 FPS WebGL Vector Rendering
const MAP_STYLES: Record<MapStyle, string | object> = {
  // Darkness: Minimal dark map (removed POIs, pedestrians)
  dark: '/style-darkness.json',

  // Night Life: Dark map with full features (shops, bus stops, etc)
  midnight: '/style-nightlife.json',

  // Photorealistic Satellite: Esri High-Resolution World Imagery
  satellite: {
    version: 8,
    sources: {
      'esri-satellite': {
        type: 'raster',
        tiles: [
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        ],
        tileSize: 256,
        maxzoom: 19,
        attribution: '© Esri, Maxar, Earthstar Geographics',
      },
    },
    layers: [
      {
        id: 'esri-satellite-layer',
        type: 'raster',
        source: 'esri-satellite',
        minzoom: 0,
        maxzoom: 19,
      },
    ],
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
  const mapInstanceRef = useRef<MapLibreMap | null>(null);
  const userMarkerRef = useRef<Marker | null>(null);
  const destMarkerRef = useRef<Marker | null>(null);
  const routeRef = useRef<RouteData | null>(route);
  routeRef.current = route;

  // Keep map properly resized on any viewport/window dimension shifts
  useEffect(() => {
    const handleViewportChange = () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.resize();
      }
    };

    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('orientationchange', handleViewportChange);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleViewportChange);
    }

    const t1 = setTimeout(handleViewportChange, 100);
    const t2 = setTimeout(handleViewportChange, 500);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('orientationchange', handleViewportChange);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', handleViewportChange);
      }
    };
  }, []);

  // Fresh mutable refs
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

  // Helper to mount or refresh the route GeoJSON vector layer
  const updateRouteLayer = (map: MapLibreMap, currentRoute: RouteData | null) => {
    if (!map || !map.isStyleLoaded()) return;

    const sourceId = 'active-route-source';
    const casingLayerId = 'active-route-casing';
    const lineLayerId = 'active-route-line';

    const coords =
      currentRoute?.geometry && currentRoute.geometry.length > 0
        ? currentRoute.geometry.map((pt) => [pt[1], pt[0]])
        : [];

    const geojson: GeoJSON.Feature<GeoJSON.LineString> = {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: coords,
      },
    };

    const existingSource = map.getSource(sourceId) as GeoJSONSource | undefined;

    if (existingSource) {
      existingSource.setData(geojson);
    } else if (coords.length > 0) {
      map.addSource(sourceId, {
        type: 'geojson',
        data: geojson,
      });

      if (!map.getLayer(casingLayerId)) {
        map.addLayer({
          id: casingLayerId,
          type: 'line',
          source: sourceId,
          layout: {
            'line-join': 'round',
            'line-cap': 'round',
          },
          paint: {
            'line-color': '#0284c7',
            'line-width': ['interpolate', ['linear'], ['zoom'], 10, 6, 16, 11, 20, 16],
            'line-opacity': 0.85,
          },
        });
      }

      if (!map.getLayer(lineLayerId)) {
        map.addLayer({
          id: lineLayerId,
          type: 'line',
          source: sourceId,
          layout: {
            'line-join': 'round',
            'line-cap': 'round',
          },
          paint: {
            'line-color': '#38bdf8',
            'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3.5, 16, 6, 20, 10],
            'line-opacity': 1.0,
          },
        });
      }
    }

    if (coords.length === 0 && existingSource) {
      if (map.getLayer(lineLayerId)) map.removeLayer(lineLayerId);
      if (map.getLayer(casingLayerId)) map.removeLayer(casingLayerId);
      map.removeSource(sourceId);
    }
  };

  const isInitialMountRef = useRef(true);

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

    map.addControl(new AttributionControl({ compact: true }), 'bottom-left');

    mapInstanceRef.current = map;

    map.on('load', () => {
      // Force MapLibre to calculate real container dimensions immediately across mobile frames
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
    map.on('dblclick', () => {
      lastDblClickTime = Date.now();
    });
    
    let lastGestureEndTime = 0;
    map.on('zoomend', () => { lastGestureEndTime = Date.now(); });
    map.on('dragend', () => { lastGestureEndTime = Date.now(); });

    // Detect user manual pan/zoom to suspend auto-centering
    map.on('dragstart', (e) => { if (e.originalEvent) onUserPanOrZoomRef.current?.(); });
    map.on('rotatestart', (e) => { if (e.originalEvent) onUserPanOrZoomRef.current?.(); });
    map.on('pitchstart', (e) => { if (e.originalEvent) onUserPanOrZoomRef.current?.(); });
    map.on('zoomstart', (e) => {
      if (e.originalEvent) onUserPanOrZoomRef.current?.();
    });

    // Click handler on map canvas
    map.on('click', (e) => {
      if (isNavigatingRef.current) return;
      if (map.isMoving() || map.isZooming()) return;
      
      // Prevent double tap from placing a pin
      const originalEvent = e.originalEvent as MouseEvent;
      if (originalEvent && originalEvent.detail > 1) return;
      
      // Prevent synthetic clicks that fire right after a double tap gesture
      if (Date.now() - lastDblClickTime < 500) return;
      if (Date.now() - lastGestureEndTime < 300) return;

      if (hasDestinationRef.current) {
        onMapTapWithDestinationRef.current?.();
      } else {
        onMapClickRef.current?.([e.lngLat.lat, e.lngLat.lng]);
      }
    });

    // Observe parent container resize and update MapLibre canvas on mobile viewport shifts
    const handleResize = () => {
      map.resize();
    };

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
      resizeObserver.disconnect();
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', handleResize);
      }
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []); // Run once on mount

  // 2. Map Style Switcher (only when user actively changes style)
  useEffect(() => {
    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
      return;
    }
    const map = mapInstanceRef.current;
    if (!map) return;
    map.setStyle(MAP_STYLES[mapStyle] as any);
  }, [mapStyle]);

  // 3. Update route on map when route state changes
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    updateRouteLayer(map, route);

    if (route && route.geometry && route.geometry.length > 1 && !isNavigating) {
      const bounds = new LngLatBounds();
      route.geometry.forEach((pt) => bounds.extend([pt[1], pt[0]]));
      
      // Calculate responsive percentage-based padding so route is clearly framed above the bottom sheet
      const screenH = typeof window !== 'undefined' ? window.innerHeight : 800;
      const screenW = typeof window !== 'undefined' ? window.innerWidth : 400;
      const topPadding = Math.max(90, Math.round(screenH * 0.12));
      const bottomPadding = Math.max(280, Math.round(screenH * 0.42));
      const sidePadding = Math.max(30, Math.round(screenW * 0.08));

      map.fitBounds(bounds, {
        padding: { top: topPadding, bottom: bottomPadding, left: sidePadding, right: sidePadding },
        maxZoom: 16,
        duration: 1000,
      });
    }
  }, [route, isNavigating]);

  // 4. Render and update User Location marker (with accuracy ring & heading cone)
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

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
  }, [userLocation, activeNavLocation, isNavigating, targetHeading]);

  // 5. Render and update Destination marker
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

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
        onMapClickRef.current?.([lngLat.lat, lngLat.lng]);
      });

      destMarkerRef.current = marker;
    } else {
      destMarkerRef.current.setLngLat([destination.lng, destination.lat]);
      destMarkerRef.current.setDraggable(!isNavigating);
    }
  }, [destination, isNavigating]);

  // 6. Navigation Follow Camera Engine (Fluid 60 FPS GPU-Accelerated 45 deg Perspective)
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !isNavigating || !isFollowingUser) return;

    const targetCoord =
      activeNavLocation || (userLocation ? [userLocation.lat, userLocation.lng] : null);
    if (!targetCoord) return;

    const currentBearing = map.getBearing();
    let bearingToUse = currentBearing;
    if (typeof targetHeading === 'number' && !isNaN(targetHeading)) {
      bearingToUse = smoothAngle(currentBearing, targetHeading, 0.45);
    }

    map.easeTo({
      center: [targetCoord[1], targetCoord[0]],
      zoom: standardNavZoom,
      bearing: bearingToUse,
      pitch: 45,
      padding: { top: window.innerHeight * 0.4, bottom: 0, left: 0, right: 0 },
      duration: 950,
      easing: (t) => t,
    });
  }, [activeNavLocation, userLocation, isNavigating, isFollowingUser, targetHeading, standardNavZoom]);

  // 7. Recenter trigger
  useEffect(() => {
    if (recenterTrigger === 0) return;
    const map = mapInstanceRef.current;
    if (!map) return;

    const targetCoord =
      activeNavLocation || (userLocation ? [userLocation.lat, userLocation.lng] : null);
    if (!targetCoord) return;

    const bearing =
      typeof targetHeading === 'number' && !isNaN(targetHeading) ? targetHeading : 0;

    map.flyTo({
      center: [targetCoord[1], targetCoord[0]],
      zoom: isNavigating ? standardNavZoom : 16,
      bearing: isNavigating ? bearing : 0,
      pitch: isNavigating ? 45 : 0,
      padding: isNavigating ? { top: window.innerHeight * 0.4, bottom: 0, left: 0, right: 0 } : { top: 0, bottom: 0, left: 0, right: 0 },
      duration: 800,
    });
  }, [recenterTrigger]);

  return (
    <div
      ref={mapContainerRef}
      id="map-container"
      className="absolute inset-0 w-full h-full bg-black cursor-crosshair z-0"
    />
  );
};
