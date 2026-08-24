import { useEffect, useState } from 'react';
import {
  calculateShortsStats,
  clearShortViewEvents,
  formatDuration,
  getShortViewEvents,
  onStorageChanged,
  saveShortViewEvent,
} from '@/utils/storage';
import type { ShortsStats, ShortViewEvent } from '@/utils/types';
import './App.css';

export default function App() {
  const [stats, setStats] = useState<ShortsStats>({
    todayCount: 0,
    avgDwellMs: 0,
    longestDwellMs: 0,
    totalDwellMsToday: 0,
    events: [],
  });
  const [isClearing, setIsClearing] = useState(false);
  const [copiedStatus, setCopiedStatus] = useState<string | null>(null);

  // Load events and listen to live storage updates
  useEffect(() => {
    async function loadData() {
      const storedEvents = await getShortViewEvents();
      setStats(calculateShortsStats(storedEvents));
    }

    loadData();

    // Subscribe to runtime storage updates
    const unsubscribe = onStorageChanged((updatedEvents) => {
      setStats(calculateShortsStats(updatedEvents));
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const handleClearData = async () => {
    setIsClearing(true);
    await clearShortViewEvents();
    setStats({
      todayCount: 0,
      avgDwellMs: 0,
      longestDwellMs: 0,
      totalDwellMsToday: 0,
      events: [],
    });
    setCopiedStatus('Data cleared');
    setTimeout(() => {
      setIsClearing(false);
      setCopiedStatus(null);
    }, 1500);
  };

  // Helper for web preview testing
  const handleSimulateEvent = async () => {
    const randomSec = Math.floor(Math.random() * 25) + 3;
    const dwellMs = randomSec * 1000;
    const sampleIds = ['dQw4w9WgXcQ', '3JZ_D3ELwOQ', 'kXYiU_JCYtU', '9bZkp7q19f0', 'kJQP7kiw5Fk'];
    const videoId = sampleIds[Math.floor(Math.random() * sampleIds.length)] ?? 'sample123';
    const now = Date.now();

    const sampleEvent: ShortViewEvent = {
      id: `${videoId}-${now}`,
      videoId: videoId ?? null,
      url: `https://www.youtube.com/shorts/${videoId}`,
      startedAt: now - dwellMs,
      endedAt: now,
      dwellMs,
      timestamp: new Date(now).toISOString(),
    };

    await saveShortViewEvent(sampleEvent);
    const updated = await getShortViewEvents();
    setStats(calculateShortsStats(updated));
  };

  const isTrackingActive = stats.todayCount > 0;

  return (
    <div className="popup-container" id="focusscroll-popup">
      {/* Header */}
      <header className="header" id="popup-header">
        <div className="brand">
          <div className="brand-icon" id="brand-icon">FS</div>
          <div>
            <h1 className="brand-title" id="brand-title">FocusScroll</h1>
            <p className="brand-subtitle">Phase 0: Dwell Tracker</p>
          </div>
        </div>
        <div className="status-badge" id="status-badge">
          <span className="status-dot"></span>
          <span>{isTrackingActive ? 'Active' : 'Ready'}</span>
        </div>
      </header>

      {/* Status banner */}
      <div className="status-banner" id="status-banner">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22d3ee" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <polygon points="10 8 16 12 10 16 10 8"></polygon>
        </svg>
        <span className="status-banner-text">
          {isTrackingActive ? 'Tracking YouTube Shorts' : 'Open YouTube Shorts to begin'}
        </span>
      </div>

      {/* Metrics Grid */}
      <section className="stats-grid" id="stats-grid">
        <div className="stat-card highlight" id="stat-card-today-count">
          <span className="stat-label">Today's Shorts</span>
          <span className="stat-value cyan">{stats.todayCount}</span>
        </div>

        <div className="stat-card" id="stat-card-total-time">
          <span className="stat-label">Total Time Today</span>
          <span className="stat-value">{formatDuration(stats.totalDwellMsToday)}</span>
        </div>

        <div className="stat-card" id="stat-card-avg-time">
          <span className="stat-label">Avg Time / Short</span>
          <span className="stat-value">{formatDuration(stats.avgDwellMs)}</span>
        </div>

        <div className="stat-card" id="stat-card-longest-watch">
          <span className="stat-label">Longest Watch</span>
          <span className="stat-value">{formatDuration(stats.longestDwellMs)}</span>
        </div>
      </section>

      {/* Recent Shorts Feed */}
      <section className="recent-section" id="recent-section">
        <div className="recent-header">
          <span>Recent Shorts</span>
          <span>{stats.events.length > 0 ? `${stats.events.length} tracked` : ''}</span>
        </div>

        {stats.events.length === 0 ? (
          <div className="empty-state" id="empty-state">
            No Shorts recorded today yet.
          </div>
        ) : (
          <div className="recent-list" id="recent-list">
            {stats.events.slice(0, 5).map((ev) => (
              <div key={ev.id} className="recent-item" id={`event-item-${ev.id}`}>
                <span className="recent-video-id">#{ev.videoId || 'unknown'}</span>
                <span className="recent-dwell">{formatDuration(ev.dwellMs)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Actions */}
      <div className="actions" id="actions-panel">
        <button
          type="button"
          className="btn-clear"
          id="btn-clear-data"
          onClick={handleClearData}
          disabled={isClearing}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
          {copiedStatus || (isClearing ? 'Clearing...' : 'Clear test data')}
        </button>

        {/* Simulation button for web preview mode */}
        {typeof chrome === 'undefined' || !chrome.storage ? (
          <button
            type="button"
            className="btn-simulate"
            id="btn-simulate-event"
            onClick={handleSimulateEvent}
          >
            + Simulate Short View (Preview Test)
          </button>
        ) : null}
      </div>

      <div className="footer-note">
        FocusScroll POC • YouTube Shorts Only
      </div>
    </div>
  );
}
