import React, { useState, useEffect, useRef, useCallback } from 'react';
import L from 'leaflet';
import { LatLng, MapStyle, PlaceResult, RouteData, TravelMode, UserLocation } from './types';
import { MapView } from './components/MapView';
import { SearchBar } from './components/SearchBar';
import { RouteBottomSheet } from './components/RouteBottomSheet';
import { NavigationHUD } from './components/NavigationHUD';
import { MapControls } from './components/MapControls';
import { OfflineIndicator } from './components/OfflineIndicator';
import { calculateRoute, reverseGeocode, calculateHaversineDistance } from './services/mapService';
import { voiceGuidance } from './utils/voiceGuidance';

export default function App() {
  const [mapInstance, setMapInstance] = useState<L.Map | null>(null);
  const [mapStyle, setMapStyle] = useState<MapStyle>('dark');
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  
  // Destination and Route state
  const [selectedDestination, setSelectedDestination] = useState<PlaceResult | null>(null);
  const [route, setRoute] = useState<RouteData | null>(null);
  const [isLoadingRoute, setIsLoadingRoute] = useState(false);
  const [travelMode, setTravelMode] = useState<TravelMode>('driving');

  // Turn-by-Turn Navigation state
  const [isNavigating, setIsNavigating] = useState(false);
  const [isSimulated, setIsSimulated] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [remainingDistance, setRemainingDistance] = useState(0);
  const [remainingDuration, setRemainingDuration] = useState(0);
  const [currentSpeed, setCurrentSpeed] = useState(0);
  const [activeNavLocation, setActiveNavLocation] = useState<LatLng | null>(null);
  const [isVoiceEnabled, setIsVoiceEnabled] = useState(true);

  // References for live GPS & Simulation
  const watchIdRef = useRef<number | null>(null);
  const simulationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const simIndexRef = useRef(0);
  const hasCenteredOnUserRef = useRef(false);

  // 1. Initial Location detection and continuous GPS watching
  const requestLocation = useCallback((forceCenter = false) => {
    if (!navigator.geolocation) {
      console.warn('Geolocation not supported by browser.');
      return;
    }

    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords: UserLocation = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          heading: pos.coords.heading,
          speed: pos.coords.speed ? pos.coords.speed * 3.6 : 0, // km/h
          accuracy: pos.coords.accuracy,
        };
        setUserLocation(coords);
        setIsLocating(false);

        if ((forceCenter || !hasCenteredOnUserRef.current) && mapInstance) {
          mapInstance.flyTo([coords.lat, coords.lng], 16, { duration: 1.2 });
          hasCenteredOnUserRef.current = true;
        }
      },
      (err) => {
        console.warn('Geolocation error / permission denied:', err.message);
        setIsLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 10000 }
    );
  }, [mapInstance]);

  // Continuously track real GPS user position
  useEffect(() => {
    requestLocation(true);

    if (!navigator.geolocation) return;

    const globalWatchId = navigator.geolocation.watchPosition(
      (pos) => {
        const coords: UserLocation = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          heading: pos.coords.heading,
          speed: pos.coords.speed ? pos.coords.speed * 3.6 : 0,
          accuracy: pos.coords.accuracy,
        };
        setUserLocation(coords);
        setIsLocating(false);

        if (!hasCenteredOnUserRef.current && mapInstance) {
          mapInstance.flyTo([coords.lat, coords.lng], 16, { duration: 1.2 });
          hasCenteredOnUserRef.current = true;
        }
      },
      (err) => {
        console.warn('Continuous GPS watch error:', err.message);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
    );

    return () => {
      navigator.geolocation.clearWatch(globalWatchId);
    };
  }, [mapInstance, requestLocation]);

  // 2. Route calculation when destination or travel mode changes
  const fetchRoute = useCallback(
    async (destCoords: LatLng, destName: string, mode: TravelMode) => {
      setIsLoadingRoute(true);

      // Real user starting point
      let startPoint: LatLng | null = userLocation ? [userLocation.lat, userLocation.lng] : null;

      // If user location not available yet, attempt immediate high-accuracy fix
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
        } catch (e) {
          console.warn('Real GPS not yet available, falling back to map center');
        }
      }

      // Fallback only if GPS completely unavailable/denied in browser
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
        setRoute(calculated);
        if (calculated) {
          setRemainingDistance(calculated.distance);
          setRemainingDuration(calculated.duration);
        }
      } catch (err) {
        console.error('Route calculation error:', err);
      } finally {
        setIsLoadingRoute(false);
      }
    },
    [userLocation, mapInstance]
  );

  // 3. User selects a place from Search
  const handleSelectPlace = (place: PlaceResult) => {
    setSelectedDestination(place);
    if (mapInstance) {
      mapInstance.flyTo([place.lat, place.lng], 15, { duration: 1.2 });
    }
    fetchRoute([place.lat, place.lng], place.name, travelMode);
  };

  // 4. User drops a pin by clicking on the map
  const handleMapClick = async (coords: LatLng) => {
    if (isNavigating) return; // Don't interrupt active navigation

    // Reverse geocode clicked location
    const placeName = await reverseGeocode(coords[0], coords[1]);
    const place: PlaceResult = {
      id: `pin-${Date.now()}`,
      name: placeName,
      label: `${coords[0].toFixed(5)}, ${coords[1].toFixed(5)}`,
      lat: coords[0],
      lng: coords[1],
    };

    setSelectedDestination(place);
    fetchRoute(coords, placeName, travelMode);
  };

  // 5. Travel mode changed
  const handleChangeMode = (mode: TravelMode) => {
    setTravelMode(mode);
    if (selectedDestination) {
      fetchRoute([selectedDestination.lat, selectedDestination.lng], selectedDestination.name, mode);
    }
  };

  // 6. Clear destination
  const handleClearDestination = () => {
    setSelectedDestination(null);
    setRoute(null);
    setIsNavigating(false);
    stopNavigation();
  };

  // 7. Start Navigation (Real GPS or Simulated)
  const handleStartNavigation = (simulated: boolean) => {
    if (!route || !route.geometry || route.geometry.length === 0) return;

    setIsNavigating(true);
    setIsSimulated(simulated);
    setCurrentStepIndex(0);
    setRemainingDistance(route.distance);
    setRemainingDuration(route.duration);

    // Initial voice announcement
    const firstStep = route.steps[0];
    const initialAnnouncement = firstStep
      ? `Starting route to ${route.destinationName}. ${firstStep.instruction}.`
      : `Starting navigation to ${route.destinationName}.`;
    voiceGuidance.speak(initialAnnouncement, true);

    if (simulated) {
      // Run route simulation along the coordinates
      startSimulation(route);
    } else {
      // Start live GPS tracking
      startGPSTracking();
    }
  };

  // Stop Navigation
  const stopNavigation = () => {
    setIsNavigating(false);
    setIsSimulated(false);
    setActiveNavLocation(null);
    voiceGuidance.stop();

    if (simulationTimerRef.current) {
      clearInterval(simulationTimerRef.current);
      simulationTimerRef.current = null;
    }

    if (watchIdRef.current !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  };

  // Start Simulation
  const startSimulation = (activeRoute: RouteData) => {
    if (simulationTimerRef.current) clearInterval(simulationTimerRef.current);

    simIndexRef.current = 0;
    const coords = activeRoute.geometry;
    const totalPoints = coords.length;

    // Simulation speed factor based on mode
    const speedKmh = travelMode === 'walking' ? 5 : travelMode === 'cycling' ? 18 : 45;
    setCurrentSpeed(speedKmh);

    simulationTimerRef.current = setInterval(() => {
      simIndexRef.current += 1;
      const currIdx = simIndexRef.current;

      if (currIdx >= totalPoints) {
        // Arrived at destination
        setActiveNavLocation(coords[totalPoints - 1]);
        setRemainingDistance(0);
        setRemainingDuration(0);
        voiceGuidance.speak(`You have arrived at your destination, ${activeRoute.destinationName}.`, true);
        if (simulationTimerRef.current) clearInterval(simulationTimerRef.current);
        return;
      }

      const currentPos = coords[currIdx];
      setActiveNavLocation(currentPos);

      // Estimate remaining progress
      const progressFraction = currIdx / totalPoints;
      const remDist = Math.max(0, Math.round(activeRoute.distance * (1 - progressFraction)));
      const remDur = Math.max(0, Math.round(activeRoute.duration * (1 - progressFraction)));
      setRemainingDistance(remDist);
      setRemainingDuration(remDur);

      // Check distance to next step maneuvers
      activeRoute.steps.forEach((step, sIdx) => {
        const distToManeuver = calculateHaversineDistance(currentPos, step.location);
        if (distToManeuver < 35 && sIdx > currentStepIndex) {
          setCurrentStepIndex(sIdx);
          voiceGuidance.speak(step.instruction);
        }
      });
    }, 1000);
  };

  // Start Live GPS Tracking
  const startGPSTracking = () => {
    if (!navigator.geolocation) return;

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const coords: LatLng = [pos.coords.latitude, pos.coords.longitude];
        setActiveNavLocation(coords);

        const speedKmh = pos.coords.speed ? pos.coords.speed * 3.6 : 0;
        setCurrentSpeed(speedKmh);

        setUserLocation({
          lat: coords[0],
          lng: coords[1],
          heading: pos.coords.heading,
          speed: speedKmh,
          accuracy: pos.coords.accuracy,
        });

        if (route) {
          // Check progress against steps
          route.steps.forEach((step, sIdx) => {
            const dist = calculateHaversineDistance(coords, step.location);
            if (dist < 30 && sIdx > currentStepIndex) {
              setCurrentStepIndex(sIdx);
              voiceGuidance.speak(step.instruction);
            }
          });
        }
      },
      (err) => {
        console.warn('GPS watch error:', err);
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 5000 }
    );
  };

  // Voice toggle
  const handleToggleVoice = () => {
    const nextVal = !isVoiceEnabled;
    setIsVoiceEnabled(nextVal);
    voiceGuidance.setEnabled(nextVal);
  };

  // Recenter map during navigation or idle
  const handleRecenter = () => {
    if (!mapInstance) return;
    const target = activeNavLocation || (userLocation ? [userLocation.lat, userLocation.lng] as LatLng : null);
    if (target) {
      mapInstance.flyTo(target, 17, { duration: 0.8 });
    }
  };

  // Manual next step (helpful in simulation or preview)
  const handleNextStep = () => {
    if (!route) return;
    const nextIdx = Math.min(currentStepIndex + 1, route.steps.length - 1);
    setCurrentStepIndex(nextIdx);
    const step = route.steps[nextIdx];
    if (step) {
      voiceGuidance.speak(step.instruction, true);
    }
  };

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-black text-white select-none">
      {/* Offline Connectivity Notification */}
      <OfflineIndicator />

      {/* Main Map Canvas */}
      <MapView
        userLocation={userLocation}
        destination={selectedDestination}
        route={route}
        mapStyle={mapStyle}
        isNavigating={isNavigating}
        activeNavLocation={activeNavLocation}
        onMapClick={handleMapClick}
        onMapReady={setMapInstance}
      />

      {/* Top Search Bar (idle state) */}
      <SearchBar
        userLocation={userLocation ? [userLocation.lat, userLocation.lng] : null}
        onSelectPlace={handleSelectPlace}
        onClearDestination={handleClearDestination}
        selectedDestination={selectedDestination}
        isNavigating={isNavigating}
      />

      {/* Map Controls: Locate, Orient North, Style, Zoom */}
      <MapControls
        mapStyle={mapStyle}
        onChangeStyle={setMapStyle}
        onLocateMe={() => requestLocation(true)}
        isLocating={isLocating}
        hasUserLocation={!!userLocation}
        onZoomIn={() => mapInstance?.zoomIn()}
        onZoomOut={() => mapInstance?.zoomOut()}
        onResetNorth={() => mapInstance?.setBearing ? mapInstance.setBearing(0) : mapInstance?.setView(mapInstance.getCenter(), mapInstance.getZoom())}
        isNavigating={isNavigating}
      />

      {/* Route Bottom Sheet (Destination preview & mode calculation) */}
      <RouteBottomSheet
        route={route}
        isLoadingRoute={isLoadingRoute}
        travelMode={travelMode}
        onChangeMode={handleChangeMode}
        onStartNavigation={handleStartNavigation}
        onClose={handleClearDestination}
        isNavigating={isNavigating}
      />

      {/* Active Turn-by-Turn Navigation HUD */}
      {isNavigating && route && (
        <NavigationHUD
          route={route}
          currentStepIndex={currentStepIndex}
          remainingDistance={remainingDistance}
          remainingDuration={remainingDuration}
          currentSpeed={currentSpeed}
          isVoiceEnabled={isVoiceEnabled}
          onToggleVoice={handleToggleVoice}
          onEndNavigation={stopNavigation}
          onRecenter={handleRecenter}
          isSimulated={isSimulated}
          onNextStep={isSimulated ? handleNextStep : undefined}
        />
      )}
    </main>
  );
}
