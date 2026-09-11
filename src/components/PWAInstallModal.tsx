import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Download, Share, PlusSquare, X, Smartphone, CheckCircle2 } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface Props {
  className?: string;
}

export const PWAInstallModal: React.FC<Props> = ({ className = '' }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSModal, setShowIOSModal] = useState(false);
  const [iconLoaded, setIconLoaded] = useState(true);

  // Lock body scroll when modal is open
  useEffect(() => {
    if (showIOSModal) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') setShowIOSModal(false);
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => {
        document.body.style.overflow = originalOverflow;
        window.removeEventListener('keydown', handleKeyDown);
      };
    }
  }, [showIOSModal]);

  // If running in standalone mode (already installed), no need to show
  if (isInstalled) {
    return null;
  }

  const handleInstallClick = async () => {
    if (isInstallable) {
      const installed = await install();
      if (!installed) {
        setShowIOSModal(true);
      }
    } else {
      setShowIOSModal(true);
    }
  };

  const modalContent = showIOSModal ? (
    <div
      id="ios-install-backdrop"
      className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-6 bg-black/85 backdrop-blur-md overflow-y-auto animate-in fade-in duration-200"
      onClick={() => setShowIOSModal(false)}
      style={{
        paddingTop: 'max(env(safe-area-inset-top, 0px), 16px)',
        paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 16px)',
      }}
    >
      <div
        id="ios-install-card"
        className="w-full max-w-md max-h-[92dvh] sm:max-h-[85vh] flex flex-col rounded-3xl bg-zinc-950 border border-white/15 text-white shadow-[0_25px_60px_rgba(0,0,0,0.95)] relative my-auto overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Bar */}
        <div className="flex items-center justify-between p-5 pb-3 border-b border-zinc-900 shrink-0">
          <div className="flex items-center gap-3">
            {iconLoaded ? (
              <img
                src="/icon-192.png"
                alt="Mapout"
                className="w-10 h-10 rounded-xl shadow-md border border-white/10 object-cover"
                onError={() => setIconLoaded(false)}
              />
            ) : (
              <div className="w-10 h-10 rounded-xl bg-zinc-900 border border-white/15 flex items-center justify-center shadow-md">
                <Smartphone className="w-5 h-5 text-sky-400" />
              </div>
            )}
            <div>
              <h2 className="text-base font-bold tracking-tight text-white leading-tight">
                Add Mapout to Home Screen
              </h2>
              <p className="text-xs text-zinc-400 leading-snug">
                Full-screen native maps experience
              </p>
            </div>
          </div>

          <button
            onClick={() => setShowIOSModal(false)}
            id="close-install-modal-btn"
            className="p-2 rounded-full text-zinc-400 hover:text-white bg-zinc-900 border border-zinc-800 transition active:scale-95 shrink-0 ml-2"
            title="Close instructions"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Body: cleanly fits both portrait and landscape orientation */}
        <div className="p-5 space-y-3 overflow-y-auto text-xs text-zinc-300 overscroll-contain">
          <div className="flex items-start gap-3.5 p-3 rounded-2xl bg-zinc-900/80 border border-zinc-800/80">
            <div className="p-2 rounded-xl bg-sky-500/15 text-sky-400 border border-sky-500/20 shrink-0">
              <Share className="w-4 h-4" />
            </div>
            <div className="leading-relaxed min-w-0">
              <span className="font-semibold text-white block text-xs">1. Tap the Share icon</span>
              <p className="text-zinc-400 text-[11px] mt-0.5">
                Found in Safari&apos;s bottom navigation bar (or top right on iPad). In Chrome, tap the menu <span className="font-mono text-zinc-300">⋮</span>.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3.5 p-3 rounded-2xl bg-zinc-900/80 border border-zinc-800/80">
            <div className="p-2 rounded-xl bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 shrink-0">
              <PlusSquare className="w-4 h-4" />
            </div>
            <div className="leading-relaxed min-w-0">
              <span className="font-semibold text-white block text-xs">2. Select &apos;Add to Home Screen&apos;</span>
              <p className="text-zinc-400 text-[11px] mt-0.5">
                Scroll down the list of actions in the share sheet and tap &apos;Add to Home Screen&apos;.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3.5 p-3 rounded-2xl bg-zinc-900/80 border border-zinc-800/80">
            <div className="p-2 rounded-xl bg-purple-500/15 text-purple-400 border border-purple-500/20 shrink-0">
              <CheckCircle2 className="w-4 h-4" />
            </div>
            <div className="leading-relaxed min-w-0">
              <span className="font-semibold text-white block text-xs">3. Tap &apos;Add&apos; in top right</span>
              <p className="text-zinc-400 text-[11px] mt-0.5">
                Confirm to place the Mapout icon on your phone&apos;s home screen for instant full-screen navigation.
              </p>
            </div>
          </div>
        </div>

        {/* Footer Button */}
        <div className="p-5 pt-3 border-t border-zinc-900 shrink-0 bg-zinc-950/80">
          <button
            onClick={() => setShowIOSModal(false)}
            id="dismiss-install-modal-btn"
            className="w-full py-3 rounded-2xl bg-white text-black font-bold text-xs tracking-wider uppercase active:scale-[0.98] transition hover:bg-zinc-200 shadow-lg"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
      {isInstallable ? (
        <button
          onClick={handleInstallClick}
          id="pwa-install-btn"
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-zinc-900/90 hover:bg-zinc-800 text-white border border-white/15 text-xs font-medium backdrop-blur-xl shadow-lg transition-all active:scale-95 ${className}`}
          title="Install Mapout to Home Screen"
        >
          <Download className="w-3.5 h-3.5 text-sky-400" />
          <span>Install</span>
        </button>
      ) : (
        <button
          onClick={handleInstallClick}
          id="pwa-ios-guide-btn"
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-zinc-900/90 hover:bg-zinc-800 text-white border border-white/15 text-xs font-medium backdrop-blur-xl shadow-lg transition-all active:scale-95 ${className}`}
          title="Add Mapout to Home Screen"
        >
          <Smartphone className="w-3.5 h-3.5 text-sky-400" />
          <span>Add to Home</span>
        </button>
      )}

      {/* Render modal directly into document.body to break free from any backdrop-filter or transform containing blocks */}
      {typeof document !== 'undefined' && modalContent && createPortal(modalContent, document.body)}
    </>
  );
};
