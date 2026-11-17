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

interface ParsedBuildingToken {
  rawToken: string;
  digits: string;
  suffixRaw: string;
  suffixCanonical: string;
  startsWithNumber: boolean;
  streetRemainder: string;
  isGlued: boolean;
}

const GEORGIAN_TO_LATIN_CHAR: Record<string, string> = {
  'ა': 'a',
  'ბ': 'b',
  'გ': 'g',
  'დ': 'd',
  'ე': 'e',
  'ვ': 'v',
  'ზ': 'z',
  'თ': 't',
  'ი': 'i',
  'კ': 'k',
  'ლ': 'l',
  'მ': 'm',
  'ნ': 'n',
  'ო': 'o',
  'პ': 'p',
  'ჟ': 'j',
  'რ': 'r',
  'ს': 's',
  'ტ': 't',
  'უ': 'u',
  'ფ': 'f',
  'ქ': 'q',
  'ღ': 'gh',
  'ყ': 'y',
  'შ': 'sh',
  'ჩ': 'ch',
  'ც': 'c',
  'ძ': 'dz',
  'წ': 'w',
  'ჭ': 'ch',
  'ხ': 'kh',
  'ჯ': 'j',
  'ჰ': 'h',
};

const LATIN_TO_GEORGIAN_CHAR: Record<string, string> = {
  a: 'ა',
  b: 'ბ',
  g: 'გ',
  d: 'დ',
  e: 'ე',
  v: 'ვ',
  z: 'ზ',
  t: 'თ',
  i: 'ი',
  k: 'კ',
  l: 'ლ',
  m: 'მ',
  n: 'ნ',
  o: 'ო',
  p: 'პ',
  r: 'რ',
  s: 'ს',
  u: 'უ',
  f: 'ფ',
  q: 'ქ',
  c: 'ც',
  j: 'ჯ',
  h: 'ჰ',
};

function toCanonicalSuffix(suffix: string): string {
  const clean = suffix.toLowerCase().replace(/[\s./-]+/g, '').trim();
  if (!clean) return '';
  let out = '';
  for (const ch of clean) {
    out += GEORGIAN_TO_LATIN_CHAR[ch] ?? ch;
  }
  return out;
}

function normalizeHouseTokenCompact(value: string): string {
  return value.toLowerCase().replace(/[\s./-]+/g, '').trim();
}

function parseHouseNumberFields(hn: string): { digits: string; suffixCanonical: string } | null {
  const compact = normalizeHouseTokenCompact(hn);
  const m = compact.match(/^(\d+)([a-z\u10D0-\u10FF]*)$/u);
  if (!m) return null;
  return {
    digits: m[1],
    suffixCanonical: toCanonicalSuffix(m[2] || ''),
  };
}

/**
 * Extracts English or Georgian building number + optional suffix letter (e.g. "76b", "76 b", "76ბ", "76 ბ", "76/ბ")
 * from either the start or end of a search query.
 */
