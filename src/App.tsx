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

  // Turn-by-Turn Navigation state: Audio guidance defaults to MUTED on start
  const [isNavigating, setIsNavigating] = useState(false);
  const [isSimulated, setIsSimulated] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [remainingDistance, setRemainingDistance] = useState(0);
  const [remainingDuration, setRemainingDuration] = useState(0);
  const [currentSpeed, setCurrentSpeed] = useState(0);
  const [activeNavLocation, setActiveNavLocation] = useState<LatLng | null>(null);
  const [isVoiceEnabled, setIsVoiceEnabled] = useState(false);
  const [locationErrorMsg, setLocationErrorMsg] = useState<string | null>(null);

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

  // Explicit user tap on Locate Me button (above zoom in/out)
  const handleLocateClick = useCallback(() => {
    // If location is already known, immediately center and zoom in logically like Google Maps
    if (userLocation && mapInstance) {
      mapInstance.flyTo([userLocation.lat, userLocation.lng], 16, { duration: 1.0 });
    }

    if (!navigator.geolocation) {
      setLocationErrorMsg('Geolocation is not supported by your browser.');
      setTimeout(() => setLocationErrorMsg(null), 4000);
      return;
    }

    setIsLocating(true);
    // Explicit user gesture will trigger iOS Safari's native permission prompt
    navigator.geolocation.getCurrentPosition(
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
        setLocationErrorMsg(null);

        if (mapInstance) {
          mapInstance.flyTo([coords.lat, coords.lng], 16, { duration: 1.0 });
          hasCenteredOnUserRef.current = true;
        }
      },
      (err) => {
        setIsLocating(false);
        if (err.code === 1) { // PERMISSION_DENIED
          setLocationErrorMsg('Location is blocked. In iOS: Settings > Safari > Location (choose Allow).');
        } else {
          setLocationErrorMsg('Could not get GPS signal. Please check your location settings.');
        }
        setTimeout(() => setLocationErrorMsg(null), 6000);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }, [userLocation, mapInstance]);

  // Attempt silent GPS fix on startup
  useEffect(() => {
    requestLocation(false);
  }, [requestLocation]);

  // Continuously update user location in background
  useEffect(() => {
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
        } catch {
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
    setIsRouteSheetCollapsed(false);
    if (mapInstance) {
      mapInstance.flyTo([place.lat, place.lng], 15, { duration: 1.2 });
    }
    fetchRoute([place.lat, place.lng], place.name, travelMode);
  };

  // 4. User drops a pin by clicking on the map (only when no destination is currently active)
  const handleMapClick = async (coords: LatLng) => {
    if (isNavigating) return;

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
    setIsRouteSheetCollapsed(false);
    fetchRoute(coords, placeName, travelMode);
  };

  // 5. User taps the map while a destination pin is already active:
  // Disables pin changes and instead collapses the sheet so user can view the full route!
  const handleMapTapWithDestination = () => {
    if (!isNavigating) {
      setIsRouteSheetCollapsed(true);
    }
  };

  // 6. Travel mode changed
  const handleChangeMode = (mode: TravelMode) => {
    setTravelMode(mode);
    try {
      localStorage.setItem('mapout_travel_mode', mode);
    } catch {
      // Ignored
    }
    if (selectedDestination) {
      fetchRoute([selectedDestination.lat, selectedDestination.lng], selectedDestination.name, mode);
    }
  };

  // 7. Clear destination
  const handleClearDestination = () => {
    setSelectedDestination(null);
    setRoute(null);
    setIsNavigating(false);
    setIsRouteSheetCollapsed(false);
    stopNavigation();
  };

  // 8. Start Navigation (Real GPS or Simulated)
  const handleStartNavigation = (simulated: boolean) => {
    if (!route || !route.geometry || route.geometry.length === 0) return;

    setIsNavigating(true);
    setIsSimulated(simulated);
    setCurrentStepIndex(0);
    setRemainingDistance(route.distance);
    setRemainingDuration(route.duration);

    // Audio guidance must always default to muted when navigation is started
    setIsVoiceEnabled(false);
    voiceGuidance.setEnabled(false);

    if (simulated) {
      startSimulation(route);
    } else {
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

    const speedKmh = travelMode === 'walking' ? 5 : travelMode === 'cycling' ? 18 : 45;
    setCurrentSpeed(speedKmh);

    simulationTimerRef.current = setInterval(() => {
      simIndexRef.current += 1;
      const currIdx = simIndexRef.current;

      if (currIdx >= totalPoints) {
        setActiveNavLocation(coords[totalPoints - 1]);
        setRemainingDistance(0);
        setRemainingDuration(0);
        if (simulationTimerRef.current) clearInterval(simulationTimerRef.current);
        return;
      }

      const currentPos = coords[currIdx];
      setActiveNavLocation(currentPos);

      const progressFraction = currIdx / totalPoints;
      const remDist = Math.max(0, Math.round(activeRoute.distance * (1 - progressFraction)));
      const remDur = Math.max(0, Math.round(activeRoute.duration * (1 - progressFraction)));
      setRemainingDistance(remDist);
      setRemainingDuration(remDur);

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

        if (mapInstance) {
          mapInstance.panTo(coords, { animate: true, duration: 0.8 });
        }

        if (route) {
          const destCoords = route.geometry[route.geometry.length - 1];
          const distToDest = calculateHaversineDistance(coords, destCoords);
          setRemainingDistance(Math.round(distToDest));

          route.steps.forEach((step, idx) => {
            const dist = calculateHaversineDistance(coords, step.location);
            if (dist < 40 && idx > currentStepIndex) {
              setCurrentStepIndex(idx);
              voiceGuidance.speak(step.instruction);
            }
          });

          if (distToDest < 30) {
            voiceGuidance.speak(`You have arrived at ${route.destinationName}`, true);
            stopNavigation();
          }
        }
      },
      (err) => {
        console.warn('Navigation GPS watch error:', err.message);
      },
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 1000 }
    );
  };

  // Toggle voice mute
  const handleToggleVoice = () => {
    const next = !isVoiceEnabled;
    setIsVoiceEnabled(next);
    voiceGuidance.setEnabled(next);
  };

  // Recenter during navigation
  const handleRecenter = () => {
    const target = activeNavLocation || (userLocation ? [userLocation.lat, userLocation.lng] as LatLng : null);
    if (target && mapInstance) {
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
    <main className="fixed inset-0 w-full h-full h-[100dvh] overflow-hidden bg-black text-white select-none">
      {/* Offline Connectivity Notification */}
      <OfflineIndicator />

      {/* Main Map Canvas: Covers entire full-screen with zero black margin */}
      <MapView
        userLocation={userLocation}
        destination={selectedDestination}
        route={route}
        mapStyle={mapStyle}
        isNavigating={isNavigating}
        activeNavLocation={activeNavLocation}
        hasDestination={!!selectedDestination}
        onMapClick={handleMapClick}
        onMapTapWithDestination={handleMapTapWithDestination}
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

      {/* Location Permission Notification Toast */}
      {locationErrorMsg && (
        <div
          id="location-permission-toast"
          className="fixed top-20 left-1/2 -translate-x-1/2 z-[1400] w-[90%] max-w-md p-3.5 rounded-2xl bg-zinc-950/95 border border-amber-500/30 text-amber-200 text-xs shadow-2xl backdrop-blur-xl flex items-center justify-between gap-3 animate-in slide-in-from-top-4"
        >
          <p className="leading-snug">{locationErrorMsg}</p>
          <button
            onClick={() => setLocationErrorMsg(null)}
            className="px-2.5 py-1 rounded-xl bg-zinc-800 text-white hover:bg-zinc-700 text-[11px] font-semibold shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Map Controls: Locate, Orient North, Style, Zoom */}
      <MapControls
        mapStyle={mapStyle}
        onChangeStyle={setMapStyle}
        onLocateMe={handleLocateClick}
        isLocating={isLocating}
        hasUserLocation={!!userLocation}
        onZoomIn={() => mapInstance?.zoomIn()}
        onZoomOut={() => mapInstance?.zoomOut()}
        onResetNorth={() => mapInstance?.setBearing ? mapInstance.setBearing(0) : mapInstance?.setView(mapInstance.getCenter(), mapInstance.getZoom())}
        isNavigating={isNavigating}
      />

      {/* Native Route Bottom Sheet (Peek and Expanded states, Drag gestures, Zero-twitch mode switching) */}
      <RouteBottomSheet
        route={route}
        isLoadingRoute={isLoadingRoute}
        travelMode={travelMode}
        onChangeMode={handleChangeMode}
        onStartNavigation={handleStartNavigation}
        onClose={handleClearDestination}
        isNavigating={isNavigating}
        isCollapsed={isRouteSheetCollapsed}
        onToggleCollapse={(collapsed) => setIsRouteSheetCollapsed(typeof collapsed === 'boolean' ? collapsed : !isRouteSheetCollapsed)}
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
