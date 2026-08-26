import {
  DEFAULT_FOCUS_SETTINGS,
  getCalibrationInfo,
  getFocusSettings,
  getShortViewEvents,
  isExtensionContextValid,
  onSettingsChanged,
  onStorageChanged,
  saveShortViewEvent,
} from '@/utils/storage';
import type { FocusSettings, ShortViewEvent } from '@/utils/types';

interface ActiveReelSession {
  id: string;
  reelId: string | null;
  url: string;
  startedAt: number;
  accumulatedPlayMs: number;
  lastPlayStartTime: number | null;
  isPlaying: boolean;
  videoDurationSec: number | null;
  calibration: boolean;
  currentTargetSec: number;
  minimumGateSec: number;
  earlyScrollAttempts: number;
  gateUnlocked: boolean;
}

export default defineContentScript({
  matches: [
    'https://www.instagram.com/*',
    'https://instagram.com/*',
  ],
  runAt: 'document_idle',
  main() {
    function log(message: string, ...args: unknown[]) {
      console.log(
        `%c[FocusScroll:Instagram]%c ${message}`,
        'background: #e1306c; color: #ffffff; padding: 2px 6px; border-radius: 4px; font-weight: bold;',
        'color: #f43f5e; font-weight: 600;',
        ...args
      );
    }

    log('Extension loaded on Instagram (Gentle Focus Intervention)');

    let isTerminated = false;
    let currentSession: ActiveReelSession | null = null;
    let lastHandledReelId: string | null = null;
    let storedEventsCache: ShortViewEvent[] = [];
    let userSettingsCache: FocusSettings = DEFAULT_FOCUS_SETTINGS;
    let activeVideoEl: HTMLVideoElement | null = null;
    let pollInterval: ReturnType<typeof setInterval> | null = null;
    let domObserver: MutationObserver | null = null;
    let unsubsStorage: (() => void) | null = null;
    let unsubsSettings: (() => void) | null = null;
    let lastAttemptTimestamp = 0;

    // Load initial data
    getShortViewEvents().then((events) => {
      if (!isTerminated) storedEventsCache = events;
    });

    getFocusSettings().then((settings) => {
      if (!isTerminated) {
        userSettingsCache = settings;
        if (currentSession) {
          const calib = getCalibrationInfo(storedEventsCache, userSettingsCache);
          currentSession.currentTargetSec = calib.currentTargetSec;
          currentSession.minimumGateSec = calib.minimumGateSec;
        }
      }
    });

    unsubsStorage = onStorageChanged((events) => {
      if (!isTerminated) storedEventsCache = events;
    });

    unsubsSettings = onSettingsChanged((settings) => {
      if (!isTerminated) {
        userSettingsCache = settings;
        log('Settings updated in Instagram content script:', settings);
        if (currentSession) {
          const calib = getCalibrationInfo(storedEventsCache, userSettingsCache);
          currentSession.currentTargetSec = calib.currentTargetSec;
          currentSession.minimumGateSec = calib.minimumGateSec;
        }
      }
    });

    function ensureContextValid(): boolean {
      if (isTerminated) return false;
      if (!isExtensionContextValid()) {
        cleanup();
        return false;
      }
      return true;
    }

    // Gentle Indicator Element
    let indicatorTimeout: ReturnType<typeof setTimeout> | null = null;

    function getOrCreateIndicator(): HTMLElement {
      let el = document.getElementById('focusscroll-ig-indicator');
      if (!el) {
        el = document.createElement('div');
        el.id = 'focusscroll-ig-indicator';
        el.textContent = 'Stay a moment…';
        Object.assign(el.style, {
          position: 'fixed',
          bottom: '80px',
          left: '50%',
          transform: 'translateX(-50%) translateY(8px)',
          backgroundColor: 'rgba(15, 23, 42, 0.94)',
          color: '#22d3ee',
          border: '1px solid rgba(6, 182, 212, 0.5)',
          borderRadius: '9999px',
          padding: '8px 20px',
          fontSize: '13px',
          fontWeight: '500',
          letterSpacing: '0.01em',
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.7), 0 0 16px rgba(6, 182, 212, 0.3)',
          backdropFilter: 'blur(10px)',
          webkitBackdropFilter: 'blur(10px)',
          pointerEvents: 'none',
          zIndex: '2147483647',
          opacity: '0',
          transition: 'opacity 0.2s cubic-bezier(0.16, 1, 0.3, 1), transform 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        });
        (document.body || document.documentElement).appendChild(el);
      }
      return el;
    }

    function getRemainingGateSeconds(): number {
      if (!currentSession) return 0;
      const elapsedSec = getActiveElapsedPlayMs() / 1000;
      const minGate = currentSession.minimumGateSec;
      const duration = currentSession.videoDurationSec;
      const effectiveGate = duration && duration > 0 ? Math.min(minGate, Math.max(1, duration - 0.2)) : minGate;
      return Math.max(1, Math.ceil(effectiveGate - elapsedSec));
    }

    function showGentleMessage() {
      const el = getOrCreateIndicator();
      const remaining = getRemainingGateSeconds();
      el.textContent = `✨ Stay a moment… (${remaining}s remaining)`;
      el.style.color = '#22d3ee';
      el.style.borderColor = 'rgba(6, 182, 212, 0.5)';
      el.style.opacity = '1';
      el.style.transform = 'translateX(-50%) translateY(0px)';

      if (indicatorTimeout) clearTimeout(indicatorTimeout);
      indicatorTimeout = setTimeout(() => {
        el.style.opacity = '0';
        el.style.transform = 'translateX(-50%) translateY(8px)';
      }, 1400);
    }

    function showUnlockedMessage() {
      const el = getOrCreateIndicator();
      el.textContent = '✓ Gate Unlocked';
      el.style.color = '#34d399';
      el.style.borderColor = 'rgba(52, 211, 153, 0.5)';
      el.style.opacity = '1';
      el.style.transform = 'translateX(-50%) translateY(0px)';

      if (indicatorTimeout) clearTimeout(indicatorTimeout);
      indicatorTimeout = setTimeout(() => {
        el.style.opacity = '0';
        el.style.transform = 'translateX(-50%) translateY(8px)';
      }, 1000);
    }

    // Engagement and comments whitelisting
    function isInsideEngagementOrComments(target: EventTarget | null): boolean {
      if (!target || !(target instanceof Element)) return false;
      return Boolean(
        target.closest(
          'input, textarea, [contenteditable="true"], form, ' +
          'div[role="dialog"], article div[tabindex], ' +
          'button, a, svg, div[aria-label*="Comment"], div[aria-label*="Share"], div[aria-label*="Like"]'
        )
      );
    }

    function isInstagramReelUrl(): boolean {
      const path = window.location.pathname;
      return path.includes('/reel/') || path.includes('/reels/') || path.startsWith('/reels');
    }

    function getReelIdFromUrl(): string | null {
      const match = window.location.pathname.match(/\/reel(?:s)?\/([A-Za-z0-9_-]+)/);
      return match && match[1] ? match[1] : null;
    }

    function getActiveElapsedPlayMs(): number {
      if (!currentSession) return 0;
      let total = currentSession.accumulatedPlayMs;
      if (currentSession.isPlaying && currentSession.lastPlayStartTime !== null) {
        total += Date.now() - currentSession.lastPlayStartTime;
      }
      return total;
    }

    function isGateSatisfied(): boolean {
      if (!currentSession) return true;
      if (currentSession.gateUnlocked) return true;

      // If user disabled Instagram intervention
      if (userSettingsCache.enableInstagram === false) return true;

      const elapsedSec = getActiveElapsedPlayMs() / 1000;
      const minGate = currentSession.minimumGateSec;

      if (currentSession.videoDurationSec && currentSession.videoDurationSec > 0) {
        if (elapsedSec >= Math.min(minGate, currentSession.videoDurationSec - 0.2)) {
          currentSession.gateUnlocked = true;
          return true;
        }
      }

      if (elapsedSec >= minGate) {
        currentSession.gateUnlocked = true;
        return true;
      }

      return false;
    }

    function recordEarlyScrollAttempt() {
      if (!currentSession) return;
      currentSession.earlyScrollAttempts += 1;
      const now = Date.now();
      if (now - lastAttemptTimestamp > 800) {
        lastAttemptTimestamp = now;
        showGentleMessage();
      }
    }

    // Scroll & Keyboard Interception
    function handleWheel(e: WheelEvent) {
      if (!ensureContextValid()) return;
      if (!isInstagramReelUrl() || !currentSession) return;
      if (isInsideEngagementOrComments(e.target)) return;

      if (Math.abs(e.deltaY) > 8 && !isGateSatisfied()) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        recordEarlyScrollAttempt();
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (!ensureContextValid()) return;
      if (!isInstagramReelUrl() || !currentSession) return;
      if (isInsideEngagementOrComments(e.target)) return;

      if (['ArrowDown', 'PageDown', 'j', 'J'].includes(e.key)) {
        if (!isGateSatisfied()) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          recordEarlyScrollAttempt();
        }
      }
    }

    // Touch Swipe Interception
    let touchStartY = 0;
    let touchStartX = 0;

    function handleTouchStart(e: TouchEvent) {
      if (!ensureContextValid()) return;
      if (e.touches && e.touches[0]) {
        touchStartY = e.touches[0].clientY;
        touchStartX = e.touches[0].clientX;
      }
    }

    function handleTouchMove(e: TouchEvent) {
      if (!ensureContextValid()) return;
      if (!isInstagramReelUrl() || !currentSession) return;
      if (isInsideEngagementOrComments(e.target)) return;

      if (e.touches && e.touches[0]) {
        const deltaY = touchStartY - e.touches[0].clientY;
        const deltaX = Math.abs(touchStartX - e.touches[0].clientX);

        // Vertical swipe up to go to next reel
        if (deltaY > 15 && deltaY > deltaX && !isGateSatisfied()) {
          if (e.cancelable) {
            e.preventDefault();
          }
          recordEarlyScrollAttempt();
        }
      }
    }

    // Floating Focus Progress Widget for Instagram
    function updateFloatingWidget() {
      let widget = document.getElementById('focusscroll-ig-widget');
      if (!isInstagramReelUrl() || !currentSession || userSettingsCache.enableInstagram === false) {
        if (widget) widget.style.display = 'none';
        return;
      }

      if (!widget) {
        widget = document.createElement('div');
        widget.id = 'focusscroll-ig-widget';
        Object.assign(widget.style, {
          position: 'fixed',
          top: '20px',
          right: '24px',
          backgroundColor: 'rgba(15, 23, 42, 0.88)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          borderRadius: '9999px',
          padding: '5px 12px 5px 8px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.5)',
          backdropFilter: 'blur(8px)',
          webkitBackdropFilter: 'blur(8px)',
          zIndex: '2147483640',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          fontSize: '11px',
          color: '#e2e8f0',
          pointerEvents: 'none',
          userSelect: 'none',
          transition: 'all 0.2s ease',
        });
        (document.body || document.documentElement).appendChild(widget);
      }

      widget.style.display = 'flex';
      const elapsedSec = getActiveElapsedPlayMs() / 1000;
      const targetSec = currentSession.currentTargetSec;
      const gateSec = currentSession.minimumGateSec;
      const isUnlocked = isGateSatisfied();

      const progressRatio = Math.min(1, elapsedSec / targetSec);
      const strokeDashoffset = 38 - progressRatio * 38;

      widget.innerHTML = `
        <div style="position: relative; width: 16px; height: 16px; display: flex; align-items: center; justify-content: center;">
          <svg width="16" height="16" viewBox="0 0 16 16" style="transform: rotate(-90deg);">
            <circle cx="8" cy="8" r="6" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="2" />
            <circle cx="8" cy="8" r="6" fill="none" stroke="${isUnlocked ? '#34d399' : '#22d3ee'}" stroke-width="2"
              stroke-dasharray="38" stroke-dashoffset="${strokeDashoffset}" stroke-linecap="round" />
          </svg>
        </div>
        <span style="font-weight: 600; color: ${isUnlocked ? '#34d399' : '#f8fafc'};">
          ${Math.floor(elapsedSec)}s / ${targetSec}s
        </span>
        <span style="font-size: 9.5px; opacity: 0.75; margin-left: 2px;">
          ${isUnlocked ? '✓ Ready' : `(${Math.max(1, Math.ceil(gateSec - elapsedSec))}s gate)`}
        </span>
      `;
    }

    // Video Lifecycle Handling
    function handleVideoPlay() {
      if (!currentSession) return;
      currentSession.isPlaying = true;
      currentSession.lastPlayStartTime = Date.now();
    }

    function handleVideoPause() {
      if (!currentSession) return;
      if (currentSession.isPlaying && currentSession.lastPlayStartTime !== null) {
        currentSession.accumulatedPlayMs += Date.now() - currentSession.lastPlayStartTime;
      }
      currentSession.isPlaying = false;
      currentSession.lastPlayStartTime = null;
    }

    function handleVideoEnded() {
      if (!currentSession) return;
      handleVideoPause();
      currentSession.gateUnlocked = true;
    }

    function bindActiveVideo(video: HTMLVideoElement | null) {
      if (activeVideoEl === video) return;
      if (activeVideoEl) {
        activeVideoEl.removeEventListener('play', handleVideoPlay);
        activeVideoEl.removeEventListener('playing', handleVideoPlay);
        activeVideoEl.removeEventListener('pause', handleVideoPause);
        activeVideoEl.removeEventListener('ended', handleVideoEnded);
      }

      activeVideoEl = video;

      if (activeVideoEl) {
        activeVideoEl.addEventListener('play', handleVideoPlay);
        activeVideoEl.addEventListener('playing', handleVideoPlay);
        activeVideoEl.addEventListener('pause', handleVideoPause);
        activeVideoEl.addEventListener('ended', handleVideoEnded);

        if (!activeVideoEl.paused) {
          handleVideoPlay();
        }
      }
    }

    function finalizeCurrentSession() {
      if (!currentSession) return;
      handleVideoPause();

      const dwellMs = currentSession.accumulatedPlayMs;
      if (dwellMs >= 300) {
        const finishedSession = { ...currentSession };
        const endedAt = Date.now();
        const ev: ShortViewEvent = {
          id: finishedSession.id,
          videoId: finishedSession.reelId,
          url: finishedSession.url,
          startedAt: finishedSession.startedAt,
          endedAt,
          dwellMs,
          timestamp: new Date(endedAt).toISOString(),
          calibration: finishedSession.calibration,
          currentTargetSec: finishedSession.currentTargetSec,
          minimumGateSec: finishedSession.minimumGateSec,
          earlyScrollAttempts: finishedSession.earlyScrollAttempts,
          gateUnlocked: finishedSession.gateUnlocked || (dwellMs / 1000 >= finishedSession.minimumGateSec),
        };

        saveShortViewEvent(ev).then(() => {
          log(`Instagram Reel view saved: ${finishedSession.reelId} (${(dwellMs / 1000).toFixed(1)}s)`);
        });
      }
      currentSession = null;
    }

    function checkActiveReel() {
      if (!ensureContextValid()) return;
      if (!isInstagramReelUrl()) {
        if (currentSession) finalizeCurrentSession();
        updateFloatingWidget();
        return;
      }

      const currentReelId = getReelIdFromUrl();
      const allVideos = Array.from(document.querySelectorAll('video')) as HTMLVideoElement[];
      // Find playing or visible video
      let bestVideo: HTMLVideoElement | null = null;
      for (const v of allVideos) {
        const rect = v.getBoundingClientRect();
        if (rect.width > 100 && rect.height > 100 && rect.top < window.innerHeight && rect.bottom > 0) {
          if (!v.paused || !bestVideo) {
            bestVideo = v;
          }
        }
      }

      if (currentReelId && currentReelId !== lastHandledReelId) {
        if (currentSession) finalizeCurrentSession();

        lastHandledReelId = currentReelId;
        const calibInfo = getCalibrationInfo(storedEventsCache, userSettingsCache);
        const isCalib = !calibInfo.isCalibrated;
        const now = Date.now();

        currentSession = {
          id: `${currentReelId}-${now}`,
          reelId: currentReelId,
          url: window.location.href,
          startedAt: now,
          accumulatedPlayMs: 0,
          lastPlayStartTime: bestVideo && !bestVideo.paused ? now : null,
          isPlaying: Boolean(bestVideo && !bestVideo.paused),
          videoDurationSec: bestVideo && isFinite(bestVideo.duration) ? bestVideo.duration : null,
          calibration: isCalib,
          currentTargetSec: calibInfo.currentTargetSec,
          minimumGateSec: calibInfo.minimumGateSec,
          earlyScrollAttempts: 0,
          gateUnlocked: false,
        };

        log(`New Reel active: ${currentReelId} (Target: ${currentSession.currentTargetSec}s, Gate: ${currentSession.minimumGateSec}s)`);
      }

      bindActiveVideo(bestVideo);
      updateFloatingWidget();
    }

    // Attach Event Listeners
    window.addEventListener('wheel', handleWheel, { capture: true, passive: false });
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    window.addEventListener('touchstart', handleTouchStart, { capture: true, passive: true });
    window.addEventListener('touchmove', handleTouchMove, { capture: true, passive: false });

    pollInterval = setInterval(checkActiveReel, 500);

    domObserver = new MutationObserver(() => {
      checkActiveReel();
    });
    domObserver.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true,
    });

    window.addEventListener('beforeunload', () => {
      finalizeCurrentSession();
    });

    function cleanup() {
      isTerminated = true;
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
      if (domObserver) {
        domObserver.disconnect();
        domObserver = null;
      }
      if (unsubsStorage) {
        unsubsStorage();
        unsubsStorage = null;
      }
      if (unsubsSettings) {
        unsubsSettings();
        unsubsSettings = null;
      }
      bindActiveVideo(null);
      window.removeEventListener('wheel', handleWheel, { capture: true });
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
      window.removeEventListener('touchstart', handleTouchStart, { capture: true });
      window.removeEventListener('touchmove', handleTouchMove, { capture: true });
      const widget = document.getElementById('focusscroll-ig-widget');
      if (widget) widget.remove();
      const ind = document.getElementById('focusscroll-ig-indicator');
      if (ind) ind.remove();
    }
  },
});