function extractQueryBuildingInfo(trimmed: string): ParsedBuildingToken | null {
  // 1. Check glued or hyphen/slash separated token first (e.g. "76b ...", "... 76ბ", "76/ბ ...")
  const gluedMatch = trimmed.match(/(?:^|\s)(\d+\s*[-/]?\s*[a-zA-Z\u10D0-\u10FF]{1,2})(?=\s|$)/u);
  if (gluedMatch && gluedMatch[1]) {
    const rawToken = gluedMatch[1];
    const parts = rawToken.replace(/[\s/-]+/g, '').match(/^(\d+)([a-zA-Z\u10D0-\u10FF]+)$/u);
    if (parts) {
      const digits = parts[1];
      const suffixRaw = parts[2];
      const startsWithNumber = trimmed.startsWith(rawToken.trim());
      const streetRemainder = trimmed.replace(rawToken, ' ').replace(/\s+/g, ' ').trim();
      if (streetRemainder.length >= 2) {
        return {
          rawToken: rawToken.trim(),
          digits,
          suffixRaw,
          suffixCanonical: toCanonicalSuffix(suffixRaw),
          startsWithNumber,
          streetRemainder,
          isGlued: !/\s/.test(rawToken.trim()),
        };
      }
    }
  }

  // 2. Check spaced single-letter suffix (e.g. "76 b vazha pshavela" or "76 ბ ვაჟა ფშაველა")
  const spacedMatch = trimmed.match(/(?:^|\s)(\d+)\s+([a-zA-Z\u10D0-\u10FF])(?=\s|$)/u);
  if (spacedMatch) {
    const rawToken = `${spacedMatch[1]} ${spacedMatch[2]}`;
    const streetRemainder = trimmed.replace(spacedMatch[0], ' ').replace(/\s+/g, ' ').trim();
    if (streetRemainder.length >= 2) {
      return {
        rawToken,
        digits: spacedMatch[1],
        suffixRaw: spacedMatch[2],
        suffixCanonical: toCanonicalSuffix(spacedMatch[2]),
        startsWithNumber: /^\d+/.test(trimmed),
        streetRemainder,
        isGlued: false,
      };
    }
  }

  // 3. Check plain numeric building number (e.g. "24 ilia chavchavadze")
  const plainMatch = trimmed.match(/(?:^|\s)(\d+)(?=\s|$)/u);
  if (plainMatch) {
    const rawToken = plainMatch[1];
    const streetRemainder = trimmed.replace(plainMatch[0], ' ').replace(/\s+/g, ' ').trim();
    if (streetRemainder.length >= 2) {
      return {
        rawToken,
        digits: rawToken,
        suffixRaw: '',
        suffixCanonical: '',
        startsWithNumber: /^\d+/.test(trimmed),
        streetRemainder,
        isGlued: false,
      };
    }
  }

  return null;
}

interface InternalCandidate extends PlaceResult {
  _rawHouseNumber?: string;
}

