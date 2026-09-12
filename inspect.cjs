const liberty = require('./liberty_style.json');
const pois = liberty.layers.filter(l => l['source-layer'] === 'poi' || l['source-layer'] === 'poi_detail' || l['source-layer'] === 'transit');
pois.forEach(p => {
  if (p.id.includes('bus') || p.id.includes('transit')) console.log(p.id, p.layout['text-field']);
});
