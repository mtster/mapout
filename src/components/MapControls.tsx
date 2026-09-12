import React, { useState, useEffect, useRef } from 'react';
import {
  Navigation,
  Compass,
  Plus,
  Minus,
  Layers,
  Check,
} from 'lucide-react';
import { MapStyle } from '../types';

interface Props {
  mapStyle: MapStyle;
  onChangeStyle: (style: MapStyle) => void;
  onLocateMe: () => void;
  isLocating: boolean;
  hasUserLocation: boolean;
  isCenteredOnUser?: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetNorth: () => void;
  isNavigating: boolean;
  bearing?: number;
  hasActiveDestination?: boolean;
  isRouteSheetCollapsed?: boolean;
  isStepsOpen?: boolean;
}

export const MapControls: React.FC<Props> = ({
  mapStyle,
  onChangeStyle,
  onLocateMe,
  isLocating: _isLocating,
  hasUserLocation: _hasUserLocation,
  isCenteredOnUser = true,
  onZoomIn,
  onZoomOut,
  onResetNorth,
  isNavigating,
  bearing = 0,
  hasActiveDestination = false,
  isRouteSheetCollapsed = false,
  isStepsOpen = false,
}) => {
  const [showLayerMenu, setShowLayerMenu] = useState(false);
  const layerMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (layerMenuRef.current && !layerMenuRef.current.contains(event.target as Node)) {
        setShowLayerMenu(false);
      }
    };
    if (showLayerMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showLayerMenu]);

  // When actively navigating, some controls are simplified or moved
  if (isNavigating) return null;

  const isRotated = Math.abs(bearing % 360) > 1;

  // Exact rigid binding to bottom sheet motion: zero lag, identical CSS easing curve
  let yOffset = '0px';
  if (hasActiveDestination) {
    if (isRouteSheetCollapsed) {
      yOffset = 'calc(-84px - max(env(safe-area-inset-bottom, 0px), 16px) + 6px)';
    } else if (isStepsOpen) {
      yOffset = 'calc(-468px - max(env(safe-area-inset-bottom, 0px), 16px) + 6px)';
    } else {
      yOffset = 'calc(-268px - max(env(safe-area-inset-bottom, 0px), 16px) + 6px)';
    }
  }

  return (
    <div
      className="fixed right-3 sm:right-6 z-[1200] flex flex-col gap-2 pointer-events-auto transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
      style={{
        bottom: 'calc(max(env(safe-area-inset-bottom, 0px), 16px) + 12px)',
        transform: `translate3d(0, ${yOffset}, 0)`,
      }}
    >
      {/* Compass / Reset North */}
      <button
        onClick={onResetNorth}
        id="compass-reset-north-btn"
        className={`w-11 h-11 rounded-2xl border backdrop-blur-2xl shadow-xl flex items-center justify-center active:scale-90 transition duration-200 ${
          isRotated
            ? 'bg-zinc-950 border-sky-400/60 text-sky-400 shadow-[0_0_15px_rgba(56,189,248,0.25)]'
            : 'bg-zinc-950/85 border-white/10 text-zinc-400 hover:text-white hover:bg-zinc-900'
        }`}
        title="Reset map orientation to North"
      >
        <div
          className="transition-transform duration-200 ease-out"
          style={{ transform: `rotate(${-bearing}deg)` }}
        >
          <Compass className={`w-5 h-5 ${isRotated ? 'text-sky-400' : 'text-zinc-400'}`} />
        </div>
      </button>

      {/* Layer Switcher */}
      <div className="relative" ref={layerMenuRef}>
        <button
          onClick={() => setShowLayerMenu(!showLayerMenu)}
          className={`w-11 h-11 rounded-2xl border backdrop-blur-2xl shadow-xl flex items-center justify-center transition active:scale-90 ${
            showLayerMenu
              ? 'bg-sky-500/20 border-sky-400 text-sky-400'
              : 'bg-zinc-950/85 border-white/10 text-zinc-300 hover:text-white hover:bg-zinc-900'
          }`}
          title="Change map style"
        >
          <Layers className="w-5 h-5" />
        </button>

        {showLayerMenu && (
          <div
            className="absolute right-14 bottom-0 w-36 rounded-2xl bg-zinc-950/95 border border-white/15 p-1.5 backdrop-blur-3xl shadow-2xl space-y-1 z-[1250]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-2.5 py-1 text-[10px] font-bold tracking-wider text-zinc-500 uppercase">
              Map Style
            </div>
            {(
              [
                { id: 'dark', label: 'Darkness' },
                { id: 'midnight', label: 'Night Life' },
                { id: 'satellite', label: 'Satellite' },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  onChangeStyle(item.id);
                  setShowLayerMenu(false);
                }}
                className={`w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-xs font-medium transition ${
                  mapStyle === item.id
                    ? 'bg-zinc-800 text-white font-semibold'
                    : 'text-zinc-400 hover:text-white hover:bg-zinc-900'
                }`}
              >
                <span>{item.label}</span>
                {mapStyle === item.id && <Check className="w-3.5 h-3.5 text-sky-400" />}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Locate Me button */}
      <button
        id="locate-me-control-btn"
        onClick={onLocateMe}
        className={`w-11 h-11 rounded-2xl border backdrop-blur-2xl shadow-xl flex items-center justify-center transition active:scale-90 ${
          !isCenteredOnUser
            ? 'bg-zinc-950/90 border-sky-400/60 text-sky-400 shadow-[0_0_15px_rgba(56,189,248,0.25)] hover:bg-zinc-900'
            : 'bg-zinc-950/85 border-white/10 text-zinc-400 hover:text-white hover:bg-zinc-900'
        }`}
        title="Find my location"
        aria-label="Find my location"
      >
        <Navigation
          className={`w-5 h-5 transition-colors ${
            !isCenteredOnUser ? 'fill-sky-400 text-sky-400' : 'text-zinc-400 fill-none'
          }`}
        />
      </button>

      {/* Zoom in & Zoom out */}
      {!hasActiveDestination && (
        <div className="flex flex-col rounded-2xl bg-zinc-950/85 border border-white/10 backdrop-blur-2xl shadow-xl overflow-hidden divide-y divide-zinc-900">
          <button
            onClick={onZoomIn}
            className="w-11 h-10 flex items-center justify-center text-zinc-300 hover:text-white hover:bg-zinc-900 active:scale-90 transition"
            title="Zoom In"
          >
            <Plus className="w-4 h-4" />
          </button>
          <button
            onClick={onZoomOut}
            className="w-11 h-10 flex items-center justify-center text-zinc-300 hover:text-white hover:bg-zinc-900 active:scale-90 transition"
            title="Zoom Out"
          >
            <Minus className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
};
