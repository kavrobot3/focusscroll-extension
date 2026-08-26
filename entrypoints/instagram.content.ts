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
  lastVideoCurrentTime: number;
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

    log('Extension loaded on Instagram (Optimized & Non-Blocking)');

    let isTerminated = false;
    let currentSession: ActiveReelSession | null = null;
    let lastHandledReelId: string | null = null;
    let activeVideoEl: HTMLVideoElement | null = null;
    let storedEventsCache: ShortViewEvent[] = [];
    let userSettingsCache: FocusSettings = DEFAULT_FOCUS_SETTINGS;
    let pollInterval: ReturnType<typeof setInterval> | null = null;
    let unsubsStorage: (() => void) | null = null;
    let unsubsSettings: (() => void) | null = null;
    let lastAttemptTimestamp = 0;

    // Cache initial data
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

    // Gentle Indicator Element (Reusable single DOM element)
    let indicatorEl: HTMLElement | null = null;
    let indicatorTimeout: ReturnType<typeof setTimeout> | null = null;

    function getOrCreateIndicator(): HTMLElement {
      if (!indicatorEl || !indicatorEl.isConnected) {
        indicatorEl = document.getElementById('focusscroll-ig-indicator');
        if (!indicatorEl) {
          indicatorEl = document.createElement('div');
          indicatorEl.id = 'focusscroll-ig-indicator';
          Object.assign(indicatorEl.style, {
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
          (document.body || document.documentElement).appendChild(indicatorEl);
        }
      }
      return indicatorEl;
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
        if (el) {
          el.style.opacity = '0';
          el.style.transform = 'translateX(-50%) translateY(8px)';
        }
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
        if (el) {
          el.style.opacity = '0';
          el.style.transform = 'translateX(-50%) translateY(8px)';
        }
      }, 1000);
    }

    // Engagement & Comments Whitelisting
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

    // Scroll & Keyboard Interception with instant fast-path
    function handleWheel(e: WheelEvent) {
      if (!userSettingsCache.enableInstagram) return;
      if (!currentSession || currentSession.gateUnlocked) return;
      if (Math.abs(e.deltaY) <= 8) return;
      if (!ensureContextValid() || !isInstagramReelUrl()) return;
      if (isInsideEngagementOrComments(e.target)) return;

      if (!isGateSatisfied()) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        recordEarlyScrollAttempt();
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (!userSettingsCache.enableInstagram) return;
      if (!currentSession || currentSession.gateUnlocked) return;
      if (!['ArrowDown', 'PageDown', 'j', 'J'].includes(e.key)) return;
      if (!ensureContextValid() || !isInstagramReelUrl()) return;
      if (isInsideEngagementOrComments(e.target)) return;

      if (!isGateSatisfied()) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        recordEarlyScrollAttempt();
      }
    }

    // Touch Swipe Interception with instant fast-path
    let touchStartY = 0;
    let touchStartX = 0;

    function handleTouchStart(e: TouchEvent) {
      if (e.touches && e.touches[0]) {
        touchStartY = e.touches[0].clientY;
        touchStartX = e.touches[0].clientX;
      }
    }

    function handleTouchMove(e: TouchEvent) {
      if (!userSettingsCache.enableInstagram) return;
      if (!currentSession || currentSession.gateUnlocked) return;
      if (!ensureContextValid() || !isInstagramReelUrl()) return;

      if (e.touches && e.touches[0]) {
        const deltaY = touchStartY - e.touches[0].clientY;
        const deltaX = Math.abs(touchStartX - e.touches[0].clientX);

        if (deltaY > 15 && deltaY > deltaX) {
          if (isInsideEngagementOrComments(e.target)) return;
          if (!isGateSatisfied()) {
            if (e.cancelable) {
              e.preventDefault();
            }
            recordEarlyScrollAttempt();
          }
        }
      }
    }

    // Cached Floating Progress Widget
    let widgetEl: HTMLElement | null = null;
    let widgetCircle: SVGCircleElement | null = null;
    let widgetTimeSpan: HTMLSpanElement | null = null;
    let widgetGateSpan: HTMLSpanElement | null = null;

    function createWidgetDom(): HTMLElement {
      const widget = document.createElement('div');
      widget.id = 'focusscroll-ig-widget';
      Object.assign(widget.style, {
        position: 'fixed',
        top: '20px',
        right: '24px',
        backgroundColor: 'rgba(15, 23, 42, 0.88)',
        border: '1px solid rgba(255, 255, 255, 0.12)',
        borderRadius: '9999px',
        padding: '5px 12px 5px 8px',
        display: 'none',
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
      });

      const iconBox = document.createElement('div');
      Object.assign(iconBox.style, {
        position: 'relative',
        width: '16px',
        height: '16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      });

      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', '16');
      svg.setAttribute('height', '16');
      svg.setAttribute('viewBox', '0 0 16 16');
      svg.style.transform = 'rotate(-90deg)';

      const bgCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      bgCircle.setAttribute('cx', '8');
      bgCircle.setAttribute('cy', '8');
      bgCircle.setAttribute('r', '6');
      bgCircle.setAttribute('fill', 'none');
      bgCircle.setAttribute('stroke', 'rgba(255,255,255,0.15)');
      bgCircle.setAttribute('stroke-width', '2');

      const progressCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      progressCircle.setAttribute('cx', '8');
      progressCircle.setAttribute('cy', '8');
      progressCircle.setAttribute('r', '6');
      progressCircle.setAttribute('fill', 'none');
      progressCircle.setAttribute('stroke', '#22d3ee');
      progressCircle.setAttribute('stroke-width', '2');
      progressCircle.setAttribute('stroke-dasharray', '38');
      progressCircle.setAttribute('stroke-dashoffset', '38');
      progressCircle.setAttribute('stroke-linecap', 'round');

      svg.appendChild(bgCircle);
      svg.appendChild(progressCircle);
      iconBox.appendChild(svg);

      const timeSpan = document.createElement('span');
      timeSpan.style.fontWeight = '600';
      timeSpan.style.color = '#f8fafc';

      const gateSpan = document.createElement('span');
      gateSpan.style.fontSize = '9.5px';
      gateSpan.style.opacity = '0.75';
      gateSpan.style.marginLeft = '2px';

      widget.appendChild(iconBox);
      widget.appendChild(timeSpan);
      widget.appendChild(gateSpan);

      (document.body || document.documentElement).appendChild(widget);

      widgetEl = widget;
      widgetCircle = progressCircle;
      widgetTimeSpan = timeSpan;
      widgetGateSpan = gateSpan;

      return widget;
    }

    function updateFloatingWidget() {
      if (!isInstagramReelUrl() || !currentSession || userSettingsCache.enableInstagram === false) {
        if (widgetEl) widgetEl.style.display = 'none';
        return;
      }

      if (!widgetEl || !widgetEl.isConnected) {
        createWidgetDom();
      }

      if (!widgetEl || !widgetCircle || !widgetTimeSpan || !widgetGateSpan) return;

      widgetEl.style.display = 'flex';
      const elapsedSec = getActiveElapsedPlayMs() / 1000;
      const targetSec = currentSession.currentTargetSec;
      const gateSec = currentSession.minimumGateSec;
      const isUnlocked = isGateSatisfied();

      const progressRatio = Math.min(1, elapsedSec / targetSec);
      const strokeDashoffset = 38 - progressRatio * 38;

      widgetCircle.setAttribute('stroke', isUnlocked ? '#34d399' : '#22d3ee');
      widgetCircle.setAttribute('stroke-dashoffset', strokeDashoffset.toFixed(1));

      widgetTimeSpan.style.color = isUnlocked ? '#34d399' : '#f8fafc';
      widgetTimeSpan.textContent = `${Math.floor(elapsedSec)}s / ${targetSec}s`;

      widgetGateSpan.textContent = isUnlocked
        ? '✓ Ready'
        : `(${Math.max(1, Math.ceil(gateSec - elapsedSec))}s gate)`;
    }

    // Finalize session & record event
    function finalizeCurrentSession() {
      if (!currentSession) return;
      if (currentSession.isPlaying && currentSession.lastPlayStartTime !== null) {
        currentSession.accumulatedPlayMs += Date.now() - currentSession.lastPlayStartTime;
        currentSession.isPlaying = false;
        currentSession.lastPlayStartTime = null;
      }

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

    // Event-driven video playback tracking (zero DOM queries or getBoundingClientRect reflows)
    function handleGlobalPlay(e: Event) {
      const target = e.target;
      if (!(target instanceof HTMLVideoElement)) return;
      if (!isInstagramReelUrl()) return;

      activeVideoEl = target;
      if (currentSession) {
        currentSession.isPlaying = true;
        currentSession.lastPlayStartTime = Date.now();
        if (target.duration && isFinite(target.duration) && target.duration > 0) {
          currentSession.videoDurationSec = target.duration;
        }
      }
    }

    function handleGlobalPause(e: Event) {
      const target = e.target;
      if (!(target instanceof HTMLVideoElement)) return;
      if (target === activeVideoEl && currentSession) {
        if (currentSession.isPlaying && currentSession.lastPlayStartTime !== null) {
          currentSession.accumulatedPlayMs += Date.now() - currentSession.lastPlayStartTime;
        }
        currentSession.isPlaying = false;
        currentSession.lastPlayStartTime = null;
      }
    }

    function handleGlobalTimeUpdate(e: Event) {
      const target = e.target;
      if (!(target instanceof HTMLVideoElement)) return;
      if (target !== activeVideoEl || !currentSession) return;

      const duration = target.duration;
      const currentTime = target.currentTime;

      if (duration && isFinite(duration) && duration > 0) {
        currentSession.videoDurationSec = duration;

        // Loop detection
        if (currentTime >= duration - 0.4 || target.ended) {
          currentSession.gateUnlocked = true;
        }
        if (currentSession.lastVideoCurrentTime > Math.max(1, duration - 1.5) && currentTime < 0.8) {
          currentSession.gateUnlocked = true;
        }
      }

      currentSession.lastVideoCurrentTime = currentTime;

      // Check gate elapsed time
      if (!currentSession.gateUnlocked) {
        const elapsedSec = getActiveElapsedPlayMs() / 1000;
        if (elapsedSec >= currentSession.minimumGateSec) {
          currentSession.gateUnlocked = true;
        }
      }
    }

    function handleGlobalEnded(e: Event) {
      const target = e.target;
      if (!(target instanceof HTMLVideoElement)) return;
      if (target === activeVideoEl && currentSession) {
        handleGlobalPause(e);
        currentSession.gateUnlocked = true;
      }
    }

    // Lightweight Reel change checker
    function checkReelState() {
      if (!ensureContextValid()) return;

      if (!isInstagramReelUrl()) {
        if (currentSession) {
          finalizeCurrentSession();
          lastHandledReelId = null;
          activeVideoEl = null;
        }
        updateFloatingWidget();
        return;
      }

      const currentReelId = getReelIdFromUrl();
      if (currentReelId && currentReelId !== lastHandledReelId) {
        if (currentSession) finalizeCurrentSession();

        lastHandledReelId = currentReelId;
        const calibInfo = getCalibrationInfo(storedEventsCache, userSettingsCache);
        const isCalib = !calibInfo.isCalibrated;
        const now = Date.now();

        // Check if there's an already playing video
        const isPlaying = Boolean(activeVideoEl && !activeVideoEl.paused);
        const videoDurationSec = activeVideoEl && isFinite(activeVideoEl.duration) ? activeVideoEl.duration : null;

        currentSession = {
          id: `${currentReelId}-${now}`,
          reelId: currentReelId,
          url: window.location.href,
          startedAt: now,
          accumulatedPlayMs: 0,
          lastPlayStartTime: isPlaying ? now : null,
          isPlaying,
          videoDurationSec,
          lastVideoCurrentTime: 0,
          calibration: isCalib,
          currentTargetSec: calibInfo.currentTargetSec,
          minimumGateSec: calibInfo.minimumGateSec,
          earlyScrollAttempts: 0,
          gateUnlocked: false,
        };

        log(`New Reel active: ${currentReelId} (Target: ${currentSession.currentTargetSec}s, Gate: ${currentSession.minimumGateSec}s)`);
      }

      updateFloatingWidget();
    }

    // Attach Capture Listeners for high-performance event tracking
    document.addEventListener('play', handleGlobalPlay, true);
    document.addEventListener('pause', handleGlobalPause, true);
    document.addEventListener('timeupdate', handleGlobalTimeUpdate, true);
    document.addEventListener('ended', handleGlobalEnded, true);

    window.addEventListener('wheel', handleWheel, { capture: true, passive: false });
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    window.addEventListener('touchstart', handleTouchStart, { capture: true, passive: true });
    window.addEventListener('touchmove', handleTouchMove, { capture: true, passive: false });

    // Navigation & History listeners
    window.addEventListener('popstate', checkReelState, { passive: true });
    window.addEventListener('hashchange', checkReelState, { passive: true });

    // Low-frequency lightweight ticker (300ms) for URL changes and widget updates
    pollInterval = setInterval(checkReelState, 300);

    // Initial check
    checkReelState();

    window.addEventListener('beforeunload', () => {
      finalizeCurrentSession();
    });

    function cleanup() {
      isTerminated = true;
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
      if (unsubsStorage) {
        unsubsStorage();
        unsubsStorage = null;
      }
      if (unsubsSettings) {
        unsubsSettings();
        unsubsSettings = null;
      }

      document.removeEventListener('play', handleGlobalPlay, true);
      document.removeEventListener('pause', handleGlobalPause, true);
      document.removeEventListener('timeupdate', handleGlobalTimeUpdate, true);
      document.removeEventListener('ended', handleGlobalEnded, true);

      window.removeEventListener('wheel', handleWheel, { capture: true });
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
      window.removeEventListener('touchstart', handleTouchStart, { capture: true });
      window.removeEventListener('touchmove', handleTouchMove, { capture: true });
      window.removeEventListener('popstate', checkReelState);
      window.removeEventListener('hashchange', checkReelState);

      if (widgetEl) {
        widgetEl.remove();
        widgetEl = null;
      }
      if (indicatorEl) {
        indicatorEl.remove();
        indicatorEl = null;
      }
    }
  },
});

