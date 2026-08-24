import { getCalibrationInfo, getShortViewEvents, isExtensionContextValid, onStorageChanged, saveShortViewEvent } from '@/utils/storage';
import type { ShortViewEvent } from '@/utils/types';

interface ActiveShortSession {
  id: string;
  videoId: string | null;
  url: string;
  startedAt: number;
  accumulatedPlayMs: number;
  lastPlayStartTime: number | null;
  isPlaying: boolean;
  videoDurationSec: number | null;
  hasCompletedFullLoop: boolean;
  calibration: boolean;
  currentTargetSec: number | null;
  minimumGateSec: number | null;
  earlyScrollAttempts: number;
  gateUnlocked: boolean;
}

export default defineContentScript({
  matches: [
    'https://www.youtube.com/*',
    'https://youtube.com/*',
  ],
  runAt: 'document_idle',
  main() {
    function log(message: string, ...args: unknown[]) {
      console.log(
        `%c[FocusScroll]%c ${message}`,
        'background: #0891b2; color: #ffffff; padding: 2px 6px; border-radius: 4px; font-weight: bold;',
        'color: #06b6d4; font-weight: 600;',
        ...args
      );
    }

    log('Extension loaded on YouTube (Gentle Intervention Mode)');

    let isTerminated = false;
    let currentSession: ActiveShortSession | null = null;
    let lastHandledVideoId: string | null = null;
    let storedEventsCache: ShortViewEvent[] = [];
    let activeVideoEl: HTMLVideoElement | null = null;
    let lastVideoCurrentTime = 0;
    let pollInterval: ReturnType<typeof setInterval> | null = null;
    let domObserver: MutationObserver | null = null;
    let unsubsStorage: (() => void) | null = null;

    // Initialize events cache and listen for updates safely
    getShortViewEvents().then((events) => {
      if (!isTerminated) {
        storedEventsCache = events;
      }
    });

    unsubsStorage = onStorageChanged((events) => {
      if (!isTerminated) {
        storedEventsCache = events;
      }
    });

    /**
     * Check context and cleanly terminate if extension was reloaded / invalidated
     */
    function ensureContextValid(): boolean {
      if (isTerminated) return false;
      if (!isExtensionContextValid()) {
        cleanup();
        return false;
      }
      return true;
    }

    /**
     * Subtle cyan message indicator overlay (“Stay a little longer…”)
     */
    let indicatorTimeout: ReturnType<typeof setTimeout> | null = null;

    function getOrCreateIndicator(): HTMLElement {
      let el = document.getElementById('focusscroll-gentle-indicator');
      if (!el) {
        el = document.createElement('div');
        el.id = 'focusscroll-gentle-indicator';
        el.textContent = 'Stay a little longer…';
        Object.assign(el.style, {
          position: 'fixed',
          bottom: '76px',
          left: '50%',
          transform: 'translateX(-50%) translateY(8px)',
          backgroundColor: 'rgba(15, 23, 42, 0.88)',
          color: '#22d3ee',
          border: '1px solid rgba(6, 182, 212, 0.4)',
          borderRadius: '9999px',
          padding: '7px 18px',
          fontSize: '13px',
          fontWeight: '500',
          letterSpacing: '0.01em',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5), 0 0 12px rgba(6, 182, 212, 0.25)',
          backdropFilter: 'blur(8px)',
          webkitBackdropFilter: 'blur(8px)',
          pointerEvents: 'none',
          zIndex: '2147483647',
          opacity: '0',
          transition: 'opacity 0.25s cubic-bezier(0.16, 1, 0.3, 1), transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        });
        document.body.appendChild(el);
      }
      return el;
    }

    function showGentleMessage() {
      const el = getOrCreateIndicator();
      el.style.opacity = '1';
      el.style.transform = 'translateX(-50%) translateY(0px)';

      if (indicatorTimeout) {
        clearTimeout(indicatorTimeout);
      }

      indicatorTimeout = setTimeout(() => {
        el.style.opacity = '0';
        el.style.transform = 'translateX(-50%) translateY(8px)';
      }, 1600);
    }

    /**
     * Check if active video or renderer is an advertisement
     */
    function isAdActive(): boolean {
      // 1. YouTube Player Ad classes
      const player = document.querySelector('.html5-video-player');
      if (player && (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting'))) {
        return true;
      }

      // 2. Active Reel Video Renderer Ad attributes & elements
      const activeRenderer =
        document.querySelector('ytd-reel-video-renderer[is-active]') ||
        document.querySelector('ytd-reel-video-renderer[active]') ||
        document.querySelector('ytd-reel-video-renderer:not([aria-hidden="true"])');

      if (activeRenderer) {
        if (
          activeRenderer.hasAttribute('is-ad') ||
          activeRenderer.getAttribute('is-ad') === 'true' ||
          activeRenderer.classList.contains('ytd-shorts-ad-renderer')
        ) {
          return true;
        }

        // Check for ad badges or sponsored labels in active renderer
        const adElements = activeRenderer.querySelectorAll(
          'ytd-ad-badge-renderer, ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer, .ytd-reel-ad-header-renderer, .ytp-ad-badge, .ytp-ad-text, [aria-label*="Sponsored"], [aria-label*="Promoted"]'
        );
        if (adElements.length > 0) {
          return true;
        }

        const badgeText = activeRenderer.querySelector('#channel-name, .ytd-channel-name, #text-container');
        if (badgeText && /^(sponsored|ad|promoted)$/i.test(badgeText.textContent?.trim() || '')) {
          return true;
        }
      }

      // 3. Global ad overlay checks
      const adOverlay = document.querySelector('.ytp-ad-player-overlay, .ytp-ad-overlay-container');
      if (adOverlay && (adOverlay as HTMLElement).offsetParent !== null) {
        return true;
      }

      return false;
    }

    /**
     * Calculate active elapsed playback milliseconds
     */
    function getActiveElapsedPlayMs(): number {
      if (!currentSession) return 0;
      let total = currentSession.accumulatedPlayMs;
      if (currentSession.isPlaying && currentSession.lastPlayStartTime) {
        total += Date.now() - currentSession.lastPlayStartTime;
      }
      // If short has completed a full loop, cap the active play timer at the video duration
      if (currentSession.hasCompletedFullLoop && currentSession.videoDurationSec && currentSession.videoDurationSec > 0) {
        const maxDurationMs = Math.round(currentSession.videoDurationSec * 1000);
        return Math.min(total, maxDurationMs);
      }
      return total;
    }

    /**
     * Check if the gate is currently active and blocking navigation to the next short
     */
    function isGateActive(): boolean {
      if (!currentSession) return false;
      if (currentSession.calibration) return false;
      if (currentSession.gateUnlocked) return false;

      // 1. Never restrict scrolling on ads or sponsored content
      if (isAdActive()) {
        currentSession.gateUnlocked = true;
        return false;
      }

      // 2. Allow user to scroll if more than 4 times attempted to skip
      if (currentSession.earlyScrollAttempts >= 4) {
        currentSession.gateUnlocked = true;
        return false;
      }

      // 3. If short has already completed full watch or looped, gate is immediately unlocked
      if (currentSession.hasCompletedFullLoop) {
        currentSession.gateUnlocked = true;
        return false;
      }

      // 4. Check active video element directly
      const video = getActiveVideoElement();
      if (video) {
        if (video.ended) {
          currentSession.hasCompletedFullLoop = true;
          currentSession.gateUnlocked = true;
          return false;
        }

        const duration = video.duration;
        if (duration && !isNaN(duration) && duration > 0) {
          currentSession.videoDurationSec = duration;

          // If video reached end of playback
          if (video.currentTime >= duration - 0.4) {
            currentSession.hasCompletedFullLoop = true;
            currentSession.gateUnlocked = true;
            return false;
          }

          // If target or minimum gate > short length:
          // Effective gate must never exceed the video length
          const effectiveGateSec = Math.min(
            currentSession.minimumGateSec ?? 2,
            Math.max(1, duration - 0.2)
          );

          const activePlaySec = getActiveElapsedPlayMs() / 1000;
          if (activePlaySec >= effectiveGateSec) {
            currentSession.gateUnlocked = true;
            return false;
          }

          return true;
        }
      }

      const minGate = currentSession.minimumGateSec ?? 2;
      const elapsedSec = getActiveElapsedPlayMs() / 1000;

      if (elapsedSec >= minGate) {
        currentSession.gateUnlocked = true;
        return false;
      }

      return true;
    }

    /**
     * Extract Video ID from a URL string
     */
    function extractShortsVideoIdFromUrl(urlStr: string): string | null {
      try {
        const url = new URL(urlStr, window.location.origin);
        if (url.pathname.includes('/shorts/')) {
          const match = url.pathname.match(/\/shorts\/([a-zA-Z0-9_-]+)/);
          if (match && match[1]) {
            return match[1];
          }
        }
      } catch {
        const match = urlStr.match(/\/shorts\/([a-zA-Z0-9_-]+)/);
        if (match && match[1]) {
          return match[1];
        }
      }
      return null;
    }

    /**
     * Inspect active DOM element on YouTube Shorts to retrieve current active Short video ID
     */
    function extractShortsVideoIdFromDom(): string | null {
      const activeRenderer =
        document.querySelector('ytd-reel-video-renderer[is-active]') ||
        document.querySelector('ytd-reel-video-renderer[active]') ||
        document.querySelector('ytd-reel-video-renderer:not([aria-hidden="true"])');

      if (activeRenderer) {
        const attrId =
          activeRenderer.getAttribute('video-id') ||
          activeRenderer.getAttribute('data-video-id') ||
          activeRenderer.getAttribute('id');
        if (attrId && attrId !== 'shorts-player' && !attrId.startsWith('ytd-')) {
          return attrId;
        }

        const link = activeRenderer.querySelector('a[href*="/shorts/"]');
        if (link) {
          const href = link.getAttribute('href');
          if (href) {
            const extracted = extractShortsVideoIdFromUrl(href);
            if (extracted) return extracted;
          }
        }

        const video = activeRenderer.querySelector('video');
        if (video) {
          const fromUrl = extractShortsVideoIdFromUrl(window.location.href);
          if (fromUrl) return fromUrl;
        }
      }

      return null;
    }

    /**
     * Find active <video> element on the page
     */
    function getActiveVideoElement(): HTMLVideoElement | null {
      const activeRenderer =
        document.querySelector('ytd-reel-video-renderer[is-active]') ||
        document.querySelector('ytd-reel-video-renderer[active]') ||
        document.querySelector('ytd-reel-video-renderer:not([aria-hidden="true"])');

      if (activeRenderer) {
        const video = activeRenderer.querySelector('video');
        if (video) return video;
      }

      return document.querySelector('video');
    }

    /**
     * Video Event Handlers for active playback & loop detection
     */
    function handleVideoPlay() {
      if (!currentSession) return;
      if (!currentSession.isPlaying) {
        currentSession.isPlaying = true;
        currentSession.lastPlayStartTime = Date.now();
      }
    }

    function handleVideoPause() {
      if (!currentSession) return;
      if (currentSession.isPlaying) {
        if (currentSession.lastPlayStartTime) {
          currentSession.accumulatedPlayMs += Date.now() - currentSession.lastPlayStartTime;
        }
        currentSession.isPlaying = false;
        currentSession.lastPlayStartTime = null;
      }
    }

    function handleVideoEnded() {
      if (!currentSession) return;
      currentSession.hasCompletedFullLoop = true;
      currentSession.gateUnlocked = true;
    }

    function handleVideoTimeUpdate() {
      if (!currentSession || !activeVideoEl) return;

      const duration = activeVideoEl.duration;
      const currentTime = activeVideoEl.currentTime;

      if (duration && !isNaN(duration) && duration > 0) {
        currentSession.videoDurationSec = duration;

        // 1. Reached end of video
        if (currentTime >= duration - 0.4 || activeVideoEl.ended) {
          currentSession.hasCompletedFullLoop = true;
          currentSession.gateUnlocked = true;
        }

        // 2. Loop detected (currentTime jumped from near end back to start)
        if (lastVideoCurrentTime > Math.max(1, duration - 1.5) && currentTime < 1.0) {
          currentSession.hasCompletedFullLoop = true;
          currentSession.gateUnlocked = true;
        }
      }

      lastVideoCurrentTime = currentTime;
    }

    function bindActiveVideo(video: HTMLVideoElement | null) {
      if (activeVideoEl === video) {
        if (video && currentSession) {
          // Sync play state
          if (!video.paused && !currentSession.isPlaying) {
            handleVideoPlay();
          } else if (video.paused && currentSession.isPlaying) {
            handleVideoPause();
          }
        }
        return;
      }

      if (activeVideoEl) {
        activeVideoEl.removeEventListener('play', handleVideoPlay);
        activeVideoEl.removeEventListener('playing', handleVideoPlay);
        activeVideoEl.removeEventListener('pause', handleVideoPause);
        activeVideoEl.removeEventListener('ended', handleVideoEnded);
        activeVideoEl.removeEventListener('timeupdate', handleVideoTimeUpdate);
        activeVideoEl.removeEventListener('waiting', handleVideoPause);
      }

      activeVideoEl = video;
      lastVideoCurrentTime = 0;

      if (activeVideoEl) {
        activeVideoEl.addEventListener('play', handleVideoPlay);
        activeVideoEl.addEventListener('playing', handleVideoPlay);
        activeVideoEl.addEventListener('pause', handleVideoPause);
        activeVideoEl.addEventListener('ended', handleVideoEnded);
        activeVideoEl.addEventListener('timeupdate', handleVideoTimeUpdate);
        activeVideoEl.addEventListener('waiting', handleVideoPause);

        if (currentSession) {
          if (!activeVideoEl.paused) {
            currentSession.isPlaying = true;
            currentSession.lastPlayStartTime = Date.now();
          } else {
            currentSession.isPlaying = false;
            currentSession.lastPlayStartTime = null;
          }
          if (activeVideoEl.duration && !isNaN(activeVideoEl.duration)) {
            currentSession.videoDurationSec = activeVideoEl.duration;
          }
        }
      }
    }

    /**
     * Get the current active short ID using both URL and DOM inspections
     */
    function getActiveShortId(): { videoId: string | null; isShorts: boolean } {
      const isShortsUrl = window.location.pathname.startsWith('/shorts') || window.location.href.includes('/shorts');
      
      const idFromUrl = extractShortsVideoIdFromUrl(window.location.href);
      if (idFromUrl) {
        return { videoId: idFromUrl, isShorts: true };
      }

      if (isShortsUrl) {
        const idFromDom = extractShortsVideoIdFromDom();
        if (idFromDom) {
          return { videoId: idFromDom, isShorts: true };
        }
        return { videoId: null, isShorts: true };
      }

      return { videoId: null, isShorts: false };
    }

    /**
     * Finalize and persist current short viewing session
     */
    function finalizeCurrentSession() {
      if (!currentSession) return;

      // Sync active play time
      if (currentSession.isPlaying && currentSession.lastPlayStartTime) {
        currentSession.accumulatedPlayMs += Date.now() - currentSession.lastPlayStartTime;
        currentSession.isPlaying = false;
        currentSession.lastPlayStartTime = null;
      }

      const endedAt = Date.now();
      let dwellMs = currentSession.accumulatedPlayMs;

      // If short looped, cap dwell time at video duration so looping doesn't inflate timer
      if (currentSession.hasCompletedFullLoop && currentSession.videoDurationSec && currentSession.videoDurationSec > 0) {
        const maxDurationMs = Math.round(currentSession.videoDurationSec * 1000);
        dwellMs = Math.min(dwellMs, maxDurationMs);
      }

      // Ignore invalid events (< 500ms active dwell time)
      if (dwellMs >= 500 && currentSession.videoId) {
        const dwellSec = dwellMs / 1000;
        const gateUnlocked =
          currentSession.calibration ||
          currentSession.hasCompletedFullLoop ||
          (dwellSec >= (currentSession.minimumGateSec || 2));

        const event: ShortViewEvent = {
          id: currentSession.id,
          videoId: currentSession.videoId,
          url: currentSession.url,
          startedAt: currentSession.startedAt,
          endedAt,
          dwellMs,
          timestamp: new Date(endedAt).toISOString(),
          calibration: currentSession.calibration,
          currentTargetSec: currentSession.currentTargetSec,
          minimumGateSec: currentSession.minimumGateSec,
          earlyScrollAttempts: currentSession.earlyScrollAttempts,
          gateUnlocked,
        };

        saveShortViewEvent(event);
        log(
          `Event saved: #${event.videoId} (${(dwellMs / 1000).toFixed(1)}s active dwell, ` +
          `calib=${event.calibration}, earlyAttempts=${event.earlyScrollAttempts}, gateUnlocked=${gateUnlocked})`
        );
      } else if (currentSession.videoId) {
        log(`Ignored quick swipe (<500ms active): #${currentSession.videoId} (${dwellMs}ms)`);
      }

      currentSession = null;
    }

    /**
     * Process state check on active Short video
     */
    function checkShortState() {
      const { videoId, isShorts } = getActiveShortId();

      // If user is not on Shorts at all
      if (!isShorts) {
        if (currentSession) {
          log('User left YouTube Shorts');
          finalizeCurrentSession();
          lastHandledVideoId = null;
          bindActiveVideo(null);
        }
        return;
      }

      // If we are on Shorts, keep active video element bound
      const videoEl = getActiveVideoElement();
      bindActiveVideo(videoEl);

      // If we are on Shorts but haven't resolved a specific video ID yet
      if (!videoId) {
        return;
      }

      // If we are already tracking this exact video, nothing to do
      if (currentSession && videoId === lastHandledVideoId && currentSession.videoId === videoId) {
        return;
      }

      // If changing from another video, finalize previous
      if (currentSession) {
        finalizeCurrentSession();
      }

      // Calculate calibration & target configuration for this new Short
      const calibInfo = getCalibrationInfo(storedEventsCache);
      const isCalibration = !calibInfo.isCalibrated;
      const currentTargetSec = calibInfo.isCalibrated ? calibInfo.currentTargetSec : null;
      const minimumGateSec = calibInfo.isCalibrated ? calibInfo.minimumGateSec : null;

      // Start new short session
      lastHandledVideoId = videoId;
      const now = Date.now();
      const isPlaying = videoEl ? !videoEl.paused : true;
      const videoDurationSec = videoEl && videoEl.duration && !isNaN(videoEl.duration) ? videoEl.duration : null;

      currentSession = {
        id: `${videoId}-${now}-${Math.random().toString(36).slice(2, 7)}`,
        videoId,
        url: window.location.href,
        startedAt: now,
        accumulatedPlayMs: 0,
        lastPlayStartTime: isPlaying ? now : null,
        isPlaying,
        videoDurationSec,
        hasCompletedFullLoop: false,
        calibration: isCalibration,
        currentTargetSec,
        minimumGateSec,
        earlyScrollAttempts: 0,
        gateUnlocked: isCalibration, // Unlocked immediately during calibration
      };

      if (isCalibration) {
        log(`Active Short #${videoId} [Calibration ${calibInfo.calibrationCount + 1}/6]: Unrestricted`);
      } else {
        log(`Active Short #${videoId} [Intervention]: Gate ${minimumGateSec}s (Target: ${currentTargetSec}s)`);
      }
    }

    // 1. Initial check
    checkShortState();

    // 2. Intercept scrolling before gate unlocks
    function handleWheel(e: WheelEvent) {
      if (!ensureContextValid()) return;

      // deltaY > 0 indicates scrolling down towards next Short
      if (e.deltaY > 0 && isGateActive()) {
        if (currentSession) {
          currentSession.earlyScrollAttempts += 1;
          if (currentSession.earlyScrollAttempts > 4) {
            currentSession.gateUnlocked = true;
            return; // Allow scroll through
          }
        }

        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        showGentleMessage();
        return false;
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (!ensureContextValid()) return;

      // Do not intercept if user is typing into comments or search bar
      const activeEl = document.activeElement;
      if (
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          (activeEl as HTMLElement).isContentEditable ||
          activeEl.getAttribute('role') === 'textbox')
      ) {
        return;
      }

      // Next Short navigation keys: ArrowDown, PageDown, 'j'
      // Normal browser controls (Space/k for pause, ArrowUp/PageUp for previous, m for mute, etc.) remain allowed
      if ((e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === 'j') && isGateActive()) {
        if (currentSession) {
          currentSession.earlyScrollAttempts += 1;
          if (currentSession.earlyScrollAttempts > 4) {
            currentSession.gateUnlocked = true;
            return; // Allow navigation through
          }
        }

        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        showGentleMessage();
        return false;
      }
    }

    // Capture phase listeners ensure we intercept before YouTube Shorts container handlers
    window.addEventListener('wheel', handleWheel, { capture: true, passive: false });
    document.addEventListener('wheel', handleWheel, { capture: true, passive: false });

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    document.addEventListener('keydown', handleKeyDown, { capture: true });

    // 3. YouTube Custom SPA Navigation Events
    const handleNavigationEvent = () => {
      if (!ensureContextValid()) return;
      setTimeout(checkShortState, 50);
    };

    const ytEvents = ['yt-navigate-finish', 'yt-page-data-updated', 'yt-action', 'yt-visibility-refresh'];
    ytEvents.forEach((evtName) => {
      window.addEventListener(evtName, handleNavigationEvent);
      document.addEventListener(evtName, handleNavigationEvent);
    });

    // 4. Browser History Events
    const handleHistoryNav = () => {
      if (!ensureContextValid()) return;
      setTimeout(checkShortState, 50);
    };
    window.addEventListener('popstate', handleHistoryNav);
    window.addEventListener('hashchange', handleHistoryNav);

    // 5. User Interaction fallback triggers
    const handleWheelInteraction = () => {
      if (!ensureContextValid()) return;
      setTimeout(checkShortState, 100);
    };
    const handleKeyInteraction = (e: KeyboardEvent) => {
      if (!ensureContextValid()) return;
      if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'j', 'k'].includes(e.key)) {
        setTimeout(checkShortState, 150);
      }
    };
    window.addEventListener('wheel', handleWheelInteraction, { passive: true });
    window.addEventListener('keydown', handleKeyInteraction);

    // 6. DOM Mutation Observer
    domObserver = new MutationObserver(() => {
      if (!ensureContextValid()) return;
      checkShortState();
    });

    domObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['is-active', 'active', 'aria-hidden', 'href', 'video-id'],
    });

    // 7. Polling interval (failsafe)
    pollInterval = setInterval(() => {
      if (!ensureContextValid()) return;
      checkShortState();
    }, 400);

    // 8. Page Visibility and Unload Handling
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        finalizeCurrentSession();
      } else if (document.visibilityState === 'visible') {
        if (ensureContextValid()) {
          checkShortState();
        }
      }
    };
    const handleUnload = () => {
      finalizeCurrentSession();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleUnload);
    window.addEventListener('pagehide', handleUnload);

    /**
     * Cleanly tear down content script if context invalidated or unloaded
     */
    function cleanup() {
      if (isTerminated) return;
      isTerminated = true;

      try {
        finalizeCurrentSession();
      } catch {
        // Ignore session finalization error on cleanup
      }

      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }

      if (domObserver) {
        domObserver.disconnect();
        domObserver = null;
      }

      if (unsubsStorage) {
        try {
          unsubsStorage();
        } catch {
          // Ignore
        }
        unsubsStorage = null;
      }

      bindActiveVideo(null);

      window.removeEventListener('wheel', handleWheel, { capture: true });
      document.removeEventListener('wheel', handleWheel, { capture: true });
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
      document.removeEventListener('keydown', handleKeyDown, { capture: true });

      ytEvents.forEach((evtName) => {
        window.removeEventListener(evtName, handleNavigationEvent);
        document.removeEventListener(evtName, handleNavigationEvent);
      });

      window.removeEventListener('popstate', handleHistoryNav);
      window.removeEventListener('hashchange', handleHistoryNav);
      window.removeEventListener('wheel', handleWheelInteraction);
      window.removeEventListener('keydown', handleKeyInteraction);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleUnload);
      window.removeEventListener('pagehide', handleUnload);

      const indicator = document.getElementById('focusscroll-gentle-indicator');
      if (indicator && indicator.parentNode) {
        indicator.parentNode.removeChild(indicator);
      }
    }
  },
});

