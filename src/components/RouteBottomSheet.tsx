import React, { useEffect, useRef } from 'react';
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
  Check,
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
  isStepsOpen: boolean;
  onToggleSteps: (open?: boolean) => void;
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
  isStepsOpen,
  onToggleSteps,
}) => {
  const [isCopied, setIsCopied] = React.useState(false);
  const sheetContainerRef = useRef<HTMLDivElement>(null);

  // Drag tracking state
  const dragStartYRef = useRef<number | null>(null);
  const [dragOffset, setDragOffset] = React.useState(0);
  const isDraggingRef = useRef(false);

  // Reset dropdown state whenever destination changes
  useEffect(() => {
    onToggleSteps(false);
  }, [route?.destinationName, route?.geometry, onToggleSteps]);

  // Continuously sync actual rendered sheet height to CSS variable --route-sheet-height
  // This allows map controls and other floating UI to stay at the exact same distance above the sheet
  useEffect(() => {
    const el = sheetContainerRef.current;
    if (!el) return;

    const syncHeight = () => {
      const rect = el.getBoundingClientRect();
      const h = Math.round(rect.height);
      document.documentElement.style.setProperty('--route-sheet-height', `${h}px`);
    };

    syncHeight();
    const ro = new ResizeObserver(syncHeight);
    ro.observe(el);

    return () => {
      ro.disconnect();
      document.documentElement.style.setProperty('--route-sheet-height', '0px');
    };
  }, [isCollapsed, isStepsOpen, route]);

  if (!route || isNavigating) return null;

  const getManeuverIcon = (modifier = '', type = '') => {
    const mod = modifier.toLowerCase();
    if (type === 'arrive') return <Flag className="w-4 h-4 text-emerald-400" />;
    if (mod.includes('left')) return <CornerUpLeft className="w-4 h-4 text-sky-400" />;
    if (mod.includes('right')) return <CornerUpRight className="w-4 h-4 text-sky-400" />;
    if (mod.includes('u-turn')) return <RotateCcw className="w-4 h-4 text-amber-400" />;
    return <ArrowUp className="w-4 h-4 text-zinc-300" />;
  };

  // Export STRICTLY the clean pure URL (no title prefix, no extra text)
  const handleShare = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const url = new URL(window.location.origin + window.location.pathname);
      url.searchParams.set('dlat', route.endPoint[0].toFixed(6));
      url.searchParams.set('dlng', route.endPoint[1].toFixed(6));
      url.searchParams.set('name', encodeURIComponent(route.destinationName));
      url.searchParams.set('mode', travelMode);
      const shareUrl = url.toString();

      if (typeof navigator !== 'undefined' && navigator.share) {
        try {
          // Pass strictly the URL so iOS/Android share sheet only exports the exact URL
          await navigator.share({
            url: shareUrl,
          });
          return;
        } catch (err: any) {
          if (err.name === 'AbortError') return;
        }
      }

      // Fallback: Copy exact clean URL string to clipboard
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(shareUrl);
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2500);
      }
    } catch {
      // Ignored
    }
  };

  // Touch and pointer drag gestures to pull down (close/collapse) or pull up (expand)
  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    dragStartYRef.current = e.clientY;
    isDraggingRef.current = true;
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDraggingRef.current || dragStartYRef.current === null) return;
    const dy = e.clientY - dragStartYRef.current;
    if (isCollapsed) {
      setDragOffset(Math.min(0, Math.max(-180, dy)));
    } else {
      setDragOffset(Math.max(0, Math.min(220, dy)));
    }
  };

  const handlePointerUp = () => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;

    if (isCollapsed) {
      if (dragOffset < -30) {
        onToggleCollapse(false);
      }
    } else {
      if (dragOffset > 35) {
        onToggleCollapse(true);
      }
    }
    setDragOffset(0);
    dragStartYRef.current = null;
  };

  return (
    <div
      id="route-bottom-sheet"
      ref={sheetContainerRef}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      className={`fixed left-0 right-0 sm:left-6 sm:bottom-4 sm:max-w-md sm:rounded-3xl rounded-t-3xl bg-zinc-950/95 backdrop-blur-3xl border border-white/10 shadow-[0_-10px_40px_rgba(0,0,0,0.85)] z-[1200] text-white overflow-hidden pointer-events-auto select-none ${
        isDraggingRef.current ? '' : 'transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]'
      }`}
      style={{
        bottom: 0,
        transform: `translate3d(0, ${dragOffset}px, 0)`,
        paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 16px)',
      }}
    >
      {/* Interactive Upper Section: supports dragging to collapse or expand across drag handle, address, and header row */}
      <div
        onPointerDown={handlePointerDown}
        className="w-full cursor-grab active:cursor-grabbing select-none touch-none"
      >
        {/* Horizontal Drag Handle */}
        <div className="w-full flex flex-col items-center pt-2.5 pb-1 hover:bg-white/[0.02] transition">
          <div className="w-10 h-1 rounded-full bg-zinc-600/70" />
        </div>

        {/* Top Header Row with Destination Title and Action Controls */}
        <div className="px-5 pt-1 pb-1 flex items-center justify-between gap-3">
          <div
            className="min-w-0 flex-1 cursor-pointer"
            onClick={() => {
              if (Math.abs(dragOffset) < 5) {
                onToggleCollapse(!isCollapsed);
              }
            }}
          >
            <div className="flex items-center gap-1.5 text-[11px] text-sky-400 font-semibold tracking-wide uppercase">
              <span>{isCollapsed ? 'Route' : 'Destination'}</span>
            </div>
            <h2 className="text-base sm:text-lg font-bold tracking-tight text-white truncate leading-tight mt-0.5">
              {route.destinationName}
            </h2>
            {isCollapsed && !isLoadingRoute && (
              <div className="flex items-center gap-2 text-xs text-zinc-400 mt-1">
                <span className="font-semibold text-white">{formatDuration(route.duration)}</span>
                <span>•</span>
                <span>{formatDistance(route.distance)}</span>
                <span>•</span>
                <span className="text-emerald-400 font-medium">ETA {formatETA(route.duration)}</span>
              </div>
            )}
          </div>

          <div
            className="flex items-center gap-1.5 shrink-0"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => onToggleCollapse(!isCollapsed)}
              className="p-2 rounded-full text-zinc-400 hover:text-white bg-zinc-900 border border-zinc-800 transition active:scale-95"
              title={isCollapsed ? 'Expand route details' : 'Collapse route sheet'}
            >
              {isCollapsed ? <ChevronUp className="w-4 h-4 text-sky-400" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            {!isCollapsed && (
              <button
                onClick={handleShare}
                className="p-2 rounded-full text-zinc-400 hover:text-white bg-zinc-900 border border-zinc-800 transition active:scale-95 relative"
                title="Share exact route link"
              >
                {isCopied ? <Check className="w-4 h-4 text-emerald-400" /> : <Share2 className="w-4 h-4" />}
                {isCopied && (
                  <span className="absolute -top-7 right-0 text-[10px] bg-emerald-500 text-black font-bold px-1.5 py-0.5 rounded shadow whitespace-nowrap">
                    Link Copied!
                  </span>
                )}
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
      </div>

      {/* Fluid Expandable Section */}
      <div
        className={`grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          isCollapsed ? 'grid-rows-[0fr] opacity-0 pointer-events-none' : 'grid-rows-[1fr] opacity-100'
        }`}
      >
        <div className="overflow-hidden px-5 pt-2 pb-2">
          {/* Travel Mode Pills */}
          <div className="grid grid-cols-3 gap-2 p-1 rounded-2xl bg-zinc-900/90 border border-white/5 mb-3">
            <button
              onClick={() => {
                if (travelMode !== 'driving') onChangeMode('driving');
              }}
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
              onClick={() => {
                if (travelMode !== 'cycling') onChangeMode('cycling');
              }}
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
              onClick={() => {
                if (travelMode !== 'walking') onChangeMode('walking');
              }}
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

          {/* Route Metrics Row */}
          <div className="min-h-[48px] flex items-center justify-between py-1 border-b border-zinc-900">
            {isLoadingRoute ? null : (
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

          {/* Action Buttons */}
          <div className="grid grid-cols-4 gap-2 mt-3">
            <button
              onClick={() => onStartNavigation(false)}
              id="start-navigation-btn"
              disabled={isLoadingRoute}
              className={`col-span-3 flex items-center justify-center gap-2 py-3.5 px-4 rounded-2xl font-bold text-sm tracking-wide shadow-[0_0_24px_rgba(56,189,248,0.4)] active:scale-[0.98] transition ${
                isLoadingRoute
                  ? 'bg-sky-600/40 text-black/40 cursor-not-allowed'
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

          {/* Turn-by-Turn Steps Bar */}
          <div className="mt-3">
            <button
              onClick={() => onToggleSteps(!isStepsOpen)}
              disabled={isLoadingRoute}
              className="w-full flex items-center justify-between py-1 text-xs font-medium text-zinc-400 hover:text-zinc-200 transition disabled:opacity-50"
            >
              <span className="min-h-[16px]">
                {isLoadingRoute ? '' : `${route.steps.length} Turn-by-Turn Steps`}
              </span>
              {!isLoadingRoute && (isStepsOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />)}
            </button>

            {/* Fluid Turn-by-Turn Dropdown with CSS Grid animated transition */}
            <div
              className={`grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                isStepsOpen && !isLoadingRoute
                  ? 'grid-rows-[1fr] opacity-100 mt-2.5'
                  : 'grid-rows-[0fr] opacity-0 pointer-events-none mt-0'
              }`}
            >
              <div className="overflow-hidden">
                <div className="max-h-52 overflow-y-auto scrollable-content rounded-2xl bg-zinc-900/60 border border-zinc-800 divide-y divide-zinc-900/80 p-1">
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
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
