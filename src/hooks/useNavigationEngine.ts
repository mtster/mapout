import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Map as MapLibreMap } from 'maplibre-gl';
import { LatLng, PlaceResult, RouteData, TravelMode, UserLocation } from '../types';
import {
  calculateRoute,
  calculateHaversineDistance,
  calculateBearing,
  getShortestAngleDiff,
  IndexedRoute,
  buildIndexedRoute,
  getPointAtRouteDistance,
  getHeadingAtRouteDistance,
  snapPointToIndexedRoute,
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
  const [activeNavRouteDist, setActiveNavRouteDist] = useState<number | null>(null);
  const [isVoiceEnabled, setIsVoiceEnabled] = useState(false);

  // Mutable refs to prevent stale closures in watch callbacks & timers
  const routeRef = useRef<RouteData | null>(null);
  routeRef.current = route;

  const indexedRouteRef = useRef<IndexedRoute | null>(null);
  useEffect(() => {
    indexedRouteRef.current = route?.geometry ? buildIndexedRoute(route.geometry) : null;
  }, [route]);

  const currentStepIndexRef = useRef(0);
  currentStepIndexRef.current = currentStepIndex;

  const currentNavHeadingRef = useRef<number | null>(null);
  currentNavHeadingRef.current = currentNavHeading;

  const travelModeRef = useRef<TravelMode>(travelMode);
  travelModeRef.current = travelMode;

  const selectedDestinationRef = useRef<PlaceResult | null>(null);
  selectedDestinationRef.current = selectedDestination;

  const offRouteCounterRef = useRef(0);
  const wasSnappedRef = useRef(true);
  const lastRerouteTimeRef = useRef(0);
  const lastRerouteCoordsRef = useRef<LatLng | null>(null);
  const isReroutingRef = useRef(false);
  const prevGpsCoordsRef = useRef<LatLng | null>(null);
  const prevGpsTimestampRef = useRef<number>(0);
  const wrongDirectionCounterRef = useRef(0);

  const watchIdRef = useRef<number | null>(null);
  const simulationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const simDistMetersRef = useRef(0);

  // Route overview zoom-out mode during navigation
  const [isRouteOverview, setIsRouteOverview] = useState(false);

  // Stop Navigation: preserves map camera exactly where the user is looking
  const stopNavigation = useCallback(() => {
    setIsNavigating(false);
    setIsSimulated(false);
    setIsFollowingUser(true);
    setIsRouteOverview(false);
    setActiveNavLocation(null);
    setActiveNavRouteDist(null);
    setCurrentNavHeading(null);
    currentNavHeadingRef.current = null;
    offRouteCounterRef.current = 0;
    wasSnappedRef.current = true;
    isReroutingRef.current = false;
    lastRerouteCoordsRef.current = null;
    prevGpsCoordsRef.current = null;
    prevGpsTimestampRef.current = 0;
    wrongDirectionCounterRef.current = 0;
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

  // Start Simulation with constant physical Turf distance progression along the route
  const startSimulation = useCallback(
    (activeRoute: RouteData) => {
      if (simulationTimerRef.current) clearInterval(simulationTimerRef.current);

      const indexed = buildIndexedRoute(activeRoute.geometry);
      indexedRouteRef.current = indexed;
      if (!indexed) return;

      simDistMetersRef.current = 0;
      const speedKmh = travelMode === 'walking' ? 5 : travelMode === 'cycling' ? 18 : 45;
      const speedMps = speedKmh / 3.6;
      const tickMs = 800;
      const stepMeters = speedMps * (tickMs / 1000);
      setCurrentSpeed(speedKmh);

      const emitSimStep = (distMeters: number) => {
        const clampedDist = Math.min(distMeters, indexed.totalMeters);
        const currentPos = getPointAtRouteDistance(indexed, clampedDist);
        const roadHeading = getHeadingAtRouteDistance(indexed, clampedDist);

        setActiveNavLocation(currentPos);
        setActiveNavRouteDist(clampedDist);

        if (roadHeading !== null && !isNaN(roadHeading)) {
          setCurrentNavHeading(roadHeading);
          currentNavHeadingRef.current = roadHeading;
        }

        const remDist = Math.max(0, Math.round(indexed.totalMeters - clampedDist));
        const progressFraction = indexed.totalMeters > 0 ? remDist / indexed.totalMeters : 0;
        const remDur = Math.max(0, Math.round(activeRoute.duration * progressFraction));

        setRemainingDistance(remDist);
        setRemainingDuration(remDur);

        // Turn instructions
        activeRoute.steps.forEach((step, sIdx) => {
          const distToManeuver = calculateHaversineDistance(currentPos, step.location);
          if (distToManeuver < 35 && sIdx > currentStepIndexRef.current) {
            setCurrentStepIndex(sIdx);
            currentStepIndexRef.current = sIdx;
            voiceGuidance.speak(step.instruction);
          }
        });

        if (clampedDist >= indexed.totalMeters) {
          setRemainingDistance(0);
          setRemainingDuration(0);
          voiceGuidance.speak(`You have arrived at ${activeRoute.destinationName}`, true);
          if (simulationTimerRef.current) {
            clearInterval(simulationTimerRef.current);
            simulationTimerRef.current = null;
          }
        }
      };

      // Emit initial frame at 0m immediately
      emitSimStep(0);

      simulationTimerRef.current = setInterval(() => {
        simDistMetersRef.current += stepMeters;
        emitSimStep(simDistMetersRef.current);
      }, tickMs);
    },
    [travelMode, setRemainingDistance, setRemainingDuration]
  );

  // Start Live GPS Tracking with Turf Snapping, Off-Route Detection, Wrong-Direction Detection & Auto-Rerouting
  const startGPSTracking = useCallback(() => {
    if (!navigator.geolocation) return;

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const rawCoords: LatLng = [pos.coords.latitude, pos.coords.longitude];
        const nowMs = Date.now();

        // Compute reliable speed: prefer GPS sensor speed, fallback to delta distance / delta time
        let speedKmh =
          pos.coords.speed !== null && !isNaN(pos.coords.speed) && pos.coords.speed >= 0
            ? pos.coords.speed * 3.6
            : 0;

        let userHeading: number | null = null;
        if (pos.coords.heading !== null && !isNaN(pos.coords.heading) && pos.coords.heading >= 0) {
          userHeading = pos.coords.heading;
        }

        if (prevGpsCoordsRef.current) {
          const distFromPrev = calculateHaversineDistance(prevGpsCoordsRef.current, rawCoords);
          const dtSeconds = prevGpsTimestampRef.current > 0 ? (nowMs - prevGpsTimestampRef.current) / 1000 : 0;

          if (
            (pos.coords.speed === null || isNaN(pos.coords.speed)) &&
            dtSeconds >= 0.3 &&
            distFromPrev >= 2
          ) {
            speedKmh = Math.min((distFromPrev / dtSeconds) * 3.6, 180);
          }

          if (userHeading === null && distFromPrev >= 3) {
            userHeading = calculateBearing(prevGpsCoordsRef.current, rawCoords);
          }
        }

        prevGpsCoordsRef.current = rawCoords;
        prevGpsTimestampRef.current = nowMs;
        setCurrentSpeed(speedKmh);

        const currentRoute = routeRef.current;
        const dest = selectedDestinationRef.current;
        let indexed = indexedRouteRef.current;
        if (!indexed && currentRoute?.geometry) {
          indexed = buildIndexedRoute(currentRoute.geometry);
          indexedRouteRef.current = indexed;
        }

        if (currentRoute && currentRoute.geometry && indexed && dest) {
          const destCoords: LatLng = [dest.lat, dest.lng];

          // 1. Single-pass Turf snapping onto IndexedRoute
          const snap = snapPointToIndexedRoute(rawCoords, indexed);
          const offDist = snap.offRouteDistance;
          const routeTangent = snap.routeTangent;

          // 2. Opposite / Wrong-direction detection:
          // When user is moving at vehicle or cycling speed (>= 4.5 km/h) and traveling opposite to the route line (> 110 deg difference)
          let isWrongDirection = false;
          if (routeTangent !== null && userHeading !== null && speedKmh >= 4.5) {
            const headingDiff = Math.abs(getShortestAngleDiff(userHeading, routeTangent));
            if (headingDiff > 110) {
              wrongDirectionCounterRef.current += 1;
            } else {
              wrongDirectionCounterRef.current = Math.max(0, wrongDirectionCounterRef.current - 1);
            }

            if (wrongDirectionCounterRef.current >= 2) {
              isWrongDirection = true;
            }
          } else {
            wrongDirectionCounterRef.current = 0;
          }

          // 3. Intelligent Route Corridor Snapping with Hysteresis
          const snapThreshold = wasSnappedRef.current ? 65 : 45;
          const isWithinCorridor = offDist <= snapThreshold;

          if (!isWithinCorridor) {
            offRouteCounterRef.current += 1;
          } else {
            offRouteCounterRef.current = 0;
          }

          const isConfirmedOffRoute = offDist > 80 || offRouteCounterRef.current >= 2;
          wasSnappedRef.current = !isConfirmedOffRoute && !isWrongDirection;

          let displayPos: LatLng;
          let routeDist: number | null;
          let roadHeading: number | null = null;

          if (!isConfirmedOffRoute && !isWrongDirection) {
            // LOCKED TO ROUTE: snapped directly on the route polyline & tracked by distance along Turf path
            displayPos = snap.snappedPos;
            routeDist = snap.distAlongMeters;

            if (routeTangent !== null) {
              roadHeading = routeTangent;
            } else if (userHeading !== null) {
              roadHeading = userHeading;
            }
          } else {
            // Truly off route or driving in wrong direction: display raw GPS location and true user travel heading
            displayPos = rawCoords;
            routeDist = null;
            roadHeading = userHeading;
          }

          setActiveNavLocation(displayPos);
          setActiveNavRouteDist(routeDist);

          if (roadHeading !== null && !isNaN(roadHeading)) {
            if (speedKmh > 2 || currentNavHeadingRef.current === null) {
              setCurrentNavHeading(roadHeading);
              currentNavHeadingRef.current = roadHeading;
            }
          }

          setUserLocation({
            lat: rawCoords[0],
            lng: rawCoords[1],
            heading: roadHeading ?? undefined,
            speed: speedKmh,
            accuracy: pos.coords.accuracy,
          });

          // 4. Local ETA & Distance Update without API calls
          setRemainingDistance(snap.remainingDistanceMeters);
          const totalDist = indexed.totalMeters > 0 ? indexed.totalMeters : currentRoute.distance;
          const progressFraction = totalDist > 0 ? snap.remainingDistanceMeters / totalDist : 0;
          const remDur = Math.max(0, Math.round(currentRoute.duration * progressFraction));
          setRemainingDuration(remDur);

          // 5. Intelligent Safe Auto-Rerouting (Anti-thrashing with distance & cooldown thresholds)
          const distSinceLastReroute = lastRerouteCoordsRef.current
            ? calculateHaversineDistance(rawCoords, lastRerouteCoordsRef.current)
            : 999;

          const canReroute =
            nowMs - lastRerouteTimeRef.current > 4500 &&
            !isReroutingRef.current &&
            distSinceLastReroute > 25;

          if ((isConfirmedOffRoute || isWrongDirection) && canReroute) {
            lastRerouteTimeRef.current = nowMs;
            lastRerouteCoordsRef.current = rawCoords;
            isReroutingRef.current = true;
            offRouteCounterRef.current = 0;
            wrongDirectionCounterRef.current = 0;
            voiceGuidance.speak('Rerouting...', true);

            calculateRoute(rawCoords, destCoords, travelModeRef.current, dest.name, userHeading)
              .then((newRoute) => {
                if (newRoute && newRoute.geometry.length > 1) {
                  indexedRouteRef.current = buildIndexedRoute(newRoute.geometry);
                  setRoute(newRoute);
                  setCurrentStepIndex(0);
                  currentStepIndexRef.current = 0;
                  setRemainingDistance(newRoute.distance);
                  setRemainingDuration(newRoute.duration);
                  setTargetArrivalTimestamp(Date.now() + newRoute.duration * 1000);
                  setActiveNavLocation(newRoute.geometry[0]);
                  setActiveNavRouteDist(0);
                  wasSnappedRef.current = true;
                  wrongDirectionCounterRef.current = 0;
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

          // 6. Turn maneuver step trigger
          currentRoute.steps.forEach((step, idx) => {
            const dist = calculateHaversineDistance(rawCoords, step.location);
            if (dist < 40 && idx > currentStepIndexRef.current) {
              setCurrentStepIndex(idx);
              currentStepIndexRef.current = idx;
              voiceGuidance.speak(step.instruction);
            }
          });

          // 7. Arrival check
          if (snap.remainingDistanceMeters < 25) {
            voiceGuidance.speak(`You have arrived at ${currentRoute.destinationName}`, true);
            stopNavigation();
          }
        } else {
          setActiveNavLocation(rawCoords);
          setActiveNavRouteDist(null);
        }
      },
      (err) => {
        if (err.code === 3 /* TIMEOUT */) return;
        console.warn('Navigation GPS watch error:', err.message);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 1000 }
    );
  }, [setUserLocation, setRemainingDistance, setRemainingDuration, setRoute, setTargetArrivalTimestamp, stopNavigation]);

  // Start Navigation (Real GPS or Simulated)
  const handleStartNavigation = useCallback(
    (simulated: boolean) => {
      const currentRoute = routeRef.current;
      if (!currentRoute || !currentRoute.geometry || currentRoute.geometry.length === 0) return;

      indexedRouteRef.current = buildIndexedRoute(currentRoute.geometry);

      setIsNavigating(true);
      setIsSimulated(simulated);
      setIsFollowingUser(true);
      setRecenterTrigger((prev) => prev + 1);
      setCurrentStepIndex(0);
      currentStepIndexRef.current = 0;
      offRouteCounterRef.current = 0;
      wasSnappedRef.current = true;
      isReroutingRef.current = false;
      lastRerouteTimeRef.current = 0;
      lastRerouteCoordsRef.current = null;
      prevGpsCoordsRef.current = null;
      prevGpsTimestampRef.current = 0;
      wrongDirectionCounterRef.current = 0;
      setRemainingDistance(currentRoute.distance);
      setRemainingDuration(currentRoute.duration);

      const lockedArrivalTimestamp = Date.now() + currentRoute.duration * 1000;
      setTargetArrivalTimestamp(lockedArrivalTimestamp);

      if (currentRoute.geometry.length > 1) {
        const initHeading = calculateBearing(currentRoute.geometry[0], currentRoute.geometry[1]);
        setCurrentNavHeading(initHeading);
        currentNavHeadingRef.current = initHeading;
      }

      // Initialize starting route position immediately
      if (!simulated && userLocation && indexedRouteRef.current) {
        const initSnap = snapPointToIndexedRoute([userLocation.lat, userLocation.lng], indexedRouteRef.current);
        if (initSnap.offRouteDistance <= 65) {
          setActiveNavLocation(initSnap.snappedPos);
          setActiveNavRouteDist(initSnap.distAlongMeters);
        } else {
          setActiveNavLocation([userLocation.lat, userLocation.lng]);
          setActiveNavRouteDist(null);
        }
      } else {
        setActiveNavLocation(currentRoute.geometry[0]);
        setActiveNavRouteDist(0);
      }

      setIsVoiceEnabled(false);
      voiceGuidance.setEnabled(false);

      if (simulated) {
        startSimulation(currentRoute);
      } else {
        startGPSTracking();
      }
    },
    [userLocation, setRemainingDistance, setRemainingDuration, setTargetArrivalTimestamp, startSimulation, startGPSTracking]
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
    activeNavRouteDist,
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
