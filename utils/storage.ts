import {
  DEFAULT_FOCUS_SETTINGS,
  type CalibrationInfo,
  type FocusSettings,
  type ShortsStats,
  type ShortViewEvent,
} from './types';

export { DEFAULT_FOCUS_SETTINGS } from './types';
export const STORAGE_KEY_EVENTS = 'focusscroll_short_view_events';
export const STORAGE_KEY_SETTINGS = 'focusscroll_user_settings';
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
 * Retrieve user FocusSettings
 */
export async function getFocusSettings(): Promise<FocusSettings> {
  if (isExtensionContextValid()) {
    try {
      const data = await chrome.storage.local.get(STORAGE_KEY_SETTINGS);
      if (data[STORAGE_KEY_SETTINGS]) {
        return { ...DEFAULT_FOCUS_SETTINGS, ...data[STORAGE_KEY_SETTINGS] };
      }
    } catch {
      // Fall through to localStorage
    }
  }

  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = localStorage.getItem(STORAGE_KEY_SETTINGS);
      if (raw) {
        return { ...DEFAULT_FOCUS_SETTINGS, ...JSON.parse(raw) };
      }
    }
  } catch {
    // Ignore localStorage access error
  }

  return DEFAULT_FOCUS_SETTINGS;
}

/**
 * Save user FocusSettings
 */
export async function saveFocusSettings(settings: FocusSettings): Promise<void> {
  if (isExtensionContextValid()) {
    try {
      await chrome.storage.local.set({ [STORAGE_KEY_SETTINGS]: settings });
    } catch {
      // Fall through to localStorage
    }
  }

  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(settings));
      window.dispatchEvent(new CustomEvent('focusscroll_settings_updated', { detail: settings }));
    }
  } catch {
    // Ignore localStorage write error
  }
}

/**
 * Subscribe to settings changes
 */
export function onSettingsChanged(callback: (settings: FocusSettings) => void): () => void {
  if (isExtensionContextValid()) {
    try {
      const listener = (
        changes: { [key: string]: chrome.storage.StorageChange },
        areaName: string
      ) => {
        if (areaName === 'local' && changes[STORAGE_KEY_SETTINGS]) {
          callback({
            ...DEFAULT_FOCUS_SETTINGS,
            ...(changes[STORAGE_KEY_SETTINGS].newValue as FocusSettings),
          });
        }
      };
      chrome.storage.onChanged.addListener(listener);
      return () => {
        try {
          if (isExtensionContextValid()) {
            chrome.storage.onChanged.removeListener(listener);
          }
        } catch {
          // Ignore
        }
      };
    } catch {
      // Ignore
    }
  }

  if (typeof window !== 'undefined') {
    const handler = (e: Event) => {
      const customEv = e as CustomEvent<FocusSettings>;
      if (customEv.detail) {
        callback(customEv.detail);
      } else {
        getFocusSettings().then(callback);
      }
    };
    window.addEventListener('focusscroll_settings_updated', handler);
    return () => {
      window.removeEventListener('focusscroll_settings_updated', handler);
    };
  }
  return () => {};
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
 * Get effective target progression rate in seconds per Short
 */
export function getProgressionRate(settings: FocusSettings): number {
  switch (settings.progressionSpeed) {
    case 'fixed':
      return 0;
    case 'gentle':
      // Gentle: very low, approachable increase (+0.05s per video)
      return 0.05;
    case 'normal':
      return 0.15;
    case 'brisk':
      return 0.3;
    case 'custom':
      return Math.max(0, Number(settings.customIncreasePerShortSec) || 0.05);
    default:
      return 0.05;
  }
}

/**
 * Compute calibration details and current focus target from recorded events & settings
 */
export function getCalibrationInfo(
  events: ShortViewEvent[],
  customSettings?: FocusSettings
): CalibrationInfo {
  const settings: FocusSettings = customSettings || DEFAULT_FOCUS_SETTINGS;
  const progressionRate = getProgressionRate(settings);

  // Sort chronologically ascending by startedAt to identify calibration sessions
  const chronological = [...events].sort((a, b) => a.startedAt - b.startedAt);
  const validEvents = chronological.filter((e) => e.dwellMs >= 300);

  const calibrationEvents = validEvents.slice(0, CALIBRATION_COUNT_REQUIRED);
  const count = calibrationEvents.length;
  const isCalibrated = count >= CALIBRATION_COUNT_REQUIRED;

  let baselineDwellMs = 3000;
  let baselineDwellSec = 3.0;

  if (count > 0) {
    const sumDwellMs = calibrationEvents.reduce((acc, ev) => acc + ev.dwellMs, 0);
    baselineDwellMs = Math.round(sumDwellMs / count);
    baselineDwellSec = Number((baselineDwellMs / 1000).toFixed(1));
  }

  // Exact target calculation:
  // In manual mode, target is exactly manualTargetSec.
  // In auto mode, target is baseline average dwell (or default 5s if calibrating).
  let currentTargetSec: number;
  if (settings.targetMode === 'manual') {
    currentTargetSec = settings.manualTargetSec;
  } else {
    currentTargetSec = isCalibrated ? Math.max(3, Math.round(baselineDwellSec)) : settings.manualTargetSec;
  }
  currentTargetSec = Number(currentTargetSec.toFixed(1));

  // Minimum scroll gate
  let minimumGateSec: number;
  if (settings.gateMode === 'fixed') {
    minimumGateSec = Math.min(currentTargetSec, Math.max(1, settings.manualGateSec));
  } else {
    minimumGateSec = Math.max(1, Math.min(currentTargetSec, Math.round(currentTargetSec - 2)));
  }

  return {
    isCalibrated,
    calibrationCount: Math.min(count, CALIBRATION_COUNT_REQUIRED),
    calibrationTarget: CALIBRATION_COUNT_REQUIRED,
    baselineDwellMs,
    baselineDwellSec,
    currentTargetSec,
    minimumGateSec,
    progressionRateSec: progressionRate,
    settings,
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
 * Hard reload the extension and all open YouTube & Instagram tabs to prevent stale state or errors
 */
export async function hardReloadExtension(): Promise<{ success: boolean; reloadedTabs: number }> {
  let reloadedTabs = 0;

  try {
    // 1. Reload any active YouTube & Instagram tabs if chrome.tabs is available
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
      try {
        const matchingTabs = await chrome.tabs.query({
          url: [
            '*://*.youtube.com/*',
            '*://youtube.com/*',
            '*://*.instagram.com/*',
            '*://instagram.com/*',
          ],
        });
        for (const tab of matchingTabs) {
          if (tab.id) {
            chrome.tabs.reload(tab.id);
            reloadedTabs++;
          }
        }
      } catch (err) {
        console.warn('Could not reload active tabs:', err);
      }
    }

    // 2. Hard reload extension runtime if available
    if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.reload === 'function') {
      setTimeout(() => {
        try {
          chrome.runtime.reload();
        } catch (err) {
          console.warn('chrome.runtime.reload failed:', err);
        }
      }, 300);
    }

    // 3. Reload current popup window context
    if (typeof window !== 'undefined' && window.location) {
      setTimeout(() => {
        window.location.reload();
      }, 400);
    }

    return { success: true, reloadedTabs };
  } catch {
    return { success: false, reloadedTabs: 0 };
  }
}

/**
 * Calculate aggregate statistics for today's viewing events and calibration
 */
export function calculateShortsStats(
  events: ShortViewEvent[],
  customSettings?: FocusSettings
): ShortsStats {
  const settings = customSettings || DEFAULT_FOCUS_SETTINGS;
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
  const calib = getCalibrationInfo(events, settings);

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
    settings,
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

