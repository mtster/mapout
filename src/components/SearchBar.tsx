import React, { useState, useEffect, useRef } from 'react';
import { Search, X, Coffee, Utensils, Fuel, ShoppingBag, TreePine, Loader2 } from 'lucide-react';
import { PlaceResult, LatLng } from '../types';
import { searchPlaces, formatDistance } from '../services/mapService';
import { PWAInstallModal } from './PWAInstallModal';

interface Props {
  userLocation: LatLng | null;
  onSelectPlace: (place: PlaceResult) => void;
  onClearDestination: () => void;
  selectedDestination: PlaceResult | null;
  isNavigating: boolean;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const QUICK_CATEGORIES = [
  { label: 'Coffee', query: 'coffee cafe', icon: Coffee },
  { label: 'Food', query: 'restaurant food', icon: Utensils },
  { label: 'Fuel/EV', query: 'gas station EV charger', icon: Fuel },
  { label: 'Groceries', query: 'supermarket grocery', icon: ShoppingBag },
  { label: 'Parks', query: 'park nature', icon: TreePine },
];

export const SearchBar: React.FC<Props> = ({
  userLocation,
  onSelectPlace,
  onClearDestination,
  selectedDestination,
  isNavigating,
  isOpen: externalIsOpen,
  onOpenChange,
}) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [internalIsOpen, setInternalIsOpen] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const prevQueryLenRef = useRef(0);
  const isDeletingRef = useRef(false);
  const searchSeqRef = useRef(0);

  const isOpen = externalIsOpen !== undefined ? externalIsOpen : internalIsOpen;
  const setIsOpen = (open: boolean) => {
    setInternalIsOpen(open);
    onOpenChange?.(open);
  };

  const userLocationRef = useRef(userLocation);
  useEffect(() => {
    userLocationRef.current = userLocation;
  }, [userLocation]);

  // Sync with selected destination name if changed externally, or clear query when cleared
  useEffect(() => {
    if (selectedDestination) {
      setQuery(selectedDestination.name);
      prevQueryLenRef.current = selectedDestination.name.length;
      isDeletingRef.current = false;
      setHasInteracted(false);
      setIsSearching(false);
      setIsOpen(false);
    } else {
      setQuery('');
      prevQueryLenRef.current = 0;
      isDeletingRef.current = false;
      setHasInteracted(false);
      setIsSearching(false);
      setResults([]);
    }
  }, [selectedDestination]);

