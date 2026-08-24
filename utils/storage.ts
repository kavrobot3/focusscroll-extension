import type { ShortViewEvent, ShortsStats } from './types';

export const STORAGE_KEY_EVENTS = 'focusscroll_short_view_events';

function hasChromeStorage(): boolean {
  return (
    typeof chrome !== 'undefined' &&
    Boolean(chrome?.storage?.local)
  );
}

/**
 * Retrieve all recorded ShortViewEvents
 */
export async function getShortViewEvents(): Promise<ShortViewEvent[]> {
  try {
    if (hasChromeStorage()) {
      const data = await chrome.storage.local.get(STORAGE_KEY_EVENTS);
      return (data[STORAGE_KEY_EVENTS] as ShortViewEvent[]) || [];
    } else if (typeof window !== 'undefined' && window.localStorage) {
      const raw = localStorage.getItem(STORAGE_KEY_EVENTS);
      return raw ? JSON.parse(raw) : [];
    }
  } catch (err) {
    console.error('FocusScroll: Failed to read stored events', err);
  }
  return [];
}

/**
 * Save a new ShortViewEvent to storage
 */
export async function saveShortViewEvent(event: ShortViewEvent): Promise<void> {
  try {
    const existing = await getShortViewEvents();
    // Keep list bounded (e.g. up to 1000 latest events)
    const updated = [event, ...existing].slice(0, 1000);

    if (hasChromeStorage()) {
      await chrome.storage.local.set({ [STORAGE_KEY_EVENTS]: updated });
    } else if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.setItem(STORAGE_KEY_EVENTS, JSON.stringify(updated));
      window.dispatchEvent(new Event('focusscroll_storage_updated'));
    }
  } catch (err) {
    console.error('FocusScroll: Failed to save event', err);
  }
}

/**
 * Clear all recorded events
 */
export async function clearShortViewEvents(): Promise<void> {
  try {
    if (hasChromeStorage()) {
      await chrome.storage.local.remove(STORAGE_KEY_EVENTS);
    } else if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.removeItem(STORAGE_KEY_EVENTS);
      window.dispatchEvent(new Event('focusscroll_storage_updated'));
    }
  } catch (err) {
    console.error('FocusScroll: Failed to clear events', err);
  }
}

/**
 * Subscribe to storage changes
 */
export function onStorageChanged(callback: (events: ShortViewEvent[]) => void): () => void {
  if (hasChromeStorage()) {
    const listener = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string
    ) => {
      if (areaName === 'local' && changes[STORAGE_KEY_EVENTS]) {
        callback((changes[STORAGE_KEY_EVENTS].newValue as ShortViewEvent[]) || []);
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => {
      chrome.storage.onChanged.removeListener(listener);
    };
  } else if (typeof window !== 'undefined') {
    const handler = () => {
      getShortViewEvents().then(callback);
    };
    window.addEventListener('focusscroll_storage_updated', handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener('focusscroll_storage_updated', handler);
      window.removeEventListener('storage', handler);
    };
  }
  return () => {};
}

/**
 * Calculate aggregate statistics for today's viewing events
 */
export function calculateShortsStats(events: ShortViewEvent[]): ShortsStats {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  const todayEvents = events.filter((e) => e.startedAt >= startOfDay);

  const todayCount = todayEvents.length;
  let totalDwellMsToday = 0;
  let longestDwellMs = 0;

  for (const ev of todayEvents) {
    totalDwellMsToday += ev.dwellMs;
    if (ev.dwellMs > longestDwellMs) {
      longestDwellMs = ev.dwellMs;
    }
  }

  const avgDwellMs = todayCount > 0 ? Math.round(totalDwellMsToday / todayCount) : 0;

  return {
    todayCount,
    avgDwellMs,
    longestDwellMs,
    totalDwellMsToday,
    events,
  };
}

/**
 * Format milliseconds into human-readable duration (e.g. "12.4s", "1m 32s")
 */
export function formatDuration(ms: number): string {
  if (ms <= 0) return '0s';
  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) {
    return `${totalSeconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  if (minutes < 60) {
    return `${minutes}m ${seconds}s`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}
