import { useState, useEffect, useRef, useCallback } from 'react';
import { Map as MapLibreMap } from 'maplibre-gl';
import { UserLocation } from '../types';

export function useUserLocation(mapInstance: MapLibreMap | null) {
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [locationErrorMsg, setLocationErrorMsg] = useState<string | null>(null);
  const [isCenteredOnUser, setIsCenteredOnUser] = useState(true);

  const hasCenteredOnUserRef = useRef(false);

  // Initial Location detection and continuous GPS watching
  const requestLocation = useCallback(
    (forceCenter = false) => {
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
            setIsCenteredOnUser(true);
          }
        },
        (err) => {
          console.warn('Geolocation error / permission denied:', err.message);
          setIsLocating(false);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 10000 }
      );
    },
    [mapInstance]
  );

  // Explicit user tap on Locate Me button
  const handleLocateClick = useCallback(() => {
    setIsCenteredOnUser(true);
    if (userLocation && mapInstance) {
      mapInstance.flyTo({ center: [userLocation.lng, userLocation.lat], zoom: 16, duration: 800 });
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
          mapInstance.flyTo({ center: [coords.lng, coords.lat], zoom: 16, duration: 800 });
          hasCenteredOnUserRef.current = true;
          setIsCenteredOnUser(true);
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
          setIsCenteredOnUser(true);
        }
      },
      (err) => {
        // Code 3 is TIMEOUT: occurs naturally when mobile GPS hardware is idle, indoors, or switching tabs
        if (err.code === 3 /* TIMEOUT */) {
          return;
        }
        console.warn('Continuous GPS watch error:', err.message);
      },
      { enableHighAccuracy: true, timeout: 25000, maximumAge: 10000 }
    );

    return () => {
      navigator.geolocation.clearWatch(globalWatchId);
    };
  }, [mapInstance, requestLocation]);

  return {
    userLocation,
    setUserLocation,
    isLocating,
    locationErrorMsg,
    setLocationErrorMsg,
    isCenteredOnUser,
    setIsCenteredOnUser,
    handleLocateClick,
    requestLocation,
  };
}
