import React, { useState } from 'react';
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
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetNorth: () => void;
  isNavigating: boolean;
}

export const MapControls: React.FC<Props> = ({
  mapStyle,
  onChangeStyle,
  onLocateMe,
  isLocating,
  hasUserLocation,
  onZoomIn,
  onZoomOut,
  onResetNorth,
  isNavigating,
}) => {
  const [showLayerMenu, setShowLayerMenu] = useState(false);

  // When actively navigating, some controls are simplified or moved
  if (isNavigating) return null;

  return (
    <div
      className="fixed right-3 sm:right-6 bottom-20 z-30 flex flex-col gap-2.5 pointer-events-auto"
      style={{ bottom: 'calc(max(env(safe-area-inset-bottom, 0px), 16px) + 20px)' }}
    >
      {/* Compass / Reset North */}
      <button
        onClick={onResetNorth}
        className="w-11 h-11 rounded-2xl bg-zinc-950/85 border border-white/10 backdrop-blur-2xl shadow-xl flex items-center justify-center text-zinc-300 hover:text-white hover:bg-zinc-900 active:scale-90 transition"
        title="Reset map orientation to North"
      >
        <Compass className="w-5 h-5 text-zinc-400 hover:text-sky-400 transition" />
      </button>

      {/* Layer Switcher */}
      <div className="relative">
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
            className="absolute right-14 bottom-0 w-36 rounded-2xl bg-zinc-950/95 border border-white/15 p-1.5 backdrop-blur-3xl shadow-2xl space-y-1 z-40"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-2.5 py-1 text-[10px] font-bold tracking-wider text-zinc-500 uppercase">
              Map Style
            </div>
            {(
              [
                { id: 'dark', label: 'Obsidian Dark' },
                { id: 'midnight', label: 'Pure Midnight' },
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
        onClick={onLocateMe}
        className={`w-11 h-11 rounded-2xl border backdrop-blur-2xl shadow-xl flex items-center justify-center transition active:scale-90 ${
          hasUserLocation
            ? 'bg-zinc-950/85 border-white/10 text-sky-400 hover:bg-zinc-900'
            : 'bg-zinc-950/85 border-white/10 text-zinc-400 hover:text-white hover:bg-zinc-900'
        }`}
        title="Find my location"
      >
        {isLocating ? (
          <div className="w-4 h-4 rounded-full border-2 border-sky-400 border-t-transparent animate-spin" />
        ) : (
          <Navigation
            className={`w-5 h-5 ${hasUserLocation ? 'fill-sky-400 text-sky-400' : 'text-zinc-400'}`}
          />
        )}
      </button>

      {/* Zoom in & Zoom out */}
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
    </div>
  );
};
