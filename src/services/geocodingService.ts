import { LatLng, PlaceResult } from '../types';

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

// Search places with Photon and fallback to Nominatim
export async function searchPlaces(query: string, userCoords?: LatLng): Promise<PlaceResult[]> {
  const trimmed = query.trim();
  if (!trimmed || trimmed.length < 2) return [];

  try {
    let url = `https://photon.komoot.io/api/?q=${encodeURIComponent(trimmed)}&limit=6`;
    if (userCoords) {
      url += `&lat=${userCoords[0]}&lon=${userCoords[1]}`;
    }

    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
      },
    });

    if (res.ok) {
      const data = await res.json();
      if (data && Array.isArray(data.features) && data.features.length > 0) {
        return data.features.map((feat: any, index: number) => {
          const props = feat.properties || {};
          const coords = feat.geometry?.coordinates || [0, 0];
          const name = props.name || props.street || props.city || trimmed;
          const details = [props.street, props.city, props.state, props.country]
            .filter(Boolean)
            .join(', ');

          return {
            id: `photon-${props.osm_id || index}-${coords[0]}`,
            name,
            label: details || name,
            lat: coords[1],
            lng: coords[0],
            category: props.osm_value || props.type || 'place',
            city: props.city,
            country: props.country,
          };
        });
      }
    }
  } catch (err) {
    console.warn('Photon search error, trying Nominatim fallback:', err);
  }

  // Fallback to OpenStreetMap Nominatim
  try {
    const nomUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
      trimmed
    )}&format=json&addressdetails=1&limit=6`;
    const nomRes = await fetch(nomUrl, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mapout-PWA-App',
      },
    });
    if (nomRes.ok) {
      const nomData = await nomRes.json();
      if (Array.isArray(nomData)) {
        return nomData.map((item: any) => ({
          id: `nom-${item.place_id}`,
          name: item.name || item.display_name.split(',')[0],
          label: item.display_name,
          lat: parseFloat(item.lat),
          lng: parseFloat(item.lon),
          category: item.type || item.class || 'place',
          city: item.address?.city || item.address?.town || item.address?.village,
          country: item.address?.country,
        }));
      }
    }
  } catch (err) {
    console.warn('Nominatim fallback failed:', err);
  }

  return [];
}

// Reverse geocode a tapped coordinate
export async function reverseGeocode(lat: number, lng: number): Promise<string> {
  try {
    const res = await fetch(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}`);
    if (res.ok) {
      const data = await res.json();
      if (data?.features?.[0]?.properties) {
        const p = data.features[0].properties;
        const parts = [p.name, p.street, p.city, p.country].filter(Boolean);
        if (parts.length > 0) return parts.slice(0, 3).join(', ');
      }
    }
  } catch {
    // fallback
  }

  try {
    const nomRes = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
      { headers: { 'User-Agent': 'Mapout-PWA-App' } }
    );
    if (nomRes.ok) {
      const data = await nomRes.json();
      if (data?.display_name) {
        return data.display_name.split(',').slice(0, 3).join(',').trim();
      }
    }
  } catch {
    // fallback
  }

  return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}
