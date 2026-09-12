import { useEffect, RefObject } from 'react';
import { Map as MapLibreMap } from 'maplibre-gl';

/**
 * Calculates and applies exact physical dimensions of the device in pixels to the map
 * and document roots, bypassing iOS WebKit viewport trimming at the bottom home indicator bar.
 */
export function useExactViewport(
  containerRef: RefObject<HTMLDivElement | null>,
  mapInstanceRef: RefObject<MapLibreMap | null>
) {
  useEffect(() => {
    const applyExactDimensions = () => {
      const isLandscape = typeof window !== 'undefined' && window.innerWidth > window.innerHeight;
      const screenH = window.screen?.height || 0;
      const screenW = window.screen?.width || 0;
      const innerH = window.innerHeight || 0;
      const innerW = window.innerWidth || 0;
      const vvH = window.visualViewport?.height || 0;
      const vvW = window.visualViewport?.width || 0;
      const docH = document.documentElement?.clientHeight || 0;
      const docW = document.documentElement?.clientWidth || 0;

      // In iOS or mobile, screen.height represents the true unconstrained physical screen
      const maxScreenDim = Math.max(screenH, screenW);
      const minScreenDim = Math.min(screenH, screenW);
      const fullScreenH = isLandscape ? minScreenDim : maxScreenDim;
      const fullScreenW = isLandscape ? maxScreenDim : minScreenDim;

      const targetHeight = Math.max(fullScreenH, innerH, vvH, docH);
      const targetWidth = Math.max(fullScreenW, innerW, vvW, docW);

      // Physically force the map container element
      const container = containerRef.current;
      if (container) {
        container.style.setProperty('height', `${targetHeight}px`, 'important');
        container.style.setProperty('min-height', `${targetHeight}px`, 'important');
        container.style.setProperty('width', `${targetWidth}px`, 'important');
        container.style.setProperty('min-width', `${targetWidth}px`, 'important');

        const canvasContainer = container.querySelector('.maplibregl-canvas-container') as HTMLElement | null;
        const canvas = container.querySelector('.maplibregl-canvas') as HTMLElement | null;
        if (canvasContainer) {
          canvasContainer.style.setProperty('height', `${targetHeight}px`, 'important');
          canvasContainer.style.setProperty('width', `${targetWidth}px`, 'important');
        }
        if (canvas) {
          canvas.style.setProperty('height', `${targetHeight}px`, 'important');
          canvas.style.setProperty('width', `${targetWidth}px`, 'important');
        }
      }

      // Also force document body and root elements
      document.documentElement.style.setProperty('height', `${targetHeight}px`, 'important');
      document.documentElement.style.setProperty('min-height', `${targetHeight}px`, 'important');
      document.body.style.setProperty('height', `${targetHeight}px`, 'important');
      document.body.style.setProperty('min-height', `${targetHeight}px`, 'important');

      const rootEl = document.getElementById('root');
      if (rootEl) {
        rootEl.style.setProperty('height', `${targetHeight}px`, 'important');
        rootEl.style.setProperty('min-height', `${targetHeight}px`, 'important');
      }

      const mainEl = document.getElementById('main-view');
      if (mainEl) {
        mainEl.style.setProperty('height', `${targetHeight}px`, 'important');
        mainEl.style.setProperty('min-height', `${targetHeight}px`, 'important');
      }

      if (mapInstanceRef.current) {
        mapInstanceRef.current.resize();
      }
    };

    applyExactDimensions();

    window.addEventListener('resize', applyExactDimensions);
    window.addEventListener('orientationchange', applyExactDimensions);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', applyExactDimensions);
    }

    const t1 = setTimeout(applyExactDimensions, 50);
    const t2 = setTimeout(applyExactDimensions, 150);
    const t3 = setTimeout(applyExactDimensions, 300);
    const t4 = setTimeout(applyExactDimensions, 600);
    const t5 = setTimeout(applyExactDimensions, 1200);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
      clearTimeout(t5);
      window.removeEventListener('resize', applyExactDimensions);
      window.removeEventListener('orientationchange', applyExactDimensions);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', applyExactDimensions);
      }
    };
  }, [containerRef, mapInstanceRef]);
}
