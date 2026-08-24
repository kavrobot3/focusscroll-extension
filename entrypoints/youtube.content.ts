import { computeTargetAndGate, getShortViewEvents, saveShortViewEvent } from '@/utils/storage';
import type { ShortViewEvent } from '@/utils/types';

interface ActiveShortSession {
  id: string;
  videoId: string | null;
  url: string;
  startedAt: number;
  calibration: boolean;
  currentTargetSec: number;
  minimumGateSec: number;
  earlyScrollAttempts: number;
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

    log('FocusScroll intervention engine active');

    let currentSession: ActiveShortSession | null = null;
    let lastHandledVideoId: string | null = null;
    let hintTimeout: ReturnType<typeof setTimeout> | null = null;

    /**
     * Create subtle hint element in DOM
     */
    function getOrCreateHintElement(): HTMLElement {
      let el = document.getElementById('focusscroll-subtle-hint');
      if (!el) {
        el = document.createElement('div');
        el.id = 'focusscroll-subtle-hint';
        el.textContent = 'Stay a little longer…';

        // Apply inline styles to ensure encapsulation without external CSS dependency
        Object.assign(el.style, {
          position: 'fixed',
          bottom: '36px',
          left: '50%',
          transform: 'translateX(-50%) translateY(8px)',
          backgroundColor: 'rgba(12, 17, 23, 0.90)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          color: '#22d3ee',
          border: '1px solid rgba(6, 182, 212, 0.35)',
          boxShadow: '0 4px 24px rgba(0, 0, 0, 0.55)',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          fontSize: '13px',
          fontWeight: '500',
          letterSpacing: '0.01em',
          padding: '7px 16px',
          borderRadius: '9999px',
          pointerEvents: 'none',
          zIndex: '2147483647',
          opacity: '0',
          transition: 'opacity 0.22s ease, transform 0.22s ease',
        });

        document.body.appendChild(el);
      }
      return el;
    }

    /**
     * Show the subtle "Stay a little longer…" message
     */
    function showSubtleHint() {
      const el = getOrCreateHintElement();
      el.style.opacity = '1';
      el.style.transform = 'translateX(-50%) translateY(0)';

      if (hintTimeout) {
        clearTimeout(hintTimeout);
      }

      hintTimeout = setTimeout(() => {
        el.style.opacity = '0';
        el.style.transform = 'translateX(-50%) translateY(8px)';
      }, 1600);
    }

    /**
     * Check if the gate is currently locked for active session
     */
    function isGateLocked(): boolean {
      if (!currentSession) return false;
      // In calibration mode, scrolling is never restricted
      if (currentSession.calibration || currentSession.minimumGateSec <= 0) {
        return false;
      }

      const elapsedSec = (Date.now() - currentSession.startedAt) / 1000;
      return elapsedSec < currentSession.minimumGateSec;
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

        if (activeRenderer.querySelector('video')) {
          const fromUrl = extractShortsVideoIdFromUrl(window.location.href);
          if (fromUrl) return fromUrl;
        }
      }

      return null;
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

      const endedAt = Date.now();
      const dwellMs = endedAt - currentSession.startedAt;
      const dwellSec = dwellMs / 1000;

