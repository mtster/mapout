import { MapStyle } from '../../types';

// 100% Free, Vector, Hardware-Accelerated Basemap Styles from OpenFreeMap
// Zero API Keys, Zero Watermarks, Native 60 FPS WebGL Vector Rendering
export const MAP_STYLES: Record<MapStyle, string | object> = {
  // Darkness: Minimal dark map (removed POIs, pedestrians)
  dark: '/style-darkness.json',

  // Night Life: Dark map with full features (shops, bus stops, etc)
  midnight: '/style-nightlife.json',

  // Photorealistic Satellite: Esri High-Resolution World Imagery
  satellite: {
    version: 8,
    sources: {
      'esri-satellite': {
        type: 'raster',
        tiles: [
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        ],
        tileSize: 256,
        maxzoom: 19,
        attribution: '© Esri, Maxar, Earthstar Geographics',
      },
    },
    layers: [
      {
        id: 'esri-satellite-layer',
        type: 'raster',
        source: 'esri-satellite',
        minzoom: 0,
        maxzoom: 19,
      },
    ],
  },
};
