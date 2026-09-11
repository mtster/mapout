import React, { useState, useEffect, useRef } from 'react';
import {
  Car,
  Bike,
  Footprints,
  Play,
  RotateCcw,
  ChevronUp,
  ChevronDown,
  X,
  Clock,
  Compass,
  CornerUpRight,
  CornerUpLeft,
  ArrowUp,
  Flag,
  Share2,
} from 'lucide-react';
import { RouteData, TravelMode } from '../types';
import { formatDistance, formatDuration, formatETA } from '../services/mapService';

interface Props {
  route: RouteData | null;
  isLoadingRoute: boolean;
  travelMode: TravelMode;
  onChangeMode: (mode: TravelMode) => void;
  onStartNavigation: (simulated: boolean) => void;
  onClose: () => void;
  isNavigating: boolean;
  isCollapsed: boolean;
  onToggleCollapse: (collapsed?: boolean) => void;
}

export const RouteBottomSheet: React.FC<Props> = ({
  route,
  isLoadingRoute,
  travelMode,
  onChangeMode,
  onStartNavigation,
  onClose,
  isNavigating,
  isCollapsed,
  onToggleCollapse,
}) => {
  const [showSteps, setShowSteps] = useState(false);

  // Drag tracking state
  const dragStartYRef = useRef<number | null>(null);
  const [dragOffset, setDragOffset] = useState(0);
  const isDraggingRef = useRef(false);

  // Reset dropdown state whenever a new pin or destination is selected
  useEffect(() => {
    setShowSteps(false);
  }, [route?.destinationName, route?.geometry]);

  if (!route || isNavigating) return null;

  const getManeuverIcon = (modifier = '', type = '') => {
    const mod = modifier.toLowerCase();
    if (type === 'arrive') return <Flag className="w-4 h-4 text-emerald-400" />;
    if (mod.includes('left')) return <CornerUpLeft className="w-4 h-4 text-sky-400" />;
    if (mod.includes('right')) return <CornerUpRight className="w-4 h-4 text-sky-400" />;
    if (mod.includes('u-turn')) return <RotateCcw className="w-4 h-4 text-amber-400" />;
    return <ArrowUp className="w-4 h-4 text-zinc-300" />;
  };

  const handleShare = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Route to ${route.destinationName}`,
          text: `Route to ${route.destinationName}: ${formatDistance(route.distance)}, ${formatDuration(route.duration)}`,
          url: window.location.href,
        });
      } catch {
        // Ignored or dismissed
      }
    }
  };

  // Touch and pointer drag gestures to pull down (close/collapse) or pull up (expand)
  const handlePointerDown = (e: React.PointerEvent) => {
    // Only drag from primary button / touch
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    dragStartYRef.current = e.clientY;
    isDraggingRef.current = true;
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDraggingRef.current || dragStartYRef.current === null) return;
    const dy = e.clientY - dragStartYRef.current;
    if (isCollapsed) {
      // When collapsed, only allow dragging up (dy < 0)
      setDragOffset(Math.min(0, Math.max(-180, dy)));
    } else {
      // When expanded, only allow dragging down (dy > 0)
      setDragOffset(Math.max(0, Math.min(220, dy)));
    }
  };

  const handlePointerUp = () => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;

    if (isCollapsed) {
      // Dragged up enough to expand
      if (dragOffset < -30) {
        onToggleCollapse(false);
      }
    } else {
      // Dragged down enough to collapse
      if (dragOffset > 35) {
        onToggleCollapse(true);
      }
    }
    setDragOffset(0);
    dragStartYRef.current = null;
  };

  const getModeIcon = () => {
    if (travelMode === 'cycling') return <Bike className="w-3.5 h-3.5" />;
    if (travelMode === 'walking') return <Footprints className="w-3.5 h-3.5" />;
    return <Car className="w-3.5 h-3.5" />;
  };

  return (
    <div
      id="route-bottom-sheet"
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      className={`fixed left-0 right-0 sm:left-6 sm:bottom-4 sm:max-w-md sm:rounded-3xl rounded-t-3xl bg-zinc-950/95 backdrop-blur-3xl border border-white/10 shadow-[0_-10px_40px_rgba(0,0,0,0.85)] z-[1200] text-white overflow-hidden pointer-events-auto select-none ${
        isDraggingRef.current ? '' : 'transition-all duration-300 ease-out'
      }`}
      style={{
        bottom: 0,
        transform: `translate3d(0, ${dragOffset}px, 0)`,
        paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 8px)',
      }}
    >
      {/* Interactive Drag Handle Header */}
      <div
        onPointerDown={handlePointerDown}
        onClick={() => {
          if (isCollapsed) onToggleCollapse(false);
        }}
        className="w-full flex flex-col items-center pt-2.5 pb-1 cursor-grab active:cursor-grabbing hover:bg-white/[0.02] transition"
      >
        <div className="w-10 h-1 rounded-full bg-zinc-600/70" />
      </div>

      {/* COLLAPSED / PEEK VIEW: Small compact bar leaving 90%+ map view unobstructed */}
      {isCollapsed ? (
        <div
          id="route-sheet-collapsed-bar"
          onClick={() => onToggleCollapse(false)}
          className="px-5 py-2 flex items-center justify-between gap-3 cursor-pointer hover:bg-white/[0.03] transition active:scale-[0.99]"
        >
          <div className="min-w-0 flex-1 flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-sky-500/15 text-sky-400 shrink-0">
              {getModeIcon()}
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-white truncate leading-tight">
                {route.destinationName}
              </h2>
              <div className="flex items-center gap-2 text-xs text-zinc-400 mt-0.5">
                {isLoadingRoute ? (
                  <span className="text-sky-400 font-medium animate-pulse">Updating route...</span>
                ) : (
                  <>
                    <span className="font-semibold text-white">{formatDuration(route.duration)}</span>
                    <span>•</span>
                    <span>{formatDistance(route.distance)}</span>
                    <span>•</span>
                    <span className="text-emerald-400 font-medium">ETA {formatETA(route.duration)}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleCollapse(false);
              }}
              className="p-2 rounded-full text-zinc-300 hover:text-white bg-zinc-900 border border-zinc-800 transition active:scale-95 flex items-center gap-1 text-xs font-semibold px-3"
              title="Tap to view full route details"
            >
              <span>Details</span>
              <ChevronUp className="w-3.5 h-3.5 text-sky-400" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              className="p-2 rounded-full text-zinc-400 hover:text-white bg-zinc-900 border border-zinc-800 transition active:scale-95"
              title="Close route"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      ) : (
        /* EXPANDED VIEW: Complete destination, vehicle mode selection, and navigation actions */
        <div className="px-5 pt-1 pb-3">
          {/* Header with destination title, share, collapse chevron, and close */}
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-xs text-sky-400 font-medium tracking-wide">
                <span>DESTINATION</span>
              </div>
              <h2 className="text-lg font-bold tracking-tight text-white truncate mt-0.5">
                {route.destinationName}
              </h2>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={() => onToggleCollapse(true)}
                className="p-2 rounded-full text-zinc-400 hover:text-white bg-zinc-900 border border-zinc-800 transition active:scale-95"
                title="Collapse sheet to peek view"
              >
                <ChevronDown className="w-4 h-4" />
              </button>
              {typeof navigator !== 'undefined' && 'share' in navigator && (
                <button
                  onClick={handleShare}
                  className="p-2 rounded-full text-zinc-400 hover:text-white bg-zinc-900 border border-zinc-800 transition active:scale-95"
                  title="Share route"
                >
                  <Share2 className="w-4 h-4" />
                </button>
              )}
              <button
                onClick={onClose}
                className="p-2 rounded-full text-zinc-400 hover:text-white bg-zinc-900 border border-zinc-800 transition active:scale-95"
                title="Close route"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Travel Mode Pills - Stays permanently mounted so switching vehicle modes has zero twitching */}
          <div className="grid grid-cols-3 gap-2 p-1 rounded-2xl bg-zinc-900/90 border border-white/5 mb-3">
            <button
              onClick={() => onChangeMode('driving')}
              className={`flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-semibold transition ${
                travelMode === 'driving'
                  ? 'bg-white text-black shadow-md'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <Car className="w-3.5 h-3.5" />
              <span>Drive</span>
            </button>
            <button
              onClick={() => onChangeMode('cycling')}
              className={`flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-semibold transition ${
                travelMode === 'cycling'
                  ? 'bg-white text-black shadow-md'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <Bike className="w-3.5 h-3.5" />
              <span>Cycle</span>
            </button>
            <button
              onClick={() => onChangeMode('walking')}
              className={`flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-semibold transition ${
                travelMode === 'walking'
                  ? 'bg-white text-black shadow-md'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <Footprints className="w-3.5 h-3.5" />
              <span>Walk</span>
            </button>
          </div>

          {/* Route Metrics Row - Fixed height area with no layout shift or twitching */}
          <div className="min-h-[50px] flex items-center justify-between py-1.5 border-b border-zinc-900">
            {isLoadingRoute ? (
              <div className="w-full flex items-center justify-between text-zinc-400 text-xs py-2 animate-pulse">
                <div className="flex items-center gap-2">
                  <div className="w-3.5 h-3.5 rounded-full border-2 border-sky-400 border-t-transparent animate-spin" />
                  <span className="font-medium text-sky-400">Calculating route for {travelMode}...</span>
                </div>
                <div className="h-5 w-16 bg-zinc-800 rounded-full" />
              </div>
            ) : (
              <>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-extrabold tracking-tight text-white">
                    {formatDuration(route.duration)}
                  </span>
                  <span className="text-sm font-medium text-zinc-400">
                    ({formatDistance(route.distance)})
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-semibold bg-emerald-950/60 px-2.5 py-1 rounded-full border border-emerald-800/40">
                  <Clock className="w-3 h-3" />
                  <span>ETA {formatETA(route.duration)}</span>
                </div>
              </>
            )}
          </div>

          {/* Action Buttons: 12px gap from Metrics */}
          <div className="grid grid-cols-4 gap-2 mt-3">
            <button
              onClick={() => onStartNavigation(false)}
              id="start-navigation-btn"
              disabled={isLoadingRoute}
              className={`col-span-3 flex items-center justify-center gap-2 py-3.5 px-4 rounded-2xl font-bold text-sm tracking-wide shadow-[0_0_24px_rgba(56,189,248,0.4)] active:scale-[0.98] transition ${
                isLoadingRoute
                  ? 'bg-sky-600/50 text-black/60 cursor-not-allowed'
                  : 'bg-sky-500 hover:bg-sky-400 text-black'
              }`}
            >
              <Play className="w-4 h-4 fill-current" />
              <span>Start Navigation</span>
            </button>

            <button
              onClick={() => onStartNavigation(true)}
              id="simulate-navigation-btn"
              disabled={isLoadingRoute}
              className="col-span-1 flex flex-col items-center justify-center rounded-2xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-white text-[11px] font-medium transition active:scale-95 py-2 disabled:opacity-50"
              title="Preview simulated navigation"
            >
              <Compass className="w-4 h-4 text-sky-400 mb-0.5" />
              <span>Simulate</span>
            </button>
          </div>

          {/* Turn-by-Turn Steps Toggle: Exactly 12px separation from Action buttons */}
          <div className="mt-3">
            <button
              onClick={() => setShowSteps(!showSteps)}
              disabled={isLoadingRoute}
              className="w-full flex items-center justify-between py-2 text-xs font-medium text-zinc-400 hover:text-zinc-200 transition"
            >
              <span>
                {isLoadingRoute ? 'Calculating turn-by-turn steps...' : `${route.steps.length} Turn-by-Turn Steps`}
              </span>
              {showSteps ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
            </button>

            {/* Steps dropdown content: Exactly 12px separation from toggle */}
            {showSteps && !isLoadingRoute && (
              <div className="mt-3 max-h-56 overflow-y-auto rounded-2xl bg-zinc-900/60 border border-zinc-800 divide-y divide-zinc-900/80">
                {route.steps.map((step, idx) => (
                  <div key={step.id || idx} className="flex items-start gap-3 p-3 text-xs">
                    <div className="p-1.5 rounded-lg bg-zinc-800 mt-0.5 shrink-0">
                      {getManeuverIcon(step.modifier, step.type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-zinc-200 font-medium leading-snug">{step.instruction}</p>
                      {step.distance > 0 && (
                        <p className="text-[11px] text-zinc-500 mt-0.5">{formatDistance(step.distance)}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
