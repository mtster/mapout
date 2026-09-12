import React, { useState, useRef } from 'react';
import { Info, X, ExternalLink } from 'lucide-react';

interface Props {
  isNavigating: boolean;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export const AttributionButton: React.FC<Props> = ({
  isNavigating,
  isOpen: externalIsOpen,
  onOpenChange,
}) => {
  const [internalIsOpen, setInternalIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const isOpen = externalIsOpen !== undefined ? externalIsOpen : internalIsOpen;
  const setIsOpen = (open: boolean) => {
    setInternalIsOpen(open);
    onOpenChange?.(open);
  };

  // Hide during active turn-by-turn navigation so HUD has complete focus
  if (isNavigating) return null;

  return (
    <>
      {/* Fullscreen backdrop to dismiss popover when tapping anywhere without triggering map clicks */}
      {isOpen && (
        <div
          id="attribution-backdrop"
          className="fixed inset-0 z-[1200] bg-transparent cursor-default"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            setIsOpen(false);
          }}
          onTouchStart={(e) => {
            e.stopPropagation();
            setIsOpen(false);
          }}
        />
      )}

      <div
        ref={containerRef}
        className="fixed left-3 sm:left-6 z-[1100] pointer-events-auto transition-all duration-300"
        style={{
          top: 'calc(env(safe-area-inset-top, 0px) + 70px)',
        }}
      >
        {/* Attribution Button - Identical in design to bottom-right map controls */}
        <button
          id="openfreemap-attribution-btn"
          onClick={(e) => {
            e.stopPropagation();
            setIsOpen(!isOpen);
          }}
          className={`w-11 h-11 rounded-2xl border backdrop-blur-2xl shadow-xl flex items-center justify-center transition active:scale-90 ${
            isOpen
              ? 'bg-sky-500/20 border-sky-400 text-sky-400 shadow-[0_0_15px_rgba(56,189,248,0.25)]'
              : 'bg-zinc-950/85 border-white/10 text-zinc-300 hover:text-white hover:bg-zinc-900'
          }`}
          title="Map Attribution & Data Sources"
          aria-label="Map Attribution and Info"
        >
          <Info className="w-5 h-5" />
        </button>

        {/* Attribution Card / Popover */}
        {isOpen && (
          <div
            id="attribution-popover"
            className="absolute left-0 top-14 w-80 sm:w-96 rounded-3xl bg-zinc-950/95 border border-white/15 p-5 backdrop-blur-3xl shadow-[0_20px_50px_rgba(0,0,0,0.9)] z-[1250] space-y-4 animate-in fade-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Popover Header */}
            <div className="flex items-center justify-between border-b border-zinc-800/80 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-sky-400 animate-pulse" />
                <h3 className="text-sm font-bold text-white tracking-tight">
                  Map & Data Sources
                </h3>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 rounded-full text-zinc-400 hover:text-white hover:bg-zinc-800 transition active:scale-95"
                title="Close attribution"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content List */}
            <div className="space-y-3 text-xs leading-relaxed text-zinc-300">
              <div className="p-3 rounded-2xl bg-zinc-900/80 border border-white/5 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-white">OpenFreeMap</span>
                  <a
                    href="https://openfreemap.org"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sky-400 hover:underline flex items-center gap-1 text-[11px]"
                  >
                    <span>openfreemap.org</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <p className="text-zinc-400 text-[11px]">
                  Free, open-source vector tiles hosting powered by MapLibre GL.
                </p>
              </div>

              <div className="p-3 rounded-2xl bg-zinc-900/80 border border-white/5 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-white">OpenStreetMap</span>
                  <a
                    href="https://www.openstreetmap.org/copyright"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sky-400 hover:underline flex items-center gap-1 text-[11px]"
                  >
                    <span>© OSM Contributors</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <p className="text-zinc-400 text-[11px]">
                  Global community map data licensed under Open Database License (ODbL).
                </p>
              </div>

              <div className="p-3 rounded-2xl bg-zinc-900/80 border border-white/5 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-white">OSRM Routing & Photon</span>
                  <span className="text-zinc-500 text-[10px]">Turn-by-Turn Engine</span>
                </div>
                <p className="text-zinc-400 text-[11px]">
                  Routing algorithms and geocoding services built on open infrastructure.
                </p>
              </div>
            </div>

            {/* Footer */}
            <div className="text-[10px] text-zinc-500 border-t border-zinc-900 pt-2 flex items-center justify-between">
              <span>Mapout • Privacy Focused</span>
              <span>100% Free & Open</span>
            </div>
          </div>
        )}
      </div>
    </>
  );
};
