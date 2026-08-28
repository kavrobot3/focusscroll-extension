import React, { useEffect, useState } from 'react';
import {
  CALIBRATION_COUNT_REQUIRED,
  calculateShortsStats,
  clearShortViewEvents,
  formatDuration,
  getCalibrationInfo,
  getFocusSettings,
  getProgressionRate,
  getShortViewEvents,
  hardReloadExtension,
  onSettingsChanged,
  onStorageChanged,
  saveFocusSettings,
  saveShortViewEvent,
} from '@/utils/storage';
import {
  DEFAULT_FOCUS_SETTINGS,
  type FocusSettings,
  type ShortsStats,
  type ShortViewEvent,
} from '@/utils/types';
import { MiniDwellChart } from './MiniDwellChart';
import './App.css';

export default function App() {
  const [settings, setSettings] = useState<FocusSettings>(DEFAULT_FOCUS_SETTINGS);
  const [stats, setStats] = useState<ShortsStats>({
    todayCount: 0,
    avgDwellMs: 0,
    longestDwellMs: 0,
    totalDwellMsToday: 0,
    isCalibrated: false,
    calibrationCount: 0,
    calibrationTarget: CALIBRATION_COUNT_REQUIRED,
    baselineAvgDwellMs: 0,
    currentTargetSec: 5,
    minimumGateSec: 2,
    totalEarlyScrollAttempts: 0,
    events: [],
    settings: DEFAULT_FOCUS_SETTINGS,
  });

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [instantSyncNotice, setInstantSyncNotice] = useState<string | null>(null);
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'activity'>('overview');

  // Load events and settings
  useEffect(() => {
    async function loadData() {
      const [storedEvents, storedSettings] = await Promise.all([
        getShortViewEvents(),
        getFocusSettings(),
      ]);
      setSettings(storedSettings);
      setStats(calculateShortsStats(storedEvents, storedSettings));
    }

    loadData();

    // Subscribe to runtime storage updates
    const unsubsEvents = onStorageChanged((updatedEvents) => {
      setStats((prev) => calculateShortsStats(updatedEvents, prev.settings));
    });

    const unsubsSettings = onSettingsChanged((updatedSettings) => {
      setSettings(updatedSettings);
      getShortViewEvents().then((events) => {
        setStats(calculateShortsStats(events, updatedSettings));
      });
    });

    return () => {
      unsubsEvents();
      unsubsSettings();
    };
  }, []);

  // Update setting helper - saves immediately in storage for REAL-TIME synchronization
  const updateSetting = <K extends keyof FocusSettings>(key: K, value: FocusSettings[K]) => {
    const updated: FocusSettings = { ...settings, [key]: value };
    setSettings(updated);
    setSaveSuccess(false);

    // Apply instantly in storage so active content scripts pick it up in real-time
    saveFocusSettings(updated);

    // Recalculate stats immediately to preview new target & gate
    const updatedStats = calculateShortsStats(stats.events, updated);
    setStats(updatedStats);

    const targetDesc = key === 'manualTargetSec' || key === 'targetMode'
      ? `Target: ${updatedStats.currentTargetSec}s`
      : 'Synced';
    setInstantSyncNotice(`✓ ${targetDesc}`);
    setTimeout(() => setInstantSyncNotice(null), 1600);
  };

  // Preset handlers - calibrated gently for average short-form video viewers
  const handleApplyPreset = (presetName: 'starter' | 'gentle' | 'balanced' | 'deep') => {
    let preset: FocusSettings;
    if (presetName === 'starter') {
      // 🐣 Starter: 4s Target, 2s Gate, No increase (Fixed) - super forgiving
      preset = {
        ...settings,
        targetMode: 'manual',
        manualTargetSec: 4,
        progressionSpeed: 'fixed',
        customIncreasePerShortSec: 0,
        gateMode: 'fixed',
        manualGateSec: 2,
        maxTargetCapSec: 15,
      };
    } else if (presetName === 'gentle') {
      // 🌿 Gentle: Auto target based on baseline, 2s Gate, gentle +0.05s increase
      preset = {
        ...settings,
        targetMode: 'auto',
        progressionSpeed: 'gentle',
        customIncreasePerShortSec: 0.05,
        gateMode: 'auto',
        manualGateSec: 2,
        maxTargetCapSec: 20,
      };
    } else if (presetName === 'balanced') {
      // 🎯 Balanced: 7s Target, 2s Gate, +0.10s increase
      preset = {
        ...settings,
        targetMode: 'manual',
        manualTargetSec: 7,
        progressionSpeed: 'custom',
        customIncreasePerShortSec: 0.1,
        gateMode: 'auto',
        manualGateSec: 2,
        maxTargetCapSec: 25,
      };
    } else {
      // 🧘 Deep: 10s Target, 3s Gate, +0.15s increase
      preset = {
        ...settings,
        targetMode: 'manual',
        manualTargetSec: 10,
        progressionSpeed: 'normal',
        customIncreasePerShortSec: 0.15,
        gateMode: 'fixed',
        manualGateSec: 3,
        maxTargetCapSec: 30,
      };
    }

    setSettings(preset);
    saveFocusSettings(preset);
    const updatedStats = calculateShortsStats(stats.events, preset);
    setStats(updatedStats);

    setInstantSyncNotice(`✓ ${updatedStats.currentTargetSec}s Preset Applied`);
    setTimeout(() => setInstantSyncNotice(null), 1600);
  };

  // Save settings and hard reload extension & tabs
  const handleSaveAndHardReload = async () => {
    setIsSaving(true);
    try {
      await saveFocusSettings(settings);
      setSaveSuccess(true);
      setActionFeedback('Applied • Reloading YouTube & Instagram Tabs...');

      setTimeout(async () => {
        await hardReloadExtension();
        setIsSaving(false);
      }, 500);
    } catch {
      setIsSaving(false);
      setActionFeedback('Saved (Could not reload tabs)');
      setTimeout(() => setActionFeedback(null), 2000);
    }
  };

  // Export all viewing data as formatted JSON
  const handleExportData = () => {
    try {
      const exportPayload = {
        exportDate: new Date().toISOString(),
        app: 'FocusScroll Extension',
        version: '1.0.0',
        description: 'YouTube Shorts and Instagram Reels dwell tracker with gentle focus intervention and hidden target gate',
        privacyNote: 'Your Shorts viewing data is stored locally on this browser.',
        stats: {
          calibrationBaselineDwellMs: stats.baselineAvgDwellMs,
          calibrationBaselineSec: Number((stats.baselineAvgDwellMs / 1000).toFixed(1)),
          currentTargetSec: stats.currentTargetSec,
          minimumGateSec: stats.minimumGateSec,
          avgDwellMs: stats.avgDwellMs,
          longestDwellMs: stats.longestDwellMs,
          shortsWatchedToday: stats.todayCount,
          totalShortsTimeTodayMs: stats.totalDwellMsToday,
          totalEarlyScrollAttempts: stats.totalEarlyScrollAttempts,
          isCalibrated: stats.isCalibrated,
          calibrationCount: stats.calibrationCount,
          calibrationTarget: stats.calibrationTarget,
          totalRecordedEvents: stats.events.length,
        },
        settings,
        events: stats.events,
      };

      const jsonStr = JSON.stringify(exportPayload, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const dateStamp = new Date().toISOString().split('T')[0];
      a.download = `focusscroll-data-${dateStamp}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setActionFeedback('JSON Data Downloaded ✓');
      setTimeout(() => setActionFeedback(null), 2000);
    } catch (err) {
      console.error('Export failed:', err);
      setActionFeedback('Export failed');
      setTimeout(() => setActionFeedback(null), 2000);
    }
  };

  // Confirm and perform full reset
  const handleConfirmReset = async () => {
    setIsClearing(true);
    await clearShortViewEvents();
    const updatedStats = calculateShortsStats([], settings);
    setStats(updatedStats);
    setIsResetConfirmOpen(false);
    setIsClearing(false);
    setActionFeedback('All viewing data reset ✓');
    setTimeout(() => setActionFeedback(null), 2000);
  };

  // Simulation helpers for testing in web sandbox preview
  const handleSimulateSingleEvent = async (platform: 'youtube' | 'instagram' = 'youtube') => {
    const existing = await getShortViewEvents();
    const currentCalib = getCalibrationInfo(existing, settings);
    const now = Date.now();
    const sampleIds = platform === 'youtube'
      ? ['dQw4w9WgXcQ', '3JZ_D3ELwOQ', 'kXYiU_JCYtU', '9bZkp7q19f0', 'kJQP7kiw5Fk']
      : ['Cx9721_reels', 'Da4519_insta', 'Eb8201_reels', 'Fa1190_insta'];
    const videoId = sampleIds[Math.floor(Math.random() * sampleIds.length)] ?? 'demo_vid';

    let dwellMs: number;
    let calibration = false;
    let currentTargetSec = currentCalib.currentTargetSec;
    let minimumGateSec = currentCalib.minimumGateSec;
    let earlyScrollAttempts = 0;
    let gateUnlocked = true;

    if (!currentCalib.isCalibrated) {
      calibration = true;
      const randomSec = Math.floor(Math.random() * 5) + 3; // 3-7s baseline for avg user
      dwellMs = randomSec * 1000;
      gateUnlocked = true;
    } else {
      calibration = false;
      const userExceededGate = Math.random() > 0.3;
      if (userExceededGate && currentTargetSec) {
        dwellMs = (currentTargetSec + Math.floor(Math.random() * 4)) * 1000;
        earlyScrollAttempts = Math.random() > 0.6 ? 1 : 0;
        gateUnlocked = true;
      } else {
        earlyScrollAttempts = Math.floor(Math.random() * 2) + 1;
        dwellMs = Math.max(800, (minimumGateSec + 1) * 1000);
        gateUnlocked = true;
      }
    }

    const sampleEvent: ShortViewEvent = {
      id: `${videoId}-${now}`,
      videoId,
      url: platform === 'youtube' ? `https://www.youtube.com/shorts/${videoId}` : `https://www.instagram.com/reel/${videoId}/`,
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
    setStats(calculateShortsStats(updated, settings));
    setActionFeedback(`Simulated ${platform === 'youtube' ? 'YouTube Short' : 'Instagram Reel'}`);
    setTimeout(() => setActionFeedback(null), 1200);
  };

  const handleSimulateFastTrackCalibration = async () => {
    const now = Date.now();
    const durations = [4.5, 6.2, 5.0]; // Realistic 4-6s baseline dwells
    const sampleIds = ['dQw4w9WgXcQ', 'Cx9721_reels', 'kXYiU_JCYtU'];

    await clearShortViewEvents();

    for (let i = 0; i < 3; i++) {
      const durSec = durations[i] ?? 5;
      const dwellMs = Math.round(durSec * 1000);
      const startedAt = now - (3 - i) * 60000;
      const endedAt = startedAt + dwellMs;
      const vid = sampleIds[i] ?? `demo_${i}`;

      const ev: ShortViewEvent = {
        id: `${vid}-${startedAt}`,
        videoId: vid,
        url: vid.includes('reels') ? `https://www.instagram.com/reel/${vid}/` : `https://www.youtube.com/shorts/${vid}`,
        startedAt,
        endedAt,
        dwellMs,
        timestamp: new Date(endedAt).toISOString(),
        calibration: true,
        currentTargetSec: 5,
        minimumGateSec: 2,
        earlyScrollAttempts: 0,
        gateUnlocked: true,
      };
      await saveShortViewEvent(ev);
    }

    const updated = await getShortViewEvents();
    setStats(calculateShortsStats(updated, settings));
    setActionFeedback('3 Baseline Calibration views recorded!');
    setTimeout(() => setActionFeedback(null), 2000);
  };

  const calibrationPercent = Math.min(100, Math.round((stats.calibrationCount / stats.calibrationTarget) * 100));
  const effectiveProgRate = getProgressionRate(settings);

  return (
    <div className="popup-container" id="focusscroll-popup">
      {/* Toast Feedback Notification */}
      {actionFeedback && (
        <div className="toast-notification" id="toast-notification">
          <span>{actionFeedback}</span>
        </div>
      )}

      {/* Reset Confirmation Modal / Overlay */}
      {isResetConfirmOpen && (
        <div className="confirm-modal-backdrop" id="reset-confirm-modal">
          <div className="confirm-modal-card">
            <div className="confirm-modal-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
              </svg>
            </div>
            <h3 className="confirm-modal-title">Reset All Data?</h3>
            <p className="confirm-modal-desc">
              This will permanently delete all recorded Shorts and Reels viewing history, clear baseline calibration, and reset your analytics.
            </p>
            <div className="confirm-modal-actions">
              <button
                type="button"
                className="btn-modal-cancel"
                id="btn-cancel-reset"
                onClick={() => setIsResetConfirmOpen(false)}
                disabled={isClearing}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-modal-confirm"
                id="btn-confirm-reset"
                onClick={handleConfirmReset}
                disabled={isClearing}
              >
                {isClearing ? 'Resetting...' : 'Confirm Reset'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header with FocusScroll Branding */}
      <header className="header" id="popup-header">
        <div className="brand" id="brand-identity">
          <div className="brand-logo-container">
            <img
              src="/icon/48.png"
              alt="FocusScroll Logo"
              className="brand-logo-img"
              id="brand-logo-img"
              referrerPolicy="no-referrer"
              onError={(e) => {
                const target = e.currentTarget;
                target.src = '/logo.svg';
              }}
            />
            <div className="brand-logo-glow"></div>
          </div>
          <div>
            <div className="brand-title-row">
              <h1 className="brand-title" id="brand-title">FocusScroll</h1>
              <span className="brand-tag">PRO</span>
            </div>
            <p className="brand-subtitle" title="Mindful pacing & focus protection on YouTube Shorts & Instagram Reels">
              Shorts & Reels Focus Interceptor
            </p>
          </div>
        </div>
        <div className={`status-badge ${stats.isCalibrated ? 'active' : 'calibrating'}`} id="status-badge">
          <span className="status-dot"></span>
          <span>{stats.isCalibrated ? 'Active Protection' : 'Calibrating'}</span>
        </div>
      </header>

      {/* Target & Settings Control Drawer */}
      <section className="settings-card" id="settings-card">
        <button
          type="button"
          className="settings-toggle-btn"
          id="btn-toggle-settings"
          onClick={() => setIsSettingsOpen(!isSettingsOpen)}
        >
          <div className="settings-header-left">
            <span className="settings-header-icon">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
              </svg>
            </span>
            <span>Target & Progression Settings</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {instantSyncNotice ? (
              <span className="live-sync-badge" id="live-sync-notice">{instantSyncNotice}</span>
            ) : (
              <span className="settings-badge">
                {settings.targetMode === 'manual' ? `${settings.manualTargetSec}s Target` : 'Auto Target'}
              </span>
            )}
            <span className={`settings-toggle-arrow ${isSettingsOpen ? 'open' : ''}`}>▼</span>
          </div>
        </button>

        {isSettingsOpen && (
          <div className="settings-content" id="settings-content-drawer">
            {/* Quick Presets */}
            <div className="presets-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="presets-label">Pacing Presets</span>
                <span style={{ fontSize: '9px', color: '#22d3ee' }}>⚡ Updates in real-time</span>
              </div>
              <div className="presets-buttons">
                <button
                  type="button"
                  className={`btn-preset ${settings.progressionSpeed === 'fixed' && settings.manualTargetSec === 4 ? 'active' : ''}`}
                  onClick={() => handleApplyPreset('starter')}
                  title="4s Target, 2s Gate, Fixed speed"
                >
                  🐣 4s Fixed
                </button>
                <button
                  type="button"
                  className={`btn-preset ${settings.progressionSpeed === 'gentle' && settings.targetMode === 'auto' ? 'active' : ''}`}
                  onClick={() => handleApplyPreset('gentle')}
                  title="Auto baseline, 2s gate, +0.05s growth"
                >
                  🌿 Gentle
                </button>
                <button
                  type="button"
                  className={`btn-preset ${settings.manualTargetSec === 7 ? 'active' : ''}`}
                  onClick={() => handleApplyPreset('balanced')}
                  title="7s Target, 2s gate, +0.10s growth"
                >
                  🎯 7s Target
                </button>
                <button
                  type="button"
                  className={`btn-preset ${settings.manualTargetSec === 10 ? 'active' : ''}`}
                  onClick={() => handleApplyPreset('deep')}
                  title="10s Target, 3s gate, +0.15s growth"
                >
                  🧘 10s Deep
                </button>
              </div>
            </div>

            {/* Target Duration Selector */}
            <div className="setting-group" id="setting-group-target">
              <div className="setting-title-row">
                <span className="setting-title">Target Duration</span>
                <span className="setting-active-val">
                  {settings.targetMode === 'auto' ? '✨ Adaptive Auto' : `🎯 ${settings.manualTargetSec}s`}
                </span>
              </div>

              <div className="segmented-mode-toggle">
                <button
                  type="button"
                  className={`btn-mode-tab ${settings.targetMode === 'manual' ? 'active' : ''}`}
                  onClick={() => updateSetting('targetMode', 'manual')}
                >
                  ⚙️ Manual Custom
                </button>
                <button
                  type="button"
                  className={`btn-mode-tab ${settings.targetMode === 'auto' ? 'active' : ''}`}
                  onClick={() => updateSetting('targetMode', 'auto')}
                >
                  ✨ Auto (From Baseline)
                </button>
              </div>

              {settings.targetMode === 'manual' && (
                <div className="target-input-row">
                  <span style={{ fontSize: '10.5px', color: '#cbd5e1' }}>Target:</span>
                  <input
                    type="range"
                    className="slider-input"
                    min="2"
                    max="45"
                    step="1"
                    value={settings.manualTargetSec}
                    onChange={(e) => updateSetting('manualTargetSec', parseInt(e.target.value, 10))}
                  />
                  <div className="stepper-control">
                    <button
                      type="button"
                      className="btn-stepper"
                      onClick={() => updateSetting('manualTargetSec', Math.max(2, settings.manualTargetSec - 1))}
                      disabled={settings.manualTargetSec <= 2}
                    >
                      -
                    </button>
                    <input
                      type="number"
                      className="stepper-number-input"
                      min="2"
                      max="60"
                      value={settings.manualTargetSec}
                      onChange={(e) => updateSetting('manualTargetSec', Math.max(2, parseInt(e.target.value, 10) || 2))}
                    />
                    <button
                      type="button"
                      className="btn-stepper"
                      onClick={() => updateSetting('manualTargetSec', Math.min(60, settings.manualTargetSec + 1))}
                      disabled={settings.manualTargetSec >= 60}
                    >
                      +
                    </button>
                    <span style={{ fontSize: '10px', color: '#94a3b8' }}>s</span>
                  </div>
                </div>
              )}
            </div>

            {/* Platform Toggles */}
            <div className="setting-group" id="setting-group-platforms">
              <div className="setting-title-row">
                <span className="setting-title">Platforms</span>
                <span className="setting-active-val">
                  {[settings.enableYouTube && 'YouTube', settings.enableInstagram && 'Instagram'].filter(Boolean).join(' + ') || 'None'}
                </span>
              </div>
              <div className="platform-toggles-grid">
                <label className={`platform-toggle-item ${settings.enableYouTube ? 'active' : ''}`}>
                  <input
                    type="checkbox"
                    checked={settings.enableYouTube}
                    onChange={(e) => updateSetting('enableYouTube', e.target.checked)}
                  />
                  <span className="platform-toggle-label">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                    </svg>
                    YouTube Shorts
                  </span>
                </label>

                <label className={`platform-toggle-item ${settings.enableInstagram ? 'active' : ''}`}>
                  <input
                    type="checkbox"
                    checked={settings.enableInstagram}
                    onChange={(e) => updateSetting('enableInstagram', e.target.checked)}
                  />
                  <span className="platform-toggle-label">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect>
                      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path>
                      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line>
                    </svg>
                    Instagram Reels
                  </span>
                </label>
              </div>
            </div>

            {/* Target Progression Speed */}
            <div className="setting-group" id="setting-group-speed">
              <div className="setting-title-row">
                <span className="setting-title">Target Progression Speed</span>
                <span className="setting-active-val">
                  {settings.progressionSpeed === 'fixed' ? '0.0s (Fixed)' : `+${effectiveProgRate}s / video`}
                </span>
              </div>
              <div className="speed-tabs">
                <button
                  type="button"
                  className={`btn-speed-tab ${settings.progressionSpeed === 'gentle' ? 'active' : ''}`}
                  onClick={() => updateSetting('progressionSpeed', 'gentle')}
                >
                  <span>Gentle</span>
                  <span className="speed-tab-sub">+0.05s</span>
                </button>
                <button
                  type="button"
                  className={`btn-speed-tab ${settings.progressionSpeed === 'normal' ? 'active' : ''}`}
                  onClick={() => updateSetting('progressionSpeed', 'normal')}
                >
                  <span>Normal</span>
                  <span className="speed-tab-sub">+0.15s</span>
                </button>
                <button
                  type="button"
                  className={`btn-speed-tab ${settings.progressionSpeed === 'fixed' ? 'active' : ''}`}
                  onClick={() => updateSetting('progressionSpeed', 'fixed')}
                >
                  <span>Fixed</span>
                  <span className="speed-tab-sub">No grow</span>
                </button>
                <button
                  type="button"
                  className={`btn-speed-tab ${settings.progressionSpeed === 'custom' ? 'active' : ''}`}
                  onClick={() => updateSetting('progressionSpeed', 'custom')}
                >
                  <span>Custom</span>
                  <span className="speed-tab-sub">Custom</span>
                </button>
              </div>
            </div>

            {/* Save & Hard Reload Button */}
            <button
              type="button"
              className={`btn-save-reload ${saveSuccess ? 'saved' : ''} ${isSaving ? 'reloading' : ''}`}
              id="btn-save-hard-reload"
              onClick={handleSaveAndHardReload}
              disabled={isSaving}
            >
              {isSaving ? (
                <>
                  <svg className="spin-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="12" y1="2" x2="12" y2="6"></line>
                    <line x1="12" y1="18" x2="12" y2="22"></line>
                    <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line>
                    <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line>
                    <line x1="2" y1="12" x2="6" y2="12"></line>
                    <line x1="18" y1="12" x2="22" y2="12"></line>
                    <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line>
                    <line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line>
                  </svg>
                  <span>Reloading Active Tabs...</span>
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path>
                  </svg>
                  <span>Hard Refresh Active Tabs</span>
                </>
              )}
            </button>
          </div>
        )}
      </section>

      {/* Mini Line Chart: Dwell Time over Last 20 Shorts */}
      <MiniDwellChart
        events={stats.events}
        currentTargetSec={stats.currentTargetSec}
      />

      {/* Calibration Progress Bar */}
      <section className="calibration-card" id="calibration-card">
        <div className="calibration-header">
          <div className="calibration-title-group">
            <span className="calibration-badge-label">Phase</span>
            <span className="calibration-status-text">
              {stats.isCalibrated ? (
                <span className="text-cyan font-semibold">Baseline Established</span>
              ) : (
                <span>Calibration ({stats.calibrationCount}/{stats.calibrationTarget} Videos)</span>
              )}
            </span>
          </div>
          <span className="calibration-meta">
            {stats.isCalibrated
              ? `Baseline: ${(stats.baselineAvgDwellMs / 1000).toFixed(1)}s`
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
            ? `Active focus target: ${stats.currentTargetSec}s (Scroll Gate: ${stats.minimumGateSec}s).`
            : 'Focus protection starts with a gentle 2s breath pause while calculating your personalized baseline.'}
        </div>
      </section>

      {/* 6 Required Core Stats Grid */}
      <section className="stats-section" id="stats-section">
        <div className="section-label-row">
          <span className="section-label">Performance Metrics</span>
          <span className="section-sublabel">Shorts & Reels</span>
        </div>

        <div className="stats-grid-6" id="stats-grid-6">
          {/* 1. Calibration Baseline */}
          <div className={`stat-card ${stats.isCalibrated ? 'highlight-purple' : ''}`} id="stat-card-baseline">
            <span className="stat-label">Calibration Baseline</span>
            <span className="stat-value purple">
              {stats.baselineAvgDwellMs > 0
                ? `${(stats.baselineAvgDwellMs / 1000).toFixed(1)}s`
                : '--'}
            </span>
            <span className="stat-subtext">
              {stats.isCalibrated
                ? `Calibrated (${stats.calibrationCount} vids)`
                : `Phase ${stats.calibrationCount}/${stats.calibrationTarget}`}
            </span>
          </div>

          {/* 2. Current Target */}
          <div className="stat-card highlight" id="stat-card-target">
            <span className="stat-label">Current Target</span>
            <span className="stat-value cyan">
              {stats.currentTargetSec}s
            </span>
            <span className="stat-subtext">
              Gate: {stats.minimumGateSec}s • {settings.progressionSpeed === 'fixed' ? 'Fixed' : `+${effectiveProgRate}s`}
            </span>
          </div>

          {/* 3. Average Dwell Time */}
          <div className="stat-card" id="stat-card-avg-dwell">
            <span className="stat-label">Average Dwell Time</span>
            <span className="stat-value">
              {formatDuration(stats.avgDwellMs)}
            </span>
            <span className="stat-subtext">
              {stats.todayCount > 0 ? `${stats.todayCount} views today` : 'No views today'}
            </span>
          </div>

          {/* 4. Longest Watch */}
          <div className="stat-card" id="stat-card-longest-watch">
            <span className="stat-label">Longest Watch</span>
            <span className="stat-value amber">
              {formatDuration(stats.longestDwellMs)}
            </span>
            <span className="stat-subtext">
              Session peak dwell
            </span>
          </div>

          {/* 5. Shorts Watched Today */}
          <div className="stat-card" id="stat-card-watched-today">
            <span className="stat-label">Watched Today</span>
            <span className="stat-value">
              {stats.todayCount}
            </span>
            <span className="stat-subtext">
              {stats.totalEarlyScrollAttempts > 0
                ? `${stats.totalEarlyScrollAttempts} early scrolls stopped`
                : 'Pacing on track'}
            </span>
          </div>

          {/* 6. Total Shorts Time Today */}
          <div className="stat-card" id="stat-card-total-time-today">
            <span className="stat-label">Total Time Today</span>
            <span className="stat-value emerald">
              {formatDuration(stats.totalDwellMsToday)}
            </span>
            <span className="stat-subtext">
              Total viewing duration
            </span>
          </div>
        </div>
      </section>

      {/* Activity Toggle & Feed */}
      <section className="recent-section" id="recent-section">
        <div className="recent-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span>Recent Activity</span>
            <span className="activity-count-pill">{stats.events.length}</span>
          </div>
          <button
            type="button"
            className="btn-toggle-activity-view"
            onClick={() => setActiveTab(activeTab === 'overview' ? 'activity' : 'overview')}
          >
            {activeTab === 'overview' ? 'View Feed ▼' : 'Hide Feed ▲'}
          </button>
        </div>

        {activeTab === 'activity' && (
          stats.events.length === 0 ? (
            <div className="empty-state" id="empty-state">
              No Shorts or Reels recorded yet. Open YouTube Shorts or Instagram Reels to begin.
            </div>
          ) : (
            <div className="recent-list" id="recent-list">
              {stats.events.slice(0, 8).map((ev) => {
                const isInsta = ev.url?.includes('instagram.com') || ev.videoId?.includes('reels') || ev.videoId?.includes('insta');
                return (
                  <div key={ev.id} className="recent-item" id={`event-item-${ev.id}`}>
                    <div className="recent-left">
                      <span className={`event-platform-tag ${isInsta ? 'platform-ig' : 'platform-yt'}`}>
                        {isInsta ? 'IG Reel' : 'YT Short'}
                      </span>
                      <span className={`event-tag ${ev.calibration ? 'tag-calib' : 'tag-intervention'}`}>
                        {ev.calibration ? 'Calib' : 'Intervention'}
                      </span>
                      <span className="recent-video-id">#{ev.videoId?.slice(0, 10) || 'video'}</span>
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
                );
              })}
            </div>
          )
        )}
      </section>

      {/* Privacy Note & Data Management Actions */}
      <section className="data-management-card" id="data-management-card">
        {/* Privacy Note */}
        <div className="privacy-note" id="privacy-note">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="privacy-icon">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
          </svg>
          <span>Your Shorts viewing data is stored locally on this browser.</span>
        </div>

        {/* Action Buttons: Export Data & Reset Data */}
        <div className="data-actions-row" id="data-actions-row">
          {/* Export JSON Button */}
          <button
            type="button"
            className="btn-export-data"
            id="btn-export-json"
            onClick={handleExportData}
            title="Download viewing events & statistics as a JSON file"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            <span>Export Data (JSON)</span>
          </button>

          {/* Reset All Data Button */}
          <button
            type="button"
            className="btn-reset-data"
            id="btn-reset-data"
            onClick={() => setIsResetConfirmOpen(true)}
            title="Clear all recorded data and restart baseline calibration"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
            <span>Reset All Data</span>
          </button>
        </div>

        {/* Sandbox Preview Simulation Controls (Web sandbox only) */}
        {typeof chrome === 'undefined' || !chrome.storage ? (
          <div className="simulation-panel" id="simulation-panel">
            <div className="simulation-label">Sandbox Simulator:</div>
            <div className="simulation-buttons">
              <button
                type="button"
                className="btn-simulate"
                id="btn-simulate-yt"
                onClick={() => handleSimulateSingleEvent('youtube')}
              >
                + YT Short
              </button>
              <button
                type="button"
                className="btn-simulate"
                id="btn-simulate-ig"
                onClick={() => handleSimulateSingleEvent('instagram')}
              >
                + IG Reel
              </button>
              {!stats.isCalibrated ? (
                <button
                  type="button"
                  className="btn-simulate-fast"
                  id="btn-simulate-fast-calib"
                  onClick={handleSimulateFastTrackCalibration}
                >
                  ⚡ Fast 3 Calib
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </section>

      {/* Footer Brand */}
      <footer className="footer-note" id="footer-note">
        FocusScroll • Mindful Pacing for YouTube Shorts & Instagram Reels
      </footer>
    </div>
  );
}
