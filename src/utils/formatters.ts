// Format distance: 1.2 km or 450 m
export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(1)} km`;
}

// Format duration: 18 min or 1 h 24 min
export function formatDuration(seconds: number): string {
  const safeSeconds = Math.max(0, Math.round(seconds));
  const mins = Math.round(safeSeconds / 60);
  if (mins < 1) {
    return '1 min';
  }
  if (mins < 60) {
    return `${mins} min`;
  }
  const hours = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  return remainingMins > 0 ? `${hours} h ${remainingMins} min` : `${hours} h`;
}

// Format ETA timestamp in strict 24-hour format (e.g., "17:42", "09:15")
// If targetTimestampMs is given (locked at start of navigation), it formats that exact target timestamp
// preventing ETA from drifting forward as time elapses.
export function formatETA(durationSeconds: number, targetTimestampMs?: number | null): string {
  const timestamp = targetTimestampMs || (Date.now() + Math.max(0, durationSeconds) * 1000);
  const arrival = new Date(timestamp);
  const hours = String(arrival.getHours()).padStart(2, '0');
  const minutes = String(arrival.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}
