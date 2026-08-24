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
    isCalibrated: false,
    calibrationCount: 0,
    calibrationTotal: 6,
    baselineDwellMs: 0,
    currentTargetSec: 0,
    minimumGateSec: 0,
    totalEarlyScrollAttempts: 0,
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
      isCalibrated: false,
      calibrationCount: 0,
      calibrationTotal: 6,
      baselineDwellMs: 0,
      currentTargetSec: 0,
      minimumGateSec: 0,
      totalEarlyScrollAttempts: 0,
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
    const existing = await getShortViewEvents();
    const isCalib = existing.length < 6;
    const randomSec = isCalib
      ? Math.floor(Math.random() * 12) + 8 // 8s-20s during calibration
      : Math.floor(Math.random() * 20) + 10;
    const dwellMs = randomSec * 1000;
    const sampleIds = ['dQw4w9WgXcQ', '3JZ_D3ELwOQ', 'kXYiU_JCYtU', '9bZkp7q19f0', 'kJQP7kiw5Fk'];
    const videoId = sampleIds[Math.floor(Math.random() * sampleIds.length)] ?? 'sample123';
    const now = Date.now();

    const targetSec = isCalib ? 0 : Math.max(5, Math.round((stats.baselineDwellMs || 12000) / 1000));
    const gateSec = isCalib ? 0 : Math.max(2, targetSec - 5);

    const sampleEvent: ShortViewEvent = {
      id: `${videoId}-${now}`,
      videoId: videoId ?? null,
      url: `https://www.youtube.com/shorts/${videoId}`,
      startedAt: now - dwellMs,
      endedAt: now,
      dwellMs,
      timestamp: new Date(now).toISOString(),
      calibration: isCalib,
      currentTargetSec: targetSec,
      minimumGateSec: gateSec,
      earlyScrollAttempts: isCalib ? 0 : Math.floor(Math.random() * 2),
      gateUnlocked: isCalib || randomSec >= gateSec,
    };

    await saveShortViewEvent(sampleEvent);
    const updated = await getShortViewEvents();
    setStats(calculateShortsStats(updated));
  };

  return (
    <div className="popup-container" id="focusscroll-popup">
      {/* Header */}
      <header className="header" id="popup-header">
        <div className="brand">
          <div className="brand-icon" id="brand-icon">FS</div>
          <div>
            <h1 className="brand-title" id="brand-title">FocusScroll</h1>
            <p className="brand-subtitle">Gentle Intervention Mode</p>
          </div>
        </div>
        <div className={`status-badge ${stats.isCalibrated ? 'active' : 'calibrating'}`} id="status-badge">
          <span className="status-dot"></span>
          <span>{stats.isCalibrated ? 'Gate Active' : 'Calibrating'}</span>
        </div>
      </header>

      {/* Calibration Progress / Status Card */}
      <section className="calibration-card" id="calibration-card">
        <div className="calibration-header">
          <span className="calibration-title">
            {stats.isCalibrated ? 'Calibration Complete' : 'Calibration Mode'}
          </span>
          <span className="calibration-ratio">
            {stats.calibrationCount} / {stats.calibrationTotal} Shorts
          </span>
        </div>

        <div className="calibration-bar-bg">
          <div
            className="calibration-bar-fill"
            style={{
              width: `${Math.min(100, (stats.calibrationCount / stats.calibrationTotal) * 100)}%`,
            }}
          ></div>
        </div>

        <p className="calibration-desc">
          {stats.isCalibrated
            ? `Baseline established at ${formatDuration(stats.baselineDwellMs)}. Gate unlocks at ${stats.minimumGateSec}s.`
            : `Observing first 6 Shorts without restriction to learn your natural dwell baseline.`}
        </p>
      </section>

      {/* Target & Gate Metrics Grid */}
      <section className="stats-grid" id="stats-grid">
        <div className="stat-card highlight" id="stat-card-target">
          <span className="stat-label">Hidden Target</span>
          <span className="stat-value cyan">
            {stats.isCalibrated ? `${stats.currentTargetSec}s` : 'Pending'}
          </span>
          <span className="stat-sub">
            {stats.isCalibrated ? `Gate: ${stats.minimumGateSec}s` : 'First 6 free'}
          </span>
        </div>

        <div className="stat-card" id="stat-card-early-scrolls">
          <span className="stat-label">Early Scrolls</span>
          <span className="stat-value">
            {stats.totalEarlyScrollAttempts}
          </span>
          <span className="stat-sub">Nudges triggered</span>
        </div>

        <div className="stat-card" id="stat-card-avg-time">
          <span className="stat-label">Avg Dwell Time</span>
          <span className="stat-value">{formatDuration(stats.avgDwellMs)}</span>
          <span className="stat-sub">{stats.todayCount} watched today</span>
        </div>

        <div className="stat-card" id="stat-card-total-time">
          <span className="stat-label">Total Time Today</span>
          <span className="stat-value">{formatDuration(stats.totalDwellMsToday)}</span>
          <span className="stat-sub">Longest: {formatDuration(stats.longestDwellMs)}</span>
        </div>
      </section>

      {/* Recent Shorts Feed */}
      <section className="recent-section" id="recent-section">
        <div className="recent-header">
          <span>Recent Activity</span>
          <span>{stats.events.length > 0 ? `${stats.events.length} tracked` : ''}</span>
        </div>

        {stats.events.length === 0 ? (
          <div className="empty-state" id="empty-state">
            No Shorts recorded today. Open YouTube Shorts to begin.
          </div>
        ) : (
          <div className="recent-list" id="recent-list">
            {stats.events.slice(0, 4).map((ev) => (
              <div key={ev.id} className="recent-item" id={`event-item-${ev.id}`}>
                <div className="recent-info">
                  <span className="recent-video-id">#{ev.videoId || 'unknown'}</span>
                  <span className={`recent-tag ${ev.calibration ? 'calib' : 'gated'}`}>
                    {ev.calibration ? 'Calibration' : ev.earlyScrollAttempts > 0 ? `${ev.earlyScrollAttempts} nudges` : 'Unlocked'}
                  </span>
                </div>
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
            + Simulate Short Event (Preview Test)
          </button>
        ) : null}
      </div>

      <div className="footer-note">
        FocusScroll • Gentle Scroll Gate
      </div>
    </div>
  );
}
