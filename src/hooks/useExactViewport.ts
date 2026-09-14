import { useEffect, RefObject } from 'react';
import { Map as MapLibreMap } from 'maplibre-gl';

/**
 * Calculates the device's true physical hardware screen dimensions,
 * bypassing WebKit's reported layout viewport height to ensure 100% gapless edge-to-edge coverage.
 */
export function getHardwareScreenDimensions() {
  if (typeof window === 'undefined') {
    return { targetHeight: 0, targetWidth: 0 };
  }

  const isLandscape = typeof window !== 'undefined' && window.innerWidth > window.innerHeight;
  const screenH = window.screen?.height || 0;
  const screenW = window.screen?.width || 0;
  const innerH = window.innerHeight || 0;
  const innerW = window.innerWidth || 0;
  const vvH = window.visualViewport?.height || 0;
  const vvW = window.visualViewport?.width || 0;
  const docH = document.documentElement?.clientHeight || 0;
  const docW = document.documentElement?.clientWidth || 0;

  // window.screen represents the physical hardware panel
  const maxScreenDim = Math.max(screenH, screenW);
  const minScreenDim = Math.min(screenH, screenW);
  const fullScreenH = isLandscape ? minScreenDim : maxScreenDim;
  const fullScreenW = isLandscape ? maxScreenDim : minScreenDim;

  // Math.max guarantees targetHeight matches the physical device height
  const targetHeight = Math.max(fullScreenH, innerH, vvH, docH);
  const targetWidth = Math.max(fullScreenW, innerW, vvW, docW);

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

      // Dynamic stylesheet injection to override any layout viewport constraints immediately
      let styleEl = document.getElementById('hardware-screen-style');
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'hardware-screen-style';
        document.head.appendChild(styleEl);
      }
      styleEl.textContent = `
        html, body, #root, #main-view, #map-container {
          width: ${targetWidth}px !important;
          min-width: ${targetWidth}px !important;
          height: ${targetHeight}px !important;
          min-height: ${targetHeight}px !important;
          bottom: auto !important;
        }
        .maplibregl-canvas-container, .maplibregl-canvas {
          width: ${targetWidth}px !important;
          min-width: ${targetWidth}px !important;
          height: ${targetHeight}px !important;
          min-height: ${targetHeight}px !important;
          bottom: auto !important;
        }
      `;

      // Direct Inline Overrides with !important:
      // Apply targetHeight and bottom: auto directly to root, documentElement, body, and main-view
      document.documentElement.style.setProperty('height', `${targetHeight}px`, 'important');
      document.documentElement.style.setProperty('min-height', `${targetHeight}px`, 'important');
      document.documentElement.style.setProperty('bottom', 'auto', 'important');

      document.body.style.setProperty('height', `${targetHeight}px`, 'important');
      document.body.style.setProperty('min-height', `${targetHeight}px`, 'important');
      document.body.style.setProperty('bottom', 'auto', 'important');

      const rootEl = document.getElementById('root');
      if (rootEl) {
        rootEl.style.setProperty('height', `${targetHeight}px`, 'important');
        rootEl.style.setProperty('min-height', `${targetHeight}px`, 'important');
        rootEl.style.setProperty('width', `${targetWidth}px`, 'important');
        rootEl.style.setProperty('bottom', 'auto', 'important');
      }

      const mainEl = document.getElementById('main-view');
      if (mainEl) {
        mainEl.style.setProperty('height', `${targetHeight}px`, 'important');
        mainEl.style.setProperty('min-height', `${targetHeight}px`, 'important');
        mainEl.style.setProperty('width', `${targetWidth}px`, 'important');
        mainEl.style.setProperty('bottom', 'auto', 'important');
      }

      // Apply targetHeight in exact physical pixels directly to #map-container and WebGL canvas elements
      const container = containerRef?.current || document.getElementById('map-container');
      if (container) {
        container.style.setProperty('height', `${targetHeight}px`, 'important');
        container.style.setProperty('min-height', `${targetHeight}px`, 'important');
        container.style.setProperty('width', `${targetWidth}px`, 'important');
        container.style.setProperty('min-width', `${targetWidth}px`, 'important');
        container.style.setProperty('bottom', 'auto', 'important');

        const canvasContainer = container.querySelector('.maplibregl-canvas-container') as HTMLElement | null;
        const canvas = container.querySelector('.maplibregl-canvas') as HTMLElement | null;
        if (canvasContainer) {
          canvasContainer.style.setProperty('height', `${targetHeight}px`, 'important');
          canvasContainer.style.setProperty('min-height', `${targetHeight}px`, 'important');
          canvasContainer.style.setProperty('width', `${targetWidth}px`, 'important');
          canvasContainer.style.setProperty('min-width', `${targetWidth}px`, 'important');
          canvasContainer.style.setProperty('bottom', 'auto', 'important');
        }
        if (canvas) {
          canvas.style.setProperty('height', `${targetHeight}px`, 'important');
          canvas.style.setProperty('min-height', `${targetHeight}px`, 'important');
          canvas.style.setProperty('width', `${targetWidth}px`, 'important');
          canvas.style.setProperty('min-width', `${targetWidth}px`, 'important');
          canvas.style.setProperty('bottom', 'auto', 'important');
        }
      }

      // 4. MapLibre Synchronization: Trigger resize so WebGL projection matrix updates to full physical bounds
      if (mapInstanceRef?.current) {
        mapInstanceRef.current.resize();
      }
    };

    applyExactDimensions();

    // 5. Cascading Event Handlers & Timers:
    // Listen to resize, orientationchange, and visualViewport.resize/scroll
    window.addEventListener('resize', applyExactDimensions, { passive: true });
    window.addEventListener('orientationchange', applyExactDimensions, { passive: true });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', applyExactDimensions, { passive: true });
      window.visualViewport.addEventListener('scroll', applyExactDimensions, { passive: true });
    }

    // Timed re-evaluations at 50ms, 150ms, 300ms, 600ms, and 1200ms to guarantee any delayed layout shift is overridden
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
        window.visualViewport.removeEventListener('scroll', applyExactDimensions);
      }
    };
  }, [containerRef, mapInstanceRef]);
}
