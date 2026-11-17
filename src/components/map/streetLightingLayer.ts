import { Map as MapLibreMap, CustomLayerInterface, MercatorCoordinate } from 'maplibre-gl';
import { MapStyle } from '../../types';
import { ROUTE_PASSED_CASING_LAYER_ID } from './routeLayer';

export const STREET_LIGHTS_LAYER_ID = 'ambient-street-lights-webgl';

const ROAD_LAYER_IDS = [
  'highway_major_inner',
  'highway_motorway_inner',
  'highway_minor',
  'highway_major_subtle',
];

const BEFORE_LAYER_CANDIDATES = [
  'highway_name_other',
  'highway_name_motorway',
  'place_other',
  ROUTE_PASSED_CASING_LAYER_ID,
];

// Single permanent geographic grid (~100m blocks) so lights stay bolted to fixed real-world spots across all zooms
const CELL_DEG = 0.00105;
const MAX_ACTIVE_LIGHTS = 72;
const MAX_STORED_CELLS = 200;
const MOVE_SCAN_THROTTLE_MS = 850;
const MIN_SCAN_MOVE_DEG = 0.00032; // ~35 meters
const MIN_SCAN_ZOOM_DELTA = 0.22;
const FADE_IN_MS = 260;

// Warm, restrained sodium/incandescent light tints (RGB 0..1)
const LIGHT_PALETTE: [number, number, number][] = [
  [1.0, 0.78, 0.44], // Soft sodium amber
  [1.0, 0.85, 0.56], // Warm tungsten streetlamp
  [1.0, 0.90, 0.68], // Soft warm incandescent
  [0.98, 0.74, 0.40], // Deep golden amber
];

interface LightEntry {
  key: string;
  lng: number;
  lat: number;
  mcX: number; // Cached Float64 Mercator X
  mcY: number; // Cached Float64 Mercator Y
  mercRadiusBase: number; // Cached Float64 baseRadiusMeters * meterInMercatorCoordinateUnits
  color: [number, number, number];
  boost: number;
  minZoom: number;
  staticPriority: number; // Strictly deterministic (never depends on camera position)
  createdAt: number;
}

