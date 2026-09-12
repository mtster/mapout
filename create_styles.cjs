const fs = require('fs');
const dark = require('./dark_style.json');
const liberty = require('./liberty_style.json');

// We want to create two styles based on dark.
// "darkness": purely minimal. Let's see what's in dark.
// Wait, dark has pedestrian lines?
const darkness = JSON.parse(JSON.stringify(dark));
// Remove pedestrian and minor paths from darkness to make it very minimal
darkness.layers = darkness.layers.filter(l => !l.id.includes('pedestrian') && !l.id.includes('path') && !l.id.includes('minor') && !l.id.includes('dashline'));

// Night Life: dark + POIs from liberty
const nightlife = JSON.parse(JSON.stringify(dark));
const poiLayers = liberty.layers.filter(l => l['source-layer'] === 'poi' || l['source-layer'] === 'aerodrome_label' || l['source-layer'] === 'park');

// We might want to adjust text colors for dark mode, since liberty is light.
poiLayers.forEach(l => {
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
