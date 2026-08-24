import { saveShortViewEvent } from '@/utils/storage';
import type { ShortViewEvent } from '@/utils/types';

interface ActiveShortSession {
  id: string;
  videoId: string | null;
  url: string;
  startedAt: number;
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

    log('Extension loaded on YouTube');

    let currentSession: ActiveShortSession | null = null;
    let lastHandledVideoId: string | null = null;

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
      // 1. Look for active reel renderer
      const activeRenderer =
        document.querySelector('ytd-reel-video-renderer[is-active]') ||
        document.querySelector('ytd-reel-video-renderer[active]') ||
        document.querySelector('ytd-reel-video-renderer:not([aria-hidden="true"])');

      if (activeRenderer) {
        // Check attributes on renderer
        const attrId =
          activeRenderer.getAttribute('video-id') ||
          activeRenderer.getAttribute('data-video-id') ||
          activeRenderer.getAttribute('id');
        if (attrId && attrId !== 'shorts-player' && !attrId.startsWith('ytd-')) {
          return attrId;
        }

        // Check internal links
        const link = activeRenderer.querySelector('a[href*="/shorts/"]');
        if (link) {
          const href = link.getAttribute('href');
          if (href) {
            const extracted = extractShortsVideoIdFromUrl(href);
            if (extracted) return extracted;
          }
        }

        // Check video element currentSrc or media
        const video = activeRenderer.querySelector('video');
        if (video) {
          // If video exists inside active renderer, URL usually reflects it
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
        // User is on /shorts without ID yet (e.g. initial /shorts load before redirect)
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

      // Ignore invalid events (< 500ms dwell time)
      if (dwellMs >= 500 && currentSession.videoId) {
        const event: ShortViewEvent = {
          id: currentSession.id,
          videoId: currentSession.videoId,
          url: currentSession.url,
          startedAt: currentSession.startedAt,
          endedAt,
          dwellMs,
          timestamp: new Date(endedAt).toISOString(),
        };

        saveShortViewEvent(event);
        log(`Event saved: #${event.videoId} (${(dwellMs / 1000).toFixed(1)}s dwell time)`);
      } else if (currentSession.videoId) {
        log(`Ignored quick swipe (<500ms): #${currentSession.videoId} (${dwellMs}ms)`);
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
        }
        return;
      }

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

      // Start new short session
      lastHandledVideoId = videoId;
      const now = Date.now();
      currentSession = {
        id: `${videoId}-${now}-${Math.random().toString(36).slice(2, 7)}`,
        videoId,
        url: window.location.href,
        startedAt: now,
      };

      log(`Active Short: #${videoId} - tracking started...`);
    }

    // 1. Initial check
    checkShortState();

    // 2. YouTube Custom SPA Navigation Events
    const ytEvents = ['yt-navigate-finish', 'yt-page-data-updated', 'yt-action', 'yt-visibility-refresh'];
    ytEvents.forEach((evtName) => {
      window.addEventListener(evtName, () => {
        setTimeout(checkShortState, 50);
      });
      document.addEventListener(evtName, () => {
        setTimeout(checkShortState, 50);
      });
    });

    // 3. Browser History Events
    window.addEventListener('popstate', () => setTimeout(checkShortState, 50));
    window.addEventListener('hashchange', () => setTimeout(checkShortState, 50));

    // 4. User Interaction triggers (scrolling / arrow keys / trackpad)
    window.addEventListener('wheel', () => setTimeout(checkShortState, 100), { passive: true });
    window.addEventListener('keydown', (e) => {
      if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'j', 'k'].includes(e.key)) {
        setTimeout(checkShortState, 150);
      }
    });

    // 5. DOM Mutation Observer
    const observer = new MutationObserver(() => {
      checkShortState();
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['is-active', 'active', 'aria-hidden', 'href', 'video-id'],
    });

    // 6. Polling interval (failsafe)
    setInterval(() => {
      checkShortState();
    }, 400);

    // 7. Page Visibility and Unload Handling
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
