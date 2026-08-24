import { useEffect, useState } from 'react';
import {
  CALIBRATION_COUNT_REQUIRED,
  calculateShortsStats,
  clearShortViewEvents,
  formatDuration,
  getCalibrationInfo,
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
    calibrationTarget: CALIBRATION_COUNT_REQUIRED,
    baselineAvgDwellMs: 0,
    currentTargetSec: null,
    minimumGateSec: null,
    totalEarlyScrollAttempts: 0,
    events: [],
  });
  const [isClearing, setIsClearing] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

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
      calibrationTarget: CALIBRATION_COUNT_REQUIRED,
      baselineAvgDwellMs: 0,
      currentTargetSec: null,
      minimumGateSec: null,
      totalEarlyScrollAttempts: 0,
      events: [],
    });
    setActionFeedback('Test data cleared');
    setTimeout(() => {
      setIsClearing(false);
      setActionFeedback(null);
    }, 1500);
  };

  // Helper for testing in web preview
  const handleSimulateSingleEvent = async () => {
    const existing = await getShortViewEvents();
    const currentCalib = getCalibrationInfo(existing);
    const now = Date.now();
    const sampleIds = ['dQw4w9WgXcQ', '3JZ_D3ELwOQ', 'kXYiU_JCYtU', '9bZkp7q19f0', 'kJQP7kiw5Fk', '7xQ2e5j49M8', '8pLmN2_18vQ'];
    const videoId = sampleIds[Math.floor(Math.random() * sampleIds.length)] ?? 'demo_vid';

    let dwellMs: number;
    let calibration = false;
    let currentTargetSec: number | null = null;
    let minimumGateSec: number | null = null;
    let earlyScrollAttempts = 0;
    let gateUnlocked = true;

    if (!currentCalib.isCalibrated) {
      // Still in calibration phase (Shorts 1-6)
      calibration = true;
      // Realistic random calibration dwell (e.g. 10s to 24s)
      const randomSec = Math.floor(Math.random() * 15) + 10;
      dwellMs = randomSec * 1000;
      gateUnlocked = true;
      currentTargetSec = null;
      minimumGateSec = null;
    } else {
      // In Intervention phase (7th+ Short)
      calibration = false;
      currentTargetSec = currentCalib.currentTargetSec;
      minimumGateSec = currentCalib.minimumGateSec;
      // Simulate user staying longer or attempting early scrolls
      const userExceededGate = Math.random() > 0.3;
      if (userExceededGate && currentTargetSec) {
        // Watched past the gate unlock
        dwellMs = (currentTargetSec + Math.floor(Math.random() * 8)) * 1000;
        earlyScrollAttempts = Math.random() > 0.5 ? Math.floor(Math.random() * 3) + 1 : 0;
        gateUnlocked = true;
      } else {
        // Early attempt and left
        earlyScrollAttempts = Math.floor(Math.random() * 3) + 1;
        const gate = minimumGateSec ?? 2;
        dwellMs = Math.max(800, (gate + 2) * 1000);
        gateUnlocked = true;
      }
    }

    const sampleEvent: ShortViewEvent = {
      id: `${videoId}-${now}`,
      videoId,
      url: `https://www.youtube.com/shorts/${videoId}`,
      startedAt: now - dwellMs,
      endedAt: now,
      dwellMs,
      timestamp: new Date(now).toISOString(),
      calibration,
      currentTargetSec,
      minimumGateSec,
      earlyScrollAttempts,
      gateUnlocked,
    };

    await saveShortViewEvent(sampleEvent);
    const updated = await getShortViewEvents();
    setStats(calculateShortsStats(updated));
    setActionFeedback(calibration ? 'Simulated calibration Short' : 'Simulated intervention Short');
    setTimeout(() => setActionFeedback(null), 1200);
  };

  const handleSimulateFastTrackCalibration = async () => {
    // Generate 6 sample calibration events with varied dwells
    const now = Date.now();
    const durations = [14, 18, 12, 22, 16, 20]; // average: 17.0s
    const sampleIds = ['dQw4w9WgXcQ', '3JZ_D3ELwOQ', 'kXYiU_JCYtU', '9bZkp7q19f0', 'kJQP7kiw5Fk', '7xQ2e5j49M8'];

    await clearShortViewEvents();

    for (let i = 0; i < 6; i++) {
      const durSec = durations[i] ?? 15;
      const dwellMs = durSec * 1000;
      const startedAt = now - (6 - i) * 60000;
      const endedAt = startedAt + dwellMs;
      const vid = sampleIds[i] ?? `demo_${i}`;

      const ev: ShortViewEvent = {
        id: `${vid}-${startedAt}`,
        videoId: vid,
        url: `https://www.youtube.com/shorts/${vid}`,
        startedAt,
        endedAt,
        dwellMs,
        timestamp: new Date(endedAt).toISOString(),
        calibration: true,
        currentTargetSec: null,
        minimumGateSec: null,
        earlyScrollAttempts: 0,
        gateUnlocked: true,
      };
      await saveShortViewEvent(ev);
    }

    const updated = await getShortViewEvents();
    setStats(calculateShortsStats(updated));
    setActionFeedback('6 Calibration Shorts generated! Baseline ~17s');
    setTimeout(() => setActionFeedback(null), 2000);
  };

  const isTrackingActive = stats.todayCount > 0;
  const calibrationPercent = Math.min(100, Math.round((stats.calibrationCount / stats.calibrationTarget) * 100));

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
          <span>{stats.isCalibrated ? 'Intervention Active' : 'Calibrating'}</span>
        </div>
      </header>

      {/* Calibration Progress Section */}
      <section className="calibration-card" id="calibration-card">
        <div className="calibration-header">
          <div className="calibration-title-group">
            <span className="calibration-badge-label">Phase</span>
            <span className="calibration-status-text">
              {stats.isCalibrated ? (
                <span className="text-cyan font-semibold">Baseline Established</span>
              ) : (
                <span>Calibration ({stats.calibrationCount}/{stats.calibrationTarget} Shorts)</span>
              )}
            </span>
          </div>
          <span className="calibration-meta">
            {stats.isCalibrated
              ? `Baseline: ${formatDuration(stats.baselineAvgDwellMs)} avg`
              : `${stats.calibrationTarget - stats.calibrationCount} remaining`}
          </span>
        </div>

        <div className="progress-track" id="calibration-progress-track">
          <div
            className="progress-fill"
            style={{ width: `${calibrationPercent}%` }}
            id="calibration-progress-fill"
          ></div>
        </div>

        <div className="calibration-caption">
          {stats.isCalibrated
            ? 'Gentle focus intervention is active. Scrolls are gently gated on early exits.'
            : 'First 6 Shorts establish your natural baseline dwell time without scroll restrictions.'}
        </div>
      </section>

      {/* Core Metrics Grid */}
      <section className="stats-grid" id="stats-grid">
        {/* Hidden Target */}
        <div className={`stat-card ${stats.isCalibrated ? 'highlight' : ''}`} id="stat-card-target">
          <span className="stat-label">Hidden Target</span>
          <span className="stat-value cyan">
            {stats.isCalibrated && stats.currentTargetSec !== null ? (
              `${stats.currentTargetSec}s`
            ) : (
              <span className="text-dim text-sm">In Calibration</span>
            )}
          </span>
          <span className="stat-subtext">
            {stats.isCalibrated && stats.minimumGateSec !== null
              ? `Gate: ${stats.minimumGateSec}s min`
              : 'Unlocks after 6 Shorts'}
          </span>
        </div>

        {/* Early Scroll Attempts */}
        <div className="stat-card" id="stat-card-early-scrolls">
          <span className="stat-label">Early Scroll Attempts</span>
          <span className={`stat-value ${stats.totalEarlyScrollAttempts > 0 ? 'amber' : ''}`}>
            {stats.totalEarlyScrollAttempts}
          </span>
          <span className="stat-subtext">
            {stats.totalEarlyScrollAttempts > 0 ? 'Intercepted before gate' : 'None recorded today'}
          </span>
        </div>

        {/* Average Dwell Time */}
        <div className="stat-card" id="stat-card-avg-time">
          <span className="stat-label">Average Dwell Time</span>
          <span className="stat-value">{formatDuration(stats.avgDwellMs)}</span>
          <span className="stat-subtext">
            {stats.todayCount > 0 ? `${stats.todayCount} total Shorts today` : 'No Shorts today'}
          </span>
        </div>

        {/* Longest Watch */}
        <div className="stat-card" id="stat-card-longest-watch">
          <span className="stat-label">Longest Watch</span>
          <span className="stat-value">{formatDuration(stats.longestDwellMs)}</span>
          <span className="stat-subtext">
            Total: {formatDuration(stats.totalDwellMsToday)}
          </span>
        </div>
      </section>

      {/* Recent Shorts Activity Feed */}
      <section className="recent-section" id="recent-section">
        <div className="recent-header">
          <span>Recent Shorts Activity</span>
          <span>{stats.events.length > 0 ? `${stats.events.length} recorded` : ''}</span>
        </div>

        {stats.events.length === 0 ? (
          <div className="empty-state" id="empty-state">
            No Shorts recorded yet. Open YouTube Shorts to begin calibration.
          </div>
        ) : (
          <div className="recent-list" id="recent-list">
            {stats.events.slice(0, 6).map((ev) => (
              <div key={ev.id} className="recent-item" id={`event-item-${ev.id}`}>
                <div className="recent-left">
                  <span className={`event-tag ${ev.calibration ? 'tag-calib' : 'tag-intervention'}`}>
                    {ev.calibration ? 'Calib' : 'Intervention'}
                  </span>
                  <span className="recent-video-id">#{ev.videoId || 'unknown'}</span>
                </div>
                <div className="recent-right">
                  {ev.earlyScrollAttempts > 0 ? (
                    <span className="early-tag" title={`${ev.earlyScrollAttempts} early scroll attempts`}>
                      ⚡ {ev.earlyScrollAttempts} {ev.earlyScrollAttempts === 1 ? 'attempt' : 'attempts'}
                    </span>
                  ) : null}
                  <span className="recent-dwell">{formatDuration(ev.dwellMs)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Action Buttons */}
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
          {actionFeedback || (isClearing ? 'Clearing...' : 'Clear test data')}
        </button>

        {/* Simulation testing tools for web preview */}
        {typeof chrome === 'undefined' || !chrome.storage ? (
          <div className="simulation-panel" id="simulation-panel">
            <div className="simulation-label">Preview Sandbox Controls:</div>
            <div className="simulation-buttons">
              <button
                type="button"
                className="btn-simulate"
                id="btn-simulate-event"
                onClick={handleSimulateSingleEvent}
              >
                + Simulate 1 Short ({stats.isCalibrated ? 'Intervention' : `Calib #${stats.calibrationCount + 1}`})
              </button>
              {!stats.isCalibrated ? (
                <button
                  type="button"
                  className="btn-simulate-fast"
                  id="btn-simulate-fast-calib"
                  onClick={handleSimulateFastTrackCalibration}
                >
                  ⚡ Fast-Track 6 Calibration Shorts
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      <div className="footer-note">
        FocusScroll • Gentle Intervention POC
      </div>
    </div>
  );
}

