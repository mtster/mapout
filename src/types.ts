export type LatLng = [number, number]; // [lat, lng]

export type TravelMode = 'driving' | 'cycling' | 'walking';

export type MapStyle = 'dark' | 'midnight' | 'satellite';

export interface PlaceResult {
  id: string;
  name: string;
  label: string;
  lat: number;
  lng: number;
  category?: string;
  city?: string;
  country?: string;
}

export interface RouteStep {
  id: string;
  instruction: string;
  distance: number; // in meters
  duration: number; // in seconds
  modifier?: string; // 'turn-left', 'turn-right', 'depart', 'arrive', etc.
  type?: string;
  location: LatLng;
  streetName?: string;
}

export interface RouteData {
  distance: number; // in meters
  duration: number; // in seconds
  geometry: LatLng[];
  steps: RouteStep[];
  startPoint: LatLng;
  endPoint: LatLng;
  destinationName: string;
}

export interface UserLocation {
  lat: number;
  lng: number;
  heading?: number | null;
  speed?: number | null;
  accuracy?: number;
}
