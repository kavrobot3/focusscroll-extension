import type { ShortViewEvent, ShortsStats, CalibrationInfo } from './types';

export const STORAGE_KEY_EVENTS = 'focusscroll_short_view_events';
export const CALIBRATION_COUNT_REQUIRED = 3;

/**
 * Check if Chrome Extension runtime context is still valid and not disconnected/invalidated
 */
export function isExtensionContextValid(): boolean {
  try {
    if (
      typeof chrome === 'undefined' ||
      !chrome?.runtime ||
      !chrome.runtime.id ||
      !chrome?.storage?.local
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Fallback to read from localStorage
 */
function getFromLocalStorage(): ShortViewEvent[] {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = localStorage.getItem(STORAGE_KEY_EVENTS);
      return raw ? JSON.parse(raw) : [];
    }
  } catch {
    // Ignore localStorage access errors
  }
  return [];
}

/**
 * Fallback to write to localStorage
 */
function saveToLocalStorage(events: ShortViewEvent[]): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.setItem(STORAGE_KEY_EVENTS, JSON.stringify(events));
      window.dispatchEvent(new Event('focusscroll_storage_updated'));
    }
  } catch {
    // Ignore localStorage write errors
  }
}

/**
 * Retrieve all recorded ShortViewEvents with context-invalidation safety
 */
export async function getShortViewEvents(): Promise<ShortViewEvent[]> {
  if (isExtensionContextValid()) {
    try {
      const data = await chrome.storage.local.get(STORAGE_KEY_EVENTS);
      return (data[STORAGE_KEY_EVENTS] as ShortViewEvent[]) || [];
    } catch {
      return getFromLocalStorage();
    }
  }

  return getFromLocalStorage();
}

/**
 * Compute calibration details and current hidden focus target from recorded events
 */
export function getCalibrationInfo(events: ShortViewEvent[]): CalibrationInfo {
  // Sort chronologically ascending by startedAt to identify calibration sessions
  const chronological = [...events].sort((a, b) => a.startedAt - b.startedAt);
  const validEvents = chronological.filter((e) => e.dwellMs >= 400);

  const calibrationEvents = validEvents.slice(0, CALIBRATION_COUNT_REQUIRED);
  const count = calibrationEvents.length;
  const isCalibrated = count >= CALIBRATION_COUNT_REQUIRED;

  if (count === 0) {
    return {
      isCalibrated: false,
      calibrationCount: 0,
      calibrationTarget: CALIBRATION_COUNT_REQUIRED,
      baselineDwellMs: 4000,
      baselineDwellSec: 4.0,
      currentTargetSec: 8,
      minimumGateSec: 4,
    };
  }

  const sumDwellMs = calibrationEvents.reduce((acc, ev) => acc + ev.dwellMs, 0);
  const baselineDwellMs = Math.round(sumDwellMs / count);
  const baselineDwellSec = Number((baselineDwellMs / 1000).toFixed(1));

  if (!isCalibrated) {
    return {
      isCalibrated: false,
      calibrationCount: count,
      calibrationTarget: CALIBRATION_COUNT_REQUIRED,
      baselineDwellMs,
      baselineDwellSec,
      // Provide an immediate active gentle gate even while building calibration baseline
      currentTargetSec: Math.max(6, Math.round(baselineDwellSec * 1.3)),
      minimumGateSec: Math.max(3, Math.min(6, Math.round(baselineDwellSec * 0.8))),
    };
  }

  // Once calibrated:
  // Set currentTargetSec based on baseline average
  const currentTargetSec = Math.max(6, Math.round(baselineDwellSec * 1.2));
  // Minimum gate: target - 3 seconds, bounded between 3s and 12s
  const minimumGateSec = Math.max(3, Math.min(12, currentTargetSec - 3));

  return {
    isCalibrated: true,
    calibrationCount: CALIBRATION_COUNT_REQUIRED,
    calibrationTarget: CALIBRATION_COUNT_REQUIRED,
    baselineDwellMs,
    baselineDwellSec,
    currentTargetSec,
    minimumGateSec,
  };
}

/**
 * Save a new ShortViewEvent to storage
 */
export async function saveShortViewEvent(event: ShortViewEvent): Promise<void> {
  try {
    const existing = await getShortViewEvents();
    // Keep list bounded (e.g. up to 1000 latest events)
    const updated = [event, ...existing].slice(0, 1000);

    if (isExtensionContextValid()) {
      try {
        await chrome.storage.local.set({ [STORAGE_KEY_EVENTS]: updated });
        return;
      } catch {
        // Fall back to localStorage
      }
    }

    saveToLocalStorage(updated);
  } catch {
    // Silently ignore storage failures
  }
}

/**
 * Clear all recorded events
 */
export async function clearShortViewEvents(): Promise<void> {
  try {
    if (isExtensionContextValid()) {
      try {
        await chrome.storage.local.remove(STORAGE_KEY_EVENTS);
      } catch {
        // Fall back to localStorage
      }
    }

    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.removeItem(STORAGE_KEY_EVENTS);
      window.dispatchEvent(new Event('focusscroll_storage_updated'));
    }
  } catch {
    // Silently ignore clear failures
  }
}

/**
 * Subscribe to storage changes
 */
export function onStorageChanged(callback: (events: ShortViewEvent[]) => void): () => void {
  if (isExtensionContextValid()) {
    try {
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
        try {
          if (isExtensionContextValid()) {
            chrome.storage.onChanged.removeListener(listener);
          }
        } catch {
          // Ignore removal errors if context already invalidated
        }
      };
    } catch {
      // Ignore listener attachment error if context invalidated
    }
  }

  if (typeof window !== 'undefined') {
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
 * Calculate aggregate statistics for today's viewing events and calibration
 */
export function calculateShortsStats(events: ShortViewEvent[]): ShortsStats {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  const todayEvents = events.filter((e) => e.startedAt >= startOfDay);
  const todayCount = todayEvents.length;
  let totalDwellMsToday = 0;
  let longestDwellMs = 0;
  let totalEarlyScrollAttempts = 0;

  for (const ev of todayEvents) {
    totalDwellMsToday += ev.dwellMs;
    if (ev.dwellMs > longestDwellMs) {
      longestDwellMs = ev.dwellMs;
    }
    totalEarlyScrollAttempts += (ev.earlyScrollAttempts || 0);
  }

  const avgDwellMs = todayCount > 0 ? Math.round(totalDwellMsToday / todayCount) : 0;
  const calib = getCalibrationInfo(events);

  return {
    todayCount,
    avgDwellMs,
    longestDwellMs,
    totalDwellMsToday,
    isCalibrated: calib.isCalibrated,
    calibrationCount: calib.calibrationCount,
    calibrationTarget: calib.calibrationTarget,
    baselineAvgDwellMs: calib.baselineDwellMs,
    currentTargetSec: calib.currentTargetSec,
    minimumGateSec: calib.minimumGateSec,
    totalEarlyScrollAttempts,
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

