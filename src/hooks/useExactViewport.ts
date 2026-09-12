import { useEffect, RefObject } from 'react';
import { Map as MapLibreMap } from 'maplibre-gl';

/**
 * Ensures the map canvas and app root fill the exact dynamic viewport on mobile, PWA,
 * and desktop browsers, preventing any bottom gaps or phantom overflows.
 */
export function useExactViewport(
  containerRef: RefObject<HTMLDivElement | null>,
  mapInstanceRef: RefObject<MapLibreMap | null>
) {
  useEffect(() => {
    const applyExactDimensions = () => {
      // Use visualViewport if supported for high-precision mobile browser toolbar handling,
      // falling back to innerHeight / clientHeight.
      const targetHeight =
        window.visualViewport?.height ||
        window.innerHeight ||
        document.documentElement?.clientHeight ||
        0;
      const targetWidth =
        window.visualViewport?.width ||
        window.innerWidth ||
        document.documentElement?.clientWidth ||
        0;

      if (targetHeight === 0 || targetWidth === 0) return;

      // Ensure container and canvas stay flush edge-to-edge
      const container = containerRef.current;
      if (container) {
        container.style.height = `${targetHeight}px`;
        container.style.width = `${targetWidth}px`;

        const canvasContainer = container.querySelector('.maplibregl-canvas-container') as HTMLElement | null;
        const canvas = container.querySelector('.maplibregl-canvas') as HTMLElement | null;
        if (canvasContainer) {
          canvasContainer.style.height = `${targetHeight}px`;
          canvasContainer.style.width = `${targetWidth}px`;
        }
        if (canvas) {
          canvas.style.height = `${targetHeight}px`;
          canvas.style.width = `${targetWidth}px`;
        }
      }

      // Sync document elements
      document.documentElement.style.height = `${targetHeight}px`;
      document.body.style.height = `${targetHeight}px`;

      const rootEl = document.getElementById('root');
      if (rootEl) {
        rootEl.style.height = `${targetHeight}px`;
        rootEl.style.width = `${targetWidth}px`;
      }

      const mainEl = document.getElementById('main-view');
      if (mainEl) {
        mainEl.style.height = `${targetHeight}px`;
        mainEl.style.width = `${targetWidth}px`;
      }

      if (mapInstanceRef.current) {
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
