import React, { useState, useCallback, useEffect } from 'react';
import { Map as MapLibreMap } from 'maplibre-gl';
import { MapStyle, TravelMode, LatLng } from './types';
import { MapView } from './components/MapView';
import { SearchBar } from './components/SearchBar';
import { RouteBottomSheet } from './components/RouteBottomSheet';
import { NavigationHUD } from './components/NavigationHUD';
import { MapControls } from './components/MapControls';
import { OfflineIndicator } from './components/OfflineIndicator';
import { AttributionButton } from './components/AttributionButton';
import { useUserLocation } from './hooks/useUserLocation';
import { useRoutePlanner } from './hooks/useRoutePlanner';
import { useNavigationEngine } from './hooks/useNavigationEngine';

// Standard zoom levels for active navigation
const STANDARD_NAV_ZOOM: Record<TravelMode, number> = {
  driving: 17,
  cycling: 17.5,
  walking: 18,
};

export default function App() {
  const [mapInstance, setMapInstance] = useState<MapLibreMap | null>(null);
  const [mapStyle, setMapStyle] = useState<MapStyle>('dark');
  const [isStepsOpen, setIsStepsOpen] = useState(false);

  // Open states for overlay menus/dropdowns
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isAttributionOpen, setIsAttributionOpen] = useState(false);
  const [isLayerMenuOpen, setIsLayerMenuOpen] = useState(false);

  // Prevent browser window bouncing on pull gestures
  useEffect(() => {
    const handleTouchMove = (e: TouchEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const isScrollable = target.closest('.scrollable-content');
      const isMap = target.closest('#map-container') || target.closest('.maplibregl-canvas');
      if (!isScrollable && !isMap && e.cancelable) {
        e.preventDefault();
      }
    };

    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    return () => {
      document.removeEventListener('touchmove', handleTouchMove);
    };
  }, []);

  // 1. Continuous User GPS Location & Geolocation state
  const {
    userLocation,
    setUserLocation,
    isLocating,
    locationErrorMsg,
    setLocationErrorMsg,
    isCenteredOnUser,
    setIsCenteredOnUser,
    handleLocateClick,
  } = useUserLocation(mapInstance);

  // Forward declaration ref for stopNavigation to break circular dependency with route planner
  const stopNavRef = React.useRef<() => void>(() => {});

  // 2. Route Calculation, Search selection, Pin Drop & Travel Mode management
  const {
    selectedDestination,
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
    handleSelectPlace,
    handleMapClick,
    handleMapTapWithDestination,
    handleChangeMode,
    handleClearDestination,
  } = useRoutePlanner({
    mapInstance,
    userLocation,
    setUserLocation,
    isNavigating: false,
    onStopNavigation: () => stopNavRef.current(),
  });

  // 3. Turn-by-Turn Navigation Engine (Simulation, Live GPS, Turf Snapping, Auto-Rerouting, Voice)
  const {
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
  } = useNavigationEngine({
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
  });

  stopNavRef.current = stopNavigation;

  // Reset map rotation back to standard North orientation (bearing = 0)
  const handleResetNorth = useCallback(() => {
    if (mapInstance) {
      mapInstance.easeTo({ bearing: 0, pitch: 0, duration: 400 });
      setBearing(0);
    }
  }, [mapInstance, setBearing]);

  const handleToggleSteps = useCallback((open?: boolean) => {
    setIsStepsOpen((prev) => (typeof open === 'boolean' ? open : !prev));
  }, []);

  // Intercept map click to act as a cancel/dismiss gesture if any menu or search dropdown is open
  const handleMapClickIntercepted = useCallback(
    (coords: LatLng) => {
      if (isSearchOpen || isAttributionOpen || isLayerMenuOpen) {
        setIsSearchOpen(false);
        setIsAttributionOpen(false);
        setIsLayerMenuOpen(false);
        return; // Cancel action only; do not drop pin
      }
      handleMapClick(coords);
    },
    [isSearchOpen, isAttributionOpen, isLayerMenuOpen, handleMapClick]
  );

  const handleMapTapWithDestinationIntercepted = useCallback(() => {
    if (isSearchOpen || isAttributionOpen || isLayerMenuOpen) {
      setIsSearchOpen(false);
      setIsAttributionOpen(false);
      setIsLayerMenuOpen(false);
      return; // Cancel action only; do not collapse sheet
    }
    handleMapTapWithDestination();
  }, [isSearchOpen, isAttributionOpen, isLayerMenuOpen, handleMapTapWithDestination]);

  return (
    <main id="main-view" className="absolute inset-0 w-full h-full overflow-hidden bg-black text-white select-none touch-none">
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
        onMapClick={handleMapClickIntercepted}
        onMapTapWithDestination={handleMapTapWithDestinationIntercepted}
        onMapReady={setMapInstance}
        isFollowingUser={isFollowingUser}
        isRouteOverview={isRouteOverview}
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
        isOpen={isSearchOpen}
        onOpenChange={setIsSearchOpen}
      />

      {/* Attribution Button (Top-left below search bar) */}
      <AttributionButton
        isNavigating={isNavigating}
        isOpen={isAttributionOpen}
        onOpenChange={setIsAttributionOpen}
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
        isCenteredOnUser={isCenteredOnUser}
        onZoomIn={() => mapInstance?.zoomIn()}
        onZoomOut={() => mapInstance?.zoomOut()}
        onResetNorth={handleResetNorth}
        isNavigating={isNavigating}
        bearing={bearing}
        hasActiveDestination={!!route && !isNavigating}
        isRouteSheetCollapsed={isRouteSheetCollapsed}
        isStepsOpen={isStepsOpen}
        isLayerMenuOpen={isLayerMenuOpen}
        onLayerMenuOpenChange={setIsLayerMenuOpen}
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
        isStepsOpen={isStepsOpen}
        onToggleSteps={handleToggleSteps}
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
          isRouteOverview={isRouteOverview}
          onToggleRouteOverview={handleToggleRouteOverview}
        />
      )}
    </main>
  );
}
