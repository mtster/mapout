import { useEffect, RefObject } from 'react';
import { Map as MapLibreMap } from 'maplibre-gl';

/**
 * Calculates the device's hardware physical screen dimensions where anything can be displayed,
 * explicitly bypassing the iOS layout viewport restricted height to ensure 100% edge-to-edge coverage.
 */
export function getHardwareScreenDimensions() {
  if (typeof window === 'undefined') {
    return { targetHeight: 0, targetWidth: 0 };
  }

  const isMobile =
    /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 0 && window.innerWidth <= 1024);

  let targetHeight: number;
  let targetWidth: number;

  if (isMobile) {
    const isLandscape =
      Math.abs(Number(window.orientation || 0)) === 90 ||
      window.innerWidth > window.innerHeight;

    const rawScreenH = window.screen ? window.screen.height : 0;
    const rawScreenW = window.screen ? window.screen.width : 0;

    const screenH = isLandscape
      ? Math.min(rawScreenH, rawScreenW)
      : Math.max(rawScreenH, rawScreenW);
    const screenW = isLandscape
      ? Math.max(rawScreenH, rawScreenW)
      : Math.min(rawScreenH, rawScreenW);

    targetHeight = Math.max(
      screenH,
      window.screen ? window.screen.availHeight || 0 : 0,
      window.innerHeight || 0,
      window.visualViewport?.height || 0,
      document.documentElement?.clientHeight || 0
    );

    targetWidth = Math.max(
      screenW,
      window.screen ? window.screen.availWidth || 0 : 0,
      window.innerWidth || 0,
      window.visualViewport?.width || 0,
      document.documentElement?.clientWidth || 0
    );
  } else {
    targetHeight = window.innerHeight || document.documentElement?.clientHeight || 0;
    targetWidth = window.innerWidth || document.documentElement?.clientWidth || 0;
  }

  return { targetHeight, targetWidth };
}

/**
 * Ensures the map canvas and app root fill the exact physical hardware screen height on mobile,
 * iOS Safari, WebClip, PWA, and desktop browsers, preventing any bottom gaps or phantom overflows.
 */
export function useExactViewport(
  containerRef?: RefObject<HTMLDivElement | null>,
  mapInstanceRef?: RefObject<MapLibreMap | null>
) {
  useEffect(() => {
    const applyExactDimensions = () => {
      const { targetHeight, targetWidth } = getHardwareScreenDimensions();
      if (targetHeight === 0 || targetWidth === 0) return;

      // Set CSS custom variables on root for reactive styling
      document.documentElement.style.setProperty('--real-screen-height', `${targetHeight}px`);
      document.documentElement.style.setProperty('--real-screen-width', `${targetWidth}px`);

      // Apply with 'important' to guarantee priority over any stylesheet rules
      document.documentElement.style.setProperty('height', `${targetHeight}px`, 'important');
      document.documentElement.style.setProperty('min-height', `${targetHeight}px`, 'important');

      document.body.style.setProperty('height', `${targetHeight}px`, 'important');
      document.body.style.setProperty('min-height', `${targetHeight}px`, 'important');

      const rootEl = document.getElementById('root');
      if (rootEl) {
        rootEl.style.setProperty('height', `${targetHeight}px`, 'important');
        rootEl.style.setProperty('min-height', `${targetHeight}px`, 'important');
        rootEl.style.setProperty('width', `${targetWidth}px`, 'important');
      }

      const mainEl = document.getElementById('main-view');
      if (mainEl) {
        mainEl.style.setProperty('height', `${targetHeight}px`, 'important');
        mainEl.style.setProperty('min-height', `${targetHeight}px`, 'important');
        mainEl.style.setProperty('width', `${targetWidth}px`, 'important');
      }

      // Ensure container and canvas stay flush edge-to-edge
      const container = containerRef?.current;
      if (container) {
        container.style.setProperty('height', `${targetHeight}px`, 'important');
        container.style.setProperty('min-height', `${targetHeight}px`, 'important');
        container.style.setProperty('width', `${targetWidth}px`, 'important');

        const canvasContainer = container.querySelector('.maplibregl-canvas-container') as HTMLElement | null;
        const canvas = container.querySelector('.maplibregl-canvas') as HTMLElement | null;
        if (canvasContainer) {
          canvasContainer.style.setProperty('height', `${targetHeight}px`, 'important');
          canvasContainer.style.setProperty('min-height', `${targetHeight}px`, 'important');
          canvasContainer.style.setProperty('width', `${targetWidth}px`, 'important');
        }
        if (canvas) {
          canvas.style.setProperty('height', `${targetHeight}px`, 'important');
          canvas.style.setProperty('min-height', `${targetHeight}px`, 'important');
          canvas.style.setProperty('width', `${targetWidth}px`, 'important');
        }
      }

      if (mapInstanceRef?.current) {
        mapInstanceRef.current.resize();
      }
    };

    applyExactDimensions();

    window.addEventListener('resize', applyExactDimensions, { passive: true });
    window.addEventListener('orientationchange', applyExactDimensions, { passive: true });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', applyExactDimensions, { passive: true });
      window.visualViewport.addEventListener('scroll', applyExactDimensions, { passive: true });
    }

    const t1 = setTimeout(applyExactDimensions, 50);
    const t2 = setTimeout(applyExactDimensions, 150);
    const t3 = setTimeout(applyExactDimensions, 300);
    const t4 = setTimeout(applyExactDimensions, 600);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
      window.removeEventListener('resize', applyExactDimensions);
      window.removeEventListener('orientationchange', applyExactDimensions);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', applyExactDimensions);
        window.visualViewport.removeEventListener('scroll', applyExactDimensions);
      }
    };
  }, [containerRef, mapInstanceRef]);
}
