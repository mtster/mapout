import { LatLng, PlaceResult } from '../types';
import { calculateHaversineDistance } from './turfMathService';

// Debounce helper
export function debounce<T extends (...args: any[]) => any>(fn: T, ms = 300) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>): Promise<ReturnType<T>> => {
    if (timer) clearTimeout(timer);
    return new Promise((resolve) => {
      timer = setTimeout(() => {
        resolve(fn(...args));
      }, ms);
    });
  };
}

/**
 * Distance decay factor calculation:
 * Returns a multiplier between 1.0 (local) down to ~0.001 (intercontinental).
 * Uses a smooth power-law decay function: F(d) = 1 / (1 + (d / d0)^gamma)
 * with characteristic half-distance d0 = 20 km and gamma = 1.35
 */
function calculateDistanceDecay(distKm: number, d0 = 20, gamma = 1.35): number {
  if (distKm <= 0.1) return 1.0;
  return 1 / (1 + Math.pow(distKm / d0, gamma));
}

/**
 * Text relevance scoring between query and place fields
 */
function calculateTextRelevance(query: string, name: string, label: string, category?: string): number {
  const q = query.toLowerCase().trim();
  const n = name.toLowerCase().trim();
  const l = label.toLowerCase().trim();
  const c = (category || '').toLowerCase().trim();

  // Exact name match
  if (n === q) return 100;

  // Name starts with exact query
  if (n.startsWith(q)) return 85;

  // Name has word starting with query
  const words = n.split(/\s+/);
  if (words.some((w) => w.startsWith(q))) return 75;

  // Name contains query
  if (n.includes(q)) return 60;

  // Label starts with or contains query
  if (l.startsWith(q)) return 50;
  if (l.includes(q)) return 40;

  // Category match
  if (c.includes(q)) return 35;

  // Partial word overlap
  const qWords = q.split(/\s+/).filter(Boolean);
  const matchedWords = qWords.filter((qw) => n.includes(qw) || l.includes(qw));
  if (matchedWords.length > 0) {
    return 20 + (matchedWords.length / qWords.length) * 25;
  }

  return 15;
}

