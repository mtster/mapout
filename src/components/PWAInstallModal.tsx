import React, { useState } from 'react';
import { Download, Share, PlusSquare, X, Smartphone } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface Props {
  className?: string;
}

export const PWAInstallModal: React.FC<Props> = ({ className = '' }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSModal, setShowIOSModal] = useState(false);

  // If running in standalone mode (already installed), no need to show
  if (isInstalled) {
    return null;
  }

  return (
    <>
      {isInstallable && (
        <button
          onClick={install}
          id="pwa-install-btn"
          className={`flex items-center gap-2 px-3 py-1.5 rounded-full bg-zinc-900/90 hover:bg-zinc-800 text-white border border-white/15 text-xs font-medium backdrop-blur-xl shadow-lg transition-all active:scale-95 ${className}`}
          title="Install Mapout to Home Screen"
        >
          <Download className="w-3.5 h-3.5 text-white" />
          <span>Install App</span>
        </button>
      )}

      {isIOS && !isInstallable && (
        <button
          onClick={() => setShowIOSModal(true)}
          id="pwa-ios-guide-btn"
          className={`flex items-center gap-2 px-3 py-1.5 rounded-full bg-zinc-900/90 hover:bg-zinc-800 text-white border border-white/15 text-xs font-medium backdrop-blur-xl shadow-lg transition-all active:scale-95 ${className}`}
          title="Add Mapout to iOS Home Screen"
        >
          <Smartphone className="w-3.5 h-3.5 text-white" />
          <span>Add to Home</span>
        </button>
      )}

      {showIOSModal && (
        <div
          id="ios-install-backdrop"
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in"
          onClick={() => setShowIOSModal(false)}
        >
          <div
            id="ios-install-card"
            className="w-full max-w-sm rounded-3xl bg-zinc-950 border border-zinc-800/80 p-6 text-white shadow-2xl relative mb-4 sm:mb-0"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setShowIOSModal(false)}
              className="absolute top-4 right-4 p-2 rounded-full text-zinc-400 hover:text-white bg-zinc-900 border border-zinc-800 transition"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-3.5 mb-4">
              <img
                src="/icon-192.png"
                alt="Mapout"
                className="w-12 h-12 rounded-2xl shadow-md border border-white/10"
              />
              <div>
                <h3 className="text-base font-semibold tracking-tight text-white">Add Mapout to Home Screen</h3>
                <p className="text-xs text-zinc-400">Run full-screen without Safari browser bars</p>
              </div>
            </div>

            <div className="space-y-3 my-4 text-xs text-zinc-300">
              <div className="flex items-start gap-3 p-2.5 rounded-xl bg-zinc-900/70 border border-zinc-800/60">
                <div className="p-1.5 rounded-lg bg-zinc-800 text-white shrink-0">
                  <Share className="w-4 h-4" />
                </div>
                <div className="leading-relaxed">
                  <span className="font-semibold text-white">1. Tap the Share button</span>
                  <p className="text-zinc-400 text-[11px]">Located at the bottom of Safari (or top right on iPad).</p>
                </div>
              </div>

              <div className="flex items-start gap-3 p-2.5 rounded-xl bg-zinc-900/70 border border-zinc-800/60">
                <div className="p-1.5 rounded-lg bg-zinc-800 text-white shrink-0">
                  <PlusSquare className="w-4 h-4" />
                </div>
                <div className="leading-relaxed">
                  <span className="font-semibold text-white">2. Select &apos;Add to Home Screen&apos;</span>
                  <p className="text-zinc-400 text-[11px]">Scroll down the share sheet and tap the &apos;Add to Home Screen&apos; icon.</p>
                </div>
              </div>
            </div>

            <button
              onClick={() => setShowIOSModal(false)}
              className="w-full py-2.5 rounded-2xl bg-white text-black font-semibold text-xs tracking-wide active:scale-[0.98] transition hover:bg-zinc-200"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
};
