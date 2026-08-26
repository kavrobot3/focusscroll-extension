import { useEffect, useState } from 'react';
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
  type ProgressionSpeed,
  type ShortsStats,
  type ShortViewEvent,
} from '@/utils/types';
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
    currentTargetSec: null,
    minimumGateSec: null,
    totalEarlyScrollAttempts: 0,
    events: [],
    settings: DEFAULT_FOCUS_SETTINGS,
  });

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

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
      setStats(calculateShortsStats(updatedEvents, settings));
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

  // Update setting helper
  const updateSetting = <K extends keyof FocusSettings>(key: K, value: FocusSettings[K]) => {
    const updated = { ...settings, [key]: value };
    setSettings(updated);
    setHasUnsavedChanges(true);
    setSaveSuccess(false);

    // Live preview the recalculated target in the stat cards immediately
    setStats(calculateShortsStats(stats.events, updated));
  };

  // Preset handlers
  const handleApplyPreset = (presetName: 'gentle' | 'fixed10' | 'deep') => {
    let preset: FocusSettings;
    if (presetName === 'gentle') {
      preset = {
        ...settings,
        targetMode: 'auto',
        progressionSpeed: 'gentle',
        customIncreasePerShortSec: 0.15,
        gateMode: 'auto',
        maxTargetCapSec: 30,
      };
    } else if (presetName === 'fixed10') {
      preset = {
        ...settings,
        targetMode: 'manual',
        manualTargetSec: 10,
        progressionSpeed: 'fixed',
        customIncreasePerShortSec: 0,
        gateMode: 'auto',
        manualGateSec: 3,
        maxTargetCapSec: 25,
      };
    } else {
      // deep restraint
      preset = {
        ...settings,
        targetMode: 'manual',
        manualTargetSec: 15,
        progressionSpeed: 'normal',
        customIncreasePerShortSec: 0.4,
        gateMode: 'fixed',
        manualGateSec: 5,
        maxTargetCapSec: 45,
      };
    }

    setSettings(preset);
    setHasUnsavedChanges(true);
    setSaveSuccess(false);
    setStats(calculateShortsStats(stats.events, preset));
  };

  // Save settings and hard reload extension & tabs
  const handleSaveAndHardReload = async () => {
    setIsSaving(true);
    try {
      // 1. Save settings to storage & local storage
      await saveFocusSettings(settings);
      setHasUnsavedChanges(false);
      setSaveSuccess(true);
      setActionFeedback('Settings Saved • Reloading Extension & Tabs...');

      // 2. Perform hard reload on Chrome Extension & open YouTube tabs
      setTimeout(async () => {
        await hardReloadExtension();
        setIsSaving(false);
      }, 500);
    } catch {
      setIsSaving(false);
      setActionFeedback('Saved (Could not reload runtime)');
      setTimeout(() => setActionFeedback(null), 2000);
    }
  };

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
      settings,
    });
    setActionFeedback('Test data cleared');
    setTimeout(() => {
      setIsClearing(false);
      setActionFeedback(null);
    }, 1500);
  };

  // Simulation helpers for testing in web sandbox preview
  const handleSimulateSingleEvent = async () => {
    const existing = await getShortViewEvents();
    const currentCalib = getCalibrationInfo(existing, settings);
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
      calibration = true;
      const randomSec = Math.floor(Math.random() * 10) + 8;
      dwellMs = randomSec * 1000;
      gateUnlocked = true;
      currentTargetSec = null;
      minimumGateSec = null;
    } else {
      calibration = false;
      currentTargetSec = currentCalib.currentTargetSec;
      minimumGateSec = currentCalib.minimumGateSec;
      const userExceededGate = Math.random() > 0.3;
      if (userExceededGate && currentTargetSec) {
        dwellMs = (currentTargetSec + Math.floor(Math.random() * 6)) * 1000;
        earlyScrollAttempts = Math.random() > 0.5 ? Math.floor(Math.random() * 2) + 1 : 0;
        gateUnlocked = true;
      } else {
        earlyScrollAttempts = Math.floor(Math.random() * 3) + 1;
        const gate = minimumGateSec ?? 2;
        dwellMs = Math.max(800, (gate + 1.5) * 1000);
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
    setStats(calculateShortsStats(updated, settings));
    setActionFeedback(calibration ? 'Simulated calibration Short' : 'Simulated intervention Short');
    setTimeout(() => setActionFeedback(null), 1200);
  };

  const handleSimulateFastTrackCalibration = async () => {
    const now = Date.now();
    const durations = [12, 16, 14];
    const sampleIds = ['dQw4w9WgXcQ', '3JZ_D3ELwOQ', 'kXYiU_JCYtU'];

    await clearShortViewEvents();

    for (let i = 0; i < 3; i++) {
      const durSec = durations[i] ?? 14;
      const dwellMs = durSec * 1000;
      const startedAt = now - (3 - i) * 60000;
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
        currentTargetSec: 8,
        minimumGateSec: 3,
        earlyScrollAttempts: 0,
        gateUnlocked: true,
      };
      await saveShortViewEvent(ev);
    }

    const updated = await getShortViewEvents();
    setStats(calculateShortsStats(updated, settings));
    setActionFeedback('3 Calibration Shorts generated! Baseline ~14s');
    setTimeout(() => setActionFeedback(null), 2000);
  };

  const calibrationPercent = Math.min(100, Math.round((stats.calibrationCount / stats.calibrationTarget) * 100));
  const effectiveProgRate = getProgressionRate(settings);

  return (
    <div className="popup-container" id="focusscroll-popup">
      {/* Header */}
      <header className="header" id="popup-header">
        <div className="brand">
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
          <div>
            <div className="brand-title-row">
              <h1 className="brand-title" id="brand-title">FocusScroll</h1>
              <span className="brand-tag">Shorts</span>
            </div>
            <p className="brand-subtitle" title="Track YouTube Shorts dwell time and rebuild focus with gentle intervention">
              YouTube Shorts Focus Intervention
            </p>
          </div>
        </div>
        <div className={`status-badge ${stats.isCalibrated ? 'active' : 'calibrating'}`} id="status-badge">
          <span className="status-dot"></span>
          <span>{stats.isCalibrated ? 'Intervention Active' : 'Calibrating'}</span>
        </div>
      </header>

      {/* Target & Progression Speed Settings Accordion */}
      <section className={`settings-card ${hasUnsavedChanges ? 'has-changes' : ''}`} id="settings-card">
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
            <span className="settings-badge">
              {settings.progressionSpeed === 'fixed' ? 'Fixed Target' : `+${effectiveProgRate}s/Short`}
            </span>
            <span className={`settings-toggle-arrow ${isSettingsOpen ? 'open' : ''}`}>▼</span>
          </div>
        </button>

        {isSettingsOpen && (
          <div className="settings-content" id="settings-content-drawer">
            {/* Quick Preset Buttons */}
            <div className="presets-group">
              <span className="presets-label">Quick Presets</span>
              <div className="presets-buttons">
                <button
                  type="button"
                  className={`btn-preset ${settings.progressionSpeed === 'gentle' && settings.targetMode === 'auto' ? 'active' : ''}`}
                  onClick={() => handleApplyPreset('gentle')}
                  title="Gentle +0.15s/Short increase based on baseline"
                >
                  🌿 Gentle Auto
                </button>
                <button
                  type="button"
                  className={`btn-preset ${settings.progressionSpeed === 'fixed' && settings.manualTargetSec === 10 ? 'active' : ''}`}
                  onClick={() => handleApplyPreset('fixed10')}
                  title="Fixed 10s target without increase"
                >
                  🎯 Fixed 10s
                </button>
                <button
                  type="button"
                  className={`btn-preset ${settings.manualTargetSec === 15 && settings.progressionSpeed === 'normal' ? 'active' : ''}`}
                  onClick={() => handleApplyPreset('deep')}
                  title="Strict 15s+ target with normal progression"
                >
                  🧘 Deep 15s
                </button>
              </div>
            </div>

            {/* 1. Target Increase Speed Control */}
            <div className="setting-group" id="setting-group-speed">
              <div className="setting-title-row">
                <span className="setting-title">Target Increase Speed</span>
                <span className="setting-active-val">
                  {settings.progressionSpeed === 'fixed' ? '0.0s (Fixed)' : `+${effectiveProgRate}s / Short`}
                </span>
              </div>
              <p className="setting-desc">
                Controls how much the target focus duration increases after each watched Short.
              </p>
              <div className="speed-tabs">
                <button
                  type="button"
                  className={`btn-speed-tab ${settings.progressionSpeed === 'gentle' ? 'active' : ''}`}
                  onClick={() => updateSetting('progressionSpeed', 'gentle')}
                >
                  <span>Gentle</span>
                  <span className="speed-tab-sub">+0.15s</span>
                </button>
                <button
                  type="button"
                  className={`btn-speed-tab ${settings.progressionSpeed === 'normal' ? 'active' : ''}`}
                  onClick={() => updateSetting('progressionSpeed', 'normal')}
                >
                  <span>Normal</span>
                  <span className="speed-tab-sub">+0.40s</span>
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

              {settings.progressionSpeed === 'custom' && (
                <div className="custom-speed-row">
                  <span>Step: +</span>
                  <input
                    type="range"
                    className="slider-input"
                    min="0.05"
                    max="2.0"
                    step="0.05"
                    value={settings.customIncreasePerShortSec}
                    onChange={(e) => updateSetting('customIncreasePerShortSec', parseFloat(e.target.value))}
                  />
                  <div className="stepper-control">
                    <input
                      type="number"
                      className="stepper-number-input"
                      min="0.05"
                      max="5.0"
                      step="0.05"
                      value={settings.customIncreasePerShortSec}
                      onChange={(e) => updateSetting('customIncreasePerShortSec', parseFloat(e.target.value) || 0.1)}
                    />
                    <span style={{ fontSize: '10px', color: '#94a3b8' }}>s/Short</span>
                  </div>
                </div>
              )}
            </div>

            {/* 2. Tweak Target Mode & Duration */}
            <div className="setting-group" id="setting-group-target">
              <div className="setting-title-row">
                <span className="setting-title">Target Duration</span>
                <span className="setting-active-val">
                  {settings.targetMode === 'auto' ? 'Adaptive Auto' : `${settings.manualTargetSec}s Target`}
                </span>
              </div>
              <div className="segmented-mode-toggle">
                <button
                  type="button"
                  className={`btn-mode-tab ${settings.targetMode === 'auto' ? 'active' : ''}`}
                  onClick={() => updateSetting('targetMode', 'auto')}
                >
                  ✨ Auto (From Baseline)
                </button>
                <button
                  type="button"
                  className={`btn-mode-tab ${settings.targetMode === 'manual' ? 'active' : ''}`}
                  onClick={() => updateSetting('targetMode', 'manual')}
                >
                  ⚙️ Manual Tweak
                </button>
              </div>

              {settings.targetMode === 'manual' && (
                <div className="target-input-row">
                  <span style={{ fontSize: '10.5px', color: '#cbd5e1' }}>Manual Target:</span>
                  <input
                    type="range"
                    className="slider-input"
                    min="4"
                    max="60"
                    step="1"
                    value={settings.manualTargetSec}
                    onChange={(e) => updateSetting('manualTargetSec', parseInt(e.target.value, 10))}
                  />
                  <div className="stepper-control">
                    <button
                      type="button"
                      className="btn-stepper"
                      onClick={() => updateSetting('manualTargetSec', Math.max(4, settings.manualTargetSec - 1))}
                      disabled={settings.manualTargetSec <= 4}
                    >
                      -
                    </button>
                    <input
                      type="number"
                      className="stepper-number-input"
                      min="4"
                      max="120"
                      value={settings.manualTargetSec}
                      onChange={(e) => updateSetting('manualTargetSec', Math.max(4, parseInt(e.target.value, 10) || 4))}
                    />
                    <button
                      type="button"
                      className="btn-stepper"
                      onClick={() => updateSetting('manualTargetSec', Math.min(120, settings.manualTargetSec + 1))}
                      disabled={settings.manualTargetSec >= 120}
                    >
                      +
                    </button>
                    <span style={{ fontSize: '10px', color: '#94a3b8' }}>s</span>
                  </div>
                </div>
              )}
            </div>

            {/* 3. Minimum Scroll Gate & Max Ceiling */}
            <div className="setting-group" id="setting-group-gate">
              <div className="setting-title-row">
                <span className="setting-title">Scroll Gate & Max Ceiling</span>
                <span className="setting-active-val">
                  Cap: {settings.maxTargetCapSec}s
                </span>
              </div>
              <div className="target-input-row">
                <span style={{ fontSize: '10px', color: '#cbd5e1' }}>Max Cap:</span>
                <input
                  type="range"
                  className="slider-input"
                  min="15"
                  max="90"
                  step="5"
                  value={settings.maxTargetCapSec}
                  onChange={(e) => updateSetting('maxTargetCapSec', parseInt(e.target.value, 10))}
                />
                <span style={{ fontSize: '11px', fontWeight: 600, color: '#22d3ee', minWidth: '28px', textAlign: 'right' }}>
                  {settings.maxTargetCapSec}s
                </span>
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
                  <span>Hard Reloading Extension & Tabs...</span>
                </>
              ) : saveSuccess ? (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                  <span>Settings Applied & Reloaded!</span>
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path>
                  </svg>
                  <span>Apply & Hard Reload Extension</span>
                </>
              )}
            </button>
            <div className="reload-notice">
              Hard reloads extension & YouTube tabs to apply settings immediately with zero stale state.
            </div>
          </div>
        )}
      </section>

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
            ? `Intervention active. Target progression: ${settings.progressionSpeed === 'fixed' ? 'Fixed (no increase)' : `+${effectiveProgRate}s/Short`}.`
            : 'Focus protection starts immediately with a gentle gate while establishing your personalized baseline.'}
        </div>
      </section>

      {/* Core Metrics Grid */}
      <section className="stats-grid" id="stats-grid">
        {/* Hidden Target */}
        <div className={`stat-card ${stats.isCalibrated ? 'highlight' : ''}`} id="stat-card-target">
          <span className="stat-label">Focus Target</span>
          <span className="stat-value cyan">
            {stats.currentTargetSec !== null ? (
              `${stats.currentTargetSec}s`
            ) : (
              <span className="text-dim text-sm">8s</span>
            )}
          </span>
          <span className="stat-subtext">
            {stats.minimumGateSec !== null
              ? `Gate: ${stats.minimumGateSec}s • ${settings.progressionSpeed === 'fixed' ? 'Fixed' : `+${effectiveProgRate}s`}`
              : 'Initial Gate: 3s'}
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
                  ⚡ Fast-Track 3 Calib Shorts
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      <div className="footer-note">
        FocusScroll • Target & Progression Control
      </div>
    </div>
  );
}
