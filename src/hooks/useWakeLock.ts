import { useEffect, useRef, useState } from 'react';

/**
 * Hook to keep the screen awake using the Screen Wake Lock API.
 * Supported natively in iOS 16.4+ (including iOS standalone PWAs), Android Chrome, and modern browsers.
 * Automatically handles page visibility changes to re-acquire lock when user returns to app.
 */
export function useWakeLock(enabled: boolean) {
  const [isLocked, setIsLocked] = useState(false);
  const wakeLockSentinelRef = useRef<WakeLockSentinel | null>(null);
  const isEnabledRef = useRef(enabled);

  useEffect(() => {
    isEnabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    let isCancelled = false;

    const requestLock = async () => {
      if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) {
        return;
      }

      try {
        // If already held and active, don't request duplicate
        if (wakeLockSentinelRef.current && !wakeLockSentinelRef.current.released) {
          return;
        }

        const sentinel = await navigator.wakeLock.request('screen');
        if (isCancelled) {
          sentinel.release().catch(() => {});
          return;
        }

        wakeLockSentinelRef.current = sentinel;
        setIsLocked(true);

        sentinel.addEventListener('release', () => {
          if (!isCancelled) {
            setIsLocked(false);
          }
        });
      } catch (err) {
        // May fail if low battery saver mode or disallowed by OS policy - fail silently
        console.info('Wake lock request could not be granted:', err);
        if (!isCancelled) {
          setIsLocked(false);
        }
      }
    };

    const releaseLock = async () => {
      if (wakeLockSentinelRef.current && !wakeLockSentinelRef.current.released) {
        try {
          await wakeLockSentinelRef.current.release();
        } catch {
          // Ignored
        }
      }
      wakeLockSentinelRef.current = null;
      setIsLocked(false);
    };

    if (enabled) {
      requestLock();
    } else {
      releaseLock();
    }

    // Re-acquire lock when document becomes visible again (iOS / Android browser behavior)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && isEnabledRef.current) {
        requestLock();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleVisibilityChange);

    return () => {
      isCancelled = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleVisibilityChange);
      releaseLock();
    };
  }, [enabled]);

  return { isLocked };
}
