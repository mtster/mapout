import React, { useEffect, useState } from 'react';

interface ElementMetrics {
  name: string;
  w: number;
  h: number;
  top: number;
  bottom: number;
  clientH: number;
  offsetH: number;
}

export const ViewportDebugHUD: React.FC = () => {
  const [isOpen, setIsOpen] = useState(true);
  const [activeTest, setActiveTest] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<{
    inner: string;
    outer: string;
    screen: string;
    vv: string;
    dpr: number;
    standalone: boolean;
    safeArea: string;
    units: { vh: number; dvh: number; lvh: number; svh: number };
    elements: ElementMetrics[];
  } | null>(null);

  useEffect(() => {
    const update = () => {
      const elNames = ['html', 'body', '#root', 'main', '#map-container', '.maplibregl-canvas'];
      const elMetrics: ElementMetrics[] = elNames.map((selector) => {
        const el = document.querySelector(selector) as HTMLElement | null;
        if (!el) {
          return { name: selector, w: 0, h: 0, top: 0, bottom: 0, clientH: 0, offsetH: 0 };
        }
        const rect = el.getBoundingClientRect();
        return {
          name: selector,
          w: Math.round(rect.width),
          h: Math.round(rect.height),
          top: Math.round(rect.top),
          bottom: Math.round(rect.bottom),
          clientH: el.clientHeight,
          offsetH: el.offsetHeight,
        };
      });

      // Measure CSS units
      const measureUnit = (unitStr: string): number => {
        const testEl = document.createElement('div');
        testEl.style.cssText = `position:fixed;top:0;left:0;height:${unitStr};visibility:hidden;pointer-events:none;`;
        document.body.appendChild(testEl);
        const h = Math.round(testEl.getBoundingClientRect().height);
        document.body.removeChild(testEl);
        return h;
      };

      const units = {
        vh: measureUnit('100vh'),
        dvh: measureUnit('100dvh'),
        lvh: measureUnit('100lvh'),
        svh: measureUnit('100svh'),
      };

      // Probe CSS safe area insets
      const div = document.createElement('div');
      div.style.position = 'fixed';
      div.style.top = '0';
      div.style.left = '0';
      div.style.paddingTop = 'env(safe-area-inset-top, 0px)';
      div.style.paddingBottom = 'env(safe-area-inset-bottom, 0px)';
      div.style.paddingLeft = 'env(safe-area-inset-left, 0px)';
      div.style.paddingRight = 'env(safe-area-inset-right, 0px)';
      div.style.visibility = 'hidden';
      document.body.appendChild(div);
      const computed = window.getComputedStyle(div);
      const safeArea = `T:${computed.paddingTop} B:${computed.paddingBottom} L:${computed.paddingLeft} R:${computed.paddingRight}`;
      document.body.removeChild(div);

      const isStandalone =
        window.matchMedia('(display-mode: standalone)').matches ||
        (window.navigator as unknown as { standalone?: boolean }).standalone === true;

      setMetrics({
        inner: `${window.innerWidth} × ${window.innerHeight}`,
        outer: `${window.outerWidth} × ${window.outerHeight}`,
        screen: `${window.screen.width} × ${window.screen.height}`,
        vv: window.visualViewport
          ? `${Math.round(window.visualViewport.width)} × ${Math.round(window.visualViewport.height)} (top:${Math.round(window.visualViewport.offsetTop)})`
          : 'N/A',
        dpr: window.devicePixelRatio || 1,
        standalone: isStandalone,
        safeArea,
        units,
        elements: elMetrics,
      });
    };

    update();
    const interval = setInterval(update, 500);
    window.addEventListener('resize', update, { passive: true });
    window.addEventListener('orientationchange', update, { passive: true });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', update, { passive: true });
      window.visualViewport.addEventListener('scroll', update, { passive: true });
    }

    return () => {
      clearInterval(interval);
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', update);
        window.visualViewport.removeEventListener('scroll', update);
      }
    };
  }, []);

  const applyLiveTest = (testKey: string) => {
    const targets = ['#root', 'main', '#map-container']
      .map((sel) => document.querySelector(sel) as HTMLElement)
      .filter(Boolean);

    targets.forEach((el) => {
      if (testKey === 'reset') {
        el.style.removeProperty('height');
        el.style.removeProperty('bottom');
        el.style.removeProperty('min-height');
      } else if (testKey === 'bottom-offset') {
        // Bridge the exact 59px Dynamic Island delta
        el.style.setProperty('bottom', 'calc(0px - env(safe-area-inset-top, 59px))', 'important');
        el.style.setProperty('height', 'auto', 'important');
      } else if (testKey === '100lvh') {
        el.style.setProperty('height', '100lvh', 'important');
        el.style.removeProperty('bottom');
      } else if (testKey === '100vh') {
        el.style.setProperty('height', '100vh', 'important');
        el.style.removeProperty('bottom');
      } else if (testKey === 'screen-height') {
        el.style.setProperty('height', `${window.screen.height}px`, 'important');
        el.style.removeProperty('bottom');
      }
    });

    setActiveTest(testKey === 'reset' ? null : testKey);
    window.dispatchEvent(new Event('resize'));
  };

  const copyDiagnostic = () => {
    if (!metrics) return;
    const report = {
      timestamp: new Date().toISOString(),
      viewport: {
        inner: metrics.inner,
        outer: metrics.outer,
        screen: metrics.screen,
        visualViewport: metrics.vv,
        dpr: metrics.dpr,
        standalone: metrics.standalone,
        safeArea: metrics.safeArea,
        cssUnits: metrics.units,
      },
      activeTest,
      elements: metrics.elements,
    };
    navigator.clipboard?.writeText(JSON.stringify(report, null, 2));
    alert('Diagnostics copied to clipboard!');
  };

  return (
    <div
      id="viewport-debug-hud"
      style={{
        position: 'fixed',
        left: '8px',
        bottom: 'calc(max(env(safe-area-inset-bottom, 0px), 16px) + 80px)',
        zIndex: 99999,
        fontFamily: 'monospace',
        fontSize: '10px',
        backgroundColor: 'rgba(0, 0, 0, 0.88)',
        color: '#00ff66',
        borderRadius: '8px',
        border: '1px solid rgba(0, 255, 102, 0.4)',
        boxShadow: '0 4px 20px rgba(0,0,0,0.8)',
        maxWidth: '310px',
        pointerEvents: 'auto',
      }}
    >
      <div
        onClick={() => setIsOpen(!isOpen)}
        style={{
          padding: '6px 8px',
          background: 'rgba(0, 255, 102, 0.15)',
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontWeight: 'bold',
          borderBottom: isOpen ? '1px solid rgba(0, 255, 102, 0.3)' : 'none',
        }}
      >
        <span>🛠 VIEWPORT TELEMETRY HUD</span>
        <span style={{ fontSize: '12px' }}>{isOpen ? '▼' : '▲'}</span>
      </div>

      {isOpen && metrics && (
        <div style={{ padding: '8px', lineHeight: '1.4' }}>
          <div style={{ color: '#fff' }}>
            <div><strong>Mode:</strong> {metrics.standalone ? 'PWA Standalone' : 'Browser Safari'} | DPR: {metrics.dpr}</div>
            <div><strong>Screen:</strong> {metrics.screen}</div>
            <div><strong>Inner:</strong> {metrics.inner}</div>
            <div><strong>VisualVP:</strong> {metrics.vv}</div>
            <div><strong>Safe Area:</strong> {metrics.safeArea}</div>
            <div style={{ color: '#00ffff' }}>
              <strong>CSS Units:</strong> vh:{metrics.units.vh}px | dvh:{metrics.units.dvh}px | lvh:{metrics.units.lvh}px | svh:{metrics.units.svh}px
            </div>
          </div>

          <div style={{ marginTop: '6px', paddingTop: '6px', borderTop: '1px dashed #444' }}>
            <div style={{ fontWeight: 'bold', color: '#ffcc00', marginBottom: '4px' }}>
              🧪 Tap To Test Live Fix: {activeTest ? `[${activeTest}]` : '(default)'}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', marginBottom: '4px' }}>
              <button
                onClick={() => applyLiveTest('100lvh')}
                style={{
                  background: activeTest === '100lvh' ? '#ffcc00' : '#222',
                  color: activeTest === '100lvh' ? '#000' : '#fff',
                  border: '1px solid #555',
                  borderRadius: '4px',
                  padding: '4px 2px',
                  cursor: 'pointer',
                  fontSize: '9px',
                  fontWeight: 'bold',
                }}
              >
                1. Apply 100lvh
              </button>
              <button
                onClick={() => applyLiveTest('bottom-offset')}
                style={{
                  background: activeTest === 'bottom-offset' ? '#ffcc00' : '#222',
                  color: activeTest === 'bottom-offset' ? '#000' : '#fff',
                  border: '1px solid #555',
                  borderRadius: '4px',
                  padding: '4px 2px',
                  cursor: 'pointer',
                  fontSize: '9px',
                  fontWeight: 'bold',
                }}
              >
                2. Bottom: -59px
              </button>
              <button
                onClick={() => applyLiveTest('screen-height')}
                style={{
                  background: activeTest === 'screen-height' ? '#ffcc00' : '#222',
                  color: activeTest === 'screen-height' ? '#000' : '#fff',
                  border: '1px solid #555',
                  borderRadius: '4px',
                  padding: '4px 2px',
                  cursor: 'pointer',
                  fontSize: '9px',
                  fontWeight: 'bold',
                }}
              >
                3. Screen (932px)
              </button>
              <button
                onClick={() => applyLiveTest('reset')}
                style={{
                  background: '#441111',
                  color: '#ff8888',
                  border: '1px solid #662222',
                  borderRadius: '4px',
                  padding: '4px 2px',
                  cursor: 'pointer',
                  fontSize: '9px',
                  fontWeight: 'bold',
                }}
              >
                Reset Default
              </button>
            </div>
          </div>

          <div style={{ marginTop: '6px', paddingTop: '6px', borderTop: '1px dashed #444' }}>
            <div style={{ fontWeight: 'bold', color: '#ffcc00', marginBottom: '2px' }}>DOM Element Bounds:</div>
            {metrics.elements.map((el) => {
              const hasMismatch = el.h !== window.innerHeight && el.name !== '.maplibregl-canvas';
              return (
                <div
                  key={el.name}
                  style={{
                    color: hasMismatch ? '#ff5555' : '#00ff66',
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: '4px',
                  }}
                >
                  <span style={{ fontWeight: 'bold' }}>{el.name}:</span>
                  <span>{el.w}×{el.h} (y:{el.top}→{el.bottom})</span>
                </div>
              );
            })}
          </div>

          <div style={{ marginTop: '8px', display: 'flex', gap: '6px' }}>
            <button
              onClick={copyDiagnostic}
              style={{
                flex: 1,
                background: '#00ff66',
                color: '#000',
                border: 'none',
                borderRadius: '4px',
                padding: '4px',
                fontWeight: 'bold',
                cursor: 'pointer',
              }}
            >
              Copy Report
            </button>
            <button
              onClick={() => {
                const mapEl = document.getElementById('map-container');
                if (mapEl) {
                  console.log('Map Container Computed Style:', window.getComputedStyle(mapEl));
                  alert(`MapContainer height: ${mapEl.offsetHeight}px, bounding rect: ${mapEl.getBoundingClientRect().height}px`);
                }
              }}
              style={{
                flex: 1,
                background: '#333',
                color: '#fff',
                border: '1px solid #666',
                borderRadius: '4px',
                padding: '4px',
                cursor: 'pointer',
              }}
            >
              Log Console
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
