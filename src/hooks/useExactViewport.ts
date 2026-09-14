import { useEffect, RefObject } from 'react';
import { Map as MapLibreMap } from 'maplibre-gl';

/**
 * Ensures the map canvas stays perfectly synced with the viewport.
 * Modern CSS dvh handles the dynamic screen sizing, eliminating the need for complex JS dimension overrides.
 */
export function useExactViewport(
  containerRef?: RefObject<HTMLDivElement | null>,
  mapInstanceRef?: RefObject<MapLibreMap | null>
) {
  useEffect(() => {
    const triggerResize = () => {
      if (mapInstanceRef?.current) {
        mapInstanceRef.current.resize();
      }
    };

    window.addEventListener('resize', triggerResize, { passive: true });
    window.addEventListener('orientationchange', triggerResize, { passive: true });
    
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', triggerResize, { passive: true });
    }

    // Cascade timeouts to handle slow browser reflows
    const t1 = setTimeout(triggerResize, 50);
    const t2 = setTimeout(triggerResize, 150);
    const t3 = setTimeout(triggerResize, 300);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      window.removeEventListener('resize', triggerResize);
      window.removeEventListener('orientationchange', triggerResize);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', triggerResize);
      }
    };
  }, [containerRef, mapInstanceRef]);
}
