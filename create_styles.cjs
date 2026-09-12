const fs = require('fs');
const dark = require('./dark_style.json');
const liberty = require('./liberty_style.json');

// Darkness: Minimal driving map.
const darkness = JSON.parse(JSON.stringify(dark));
// We want roads, water, buildings. We remove pedestrians, path, dashline.
darkness.layers = darkness.layers.filter(l => {
  if (l.id.includes('pedestrian') || l.id.includes('path') || l.id.includes('dashline')) {
    return false;
  }
  return true;
});

// Night Life: dark + POIs from liberty
const nightlife = JSON.parse(JSON.stringify(dark));
const poiLayers = liberty.layers.filter(l => l['source-layer'] === 'poi' || l['source-layer'] === 'aerodrome_label' || l['source-layer'] === 'park');

poiLayers.forEach(l => {
  if (l.id === 'poi_transit') {
    // Remove text field for transit/bus stops
    if (l.layout) {
      delete l.layout['text-field'];
    }
  }

  if (l.paint) {
    if (l.paint['text-color']) l.paint['text-color'] = '#aaa';
    if (l.paint['text-halo-color']) l.paint['text-halo-color'] = '#000';
    if (l.paint['icon-color']) l.paint['icon-color'] = '#aaa';
    if (l.paint['icon-halo-color']) l.paint['icon-halo-color'] = '#000';
  }
});

nightlife.layers = nightlife.layers.concat(poiLayers);

fs.writeFileSync('public/style-darkness.json', JSON.stringify(darkness));
fs.writeFileSync('public/style-nightlife.json', JSON.stringify(nightlife));
console.log('Styles created');
