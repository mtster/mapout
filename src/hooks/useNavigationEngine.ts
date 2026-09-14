import React, { useState, useRef, useCallback } from 'react';
import { Map as MapLibreMap } from 'maplibre-gl';
import { LatLng, PlaceResult, RouteData, TravelMode, UserLocation } from '../types';
import {
  calculateRoute,
  calculateHaversineDistance,
  calculateBearing,
  calculateRemainingRouteTurf,
  snapToRoute,
  getRouteHeadingAtPoint,
} from '../services/mapService';
import { voiceGuidance } from '../utils/voiceGuidance';
import { useWakeLock } from './useWakeLock';

interface UseNavigationEngineParams {
  mapInstance: MapLibreMap | null;
  userLocation: UserLocation | null;
  setUserLocation: (loc: UserLocation) => void;
  route: RouteData | null;
  setRoute: React.Dispatch<React.SetStateAction<RouteData | null>>;
  selectedDestination: PlaceResult | null;
  travelMode: TravelMode;
  setRemainingDistance: (dist: number) => void;
  setRemainingDuration: (dur: number) => void;
  setTargetArrivalTimestamp: (ts: number | null) => void;
  setIsCenteredOnUser: (centered: boolean) => void;
}

export function useNavigationEngine({
  mapInstance,
  userLocation,
  setUserLocation,
  route,
  setRoute,
  selectedDestination,
  travelMode,
  setRemainingDistance,
  setRemainingDuration,
  setTargetArrivalTimestamp,
  setIsCenteredOnUser,
}: UseNavigationEngineParams) {
  // Navigation state
  const [isNavigating, setIsNavigating] = useState(false);
  const [isSimulated, setIsSimulated] = useState(false);
  const [isFollowingUser, setIsFollowingUser] = useState(true);

  // Screen Wake Lock: Keeps screen awake during active navigation
  useWakeLock(isNavigating);

  const [currentNavHeading, setCurrentNavHeading] = useState<number | null>(null);
  const [bearing, setBearing] = useState(0);
  const [recenterTrigger, setRecenterTrigger] = useState(0);

  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [currentSpeed, setCurrentSpeed] = useState(0);
  const [activeNavLocation, setActiveNavLocation] = useState<LatLng | null>(null);
  const [isVoiceEnabled, setIsVoiceEnabled] = useState(false);

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

  // Route overview zoom-out mode during navigation
  const [isRouteOverview, setIsRouteOverview] = useState(false);

  // Stop Navigation: preserves map camera exactly where the user is looking
  const stopNavigation = useCallback(() => {
    setIsNavigating(false);
    setIsSimulated(false);
    setIsFollowingUser(true);
    setIsRouteOverview(false);
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

    if (mapInstance) {
      mapInstance.easeTo({
        pitch: 0,
        duration: 400,
      });
    }
  }, [mapInstance]);

  // Start Simulation with Turf local calculation
  const startSimulation = useCallback(
    (activeRoute: RouteData) => {
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
    },
    [travelMode, setRemainingDistance, setRemainingDuration]
  );

  // Start Live GPS Tracking with Turf Snapping, Off-Route Detection & Auto-Rerouting
  const startGPSTracking = useCallback(() => {
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
        if (err.code === 3 /* TIMEOUT */) return;
        console.warn('Navigation GPS watch error:', err.message);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 2000 }
    );
  }, [setUserLocation, setRemainingDistance, setRemainingDuration, setRoute, setTargetArrivalTimestamp, stopNavigation]);

  // Start Navigation (Real GPS or Simulated)
  const handleStartNavigation = useCallback(
    (simulated: boolean) => {
      const currentRoute = routeRef.current;
      if (!currentRoute || !currentRoute.geometry || currentRoute.geometry.length === 0) return;

      setIsNavigating(true);
      setIsSimulated(simulated);
      setIsFollowingUser(true);
      setRecenterTrigger((prev) => prev + 1);
      setCurrentStepIndex(0);
      currentStepIndexRef.current = 0;
      offRouteCounterRef.current = 0;
      isReroutingRef.current = false;
      lastRerouteTimeRef.current = 0;
      setRemainingDistance(currentRoute.distance);
      setRemainingDuration(currentRoute.duration);

      // Lock the ETA target arrival timestamp when navigation starts!
      const lockedArrivalTimestamp = Date.now() + currentRoute.duration * 1000;
      setTargetArrivalTimestamp(lockedArrivalTimestamp);

      // Compute initial road heading so map orients forward immediately
      if (currentRoute.geometry.length > 1) {
        const initHeading = calculateBearing(currentRoute.geometry[0], currentRoute.geometry[1]);
        setCurrentNavHeading(initHeading);
      }

      // Audio guidance defaults to muted when navigation is started
      setIsVoiceEnabled(false);
      voiceGuidance.setEnabled(false);

      if (simulated) {
        startSimulation(currentRoute);
      } else {
        startGPSTracking();
      }
    },
    [setRemainingDistance, setRemainingDuration, setTargetArrivalTimestamp, startSimulation, startGPSTracking]
  );

  // Toggle voice mute
  const handleToggleVoice = useCallback(() => {
    setIsVoiceEnabled((prev) => {
      const next = !prev;
      voiceGuidance.setEnabled(next);
      return next;
    });
  }, []);

  // User manually panned or zoomed the map away
  const handleUserPanOrZoom = useCallback(() => {
    setIsCenteredOnUser(false);
    if (isNavigating) {
      setIsFollowingUser(false);
      setIsRouteOverview(false);
    }
  }, [isNavigating, setIsCenteredOnUser]);

  // Recenter during navigation: restores standard 3D perspective turn-by-turn follow camera
  const handleRecenter = useCallback(() => {
    setIsRouteOverview(false);
    setIsFollowingUser(true);
    setRecenterTrigger((prev) => prev + 1);
  }, []);

  // Toggle Route Overview zoom-out during navigation
  const handleToggleRouteOverview = useCallback(() => {
    setIsRouteOverview((prev) => {
      const next = !prev;
      if (next) {
        setIsFollowingUser(false);
      } else {
        setIsFollowingUser(true);
        setRecenterTrigger((r) => r + 1);
      }
      return next;
    });
  }, []);

  // Manual next step in simulation
  const handleNextStep = useCallback(() => {
    const currentRoute = routeRef.current;
    if (!currentRoute) return;
    const nextIdx = Math.min(currentStepIndexRef.current + 1, currentRoute.steps.length - 1);
    setCurrentStepIndex(nextIdx);
    currentStepIndexRef.current = nextIdx;
    const step = currentRoute.steps[nextIdx];
    if (step) {
      voiceGuidance.speak(step.instruction, true);
    }
  }, []);

  return {
    isNavigating,
    isSimulated,
    isFollowingUser,
    isRouteOverview,
    currentNavHeading,
    bearing,
    setBearing,
    recenterTrigger,
    currentStepIndex,
    currentSpeed,
    activeNavLocation,
    isVoiceEnabled,
    handleStartNavigation,
    stopNavigation,
    handleToggleVoice,
    handleUserPanOrZoom,
    handleRecenter,
    handleToggleRouteOverview,
    handleNextStep,
  };
}