      // Ignore invalid events (< 500ms dwell time)
      if (dwellMs >= 500 && currentSession.videoId) {
        const gateUnlocked = currentSession.calibration || dwellSec >= currentSession.minimumGateSec;

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
          `Event saved: #${event.videoId} (${dwellSec.toFixed(1)}s dwell time) | Calib: ${event.calibration} | Target: ${event.currentTargetSec}s | Gate: ${event.minimumGateSec}s | Early attempts: ${event.earlyScrollAttempts}`
        );
      }

      currentSession = null;
    }

    /**
     * Process state check on active Short video
     */
    async function checkShortState() {
      const { videoId, isShorts } = getActiveShortId();

      // If user is not on Shorts at all
      if (!isShorts) {
        if (currentSession) {
          finalizeCurrentSession();
          lastHandledVideoId = null;
        }
        return;
      }

      if (!videoId) {
        return;
      }

      // If we are already tracking this exact video, do nothing
      if (currentSession && videoId === lastHandledVideoId && currentSession.videoId === videoId) {
        return;
      }

      // Finalize previous
      if (currentSession) {
        finalizeCurrentSession();
      }

      // Fetch existing events to calculate calibration & intervention targets
      const events = await getShortViewEvents();
      const targetInfo = computeTargetAndGate(events);

      lastHandledVideoId = videoId;
      const now = Date.now();

      currentSession = {
        id: `${videoId}-${now}-${Math.random().toString(36).slice(2, 7)}`,
        videoId,
        url: window.location.href,
        startedAt: now,
        calibration: !targetInfo.isCalibrated,
        currentTargetSec: targetInfo.currentTargetSec,
        minimumGateSec: targetInfo.minimumGateSec,
        earlyScrollAttempts: 0,
      };

      if (currentSession.calibration) {
        log(
          `Active Short: #${videoId} [Calibration ${targetInfo.calibrationCount + 1}/6] - Free scroll allowed`
        );
      } else {
        log(
          `Active Short: #${videoId} [Intervention Target: ${currentSession.currentTargetSec}s | Gate: ${currentSession.minimumGateSec}s]`
        );
      }
    }

    // --- INTERVENTION HANDLERS: Intercept attempts to advance to the next Short before gate unlocks ---

    // 1. Wheel Event (Intercept downward scrolling)
    window.addEventListener(
      'wheel',
      (e: WheelEvent) => {
        // Only intercept downward scroll attempts (moving to next Short)
        if (e.deltaY > 0 && isGateLocked()) {
          e.preventDefault();
          e.stopImmediatePropagation();
          if (currentSession) {
            currentSession.earlyScrollAttempts++;
          }
          showSubtleHint();
          return false;
        }
      },
      { capture: true, passive: false }
    );

    // 2. Keyboard Event (Intercept ArrowDown, PageDown, 'j' navigation)
    window.addEventListener(
      'keydown',
      (e: KeyboardEvent) => {
        const nextShortKeys = ['ArrowDown', 'PageDown', 'j', 'J'];
        if (nextShortKeys.includes(e.key) && isGateLocked()) {
          // Do not intercept if user is typing in a comment or search input box
          const target = e.target as HTMLElement | null;
          if (
            target &&
            (target.tagName === 'INPUT' ||
              target.tagName === 'TEXTAREA' ||
              target.isContentEditable ||
              target.getAttribute('contenteditable') === 'true')
          ) {
            return;
          }

          e.preventDefault();
          e.stopImmediatePropagation();
          if (currentSession) {
            currentSession.earlyScrollAttempts++;
          }
          showSubtleHint();
          return false;
        }
      },
      { capture: true }
    );

    // 3. Next Short Button Click Interception (e.g. YouTube's navigation arrow button down)
    document.addEventListener(
      'click',
      (e: MouseEvent) => {
        if (!isGateLocked()) return;

        const target = e.target as HTMLElement | null;
        if (!target) return;

        const nextBtn = target.closest(
          '#navigation-button-down, [aria-label*="Next video"], [aria-label*="Next Short"], #next-button'
        );
        if (nextBtn) {
          e.preventDefault();
          e.stopImmediatePropagation();
          if (currentSession) {
            currentSession.earlyScrollAttempts++;
          }
          showSubtleHint();
        }
      },
      { capture: true }
    );

    // 4. Touch swipe interception for trackpad/touchscreen
    let touchStartY = 0;
    window.addEventListener(
      'touchstart',
      (e: TouchEvent) => {
        if (e.touches && e.touches[0]) {
          touchStartY = e.touches[0].clientY;
        }
      },
      { capture: true, passive: true }
    );

    window.addEventListener(
      'touchmove',
      (e: TouchEvent) => {
        if (!isGateLocked()) return;
        if (e.touches && e.touches[0]) {
          const currentY = e.touches[0].clientY;
          // Swiping up on screen to go to next Short
          if (touchStartY - currentY > 25) {
            e.preventDefault();
            e.stopImmediatePropagation();
            if (currentSession) {
              currentSession.earlyScrollAttempts++;
            }
            showSubtleHint();
          }
        }
      },
      { capture: true, passive: false }
    );

    // --- NAVIGATION LIFECYCLE HOOKS ---

    // Initial check
    checkShortState();

    // YouTube Custom SPA Navigation Events
    const ytEvents = ['yt-navigate-finish', 'yt-page-data-updated', 'yt-action', 'yt-visibility-refresh'];
    ytEvents.forEach((evtName) => {
      window.addEventListener(evtName, () => setTimeout(checkShortState, 50));
      document.addEventListener(evtName, () => setTimeout(checkShortState, 50));
    });

    // Browser History Events
    window.addEventListener('popstate', () => setTimeout(checkShortState, 50));
    window.addEventListener('hashchange', () => setTimeout(checkShortState, 50));

    // DOM Mutation Observer
    const observer = new MutationObserver(() => {
      checkShortState();
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['is-active', 'active', 'aria-hidden', 'href', 'video-id'],
    });

    // Polling interval (failsafe)
    setInterval(() => {
      checkShortState();
    }, 400);

    // Page Visibility and Unload Handling
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        finalizeCurrentSession();
      } else if (document.visibilityState === 'visible') {
        checkShortState();
      }
    });

    window.addEventListener('beforeunload', () => {
      finalizeCurrentSession();
    });

    window.addEventListener('pagehide', () => {
      finalizeCurrentSession();
    });
  },
});