  // Adaptive debounced search with AbortController cancellation:
  // Cancels any pending timers AND active network requests on every keystroke/backspace.
  // Uses a longer window (750ms) during deletion bursts so holding Backspace never fires halfway through erasing.
  useEffect(() => {
    if (!hasInteracted) return;

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    const trimmed = query.trim();
    if (!trimmed || trimmed.length < 2) {
      setResults([]);
      setIsSearching(false);
      return;
    }

    const debounceMs = isDeletingRef.current ? 750 : 450;

    debounceTimerRef.current = setTimeout(async () => {
      const currentSeq = ++searchSeqRef.current;
      const controller = new AbortController();
      abortControllerRef.current = controller;
      setIsSearching(true);
      try {
        const places = await searchPlaces(
          trimmed,
          userLocationRef.current || undefined,
          controller.signal
        );
        if (!controller.signal.aborted && currentSeq === searchSeqRef.current) {
          setResults(places);
        }
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          console.error('Search error:', err);
        }
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
        if (currentSeq === searchSeqRef.current) {
          setIsSearching(false);
        }
      }
    }, debounceMs);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, [query, hasInteracted]);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (place: PlaceResult) => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    if (abortControllerRef.current) abortControllerRef.current.abort();
    setQuery(place.name);
    prevQueryLenRef.current = place.name.length;
    isDeletingRef.current = false;
    setIsOpen(false);
    setResults([]);
    onSelectPlace(place);
  };

  const handleClear = () => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    if (abortControllerRef.current) abortControllerRef.current.abort();
    setQuery('');
    prevQueryLenRef.current = 0;
    isDeletingRef.current = false;
    setResults([]);
    setIsSearching(false);
    setIsOpen(false);
    onClearDestination();
  };

  const handleCategoryClick = (catQuery: string) => {
    setQuery(catQuery);
    setHasInteracted(true);
    setIsOpen(true);
  };

  if (isNavigating) {
    return null; // During active turn-by-turn navigation, the HUD replaces the search bar
  }

  return (
    <div
      ref={searchContainerRef}
      id="search-bar-container"
      className="absolute top-3 left-3 right-3 sm:left-6 sm:right-auto sm:w-[420px] z-[1400] flex flex-col gap-2 pointer-events-auto"
      style={{ top: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}
    >
      {/* Search Header Bar */}
      <div className="relative flex items-center w-full h-12 rounded-2xl bg-zinc-950/90 backdrop-blur-2xl border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.6)] px-3.5 transition-all focus-within:border-white/30 focus-within:ring-1 focus-within:ring-white/20">
        <div className="flex items-center justify-center text-zinc-400 mr-2.5">
          {isSearching ? (
            <Loader2 className="w-4 h-4 animate-spin text-sky-400" />
          ) : (
            <Search className="w-4 h-4 text-zinc-400" />
          )}
        </div>

        <input
          id="map-search-input"
          type="text"
          value={query}
          onChange={(e) => {
            const nextVal = e.target.value;
            const inputType = (e.nativeEvent as InputEvent | undefined)?.inputType || '';
            isDeletingRef.current =
              inputType.startsWith('delete') || nextVal.length < prevQueryLenRef.current;
            prevQueryLenRef.current = nextVal.length;
            setQuery(nextVal);
            setHasInteracted(true);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          placeholder="Search destinations, streets, spots..."
          className="w-full bg-transparent text-sm text-white placeholder:text-zinc-500 font-normal outline-none"
          autoComplete="off"
          spellCheck="false"
        />

        {query ? (
          <button
            onClick={handleClear}
            id="clear-search-btn"
            className="p-1 rounded-full text-zinc-400 hover:text-white hover:bg-zinc-800 transition ml-1"
            title="Clear search"
          >
            <X className="w-4 h-4" />
          </button>
        ) : (
          <div className="flex items-center gap-1.5 ml-1">
            <PWAInstallModal />
          </div>
        )}
      </div>

      {/* Quick category pills (when focused or active) */}
      {isOpen && !query && (
        <div className="flex items-center gap-1.5 overflow-x-auto py-1 px-0.5 no-scrollbar">
          {QUICK_CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            return (
              <button
                key={cat.label}
                onClick={() => handleCategoryClick(cat.query)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-zinc-900/90 hover:bg-zinc-800 text-zinc-300 hover:text-white border border-white/10 text-xs font-medium backdrop-blur-xl whitespace-nowrap transition active:scale-95"
              >
                <Icon className="w-3.5 h-3.5 text-zinc-400" />
                <span>{cat.label}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Autocomplete Results Dropdown - Clean styling, distance aligned to right edge, no icons */}
      {isOpen && results.length > 0 && (
        <div
          id="search-results-list"
          className="w-full max-h-72 overflow-y-auto scrollable-content rounded-2xl bg-zinc-950/95 backdrop-blur-2xl border border-white/10 shadow-[0_12px_40px_rgba(0,0,0,0.85)] divide-y divide-zinc-900"
        >
          {results.map((place) => (
            <button
              key={place.id}
              onClick={() => handleSelect(place)}
              className="w-full flex items-center justify-between gap-3 p-3.5 text-left hover:bg-zinc-900/70 active:bg-zinc-800/80 transition"
            >
              <div className="flex-1 min-w-0 pr-2">
                <div className="text-sm font-medium text-white truncate">
                  {place.name}
                </div>
                <div className="text-xs text-zinc-400 truncate mt-0.5">
                  {place.label}
                </div>
              </div>
              {typeof place.distanceMeters === 'number' && (
                <div className="shrink-0 text-xs text-zinc-400 font-normal tabular-nums self-center">
                  {formatDistance(place.distanceMeters)}
                </div>
              )}
            </button>
          ))}
        </div>
      )}

      {isOpen && query.length >= 2 && !isSearching && results.length === 0 && (
        <div className="w-full p-4 rounded-2xl bg-zinc-950/95 backdrop-blur-2xl border border-white/10 text-center text-xs text-zinc-400">
          No destinations found for &quot;{query}&quot;. Try another search or tap the map to drop a pin.
        </div>
      )}
    </div>
  );
};
