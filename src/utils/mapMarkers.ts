import L from 'leaflet';

// Create custom pulsating user location marker (iOS style)
export function createUserLocationIcon(heading?: number | null): L.DivIcon {
  const headingStyle =
    typeof heading === 'number' && !isNaN(heading)
      ? `transform: rotate(${heading}deg);`
      : '';

  return L.divIcon({
    className: 'user-marker-container',
    html: `
      <div class="relative flex items-center justify-center w-8 h-8 pointer-events-none">
        ${
          typeof heading === 'number' && !isNaN(heading)
            ? `<div class="absolute -top-3 w-4 h-4 text-sky-400 opacity-80 pointer-events-none" style="${headingStyle}">
                 <svg viewBox="0 0 24 24" fill="currentColor" class="w-full h-full drop-shadow-[0_0_8px_rgba(56,189,248,0.8)]"><polygon points="12,2 22,22 12,17 2,22"/></svg>
               </div>`
            : ''
        }
        <div class="absolute w-8 h-8 rounded-full bg-sky-500/25 animate-ping"></div>
        <div class="relative w-4 h-4 rounded-full bg-sky-400 border-2 border-white shadow-[0_0_12px_rgba(56,189,248,0.9)] flex items-center justify-center">
          <div class="w-1.5 h-1.5 rounded-full bg-white"></div>
        </div>
      </div>
    `,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
}

// Create custom destination pin (sleek black chrome obsidian pin)
export function createDestinationIcon(title = 'Destination'): L.DivIcon {
  return L.divIcon({
    className: 'destination-marker-container',
    html: `
      <div class="group relative flex flex-col items-center cursor-pointer transition-transform hover:scale-110 active:scale-95">
        <div class="relative flex items-center justify-center w-9 h-11 filter drop-shadow-[0_8px_14px_rgba(0,0,0,0.85)]">
          <svg viewBox="0 0 36 44" fill="none" xmlns="http://www.w3.org/2000/svg" class="w-full h-full">
            <defs>
              <linearGradient id="pinGrad" x1="18" y1="0" x2="18" y2="44" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stop-color="#38bdf8"/>
                <stop offset="50%" stop-color="#0284c7"/>
                <stop offset="100%" stop-color="#0369a1"/>
              </linearGradient>
              <radialGradient id="specular" cx="18" cy="14" r="10" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stop-color="#ffffff" stop-opacity="0.9"/>
                <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
              </radialGradient>
            </defs>
            <!-- Pin body -->
            <path d="M18 0C8.06 0 0 8.06 0 18C0 29.5 18 44 18 44C18 44 36 29.5 36 18C36 8.06 27.94 0 18 0Z" fill="url(#pinGrad)" stroke="#ffffff" stroke-width="1.5" stroke-opacity="0.9"/>
            <!-- Inner ring -->
            <circle cx="18" cy="17" r="7" fill="#000000" stroke="#ffffff" stroke-width="1.5"/>
            <!-- Center dot -->
            <circle cx="18" cy="17" r="3" fill="#38bdf8"/>
            <!-- Specular highlight -->
            <ellipse cx="14" cy="10" rx="4" ry="2" fill="url(#specular)"/>
          </svg>
        </div>
        <div class="mt-1 px-2 py-0.5 rounded-full bg-black/90 border border-white/20 text-[10px] font-medium text-white shadow-lg whitespace-nowrap max-w-[130px] truncate">
          ${title}
        </div>
      </div>
    `,
    iconSize: [36, 56],
    iconAnchor: [18, 44],
  });
}

// Marker for an active waypoint or tapped point
export function createPinDropIcon(): L.DivIcon {
  return L.divIcon({
    className: 'pindrop-marker-container',
    html: `
      <div class="relative flex items-center justify-center w-8 h-8">
        <div class="absolute w-8 h-8 rounded-full bg-emerald-500/30 animate-ping"></div>
        <div class="w-4 h-4 rounded-full bg-emerald-400 border-2 border-white shadow-[0_0_10px_rgba(52,211,153,0.8)]"></div>
      </div>
    `,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
}
