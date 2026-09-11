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
  onMapClick: (coords: LatLng) => void;
  onMapReady?: (map: L.Map) => void;
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
  // Obsidian Dark: Esri World Dark Gray Canvas (or CARTO if user provided key)
  dark: cartoKey
    ? {
        url: `https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?api_key=${cartoKey}`,
        options: {
          subdomains: 'abcd',
          maxZoom: 20,
          attribution: '&copy; CARTO &copy; OpenStreetMap',
        },
      }
    : {
        url: 'https://services.arcgisonline.com/arcgis/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
        options: {
          maxZoom: 19,
          attribution: '&copy; Esri, HERE, Garmin, OpenStreetMap contributors',
        },
        referenceUrl: 'https://services.arcgisonline.com/arcgis/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
        referenceOptions: {
          maxZoom: 19,
          pane: 'tilePane',
          className: 'tile-reference',
        },
      },
  // Pure Midnight: High-contrast OpenStreetMap inverted to OLED pitch-black
  midnight: {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    options: {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      className: 'tile-midnight',
    },
  },
  // Photorealistic Satellite with dark road & location labels
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    options: {
      maxZoom: 19,
      attribution: '&copy; Esri, Maxar, Earthstar Geographics',
    },
    referenceUrl: 'https://services.arcgisonline.com/arcgis/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
    referenceOptions: {
      maxZoom: 19,
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
  onMapClick,
  onMapReady,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const baseLayerRef = useRef<L.TileLayer | null>(null);
  const referenceLayerRef = useRef<L.TileLayer | null>(null);
  const userMarkerRef = useRef<L.Marker | null>(null);
  const destinationMarkerRef = useRef<L.Marker | null>(null);
  const routePolylineBgRef = useRef<L.Polyline | null>(null);
  const routePolylineFgRef = useRef<L.Polyline | null>(null);

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
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    // Initial center: user location or default (Paris / London / NYC coordinates)
    const initialCenter: LatLng = userLocation
      ? [userLocation.lat, userLocation.lng]
      : [40.7128, -74.006]; // Default NYC coordinates

    const map = L.map(mapContainerRef.current, {
      center: initialCenter,
      zoom: 14,
      zoomControl: false,
      attributionControl: true,
    });

    // Add Tile Layers
    setTiles(map, mapStyle);

    // Map click handler (drop pin)
    map.on('click', (e: L.LeafletMouseEvent) => {
      onMapClick([e.latlng.lat, e.latlng.lng]);
    });

    mapInstanceRef.current = map;
    if (onMapReady) onMapReady(map);

    return () => {
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

    // Auto-center camera if in active navigation
    if (isNavigating) {
      map.panTo(currentCoords, { animate: true, duration: 0.6 });
    }
  }, [userLocation, activeNavLocation, isNavigating]);

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
    } else {
      destinationMarkerRef.current = L.marker(destCoords, {
        icon,
        draggable: true,
        zIndexOffset: 900,
      }).addTo(map);

      // Handle dragging the destination pin
      destinationMarkerRef.current.on('dragend', (e) => {
        const marker = e.target;
        const pos = marker.getLatLng();
        onMapClick([pos.lat, pos.lng]);
      });
    }
  }, [destination, onMapClick]);

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
    />
  );
};
