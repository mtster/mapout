import { useState, useRef, useCallback } from 'react';
import { Map as MapLibreMap } from 'maplibre-gl';
import { LatLng, PlaceResult, RouteData, TravelMode, UserLocation } from '../types';
import { calculateRoute, reverseGeocode } from '../services/mapService';

interface UseRoutePlannerParams {
  mapInstance: MapLibreMap | null;
  userLocation: UserLocation | null;
  setUserLocation: (loc: UserLocation) => void;
  isNavigating: boolean;
  onStopNavigation: () => void;
}

export function useRoutePlanner({
  mapInstance,
  userLocation,
  setUserLocation,
  isNavigating,
  onStopNavigation,
}: UseRoutePlannerParams) {
  // Destination and Route state
  const [selectedDestination, setSelectedDestination] = useState<PlaceResult | null>(null);
  const [route, setRoute] = useState<RouteData | null>(null);
  const [isLoadingRoute, setIsLoadingRoute] = useState(false);
  const [targetArrivalTimestamp, setTargetArrivalTimestamp] = useState<number | null>(null);
  const [remainingDistance, setRemainingDistance] = useState(0);
  const [remainingDuration, setRemainingDuration] = useState(0);

  // Persistent Travel Mode (Drive / Cycle / Walk)
  const [travelMode, setTravelMode] = useState<TravelMode>(() => {
    try {
      const saved = localStorage.getItem('mapout_travel_mode') as TravelMode;
      if (saved === 'driving' || saved === 'cycling' || saved === 'walking') {
        return saved;
      }
    } catch {
      // Ignored
    }
    return 'driving';
  });

  // Bottom sheet collapse/peek state
  const [isRouteSheetCollapsed, setIsRouteSheetCollapsed] = useState(false);

  // Request counter to avoid race conditions with out-of-order responses
  const routeRequestIdRef = useRef(0);

  // Calculate route when destination or travel mode changes
  const fetchRoute = useCallback(
    async (destCoords: LatLng, destName: string, mode: TravelMode) => {
      const currentRequestId = ++routeRequestIdRef.current;
      setIsLoadingRoute(true);

      let startPoint: LatLng | null = userLocation ? [userLocation.lat, userLocation.lng] : null;

      if (!startPoint && navigator.geolocation) {
        try {
          const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: true,
              timeout: 6000,
              maximumAge: 10000,
            });
          });
          const realCoords: UserLocation = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            heading: pos.coords.heading,
            speed: pos.coords.speed ? pos.coords.speed * 3.6 : 0,
            accuracy: pos.coords.accuracy,
          };
          setUserLocation(realCoords);
          startPoint = [realCoords.lat, realCoords.lng];
        } catch {
          console.warn('Real GPS not yet available, falling back to map center');
        }
      }

      if (!startPoint) {
        if (mapInstance) {
          const center = mapInstance.getCenter();
          startPoint = [center.lat, center.lng];
        } else {
          startPoint = [destCoords[0] - 0.015, destCoords[1] - 0.015];
        }
      }

      try {
        const calculated = await calculateRoute(startPoint, destCoords, mode, destName);
        if (currentRequestId !== routeRequestIdRef.current) return;
        setRoute(calculated);
        if (calculated) {
          setRemainingDistance(calculated.distance);
          setRemainingDuration(calculated.duration);
          // Lock the estimated arrival timestamp based on current time + calculated duration
          setTargetArrivalTimestamp(Date.now() + calculated.duration * 1000);
        }
      } catch (err) {
        if (currentRequestId === routeRequestIdRef.current) {
          console.error('Route calculation error:', err);
        }
      } finally {
        if (currentRequestId === routeRequestIdRef.current) {
          setIsLoadingRoute(false);
        }
      }
    },
    [userLocation, mapInstance, setUserLocation]
  );

  // User selects a place from Search
  const handleSelectPlace = useCallback(
    (place: PlaceResult) => {
      setSelectedDestination(place);
      setIsRouteSheetCollapsed(false);
      if (mapInstance) {
        const padBottom = Math.round((window.screen?.height || window.innerHeight) * 0.35);
        mapInstance.flyTo({
          center: [place.lng, place.lat],
          zoom: 15,
          duration: 1200,
          padding: { top: 0, bottom: padBottom, left: 0, right: 0 },
        });
      }
      fetchRoute([place.lat, place.lng], place.name, travelMode);
    },
    [mapInstance, fetchRoute, travelMode]
  );

  // User drops a pin by clicking on the map
  const handleMapClick = useCallback(
    async (coords: LatLng) => {
      if (isNavigating) return;

      const placeName = await reverseGeocode(coords[0], coords[1]);
      const place: PlaceResult = {
        id: `pin-${Date.now()}`,
        name: placeName,
        label: `${coords[0].toFixed(5)}, ${coords[1].toFixed(5)}`,
        lat: coords[0],
        lng: coords[1],
      };

      setSelectedDestination(place);
      setIsRouteSheetCollapsed(false);
      fetchRoute(coords, placeName, travelMode);
    },
    [isNavigating, fetchRoute, travelMode]
  );

  // User taps the map while a destination pin is already active -> collapse sheet
  const handleMapTapWithDestination = useCallback(() => {
    if (!isNavigating) {
      setIsRouteSheetCollapsed(true);
    }
  }, [isNavigating]);

  // Travel mode changed
  const handleChangeMode = useCallback(
    (mode: TravelMode) => {
      if (mode === travelMode) return; // Prevent unnecessary refetch if already active
      setTravelMode(mode);
      try {
        localStorage.setItem('mapout_travel_mode', mode);
      } catch {
        // Ignored
      }
      if (selectedDestination) {
        fetchRoute([selectedDestination.lat, selectedDestination.lng], selectedDestination.name, mode);
      }
    },
    [travelMode, selectedDestination, fetchRoute]
  );

  // Clear destination
  const handleClearDestination = useCallback(() => {
    routeRequestIdRef.current++;
    setSelectedDestination(null);
    setRoute(null);
    setIsRouteSheetCollapsed(false);
    setTargetArrivalTimestamp(null);
    onStopNavigation();
  }, [onStopNavigation]);

  return {
    selectedDestination,
    setSelectedDestination,
    route,
    setRoute,
    isLoadingRoute,
    travelMode,
    isRouteSheetCollapsed,
    setIsRouteSheetCollapsed,
    targetArrivalTimestamp,
    setTargetArrivalTimestamp,
    remainingDistance,
    setRemainingDistance,
    remainingDuration,
    setRemainingDuration,
    fetchRoute,
    handleSelectPlace,
    handleMapClick,
    handleMapTapWithDestination,
    handleChangeMode,
    handleClearDestination,
  };
}
