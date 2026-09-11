import React, { useState } from 'react';
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
}

export const RouteBottomSheet: React.FC<Props> = ({
  route,
  isLoadingRoute,
  travelMode,
  onChangeMode,
  onStartNavigation,
  onClose,
  isNavigating,
}) => {
  const [showSteps, setShowSteps] = useState(false);

  if (!route || isNavigating) return null;

  const getManeuverIcon = (modifier = '', type = '') => {
    const mod = modifier.toLowerCase();
    if (type === 'arrive') return <Flag className="w-4 h-4 text-emerald-400" />;
    if (mod.includes('left')) return <CornerUpLeft className="w-4 h-4 text-sky-400" />;
    if (mod.includes('right')) return <CornerUpRight className="w-4 h-4 text-sky-400" />;
    if (mod.includes('u-turn')) return <RotateCcw className="w-4 h-4 text-amber-400" />;
    return <ArrowUp className="w-4 h-4 text-zinc-300" />;
  };

  const handleShare = async () => {
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

  return (
    <div
      id="route-bottom-sheet"
      className="fixed bottom-0 left-0 right-0 sm:left-6 sm:bottom-6 sm:max-w-md sm:rounded-3xl rounded-t-3xl bg-zinc-950/95 backdrop-blur-3xl border border-white/10 shadow-[0_-10px_40px_rgba(0,0,0,0.8)] z-30 text-white overflow-hidden transition-all duration-300 pointer-events-auto"
      style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 16px)' }}
    >
      {/* Drag handle */}
      <div className="flex justify-center pt-2.5 pb-1">
        <div className="w-10 h-1 rounded-full bg-zinc-700/60" />
      </div>

      <div className="px-5 pt-1 pb-3">
        {/* Header with destination title and close */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-xs text-sky-400 font-medium tracking-wide">
              <span>DESTINATION</span>
            </div>
            <h2 className="text-lg font-bold tracking-tight text-white truncate mt-0.5">
              {route.destinationName}
            </h2>
          </div>
          <div className="flex items-center gap-1 shrink-0">
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

        {/* Travel Mode Pills */}
        <div className="grid grid-cols-3 gap-2 p-1 rounded-2xl bg-zinc-900/90 border border-white/5 mb-4">
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

        {/* Route Metrics Display */}
        {isLoadingRoute ? (
          <div className="py-6 flex items-center justify-center gap-3 text-zinc-400 text-sm">
            <div className="w-4 h-4 rounded-full border-2 border-sky-400 border-t-transparent animate-spin" />
            <span>Calculating fastest route...</span>
          </div>
        ) : (
          <>
            <div className="flex items-baseline justify-between py-2 border-b border-zinc-900">
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
            </div>

            {/* Action Buttons */}
            <div className="grid grid-cols-4 gap-2 mt-4">
              <button
                onClick={() => onStartNavigation(false)}
                id="start-navigation-btn"
                className="col-span-3 flex items-center justify-center gap-2 py-3.5 px-4 rounded-2xl bg-sky-500 hover:bg-sky-400 text-black font-bold text-sm tracking-wide shadow-[0_0_24px_rgba(56,189,248,0.4)] active:scale-[0.98] transition"
              >
                <Play className="w-4 h-4 fill-current" />
                <span>Start Navigation</span>
              </button>

              <button
                onClick={() => onStartNavigation(true)}
                id="simulate-navigation-btn"
                className="col-span-1 flex flex-col items-center justify-center rounded-2xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-white text-[11px] font-medium transition active:scale-95 py-2"
                title="Preview simulated navigation"
              >
                <Compass className="w-4 h-4 text-sky-400 mb-0.5" />
                <span>Simulate</span>
              </button>
            </div>

            {/* Turn-by-turn step toggle */}
            <div className="mt-3">
              <button
                onClick={() => setShowSteps(!showSteps)}
                className="w-full flex items-center justify-between py-2 text-xs font-medium text-zinc-400 hover:text-zinc-200 transition"
              >
                <span>{route.steps.length} Turn-by-Turn Steps</span>
                {showSteps ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
              </button>

              {showSteps && (
                <div className="mt-2 max-h-56 overflow-y-auto rounded-2xl bg-zinc-900/60 border border-zinc-800 divide-y divide-zinc-900/80">
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
          </>
        )}
      </div>
    </div>
  );
};