// Search places with distance-decay proximity prioritization and fallbacks
export async function searchPlaces(query: string, userCoords?: LatLng): Promise<PlaceResult[]> {
  const trimmed = query.trim();
  if (!trimmed || trimmed.length < 2) return [];

  const rawCandidates: PlaceResult[] = [];

  // 1. Query Photon API (biased to user coordinates if available)
  try {
    let url = `https://photon.komoot.io/api/?q=${encodeURIComponent(trimmed)}&limit=15`;
    if (userCoords) {
      url += `&lat=${userCoords[0]}&lon=${userCoords[1]}`;
    }

    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
    });

    if (res.ok) {
      const data = await res.json();
      if (data && Array.isArray(data.features) && data.features.length > 0) {
        data.features.forEach((feat: any, index: number) => {
          const props = feat.properties || {};
          const coords = feat.geometry?.coordinates || [0, 0];

          const housenumber = props.housenumber ? String(props.housenumber).trim() : '';
          const street = props.street ? String(props.street).trim() : '';
          const rawName = props.name ? String(props.name).trim() : '';

          let name = '';
          let label = '';

          if (housenumber && street) {
            const queryStartsWithNumber = /^\d+/.test(trimmed);
            const streetWithNumber = queryStartsWithNumber
              ? `${housenumber}, ${street}`
              : `${street} ${housenumber}`;

            if (rawName && rawName.toLowerCase() !== street.toLowerCase()) {
              name = rawName;
              label = [streetWithNumber, props.district || props.suburb, props.city, props.country]
                .filter(Boolean)
                .join(', ');
            } else {
              name = streetWithNumber;
              label = [props.district || props.suburb, props.city, props.state, props.country]
                .filter(Boolean)
                .join(', ');
            }
          } else if (rawName) {
            name = housenumber && !rawName.includes(housenumber) ? `${rawName} ${housenumber}` : rawName;
            label = [street, props.district || props.suburb, props.city, props.country]
              .filter(Boolean)
              .join(', ');
          } else if (street) {
            name = housenumber ? `${street} ${housenumber}` : street;
            label = [props.district || props.suburb, props.city, props.state, props.country]
              .filter(Boolean)
              .join(', ');
          } else {
            name = housenumber ? `${props.city || trimmed} ${housenumber}` : (props.city || trimmed);
            label = [props.state, props.country].filter(Boolean).join(', ');
          }

          rawCandidates.push({
            id: `photon-${props.osm_id || index}-${coords[0]}`,
            name,
            label: label || name,
            lat: coords[1],
            lng: coords[0],
            category: props.osm_value || props.type || 'place',
            city: props.city,
            country: props.country,
          });
        });
      }
    }
  } catch (err) {
    console.warn('Photon search error, trying Nominatim fallback:', err);
  }

  // 2. Query Nominatim fallback if Photon returned minimal candidates
  if (rawCandidates.length < 4) {
    try {
      let nomUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
        trimmed
      )}&format=json&addressdetails=1&limit=8`;

      if (userCoords) {
        // Bias search box (~50km viewbox around user)
        const delta = 0.45;
        const minLon = userCoords[1] - delta;
        const maxLon = userCoords[1] + delta;
        const minLat = userCoords[0] - delta;
        const maxLat = userCoords[0] + delta;
        nomUrl += `&viewbox=${minLon},${maxLat},${maxLon},${minLat}&bounded=0`;
      }

      const nomRes = await fetch(nomUrl, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Mapout-PWA-App',
        },
      });

      if (nomRes.ok) {
        const nomData = await nomRes.json();
        if (Array.isArray(nomData)) {
          nomData.forEach((item: any) => {
            const lat = parseFloat(item.lat);
            const lng = parseFloat(item.lon);
            const addr = item.address || {};
            const houseNum = addr.house_number ? String(addr.house_number).trim() : '';
            const road = addr.road || addr.street || addr.pedestrian || '';
            const rawNomName = item.name || '';

            let name = '';
            if (houseNum && road) {
              const queryStartsWithNumber = /^\d+/.test(trimmed);
              const streetWithNumber = queryStartsWithNumber
                ? `${houseNum}, ${road}`
                : `${road} ${houseNum}`;

              if (rawNomName && rawNomName !== houseNum && rawNomName.toLowerCase() !== road.toLowerCase()) {
                name = rawNomName;
              } else {
                name = streetWithNumber;
              }
            } else if (rawNomName && rawNomName !== houseNum) {
              name = houseNum && !rawNomName.includes(houseNum) ? `${rawNomName} ${houseNum}` : rawNomName;
            } else if (road) {
              name = houseNum ? `${road} ${houseNum}` : road;
            } else {
              name = item.display_name.split(',')[0];
              if (houseNum && !name.includes(houseNum)) {
                name = `${houseNum}, ${name}`;
              }
            }

            const labelParts = [
              addr.suburb || addr.quarter || addr.neighbourhood,
              addr.city || addr.town || addr.village,
              addr.country,
            ].filter(Boolean);
            const label = labelParts.length > 0 ? labelParts.join(', ') : item.display_name;

            // Avoid adding identical duplicates
            const isDup = rawCandidates.some(
              (c) => Math.abs(c.lat - lat) < 0.0005 && Math.abs(c.lng - lng) < 0.0005
            );

            if (!isDup) {
              rawCandidates.push({
                id: `nom-${item.place_id}`,
                name,
                label,
                lat,
                lng,
                category: item.type || item.class || 'place',
                city: item.address?.city || item.address?.town || item.address?.village,
                country: item.address?.country,
              });
            }
          });
        }
      }
    } catch (err) {
      console.warn('Nominatim fallback failed:', err);
    }
  }

  if (rawCandidates.length === 0) return [];

  // 3. Apply Distance Decay Ranking Mechanism
  const scoredResults = rawCandidates.map((place) => {
    let distanceMeters: number | undefined = undefined;
    let decayFactor = 1.0;

    if (userCoords) {
      distanceMeters = calculateHaversineDistance(userCoords, [place.lat, place.lng]);
      const distKm = distanceMeters / 1000;
      decayFactor = calculateDistanceDecay(distKm);
    }

    const textScore = calculateTextRelevance(trimmed, place.name, place.label, place.category);

    // Global floor for major cities/regions so international capital searches still work
    const isMajorCity =
      place.category === 'city' ||
      place.category === 'capital' ||
      place.category === 'country' ||
      place.category === 'administrative';
    const globalFloor = isMajorCity ? 12 : 3;

    // Composite ranking score: text relevance weighted by distance decay
    const compositeScore = textScore * decayFactor + globalFloor;

    return {
      place: {
        ...place,
        distanceMeters,
      },
      compositeScore,
    };
  });

  // Sort by composite score descending
  scoredResults.sort((a, b) => b.compositeScore - a.compositeScore);

  // Return top 6 deduplicated, ranked results
  return scoredResults.slice(0, 6).map((item) => item.place);
}

// Reverse geocode a tapped coordinate
export async function reverseGeocode(lat: number, lng: number): Promise<string> {
  try {
    const res = await fetch(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}`);
    if (res.ok) {
      const data = await res.json();
      if (data?.features?.[0]?.properties) {
        const p = data.features[0].properties;
        const streetWithNumber = p.street
          ? p.housenumber
            ? `${p.street} ${p.housenumber}`
            : p.street
          : null;
        const parts = [p.name, streetWithNumber, p.district || p.city, p.country].filter(Boolean);
        if (parts.length > 0) return parts.slice(0, 3).join(', ');
      }
    }
  } catch {
    // fallback
  }

  try {
    const nomRes = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`,
      { headers: { 'User-Agent': 'Mapout-PWA-App' } }
    );
    if (nomRes.ok) {
      const data = await nomRes.json();
      const addr = data.address || {};
      const houseNum = addr.house_number;
      const road = addr.road || addr.street;
      if (houseNum && road) {
        const parts = [`${road} ${houseNum}`, addr.city || addr.town, addr.country].filter(Boolean);
        return parts.join(', ');
      }
      if (data?.display_name) {
        return data.display_name.split(',').slice(0, 3).join(',').trim();
      }
    }
  } catch {
    // fallback
  }

  return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}

