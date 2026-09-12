import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Map as MapLibreMap } from 'maplibre-gl';
import { LatLng, MapStyle, PlaceResult, RouteData, TravelMode, UserLocation } from './types';
import { MapView } from './components/MapView';
import { SearchBar } from './components/SearchBar';
import { RouteBottomSheet } from './components/RouteBottomSheet';
import { NavigationHUD } from './components/NavigationHUD';
import { MapControls } from './components/MapControls';
import { OfflineIndicator } from './components/OfflineIndicator';
import { AttributionButton } from './components/AttributionButton';
import {
  calculateRoute,
  reverseGeocode,
  calculateHaversineDistance,
  calculateBearing,
  calculateRemainingRouteTurf,
  snapToRoute,
  getRouteHeadingAtPoint,
} from './services/mapService';
import { voiceGuidance } from './utils/voiceGuidance';
import { useWakeLock } from './hooks/useWakeLock';

export default function App() {
  const [mapInstance, setMapInstance] = useState<MapLibreMap | null>(null);
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

  // Turn-by-Turn Navigation state
  const [isNavigating, setIsNavigating] = useState(false);
  const [isSimulated, setIsSimulated] = useState(false);
  const [isFollowingUser, setIsFollowingUser] = useState(true);

  // Screen Wake Lock: Keeps screen awake during active navigation
  useWakeLock(isNavigating);
  const [currentNavHeading, setCurrentNavHeading] = useState<number | null>(null);
  const [bearing, setBearing] = useState(0);
  const [recenterTrigger, setRecenterTrigger] = useState(0);

  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [remainingDistance, setRemainingDistance] = useState(0);
  const [remainingDuration, setRemainingDuration] = useState(0);
  const [targetArrivalTimestamp, setTargetArrivalTimestamp] = useState<number | null>(null);
  const [currentSpeed, setCurrentSpeed] = useState(0);
  const [activeNavLocation, setActiveNavLocation] = useState<LatLng | null>(null);
  const [isVoiceEnabled, setIsVoiceEnabled] = useState(false);
  const [locationErrorMsg, setLocationErrorMsg] = useState<string | null>(null);

  // Mutable refs to prevent stale closures in watch callbacks & timers
  const routeRef = useRef<RouteData | null>(null);
  routeRef.current = route;

  const currentStepIndexRef = useRef(0);
  currentStepIndexRef.current = currentStepIndex;

  const travelModeRef = useRef<TravelMode>(travelMode);
  travelModeRef.current = travelMode;

  const selectedDestinationRef = useRef<PlaceResult | null>(null);
  selectedDestinationRef.current = selectedDestination;

  const offRouteCounterRef = useRef(0);
  const lastRerouteTimeRef = useRef(0);
  const isReroutingRef = useRef(false);

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
          mapInstance.flyTo({ center: [coords.lng, coords.lat], zoom: 16, duration: 1200 });
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

  // Explicit user tap on Locate Me button
  const handleLocateClick = useCallback(() => {
    if (userLocation && mapInstance) {
      mapInstance.flyTo({ center: [userLocation.lng, userLocation.lat], zoom: 16, duration: 1000 });
    }

    if (!navigator.geolocation) {
      setLocationErrorMsg('Geolocation is not supported by your browser.');
      setTimeout(() => setLocationErrorMsg(null), 4000);
      return;
    }

    setIsLocating(true);
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
          mapInstance.flyTo({ center: [coords.lng, coords.lat], zoom: 16, duration: 1000 });
          hasCenteredOnUserRef.current = true;
        }
      },
      (err) => {
        setIsLocating(false);
        if (err.code === 1) {
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
          mapInstance.flyTo({ center: [coords.lng, coords.lat], zoom: 16, duration: 1200 });
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
        setRoute(calculated);
        if (calculated) {
          setRemainingDistance(calculated.distance);
          setRemainingDuration(calculated.duration);
          // Lock the estimated arrival timestamp based on current time + calculated duration
          setTargetArrivalTimestamp(Date.now() + calculated.duration * 1000);
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
      const padBottom = Math.round((window.screen?.height || window.innerHeight) * 0.35);
      mapInstance.flyTo({
        center: [place.lng, place.lat],
        zoom: 15,
        duration: 1200,
        padding: { top: 0, bottom: padBottom, left: 0, right: 0 },
      });
    }
    fetchRoute([place.lat, place.lng], place.name, travelMode);
  };

  // 4. User drops a pin by clicking on the map
  const handleMapClick = async (coords: LatLng) => {
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
  };

  // 5. User taps the map while a destination pin is already active -> collapse sheet
  const handleMapTapWithDestination = () => {
    if (!isNavigating) {
      setIsRouteSheetCollapsed(true);
    }
  };

  // 6. Travel mode changed
  const handleChangeMode = (mode: TravelMode) => {
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
  };

  // 7. Clear destination
  const handleClearDestination = () => {
    setSelectedDestination(null);
    setRoute(null);
    setIsNavigating(false);
    setIsRouteSheetCollapsed(false);
    setTargetArrivalTimestamp(null);
    stopNavigation();
  };

  // Standard zoom levels for navigation
  const STANDARD_NAV_ZOOM: Record<TravelMode, number> = {
    driving: 17,
    cycling: 17.5,
    walking: 18,
  };

  // 8. Start Navigation (Real GPS or Simulated)
  const handleStartNavigation = (simulated: boolean) => {
    if (!route || !route.geometry || route.geometry.length === 0) return;

    setIsNavigating(true);
    setIsSimulated(simulated);
    setIsFollowingUser(true);
    setRecenterTrigger((prev) => prev + 1);
    setCurrentStepIndex(0);
    currentStepIndexRef.current = 0;
    offRouteCounterRef.current = 0;
    isReroutingRef.current = false;
    lastRerouteTimeRef.current = 0;
    setRemainingDistance(route.distance);
    setRemainingDuration(route.duration);

    // CRITICAL: Lock the ETA target arrival timestamp when navigation starts!
    const lockedArrivalTimestamp = Date.now() + route.duration * 1000;
    setTargetArrivalTimestamp(lockedArrivalTimestamp);

    // Compute initial road heading so map orients forward immediately
    if (route.geometry.length > 1) {
      const initHeading = calculateBearing(route.geometry[0], route.geometry[1]);
      setCurrentNavHeading(initHeading);
    }

    // Audio guidance defaults to muted when navigation is started
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
    setIsFollowingUser(true);
    setActiveNavLocation(null);
    setCurrentNavHeading(null);
    offRouteCounterRef.current = 0;
    isReroutingRef.current = false;
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

  // Start Simulation with Turf local calculation
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
        voiceGuidance.speak(`You have arrived at ${activeRoute.destinationName}`, true);
        if (simulationTimerRef.current) clearInterval(simulationTimerRef.current);
        return;
      }

      const currentPos = coords[currIdx];
      setActiveNavLocation(currentPos);

      // Continuously update road heading so road points forward
      if (currIdx < totalPoints - 1) {
        const nextPos = coords[currIdx + 1];
        const roadHeading = calculateBearing(currentPos, nextPos);
        setCurrentNavHeading(roadHeading);
      }

      const dest = selectedDestinationRef.current;
      if (dest) {
        // Turf-based slice calculation for remaining distance & duration
        const turfResult = calculateRemainingRouteTurf(currentPos, activeRoute.geometry, [dest.lat, dest.lng]);
        const progressFraction = activeRoute.distance > 0 ? turfResult.remainingDistanceMeters / activeRoute.distance : 0;
        const remDur = Math.max(0, Math.round(activeRoute.duration * progressFraction));

        setRemainingDistance(turfResult.remainingDistanceMeters);
        setRemainingDuration(remDur);
      }

      // Turn instructions
      activeRoute.steps.forEach((step, sIdx) => {
        const distToManeuver = calculateHaversineDistance(currentPos, step.location);
        if (distToManeuver < 35 && sIdx > currentStepIndexRef.current) {
          setCurrentStepIndex(sIdx);
          currentStepIndexRef.current = sIdx;
          voiceGuidance.speak(step.instruction);
        }
      });
    }, 1000);
  };

  // Start Live GPS Tracking with Turf Snapping, Off-Route Detection & Auto-Rerouting
  const startGPSTracking = () => {
    if (!navigator.geolocation) return;

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const rawCoords: LatLng = [pos.coords.latitude, pos.coords.longitude];
        const speedKmh = pos.coords.speed ? pos.coords.speed * 3.6 : 0;
        setCurrentSpeed(speedKmh);

        const currentRoute = routeRef.current;
        const dest = selectedDestinationRef.current;

        let roadHeading = pos.coords.heading;
        if (
          (roadHeading === null || roadHeading === undefined || isNaN(roadHeading) || roadHeading < 0) &&
          currentRoute &&
          currentRoute.geometry
        ) {
          const routeTangent = getRouteHeadingAtPoint(rawCoords, currentRoute.geometry);
          if (routeTangent !== null) {
            roadHeading = routeTangent;
          } else {
            const nextTarget =
              currentRoute.geometry[
                Math.min(currentStepIndexRef.current + 1, currentRoute.geometry.length - 1)
              ];
            roadHeading = calculateBearing(rawCoords, nextTarget);
          }
        }
        if (roadHeading !== null && roadHeading !== undefined && !isNaN(roadHeading)) {
          setCurrentNavHeading(roadHeading);
        }

        setUserLocation({
          lat: rawCoords[0],
          lng: rawCoords[1],
          heading: roadHeading ?? undefined,
          speed: speedKmh,
          accuracy: pos.coords.accuracy,
        });

        if (currentRoute && currentRoute.geometry && dest) {
          const destCoords: LatLng = [dest.lat, dest.lng];

          // 1. Turf calculation for map matching & local slicing
          const turfResult = calculateRemainingRouteTurf(rawCoords, currentRoute.geometry, destCoords);

          // 2. Map Matching / Snapping: Snap to route centerline if within 35m
          const snapped = snapToRoute(rawCoords, currentRoute.geometry, 35);
          setActiveNavLocation(snapped.snapped);

          // 3. Local ETA & Distance Update without API calls
          setRemainingDistance(turfResult.remainingDistanceMeters);
          const progressFraction =
            currentRoute.distance > 0 ? turfResult.remainingDistanceMeters / currentRoute.distance : 0;
          const remDur = Math.max(0, Math.round(currentRoute.duration * progressFraction));
          setRemainingDuration(remDur);

          // 4. Intelligent Safe Auto-Rerouting with Turf
          const offDist = turfResult.offRouteDistance;
          const now = Date.now();
          const canReroute = now - lastRerouteTimeRef.current > 6000 && !isReroutingRef.current;

          if (offDist > 40) {
            offRouteCounterRef.current += 1;
            // Trigger reroute if off-route > 65m immediately OR > 40m for 2 consecutive GPS updates
            if ((offDist > 65 || offRouteCounterRef.current >= 2) && canReroute) {
              lastRerouteTimeRef.current = now;
              isReroutingRef.current = true;
              offRouteCounterRef.current = 0;
              voiceGuidance.speak('Rerouting...', true);

              calculateRoute(rawCoords, destCoords, travelModeRef.current, dest.name)
                .then((newRoute) => {
                  if (newRoute) {
                    setRoute(newRoute);
                    setCurrentStepIndex(0);
                    currentStepIndexRef.current = 0;
                    setRemainingDistance(newRoute.distance);
                    setRemainingDuration(newRoute.duration);
                    setTargetArrivalTimestamp(Date.now() + newRoute.duration * 1000);
                    if (newRoute.steps.length > 0) {
                      voiceGuidance.speak(newRoute.steps[0].instruction);
                    }
                  }
                })
                .catch((err) => console.warn('Auto-rerouting failed:', err))
                .finally(() => {
                  isReroutingRef.current = false;
                });
            }
          } else {
            offRouteCounterRef.current = 0;
          }

          // 5. Turn maneuver step trigger
          currentRoute.steps.forEach((step, idx) => {
            const dist = calculateHaversineDistance(rawCoords, step.location);
            if (dist < 40 && idx > currentStepIndexRef.current) {
              setCurrentStepIndex(idx);
              currentStepIndexRef.current = idx;
              voiceGuidance.speak(step.instruction);
            }
          });

          // 6. Arrival check
          if (turfResult.remainingDistanceMeters < 25) {
            voiceGuidance.speak(`You have arrived at ${currentRoute.destinationName}`, true);
            stopNavigation();
          }
        } else {
          setActiveNavLocation(rawCoords);
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

  // User manually panned or zoomed the map away during navigation
  const handleUserPanOrZoom = useCallback(() => {
    if (isNavigating) {
      setIsFollowingUser(false);
    }
  }, [isNavigating]);

  // Recenter during navigation
  const handleRecenter = useCallback(() => {
    setIsFollowingUser(true);
    setRecenterTrigger((prev) => prev + 1);
  }, []);

  // Reset map rotation back to standard North orientation (bearing = 0)
  const handleResetNorth = useCallback(() => {
    if (mapInstance) {
      mapInstance.easeTo({ bearing: 0, pitch: 0, duration: 400 });
      setBearing(0);
    }
  }, [mapInstance]);

  // Manual next step in simulation
  const handleNextStep = () => {
    if (!route) return;
    const nextIdx = Math.min(currentStepIndex + 1, route.steps.length - 1);
    setCurrentStepIndex(nextIdx);
    currentStepIndexRef.current = nextIdx;
    const step = route.steps[nextIdx];
    if (step) {
      voiceGuidance.speak(step.instruction, true);
    }
  };

  return (
    <main id="main-view" className="absolute inset-0 w-full h-full overflow-visible bg-black text-white select-none">
      {/* Offline Connectivity Notification */}
      <OfflineIndicator />

      {/* Main Map Canvas: Hardware-accelerated MapLibre GL JS Vector Map */}
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
        isFollowingUser={isFollowingUser}
        onUserPanOrZoom={handleUserPanOrZoom}
        targetHeading={currentNavHeading}
        standardNavZoom={STANDARD_NAV_ZOOM[travelMode]}
        recenterTrigger={recenterTrigger}
        onBearingChange={setBearing}
        isRouteSheetCollapsed={isRouteSheetCollapsed}
      />

      {/* Top Search Bar (idle state) */}
      <SearchBar
        userLocation={userLocation ? [userLocation.lat, userLocation.lng] : null}
        onSelectPlace={handleSelectPlace}
        onClearDestination={handleClearDestination}
        selectedDestination={selectedDestination}
        isNavigating={isNavigating}
      />

      {/* Attribution Button (Top-left below search bar, matching bottom-right control button styling) */}
      <AttributionButton isNavigating={isNavigating} />

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
        onResetNorth={handleResetNorth}
        isNavigating={isNavigating}
        bearing={bearing}
        hasActiveDestination={!!route && !isNavigating}
        isRouteSheetCollapsed={isRouteSheetCollapsed}
      />

      {/* Native Route Bottom Sheet */}
      <RouteBottomSheet
        route={route}
        isLoadingRoute={isLoadingRoute}
        travelMode={travelMode}
        onChangeMode={handleChangeMode}
        onStartNavigation={handleStartNavigation}
        onClose={handleClearDestination}
        isNavigating={isNavigating}
        isCollapsed={isRouteSheetCollapsed}
        onToggleCollapse={(collapsed) =>
          setIsRouteSheetCollapsed(typeof collapsed === 'boolean' ? collapsed : !isRouteSheetCollapsed)
        }
      />

      {/* Active Turn-by-Turn Navigation HUD */}
      {isNavigating && route && (
        <NavigationHUD
          route={route}
          currentStepIndex={currentStepIndex}
          remainingDistance={remainingDistance}
          remainingDuration={remainingDuration}
          targetArrivalTimestamp={targetArrivalTimestamp}
          currentSpeed={currentSpeed}
          isVoiceEnabled={isVoiceEnabled}
          onToggleVoice={handleToggleVoice}
          onEndNavigation={stopNavigation}
          onRecenter={handleRecenter}
          showRecenter={!isFollowingUser}
          isSimulated={isSimulated}
          onNextStep={isSimulated ? handleNextStep : undefined}
        />
      )}
    </main>
  );
}