function hashGrid(gx: number, gy: number): number {
  let h = (Math.imul(gx, 374761393) + Math.imul(gy, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function isMapStyleReady(map: MapLibreMap): boolean {
  if (!map) return false;
  const style = (map as any).style;
  return Boolean(style && style._loaded);
}

function compileShader(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  type: number,
  source: string
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn('Ambient light shader compile error:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

const VERTEX_SHADER_SRC = `
  uniform mat4 u_matrix;
  attribute vec2 a_pos;
  attribute vec2 a_uv;
  attribute vec4 a_color_alpha;
  varying vec2 v_uv;
  varying vec4 v_color_alpha;

  void main() {
    gl_Position = u_matrix * vec4(a_pos, 0.0, 1.0);
    v_uv = a_uv;
    v_color_alpha = a_color_alpha;
  }
`;

const FRAGMENT_SHADER_SRC = `
  precision mediump float;
  uniform float u_pass;
  varying vec2 v_uv;
  varying vec4 v_color_alpha;

  void main() {
    float r = length(v_uv);
    if (r > 1.0) discard;

    // Smooth C2 radial falloff: 1.0 at lamp center, smoothly reaching 0.0 at edge
    float t = 1.0 - r * r;
    float pool = t * t;
    float alpha = v_color_alpha.a;

    if (u_pass < 0.5) {
      // Pass 1 (Multiplicative albedo illumination via gl.blendFunc(GL_DST_COLOR, GL_ONE)):
      // Brightens underlying dark grey roads & casings inside the circle: Out = Dst * (1 + Src)
      vec3 boost = v_color_alpha.rgb * pool * alpha * 1.55;
      gl_FragColor = vec4(boost, 0.0);
    } else {
      // Pass 2 (Additive soft ground scatter + restrained small bulb filament):
      vec3 groundWash = v_color_alpha.rgb * pool * 0.055;
      float filament = exp(-r * r * 920.0) * 0.50;
      float innerGlow = exp(-r * r * 140.0) * 0.13;
      vec3 bulb = vec3(1.0, 0.94, 0.80) * (filament + innerGlow);
      gl_FragColor = vec4((groundWash + bulb) * alpha, 0.0);
    }
  }
`;

class ViewportStreetLightingLayer implements CustomLayerInterface {
  id = STREET_LIGHTS_LAYER_ID;
  type: 'custom' = 'custom';
  renderingMode: '2d' = '2d';

  private map: MapLibreMap | null = null;
  private program: WebGLProgram | null = null;
  private vertexBuffer: WebGLBuffer | null = null;
  private aPosLoc = -1;
  private aUvLoc = -1;
  private aColorAlphaLoc = -1;
  private uMatrixLoc: WebGLUniformLocation | null = null;
  private uPassLoc: WebGLUniformLocation | null = null;

  private lights = new Map<string, LightEntry>();
  private lastScanMs = 0;
  private lastScanLng = 0;
  private lastScanLat = 0;
  private lastScanZoom = -1;
  private vertexData = new Float32Array(MAX_ACTIVE_LIGHTS * 6 * 8); // 6 verts/quad * 8 floats/vert
  private relMatrix = new Float32Array(16);
  private isDestroyed = false;

  private boundThrottledScan = () => this.scanViewportRoads(false);
  private boundMoveEndScan = () => this.scanViewportRoads(false, true);
  private boundSourceDataScan = (e: { sourceId?: string; isSourceLoaded?: boolean }) => {
    if (e.sourceId === 'openmaptiles' && e.isSourceLoaded) {
      this.scanViewportRoads(true);
    }
  };

  onAdd(map: MapLibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.map = map;
    this.isDestroyed = false;

    const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SRC);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SRC);
    if (!vs || !fs) return;

    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn('Ambient light program link error:', gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      return;
    }

    gl.deleteShader(vs);
    gl.deleteShader(fs);

    this.program = program;
    this.aPosLoc = gl.getAttribLocation(program, 'a_pos');
    this.aUvLoc = gl.getAttribLocation(program, 'a_uv');
    this.aColorAlphaLoc = gl.getAttribLocation(program, 'a_color_alpha');
    this.uMatrixLoc = gl.getUniformLocation(program, 'u_matrix');
    this.uPassLoc = gl.getUniformLocation(program, 'u_pass');

    this.vertexBuffer = gl.createBuffer();

    map.on('move', this.boundThrottledScan);
    map.on('moveend', this.boundMoveEndScan);
    map.on('zoomend', this.boundMoveEndScan);
    map.on('sourcedata', this.boundSourceDataScan);

    this.scanViewportRoads(true);
  }

  onRemove(map: MapLibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.isDestroyed = true;
    map.off('move', this.boundThrottledScan);
    map.off('moveend', this.boundMoveEndScan);
    map.off('zoomend', this.boundMoveEndScan);
    map.off('sourcedata', this.boundSourceDataScan);

    if (this.vertexBuffer) {
      gl.deleteBuffer(this.vertexBuffer);
      this.vertexBuffer = null;
    }
    if (this.program) {
      gl.deleteProgram(this.program);
      this.program = null;
    }
    this.lights.clear();
    this.map = null;
  }

  private scanViewportRoads(force: boolean, isEndEvent = false) {
    if (this.isDestroyed || !this.map) return;
    const now = performance.now();

    if (!force) {
      if (!isEndEvent && now - this.lastScanMs < MOVE_SCAN_THROTTLE_MS) {
        return;
      }

      // Skip redundant queryRenderedFeatures if camera barely moved/zoomed (saves CPU & battery during navigation)
      if (this.lights.size > 0 && this.lastScanZoom >= 0) {
        const center = this.map.getCenter();
        const zoom = this.map.getZoom();
        const dLng = Math.abs(center.lng - this.lastScanLng);
        const dLat = Math.abs(center.lat - this.lastScanLat);
        const dZoom = Math.abs(zoom - this.lastScanZoom);
        const minMove = isEndEvent ? MIN_SCAN_MOVE_DEG * 0.5 : MIN_SCAN_MOVE_DEG;
        const minZoom = isEndEvent ? MIN_SCAN_ZOOM_DELTA * 0.6 : MIN_SCAN_ZOOM_DELTA;
        if (dLng < minMove && dLat < minMove && dZoom < minZoom) {
          return;
        }
      }
    }

    this.lastScanMs = now;
    this.populateFixedViewportLights(now);
  }

  private populateFixedViewportLights(now: number) {
    const map = this.map;
    if (!map || !isMapStyleReady(map)) return;

    const center = map.getCenter();
    const zoom = map.getZoom();
    this.lastScanLng = center.lng;
    this.lastScanLat = center.lat;
    this.lastScanZoom = zoom;

    const bounds = map.getBounds();
    const padLng = Math.max(0.003, (bounds.getEast() - bounds.getWest()) * 0.45);
    const padLat = Math.max(0.003, (bounds.getNorth() - bounds.getSouth()) * 0.45);
    const minLng = bounds.getWest() - padLng;
    const maxLng = bounds.getEast() + padLng;
    const minLat = bounds.getSouth() - padLat;
    const maxLat = bounds.getNorth() + padLat;

    // Evict ONLY lights that have scrolled completely outside the padded viewport
    for (const [key, entry] of this.lights.entries()) {
      if (entry.lng < minLng || entry.lng > maxLng || entry.lat < minLat || entry.lat > maxLat) {
        this.lights.delete(key);
      }
    }

    if (zoom < 11.2) return;

    const activeRoadLayers = ROAD_LAYER_IDS.filter((id) => Boolean(map.getLayer(id)));
    if (activeRoadLayers.length === 0) return;

    let features: GeoJSON.Feature[] = [];
    try {
      features = map.queryRenderedFeatures(undefined, {
        layers: activeRoadLayers,
      }) as unknown as GeoJSON.Feature[];
    } catch {
      return;
    }

    const cosLat = Math.max(0.25, Math.cos((center.lat * Math.PI) / 180));
    let didAdd = false;

    for (let fIdx = 0; fIdx < features.length; fIdx++) {
      const feat = features[fIdx];
      const geom = feat.geometry;
      if (!geom) continue;

      const isMajor =
        (feat as any).layer?.id === 'highway_major_inner' ||
        (feat as any).layer?.id === 'highway_motorway_inner';

      const lines: number[][][] =
        geom.type === 'LineString'
          ? [geom.coordinates]
          : geom.type === 'MultiLineString'
          ? geom.coordinates
          : [];

      for (let lIdx = 0; lIdx < lines.length; lIdx++) {
        const coords = lines[lIdx];
        if (!coords || coords.length < 2) continue;

        for (let i = 0; i < coords.length - 1; i++) {
          const p0 = coords[i];
          const p1 = coords[i + 1];

          const midLng = (p0[0] + p1[0]) * 0.5;
          const midLat = (p0[1] + p1[1]) * 0.5;

          const gx = Math.floor(midLng / CELL_DEG);
          const gy = Math.floor(midLat / CELL_DEG);
          const key = `${gx}:${gy}`;

          // Once a cell is populated, it stays permanently fixed in place while in padded bounds
          if (this.lights.has(key)) continue;

          const h0 = hashGrid(gx, gy);
          // Organic density: ~58% of road cells host a street light
          if (h0 < 0.42) continue;

          // Subtle roadside/curb perpendicular offset (5.5m - 10.5m from centerline)
          const dx = (p1[0] - p0[0]) * cosLat;
          const dy = p1[1] - p0[1];
          const segLen = Math.hypot(dx, dy);

          let lightLng = midLng;
          let lightLat = midLat;
          if (segLen > 1e-7) {
            const hSide = hashGrid(gx + 17, gy - 31);
            const side = hSide >= 0.5 ? 1 : -1;
            const curbMeters = 5.5 + hashGrid(gx - 9, gy + 23) * 5.0;
            const degPerMeter = 1 / 111320;
            const nx = (-dy / segLen) * side;
            const ny = (dx / segLen) * side;
            lightLng += (nx * curbMeters * degPerMeter) / cosLat;
            lightLat += ny * curbMeters * degPerMeter;
          }

          const hColor = hashGrid(gx + 53, gy + 11);
          const hRadius = hashGrid(gx - 41, gy + 79);
          const hBoost = hashGrid(gx + 7, gy - 67);

          const color = LIGHT_PALETTE[Math.floor(hColor * LIGHT_PALETTE.length) % LIGHT_PALETTE.length];
          const baseRadiusMeters = 44 + hRadius * 24;
          const boost = 0.85 + hBoost * 0.35;

          // Pre-compute Float64 Mercator coordinates & base radius once on creation
          const mc = MercatorCoordinate.fromLngLat([lightLng, lightLat]);
          const mercRadiusBase = baseRadiusMeters * mc.meterInMercatorCoordinateUnits();

          // Smooth zoom tiering based purely on static deterministic hash (no sudden pop on zoom!)
          const minZoom = h0 >= 0.84 ? 11.4 : h0 >= 0.65 ? 13.3 : 14.8;
          const staticPriority = (isMajor ? 2.0 : 0.0) + h0;

          this.lights.set(key, {
            key,
            lng: lightLng,
            lat: lightLat,
            mcX: mc.x,
            mcY: mc.y,
            mercRadiusBase,
            color,
            boost,
            minZoom,
            staticPriority,
            createdAt: now,
          });
          didAdd = true;
        }
      }
    }

    // Hard memory cap if zooming far out over dense city grids
    if (this.lights.size > MAX_STORED_CELLS) {
      const sorted = Array.from(this.lights.values()).sort(
        (a, b) => b.staticPriority - a.staticPriority
      );
      this.lights.clear();
      for (let i = 0; i < MAX_STORED_CELLS; i++) {
        this.lights.set(sorted[i].key, sorted[i]);
      }
    }

    if (didAdd) {
      map.triggerRepaint();
    }
  }

  render(gl: WebGLRenderingContext | WebGL2RenderingContext, matrix: Float32Array | number[]) {
    if (!this.program || !this.vertexBuffer || !this.map || this.lights.size === 0) {
      return;
    }

    const zoom = this.map.getZoom();
    if (zoom < 11.2) return;

    const now = performance.now();
    const bounds = this.map.getBounds();
    const viewPadLng = Math.max(0.001, (bounds.getEast() - bounds.getWest()) * 0.15);
    const viewPadLat = Math.max(0.001, (bounds.getNorth() - bounds.getSouth()) * 0.15);
    const vMinLng = bounds.getWest() - viewPadLng;
    const vMaxLng = bounds.getEast() + viewPadLng;
    const vMinLat = bounds.getSouth() - viewPadLat;
    const vMaxLat = bounds.getNorth() + viewPadLat;

    // Gentle radius compensation when zoomed out (z13..z16) so lit road pockets stay visible
    const zoomRadiusScale = Math.pow(2, Math.max(0, 16 - zoom) * 0.52);

    const visibleEntries: { entry: LightEntry; alpha: number }[] = [];
    let needsFadeAnimation = false;

    for (const entry of this.lights.values()) {
      if (
        entry.lng < vMinLng ||
        entry.lng > vMaxLng ||
        entry.lat < vMinLat ||
        entry.lat > vMaxLat
      ) {
        continue;
      }

      // Continuous zoom visibility: secondary lights fade in smoothly as user zooms in
      const zoomVis = Math.min(1.0, Math.max(0.0, (zoom - entry.minZoom) / 0.85));
      if (zoomVis <= 0.005) continue;

      const fadeIn = Math.min(1.0, Math.max(0.0, (now - entry.createdAt) / FADE_IN_MS));
      if (fadeIn < 1.0) {
        needsFadeAnimation = true;
      }

      visibleEntries.push({
        entry,
        alpha: fadeIn * zoomVis * entry.boost,
      });
    }

    if (visibleEntries.length === 0) return;

    // Enforce GPU budget cap using static priority so panning never swaps nearby visible lights
    if (visibleEntries.length > MAX_ACTIVE_LIGHTS) {
      visibleEntries.sort((a, b) => b.entry.staticPriority - a.entry.staticPriority);
      visibleEntries.length = MAX_ACTIVE_LIGHTS;
    }

    // CAMERA-RELATIVE FLOAT64 TRANSFORM:
    // Eliminates WebGL float32 catastrophic cancellation (multi-meter snapping / shaking during drag & navigation).
    // All vertices are uploaded relative to the camera center in float64 precision, and column 3 of the MVP matrix
    // is translated on the CPU in 64-bit precision before uploading to the shader.
    const centerMc = MercatorCoordinate.fromLngLat(this.map.getCenter());
    const refX = centerMc.x;
    const refY = centerMc.y;

    const rm = this.relMatrix;
    for (let i = 0; i < 12; i++) {
      rm[i] = matrix[i];
    }
    rm[12] = matrix[0] * refX + matrix[4] * refY + matrix[12];
    rm[13] = matrix[1] * refX + matrix[5] * refY + matrix[13];
    rm[14] = matrix[2] * refX + matrix[6] * refY + matrix[14];
    rm[15] = matrix[3] * refX + matrix[7] * refY + matrix[15];

    let floatOffset = 0;
    let quadCount = 0;
    const d = this.vertexData;

    for (let i = 0; i < visibleEntries.length; i++) {
      const { entry, alpha } = visibleEntries[i];
      const relX = entry.mcX - refX;
      const relY = entry.mcY - refY;
      const mercRadius = entry.mercRadiusBase * zoomRadiusScale;

      const x0 = relX - mercRadius;
      const x1 = relX + mercRadius;
      const y0 = relY - mercRadius;
      const y1 = relY + mercRadius;

      const [r, g, b] = entry.color;

      // Triangle 1: (x0,y0), (x1,y0), (x0,y1)
      d[floatOffset++] = x0; d[floatOffset++] = y0; d[floatOffset++] = -1; d[floatOffset++] = -1;
      d[floatOffset++] = r;  d[floatOffset++] = g;  d[floatOffset++] = b;  d[floatOffset++] = alpha;

      d[floatOffset++] = x1; d[floatOffset++] = y0; d[floatOffset++] = 1;  d[floatOffset++] = -1;
      d[floatOffset++] = r;  d[floatOffset++] = g;  d[floatOffset++] = b;  d[floatOffset++] = alpha;

      d[floatOffset++] = x0; d[floatOffset++] = y1; d[floatOffset++] = -1; d[floatOffset++] = 1;
      d[floatOffset++] = r;  d[floatOffset++] = g;  d[floatOffset++] = b;  d[floatOffset++] = alpha;

      // Triangle 2: (x0,y1), (x1,y0), (x1,y1)
      d[floatOffset++] = x0; d[floatOffset++] = y1; d[floatOffset++] = -1; d[floatOffset++] = 1;
      d[floatOffset++] = r;  d[floatOffset++] = g;  d[floatOffset++] = b;  d[floatOffset++] = alpha;

      d[floatOffset++] = x1; d[floatOffset++] = y0; d[floatOffset++] = 1;  d[floatOffset++] = -1;
      d[floatOffset++] = r;  d[floatOffset++] = g;  d[floatOffset++] = b;  d[floatOffset++] = alpha;

      d[floatOffset++] = x1; d[floatOffset++] = y1; d[floatOffset++] = 1;  d[floatOffset++] = 1;
      d[floatOffset++] = r;  d[floatOffset++] = g;  d[floatOffset++] = b;  d[floatOffset++] = alpha;

      quadCount++;
    }

    if (quadCount === 0) return;

    const stride = 8 * 4;
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.uMatrixLoc, false, rm);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.vertexData.subarray(0, floatOffset), gl.DYNAMIC_DRAW);

    gl.enableVertexAttribArray(this.aPosLoc);
    gl.vertexAttribPointer(this.aPosLoc, 2, gl.FLOAT, false, stride, 0);

    gl.enableVertexAttribArray(this.aUvLoc);
    gl.vertexAttribPointer(this.aUvLoc, 2, gl.FLOAT, false, stride, 2 * 4);

    gl.enableVertexAttribArray(this.aColorAlphaLoc);
    gl.vertexAttribPointer(this.aColorAlphaLoc, 4, gl.FLOAT, false, stride, 4 * 4);

    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.disable(gl.DEPTH_TEST);

    // Pass 1: Multiplicative surface illumination — Dst * (1 + Light)
    gl.blendFunc(gl.DST_COLOR, gl.ONE);
    gl.uniform1f(this.uPassLoc, 0.0);
    gl.drawArrays(gl.TRIANGLES, 0, quadCount * 6);

    // Pass 2: Subtle warm asphalt scatter + tiny pinpoint streetlamp bulb
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.uniform1f(this.uPassLoc, 1.0);
    gl.drawArrays(gl.TRIANGLES, 0, quadCount * 6);

    gl.disableVertexAttribArray(this.aPosLoc);
    gl.disableVertexAttribArray(this.aUvLoc);
    gl.disableVertexAttribArray(this.aColorAlphaLoc);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    if (needsFadeAnimation) {
      this.map.triggerRepaint();
    }
  }
}

let activeLayerInstance: ViewportStreetLightingLayer | null = null;

/**
 * Mounts or removes the viewport-culled WebGL street lighting illumination layer on dark map themes.
 * Lights are fixed to deterministic roadside positions in the visible viewport and softly illuminate
 * surrounding streets, intersections, and building edges in circular pools without flickering.
 */
export function updateStreetLighting(map: MapLibreMap, mapStyle: MapStyle) {
  if (!isMapStyleReady(map)) return;

  try {
    const isDarkTheme = mapStyle === 'dark' || mapStyle === 'midnight';
    const existingLayer = map.getLayer(STREET_LIGHTS_LAYER_ID);

    if (isDarkTheme) {
      if (!existingLayer) {
        activeLayerInstance = new ViewportStreetLightingLayer();

        // Insert right below street labels & the active navigation route so route lines and text stay crisp on top
        const beforeLayerId = BEFORE_LAYER_CANDIDATES.find((id) => Boolean(map.getLayer(id)));
        map.addLayer(activeLayerInstance, beforeLayerId);
      }
    } else {
      if (existingLayer) {
        map.removeLayer(STREET_LIGHTS_LAYER_ID);
      }
      activeLayerInstance = null;
    }
  } catch (err) {
    console.warn('Could not update street lighting layer:', err);
  }
}
