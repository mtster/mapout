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

const MAX_ACTIVE_LIGHTS = 75;
const MAX_STORED_CELLS = 180;
const REFRESH_THROTTLE_MS = 280;
const FADE_IN_MS = 450;
const FADE_OUT_MS = 380;

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
  baseRadiusMeters: number;
  color: [number, number, number];
  boost: number;
  priority: number; // Higher for major roads & proximity to viewport center
  createdAt: number;
  lastSeenAt: number;
  exitingAt: number | null;
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
      // Output color is multiplied against underlying road/building pixels: Out = Dst * (1 + Src)
      vec3 boost = v_color_alpha.rgb * pool * alpha * 1.55;
      gl_FragColor = vec4(boost, 0.0);
    } else {
      // Pass 2 (Additive soft ground scatter + restrained small bulb filament):
      // Subtle atmospheric ground wash ensures even pure-black roadways catch light,
      // while a small crisp filament anchors the pool without forming giant glowing blobs.
      vec3 groundWash = v_color_alpha.rgb * pool * 0.055;
      float filament = exp(-r * r * 920.0) * 0.52;
      float innerGlow = exp(-r * r * 140.0) * 0.14;
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
  private lastRefreshMs = 0;
  private vertexData = new Float32Array(MAX_ACTIVE_LIGHTS * 6 * 8); // 6 verts/quad * 8 floats/vert
  private isDestroyed = false;

  private boundScheduleRefresh = () => this.scheduleRefresh(false);
  private boundImmediateRefresh = () => this.scheduleRefresh(true);
  private boundSourceDataRefresh = (e: { sourceId?: string; isSourceLoaded?: boolean }) => {
    if (e.sourceId === 'openmaptiles' && e.isSourceLoaded) {
      this.scheduleRefresh(false);
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

    map.on('move', this.boundScheduleRefresh);
    map.on('moveend', this.boundImmediateRefresh);
    map.on('zoomend', this.boundImmediateRefresh);
    map.on('sourcedata', this.boundSourceDataRefresh);
    map.on('idle', this.boundScheduleRefresh);

    // Initial scan once current viewport tiles settle
    this.scheduleRefresh(true);
  }

  onRemove(map: MapLibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.isDestroyed = true;
    map.off('move', this.boundScheduleRefresh);
    map.off('moveend', this.boundImmediateRefresh);
    map.off('zoomend', this.boundImmediateRefresh);
    map.off('sourcedata', this.boundSourceDataRefresh);
    map.off('idle', this.boundScheduleRefresh);

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

  private scheduleRefresh(force: boolean) {
    if (this.isDestroyed || !this.map) return;
    const now = performance.now();
    if (!force && now - this.lastRefreshMs < REFRESH_THROTTLE_MS) {
      return;
    }
    this.lastRefreshMs = now;
    this.refreshViewportLights(now);
  }

  private refreshViewportLights(now: number) {
    const map = this.map;
    if (!map || !isMapStyleReady(map)) return;

    const zoom = map.getZoom();
    let didChange = false;

    if (zoom < 11.2) {
      // Fade out existing lights cleanly on macro zooms
      for (const entry of this.lights.values()) {
        if (entry.exitingAt === null) {
          entry.exitingAt = now;
          didChange = true;
        }
      }
      if (didChange) map.triggerRepaint();
      return;
    }

    const activeRoadLayers = ROAD_LAYER_IDS.filter((id) => Boolean(map.getLayer(id)));
    if (activeRoadLayers.length === 0) return;

    const bounds = map.getBounds();
    const center = map.getCenter();
    const cosLat = Math.max(0.25, Math.cos((center.lat * Math.PI) / 180));

    // Adaptive spatial grid cell size so light density remains crisp across urban zooms
    const cellDeg = zoom >= 16 ? 0.0009 : zoom >= 14 ? 0.0018 : 0.004;
    const cellTier = zoom >= 16 ? 'hi' : zoom >= 14 ? 'md' : 'lo';

    let features: GeoJSON.Feature[] = [];
    try {
      features = map.queryRenderedFeatures(undefined, {
        layers: activeRoadLayers,
      }) as unknown as GeoJSON.Feature[];
    } catch {
      return;
    }

    const seenInPass = new Set<string>();

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

          // Evaluate midpoint of each visible road segment
          const midLng = (p0[0] + p1[0]) * 0.5;
          const midLat = (p0[1] + p1[1]) * 0.5;

          const gx = Math.floor(midLng / cellDeg);
          const gy = Math.floor(midLat / cellDeg);
          const key = `${cellTier}:${gx}:${gy}`;

          if (seenInPass.has(key)) continue;

          const h0 = hashGrid(gx, gy);
          // Organic density: ~58% of road cells get a light, leaving natural darker blocks between pockets
          if (h0 < 0.42) continue;

          seenInPass.add(key);

          const existing = this.lights.get(key);
          if (existing) {
            existing.lastSeenAt = now;
            if (existing.exitingAt !== null) {
              existing.exitingAt = null;
              didChange = true;
            }
            continue;
          }

          // Compute subtle curb/roadside perpendicular offset (5.5m - 10.5m from road centerline)
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
          const baseRadiusMeters = 44 + hRadius * 24; // 44m - 68m illumination pool radius
          const boost = 0.85 + hBoost * 0.35;

          const distFromCenter = Math.hypot((lightLng - center.lng) * cosLat, lightLat - center.lat);
          const priority = (isMajor ? 2.0 : 1.0) - distFromCenter * 15;

          this.lights.set(key, {
            key,
            lng: lightLng,
            lat: lightLat,
            baseRadiusMeters,
            color,
            boost,
            priority,
            createdAt: now,
            lastSeenAt: now,
            exitingAt: null,
          });
          didChange = true;
        }
      }
    }

    // Smoothly fade out lights from different zoom tiers or outside padded bounds
    const padLng = Math.max(0.002, (bounds.getEast() - bounds.getWest()) * 0.35);
    const padLat = Math.max(0.002, (bounds.getNorth() - bounds.getSouth()) * 0.35);
    const minLng = bounds.getWest() - padLng;
    const maxLng = bounds.getEast() + padLng;
    const minLat = bounds.getSouth() - padLat;
    const maxLat = bounds.getNorth() + padLat;

    for (const [key, entry] of this.lights.entries()) {
      const wrongTier = !key.startsWith(`${cellTier}:`);
      const outOfBounds =
        entry.lng < minLng || entry.lng > maxLng || entry.lat < minLat || entry.lat > maxLat;
      const stale = !seenInPass.has(key) && now - entry.lastSeenAt > 1200;

      if (wrongTier || outOfBounds || stale) {
        if (entry.exitingAt === null) {
          entry.exitingAt = now;
          didChange = true;
        } else if (now - entry.exitingAt >= FADE_OUT_MS) {
          this.lights.delete(key);
          didChange = true;
        }
      }
    }

    // Hard memory cap if panning rapidly
    if (this.lights.size > MAX_STORED_CELLS) {
      const sorted = Array.from(this.lights.values()).sort((a, b) => a.lastSeenAt - b.lastSeenAt);
      const excess = this.lights.size - MAX_STORED_CELLS;
      for (let i = 0; i < excess; i++) {
        this.lights.delete(sorted[i].key);
      }
      didChange = true;
    }

    if (didChange) {
      map.triggerRepaint();
    }
  }

  render(gl: WebGLRenderingContext | WebGL2RenderingContext, matrix: Float32Array | number[]) {
    if (!this.program || !this.vertexBuffer || !this.map || this.lights.size === 0) {
      return;
    }

    const now = performance.now();
    const zoom = this.map.getZoom();
    if (zoom < 11.2) return;

    // Smooth macro zoom fade-in between z11.2 and z13.0
    const zoomAlpha = Math.min(1.0, Math.max(0.0, (zoom - 11.2) / 1.8));
    // Gentle radius compensation when zoomed out (z13..z16) so road pools remain useful at overview zoom
    const zoomRadiusScale = Math.pow(2, Math.max(0, 16 - zoom) * 0.52);

    const activeEntries: LightEntry[] = [];
    let needsFadeAnimation = false;

    for (const [key, entry] of this.lights.entries()) {
      if (entry.exitingAt !== null && now - entry.exitingAt >= FADE_OUT_MS) {
        this.lights.delete(key);
        continue;
      }
      if (now - entry.createdAt < FADE_IN_MS || entry.exitingAt !== null) {
        needsFadeAnimation = true;
      }
      activeEntries.push(entry);
    }

    if (activeEntries.length === 0) return;

    // Enforce GPU budget cap prioritizing lights near center & along major roads
    if (activeEntries.length > MAX_ACTIVE_LIGHTS) {
      activeEntries.sort((a, b) => b.priority - a.priority);
      activeEntries.length = MAX_ACTIVE_LIGHTS;
    }

    let floatOffset = 0;
    let quadCount = 0;

    for (let i = 0; i < activeEntries.length; i++) {
      const entry = activeEntries[i];
      const fadeIn = Math.min(1.0, Math.max(0.0, (now - entry.createdAt) / FADE_IN_MS));
      const fadeOut =
        entry.exitingAt !== null
          ? Math.max(0.0, 1.0 - (now - entry.exitingAt) / FADE_OUT_MS)
          : 1.0;

      const alpha = fadeIn * fadeOut * zoomAlpha * entry.boost;
      if (alpha <= 0.005) continue;

      const mc = MercatorCoordinate.fromLngLat([entry.lng, entry.lat]);
      const mercRadius = entry.baseRadiusMeters * zoomRadiusScale * mc.meterInMercatorCoordinateUnits();
      const x0 = mc.x - mercRadius;
      const x1 = mc.x + mercRadius;
      const y0 = mc.y - mercRadius;
      const y1 = mc.y + mercRadius;

      const [r, g, b] = entry.color;
      const d = this.vertexData;

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
    gl.uniformMatrix4fv(this.uMatrixLoc, false, matrix);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      this.vertexData.subarray(0, floatOffset),
      gl.DYNAMIC_DRAW
    );

    gl.enableVertexAttribArray(this.aPosLoc);
    gl.vertexAttribPointer(this.aPosLoc, 2, gl.FLOAT, false, stride, 0);

    gl.enableVertexAttribArray(this.aUvLoc);
    gl.vertexAttribPointer(this.aUvLoc, 2, gl.FLOAT, false, stride, 2 * 4);

    gl.enableVertexAttribArray(this.aColorAlphaLoc);
    gl.vertexAttribPointer(this.aColorAlphaLoc, 4, gl.FLOAT, false, stride, 4 * 4);

    gl.enable(gl.BLEND);
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
 * Lights are placed organically across roads currently visible on screen, softly illuminating
 * streets, intersections, and building edges inside circular pools without obstructing the route.
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
