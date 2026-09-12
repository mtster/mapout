import React from 'react';
import {
  Volume2,
  VolumeX,
  X,
  CornerUpLeft,
  CornerUpRight,
  ArrowUp,
  RotateCcw,
  Flag,
  ChevronRight,
  Gauge,
  Clock,
  LocateFixed,
} from 'lucide-react';
import { RouteData, RouteStep } from '../types';
import { formatDistance, formatDuration, formatETA } from '../services/mapService';

interface Props {
  route: RouteData;
  currentStepIndex: number;
  remainingDistance: number;
  remainingDuration: number;
  currentSpeed: number; // in km/h
  isVoiceEnabled: boolean;
  onToggleVoice: () => void;
  onEndNavigation: () => void;
  onRecenter: () => void;
  showRecenter: boolean;
  isSimulated: boolean;
  onNextStep?: () => void;
}

export const NavigationHUD: React.FC<Props> = ({
  route,
  currentStepIndex,
  remainingDistance,
  remainingDuration,
  currentSpeed,
  isVoiceEnabled,
  onToggleVoice,
  onEndNavigation,
  onRecenter,
  showRecenter,
  isSimulated,
  onNextStep,
}) => {
  const currentStep: RouteStep | undefined = route.steps[currentStepIndex] || route.steps[route.steps.length - 1];
  const nextStep: RouteStep | undefined = route.steps[currentStepIndex + 1];

  const getManeuverIcon = (modifier = '', type = '', sizeClass = 'w-7 h-7') => {
    const mod = modifier.toLowerCase();
    if (type === 'arrive') return <Flag className={`${sizeClass} text-emerald-400`} />;
    if (mod.includes('left')) return <CornerUpLeft className={`${sizeClass} text-sky-400`} />;
    if (mod.includes('right')) return <CornerUpRight className={`${sizeClass} text-sky-400`} />;
    if (mod.includes('u-turn')) return <RotateCcw className={`${sizeClass} text-amber-400`} />;
    return <ArrowUp className={`${sizeClass} text-white`} />;
  };

  return (
    <>
      {/* Top Turn Maneuver Card */}
      <div
        id="nav-top-card"
        className="fixed top-3 left-3 right-3 sm:left-6 sm:right-auto sm:w-[420px] z-[1300] text-white pointer-events-auto"
        style={{ top: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}
      >
        <div className="rounded-3xl bg-zinc-950/95 backdrop-blur-3xl border border-white/15 p-4 shadow-[0_16px_48px_rgba(0,0,0,0.85)] flex flex-col gap-2.5">
          {/* Main Maneuver Row */}
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-zinc-900 border border-white/10 flex items-center justify-center shrink-0 shadow-inner">
              {getManeuverIcon(currentStep?.modifier, currentStep?.type)}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl font-black tracking-tight text-white">
                  {currentStep?.distance ? formatDistance(currentStep.distance) : 'Now'}
                </span>
                {isSimulated && (
                  <span className="px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-400 text-[10px] font-bold uppercase tracking-wider border border-sky-500/30">
                    SIMULATION
                  </span>
                )}
              </div>
              <p className="text-sm font-semibold text-zinc-100 line-clamp-2 leading-snug">
                {currentStep?.instruction || `Head to ${route.destinationName}`}
              </p>
            </div>

            {/* Quick voice audio toggle */}
            <button
              onClick={onToggleVoice}
              className={`p-3 rounded-2xl border transition active:scale-95 shrink-0 ${
                isVoiceEnabled
                  ? 'bg-sky-500/20 border-sky-500/40 text-sky-400'
                  : 'bg-zinc-900 border-zinc-800 text-zinc-500'
              }`}
              title={isVoiceEnabled ? 'Voice Guidance On' : 'Voice Guidance Muted'}
            >
              {isVoiceEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
            </button>
          </div>

          {/* Next upcoming maneuver preview (if available) */}
          {nextStep && (
            <div className="flex items-center gap-2 pt-2 border-t border-zinc-900 text-xs text-zinc-400 px-1">
              <span className="text-[11px] font-medium text-zinc-500 uppercase tracking-wide">THEN</span>
              {getManeuverIcon(nextStep.modifier, nextStep.type, 'w-3.5 h-3.5')}
              <span className="truncate text-zinc-300 font-medium">{nextStep.instruction}</span>
            </div>
          )}
        </div>
      </div>

      {/* Floating Re-center & Controls Buttons */}
      <div
        className="fixed right-4 z-[1300] flex flex-col items-end gap-2 pointer-events-auto"
        style={{ bottom: 'calc(max(env(safe-area-inset-bottom, 0px), 16px) + 84px)' }}
      >
        {/* Re-center Button - ONLY shown when user manually drags or zooms the map away from navigation position */}
        {showRecenter && (
          <button
            onClick={onRecenter}
            id="nav-recenter-btn"
            className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-zinc-950/95 border border-sky-400/50 text-white backdrop-blur-2xl shadow-[0_8px_30px_rgba(0,0,0,0.85)] hover:bg-zinc-900 active:scale-95 transition-all text-xs font-bold tracking-wide animate-in fade-in zoom-in-95 duration-200"
            title="Re-center onto current position"
          >
            <LocateFixed className="w-4 h-4 text-sky-400" />
            <span>Re-center</span>
          </button>
        )}

        {isSimulated && onNextStep && (
          <button
            onClick={onNextStep}
            id="nav-sim-next-btn"
            className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-full bg-zinc-950/90 border border-white/15 text-white backdrop-blur-2xl shadow-xl hover:bg-zinc-900 active:scale-95 transition text-xs font-semibold"
            title="Advance to next step"
          >
            <ChevronRight className="w-4 h-4 text-emerald-400" />
            <span>Next Step</span>
          </button>
        )}
      </div>

      {/* Bottom Navigation Dashboard HUD: Flush docked to bottom edge to eliminate blank bottom space */}
      <div
        id="nav-bottom-hud"
        className="fixed bottom-0 left-0 right-0 z-[1300] pointer-events-auto bg-zinc-950/95 backdrop-blur-3xl border-t border-white/15 shadow-[0_-12px_48px_rgba(0,0,0,0.95)] sm:left-6 sm:right-auto sm:w-[450px] sm:bottom-4 sm:rounded-3xl sm:border"
        style={{
          paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 16px)',
          paddingTop: '12px',
          paddingLeft: '16px',
          paddingRight: '16px',
        }}
      >
        <div className="w-full flex items-center justify-between gap-3 text-white">
          {/* Metrics Column: ETA, Remaining, Speed */}
          <div className="flex items-center gap-4 sm:gap-6 min-w-0">
            {/* ETA */}
            <div>
              <div className="flex items-center gap-1 text-[11px] font-bold text-emerald-400 uppercase tracking-wider">
                <Clock className="w-3 h-3" />
                <span>ETA</span>
              </div>
              <div className="text-xl font-extrabold text-white tracking-tight">
                {formatETA(remainingDuration)}
              </div>
            </div>

            {/* Duration and distance remaining */}
            <div className="border-l border-zinc-800 pl-4">
              <div className="text-xl font-extrabold text-sky-400 tracking-tight">
                {formatDuration(remainingDuration)}
              </div>
              <div className="text-xs font-semibold text-zinc-400">
                {formatDistance(remainingDistance)} left
              </div>
            </div>

            {/* Live Speed */}
            <div className="hidden xs:flex items-center gap-2 border-l border-zinc-800 pl-4">
              <Gauge className="w-4 h-4 text-zinc-500" />
              <div>
                <div className="text-lg font-black text-white">
                  {Math.round(currentSpeed)}
                </div>
                <div className="text-[10px] text-zinc-500 uppercase font-semibold">
                  KM/H
                </div>
              </div>
            </div>
          </div>

          {/* End Navigation Button */}
          <button
            onClick={onEndNavigation}
            id="end-navigation-btn"
            className="flex items-center justify-center gap-1.5 py-2.5 px-4 rounded-2xl bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white font-bold text-xs uppercase tracking-wider shadow-[0_0_20px_rgba(225,29,72,0.4)] active:scale-95 transition shrink-0"
          >
            <X className="w-4 h-4" />
            <span>End</span>
          </button>
        </div>
      </div>
    </>
  );
};
