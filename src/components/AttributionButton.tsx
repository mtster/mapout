import React, { useState, useRef, useEffect } from 'react';
import { Info, X, ExternalLink } from 'lucide-react';

interface Props {
  isNavigating: boolean;
}

export const AttributionButton: React.FC<Props> = ({ isNavigating }) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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
        className="fixed left-3 sm:left-6 z-[1250] pointer-events-auto transition-all duration-300"
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
            onClick={(e) => e.stopPropagation()}
            className="absolute left-0 top-13 w-72 sm:w-80 rounded-2xl bg-zinc-950/95 border border-white/15 p-4 backdrop-blur-3xl shadow-2xl space-y-3 z-[1300] text-left animate-in fade-in zoom-in-95 duration-150"
          >
          <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
            <div className="flex items-center gap-2 text-sky-400 font-semibold text-xs tracking-wide">
              <Info className="w-4 h-4" />
              <span>Map Information & Credits</span>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="text-zinc-400 hover:text-white p-1 rounded-lg hover:bg-zinc-900 transition"
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-2.5 text-xs text-zinc-300">
            <div className="p-2.5 rounded-xl bg-zinc-900/70 border border-white/5 space-y-1">
              <div className="flex items-center justify-between text-white font-medium">
                <span>OpenFreeMap</span>
                <a
                  href="https://openfreemap.org"
                  target="_blank"
                  rel="noreferrer"
                  className="text-sky-400 hover:underline flex items-center gap-0.5 text-[11px]"
                >
                  openfreemap.org <ExternalLink className="w-3 h-3" />
                </a>
              </div>
              <p className="text-zinc-400 text-[11px] leading-relaxed">
                Vector tile styles &amp; global infrastructure hosting. Free and open.
              </p>
            </div>

            <div className="p-2.5 rounded-xl bg-zinc-900/70 border border-white/5 space-y-1">
              <div className="flex items-center justify-between text-white font-medium">
                <span>OpenStreetMap</span>
                <a
                  href="https://www.openstreetmap.org/copyright"
                  target="_blank"
                  rel="noreferrer"
                  className="text-sky-400 hover:underline flex items-center gap-0.5 text-[11px]"
                >
                  © OSM <ExternalLink className="w-3 h-3" />
                </a>
              </div>
              <p className="text-zinc-400 text-[11px] leading-relaxed">
                Global geographic data contributed by the OpenStreetMap community under ODbL.
              </p>
            </div>

            <div className="p-2.5 rounded-xl bg-zinc-900/70 border border-white/5 space-y-1">
              <div className="flex items-center justify-between text-white font-medium">
                <span>BRouter &amp; MapLibre</span>
              </div>
              <p className="text-zinc-400 text-[11px] leading-relaxed">
                Turn-by-turn routing calculated via BRouter engine. Hardware vector rendering powered by MapLibre GL.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
    </>
  );
};
