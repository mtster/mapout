import { useState, useRef, useCallback, useEffect } from 'react';
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
  const hasInitializedPresetRef = useRef(false);
  const selectedDestinationRef = useRef<PlaceResult | null>(null);
  selectedDestinationRef.current = selectedDestination;

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
        if (calculated) {
          // If geocoding resolved in parallel with a real address name, adopt it
          const currentDest = selectedDestinationRef.current;
          if (currentDest && currentDest.name && currentDest.name !== 'Dropped Pin') {
            calculated.destinationName = currentDest.name;
          }
          setRemainingDistance(calculated.distance);
          setRemainingDuration(calculated.duration);
          // Lock the estimated arrival timestamp based on current time + calculated duration
          setTargetArrivalTimestamp(Date.now() + calculated.duration * 1000);
        }
        setRoute(calculated);
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

  // Check URL params for preset shared destination pin on initial mount
  useEffect(() => {
    if (hasInitializedPresetRef.current || typeof window === 'undefined') return;
    hasInitializedPresetRef.current = true;

    try {
      const urlParams = new URLSearchParams(window.location.search);
      const dlatStr = urlParams.get('dlat') || urlParams.get('lat');
      const dlngStr = urlParams.get('dlng') || urlParams.get('lng');
      const nameStr = urlParams.get('name') || urlParams.get('dname');
      const modeStr = urlParams.get('mode') as TravelMode | null;

      if (dlatStr && dlngStr) {
        const lat = parseFloat(dlatStr);
        const lng = parseFloat(dlngStr);
        if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
          const placeName = nameStr ? decodeURIComponent(nameStr) : `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
          const place: PlaceResult = {
            id: `shared-${Date.now()}`,
            name: placeName,
            label: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
            lat,
            lng,
          };

          const activeMode =
            modeStr === 'driving' || modeStr === 'cycling' || modeStr === 'walking'
              ? modeStr
              : travelMode;

          if (activeMode !== travelMode) {
            setTravelMode(activeMode);
          }

          setSelectedDestination(place);
          setIsRouteSheetCollapsed(false);
          fetchRoute([lat, lng], placeName, activeMode);
        }
      }
    } catch (err) {
      console.warn('Could not parse shared preset route from URL:', err);
    }
  }, [fetchRoute, travelMode]);

  // User selects a place from Search - Directly requests route without separate intermediate flyTo bounce
  const handleSelectPlace = useCallback(
    (place: PlaceResult) => {
      setSelectedDestination(place);
      setIsRouteSheetCollapsed(false);
      fetchRoute([place.lat, place.lng], place.name, travelMode);
    },
    [fetchRoute, travelMode]
  );

  // User drops a pin by clicking on the map: instant feedback with parallel calculation
  const handleMapClick = useCallback(
    (coords: LatLng) => {
      if (isNavigating) return;

      const pinId = `pin-${Date.now()}`;
      const coordLabel = `${coords[0].toFixed(5)}, ${coords[1].toFixed(5)}`;
      const initialPlace: PlaceResult = {
        id: pinId,
        name: 'Dropped Pin',
        label: coordLabel,
        lat: coords[0],
        lng: coords[1],
      };

      // 1. Immediately drop the destination pin on the map and open sheet
      setSelectedDestination(initialPlace);
      setIsRouteSheetCollapsed(false);
      setRoute(null);

      // 2. Concurrently calculate route without waiting for reverse geocoding
      fetchRoute(coords, 'Dropped Pin', travelMode);

      // 3. Concurrently reverse geocode to resolve human-readable place name
      reverseGeocode(coords[0], coords[1])
        .then((resolvedName) => {
          if (!resolvedName) return;
          setSelectedDestination((prev) => {
            if (prev && prev.id === pinId) {
              return { ...prev, name: resolvedName };
            }
            return prev;
          });
          setRoute((prev) => {
            if (prev && prev.endPoint[0] === coords[0] && prev.endPoint[1] === coords[1]) {
              return { ...prev, destinationName: resolvedName };
            }
            return prev;
          });
        })
        .catch((err) => {
          console.warn('Reverse geocoding error:', err);
        });
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
      if (mode === travelMode) return;
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