// Search places with distance-decay proximity prioritization and fallbacks
export async function searchPlaces(
  query: string,
  userCoords?: LatLng,
  signal?: AbortSignal
): Promise<PlaceResult[]> {
  const trimmed = query.trim();
  if (!trimmed || trimmed.length < 2) return [];
  if (signal?.aborted) return [];

  const parsedBuilding = extractQueryBuildingInfo(trimmed);
  const queryStartsWithNumber = /^\d+/.test(trimmed);
  const rawCandidates: InternalCandidate[] = [];

  const parsePhotonFeatures = (features: any[]) => {
    features.forEach((feat: any, index: number) => {
      const props = feat.properties || {};
      const coords = feat.geometry?.coordinates || [0, 0];

      const housenumber = props.housenumber ? String(props.housenumber).trim() : '';
      const street = props.street ? String(props.street).trim() : '';
      const rawName = props.name ? String(props.name).trim() : '';

      let name = '';
      let label = '';
      let isDirectAddress = false;

      if (housenumber && street) {
        // Format without comma as requested (e.g. "76b Vazha-Pshavela Avenue" or "76ბ ვაჟა-ფშაველა")
        const streetWithNumber = queryStartsWithNumber
          ? `${housenumber} ${street}`
          : `${street} ${housenumber}`;

        const rawNameIsJustNumber =
          normalizeHouseTokenCompact(rawName) === normalizeHouseTokenCompact(housenumber);

        if (rawName && rawName.toLowerCase() !== street.toLowerCase() && !rawNameIsJustNumber) {
          name = rawName;
          label = [streetWithNumber, props.district || props.suburb, props.city, props.country]
            .filter(Boolean)
            .join(', ');
        } else {
          name = streetWithNumber;
          isDirectAddress = true;
          label = [props.district || props.suburb, props.city, props.state, props.country]
            .filter(Boolean)
            .join(', ');
        }
      } else if (rawName) {
        const rawHasNumber =
          housenumber &&
          normalizeHouseTokenCompact(rawName).includes(normalizeHouseTokenCompact(housenumber));
        name = housenumber && !rawHasNumber ? `${rawName} ${housenumber}` : rawName;
        label = [street, props.district || props.suburb, props.city, props.country]
          .filter(Boolean)
          .join(', ');
      } else if (street) {
        name = housenumber ? `${street} ${housenumber}` : street;
        isDirectAddress = Boolean(housenumber);
        label = [props.district || props.suburb, props.city, props.state, props.country]
          .filter(Boolean)
          .join(', ');
      } else {
        name = housenumber ? `${props.city || trimmed} ${housenumber}` : (props.city || trimmed);
        label = [props.state, props.country].filter(Boolean).join(', ');
      }

      const isDup = rawCandidates.some(
        (c) =>
          Math.abs(c.lat - coords[1]) < 0.00025 &&
          Math.abs(c.lng - coords[0]) < 0.00025 &&
          c.name.toLowerCase() === name.toLowerCase()
      );
      if (!isDup) {
        rawCandidates.push({
          id: `photon-${props.osm_id || index}-${coords[0]}-${rawCandidates.length}`,
          name,
          label: label || name,
          lat: coords[1],
          lng: coords[0],
          category: isDirectAddress ? 'address' : (props.osm_value || props.type || 'place'),
          city: props.city,
          country: props.country,
          _rawHouseNumber: housenumber || undefined,
        });
      }
    });
  };

  const queryPhoton = async (qStr: string) => {
    try {
      let url = `https://photon.komoot.io/api/?q=${encodeURIComponent(qStr)}&limit=15`;
      if (userCoords) {
        url += `&lat=${userCoords[0]}&lon=${userCoords[1]}`;
      }
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal,
      });
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.features) && data.features.length > 0) {
          parsePhotonFeatures(data.features);
        }
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') throw err;
      console.warn('Photon search error, trying Nominatim fallback:', err);
    }
  };

  const queryNominatim = async (qStr: string) => {
    try {
      let nomUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
        qStr
      )}&format=json&addressdetails=1&limit=8`;

      if (userCoords) {
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
        signal,
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
            const rawNomName = item.name ? String(item.name).trim() : '';

            let name = '';
            let isDirectAddress = false;

            if (houseNum && road) {
              const streetWithNumber = queryStartsWithNumber
                ? `${houseNum} ${road}`
                : `${road} ${houseNum}`;

              const rawNomIsJustNumber =
                normalizeHouseTokenCompact(rawNomName) === normalizeHouseTokenCompact(houseNum);

              if (rawNomName && !rawNomIsJustNumber && rawNomName.toLowerCase() !== road.toLowerCase()) {
                name = rawNomName;
              } else {
                name = streetWithNumber;
                isDirectAddress = true;
              }
            } else if (
              rawNomName &&
              normalizeHouseTokenCompact(rawNomName) !== normalizeHouseTokenCompact(houseNum)
            ) {
              const rawHasNumber =
                houseNum &&
                normalizeHouseTokenCompact(rawNomName).includes(normalizeHouseTokenCompact(houseNum));
              name = houseNum && !rawHasNumber ? `${rawNomName} ${houseNum}` : rawNomName;
            } else if (road) {
              name = houseNum ? `${road} ${houseNum}` : road;
              isDirectAddress = Boolean(houseNum);
            } else {
              name = item.display_name.split(',')[0];
              if (
                houseNum &&
                !normalizeHouseTokenCompact(name).includes(normalizeHouseTokenCompact(houseNum))
              ) {
                name = `${houseNum} ${name}`;
              }
            }

            const labelParts = [
              addr.suburb || addr.quarter || addr.neighbourhood,
              addr.city || addr.town || addr.village,
              addr.country,
            ].filter(Boolean);
            const label = labelParts.length > 0 ? labelParts.join(', ') : item.display_name;

            const isDup = rawCandidates.some(
              (c) => Math.abs(c.lat - lat) < 0.00035 && Math.abs(c.lng - lng) < 0.00035
            );

            if (!isDup) {
              rawCandidates.push({
                id: `nom-${item.place_id}`,
                name,
                label,
                lat,
                lng,
                category: isDirectAddress ? 'address' : (item.type || item.class || 'place'),
                city: item.address?.city || item.address?.town || item.address?.village,
                country: item.address?.country,
                _rawHouseNumber: houseNum || undefined,
              });
            }
          });
        }
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') throw err;
      console.warn('Nominatim fallback failed:', err);
    }
  };

  const hasExactBuildingMatch = (candidates: InternalCandidate[], parsed: ParsedBuildingToken | null) => {
    if (!parsed) return true;
    return candidates.some((c) => {
      if (!c._rawHouseNumber) return false;
      const h = parseHouseNumberFields(c._rawHouseNumber);
      return (
        h &&
        h.digits === parsed.digits &&
        h.suffixCanonical === parsed.suffixCanonical
      );
    });
  };

  try {
    // 1. Primary Photon search
    await queryPhoton(trimmed);
    if (signal?.aborted) return [];

    // 2. Fallback to Nominatim if Photon returned minimal candidates OR missed an alphanumeric building number
    if (
      rawCandidates.length < 4 ||
      (parsedBuilding?.suffixCanonical && !hasExactBuildingMatch(rawCandidates, parsedBuilding))
    ) {
      await queryNominatim(trimmed);
      if (signal?.aborted) return [];
    }

    // 3. Targeted spaced/transliterated query fallback ONLY when an alphanumeric building suffix (e.g. 76b / 76ბ)
    // still hasn't matched an exact building number in OSM/Photon results
    if (
      parsedBuilding &&
      parsedBuilding.suffixCanonical &&
      !hasExactBuildingMatch(rawCandidates, parsedBuilding)
    ) {
      const variants: string[] = [];
      if (parsedBuilding.isGlued) {
        variants.push(
          parsedBuilding.startsWithNumber
            ? `${parsedBuilding.digits} ${parsedBuilding.suffixRaw} ${parsedBuilding.streetRemainder}`
            : `${parsedBuilding.streetRemainder} ${parsedBuilding.digits} ${parsedBuilding.suffixRaw}`
        );
      }
      // If user typed Georgian street with Latin suffix or vice versa, try matching Georgian suffix script
      const kaSuffix = LATIN_TO_GEORGIAN_CHAR[parsedBuilding.suffixRaw.toLowerCase()];
      if (kaSuffix) {
        variants.push(
          parsedBuilding.startsWithNumber
            ? `${parsedBuilding.digits}${kaSuffix} ${parsedBuilding.streetRemainder}`
            : `${parsedBuilding.streetRemainder} ${parsedBuilding.digits}${kaSuffix}`
        );
      }

      if (variants.length > 0) {
        await queryNominatim(variants[0]);
        if (signal?.aborted) return [];
      }
    }
  } catch (err: any) {
    if (err?.name === 'AbortError') return [];
  }

  if (rawCandidates.length === 0 || signal?.aborted) return [];

  // Check if query is looking for a specific address/building number (supports e.g. 24, 76b, 76ბ)
  const queryHasNumber = /\d+[a-zA-Z\u10D0-\u10FF]*/u.test(trimmed);

  // 4. Apply Distance Decay Ranking Mechanism with Alphanumeric Address Match Priority
  const scoredResults = rawCandidates.map((place) => {
    let distanceMeters: number | undefined = undefined;
    let decayFactor = 1.0;

    if (userCoords) {
      distanceMeters = calculateHaversineDistance(userCoords, [place.lat, place.lng]);
      const distKm = distanceMeters / 1000;
      decayFactor = calculateDistanceDecay(distKm);
    }

    let textScore = calculateTextRelevance(trimmed, place.name, place.label, place.category);

    // Exact alphanumeric building number matching (supports both English and Georgian suffixes)
    if (parsedBuilding && place._rawHouseNumber) {
      const candHn = parseHouseNumberFields(place._rawHouseNumber);
      if (candHn && candHn.digits === parsedBuilding.digits) {
        if (candHn.suffixCanonical === parsedBuilding.suffixCanonical) {
          textScore += 95; // Exact digits + suffix (including 76b <-> 76ბ)
        } else if (parsedBuilding.suffixCanonical) {
          textScore += 15; // Same digits, different suffix
        } else {
          textScore += 40;
        }
      }
    }

    // Direct address card ranks above interior businesses/venues inside the same building
    if (queryHasNumber) {
      if (place.category === 'address') {
        textScore += 45;
      } else if (
        place.category === 'house' ||
        place.category === 'apartments' ||
        place.category === 'building'
      ) {
        textScore += 35;
      }
    }

    // Global floor for major cities/regions so international capital searches still work
    const isMajorCity =
      place.category === 'city' ||
      place.category === 'capital' ||
      place.category === 'country' ||
      place.category === 'administrative';
    const globalFloor = isMajorCity ? 12 : 3;

    // Composite ranking score: text relevance weighted by distance decay
    const compositeScore = textScore * decayFactor + globalFloor;

    const { _rawHouseNumber, ...cleanPlace } = place;

    return {
      place: {
        ...cleanPlace,
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

