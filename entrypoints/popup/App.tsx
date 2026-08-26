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
    currentTargetSec: 5,
    minimumGateSec: 2,
    totalEarlyScrollAttempts: 0,
    events: [],
    settings: DEFAULT_FOCUS_SETTINGS,
  });

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [instantSyncNotice, setInstantSyncNotice] = useState(false);
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

  // Update setting helper - saves immediately in background for INSTANT application
  const updateSetting = <K extends keyof FocusSettings>(key: K, value: FocusSettings[K]) => {
    const updated = { ...settings, [key]: value };
    setSettings(updated);
    setSaveSuccess(false);

    // Apply instantly in storage so active content scripts pick it up in real-time
    saveFocusSettings(updated);
    setInstantSyncNotice(true);
    setTimeout(() => setInstantSyncNotice(false), 1500);

    // Live preview the recalculated target in the stat cards immediately
    setStats(calculateShortsStats(stats.events, updated));
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
    setInstantSyncNotice(true);
    setTimeout(() => setInstantSyncNotice(false), 1500);
    setStats(calculateShortsStats(stats.events, preset));
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
      currentTargetSec: 5,
      minimumGateSec: 2,
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
    const durations = [4, 6, 5]; // Realistic 4-6s baseline dwells
    const sampleIds = ['dQw4w9WgXcQ', 'Cx9721_reels', 'kXYiU_JCYtU'];

    await clearShortViewEvents();

    for (let i = 0; i < 3; i++) {
      const durSec = durations[i] ?? 5;
      const dwellMs = durSec * 1000;
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
    setActionFeedback('3 Calibration views saved! Baseline ~5s');
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
              <span className="brand-tag">Shorts & Reels</span>
            </div>
            <p className="brand-subtitle" title="Gentle focus and dwell pacing on YouTube Shorts & Instagram Reels">
              Shorts & Instagram Reels Focus
            </p>
          </div>
        </div>
        <div className={`status-badge ${stats.isCalibrated ? 'active' : 'calibrating'}`} id="status-badge">
          <span className="status-dot"></span>
          <span>{stats.isCalibrated ? 'Intervention Active' : 'Calibrating'}</span>
        </div>
      </header>

      {/* Target & Progression Speed Settings Accordion */}
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
            <span>Target, Progression & Platform Settings</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {instantSyncNotice ? (
              <span className="live-sync-badge">✓ Live Synced</span>
            ) : (
              <span className="settings-badge">
                {settings.progressionSpeed === 'fixed' ? 'Fixed Target' : `+${effectiveProgRate}s/vid`}
              </span>
            )}
            <span className={`settings-toggle-arrow ${isSettingsOpen ? 'open' : ''}`}>▼</span>
          </div>
        </button>

        {isSettingsOpen && (
          <div className="settings-content" id="settings-content-drawer">
            {/* Quick Presets Tuned for Real Average Users */}
            <div className="presets-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="presets-label">Friendly Presets</span>
                <span style={{ fontSize: '9px', color: '#38bdf8' }}>⚡ Auto-applies instantly</span>
              </div>
              <div className="presets-buttons">
                <button
                  type="button"
                  className={`btn-preset ${settings.progressionSpeed === 'fixed' && settings.manualTargetSec === 4 ? 'active' : ''}`}
                  onClick={() => handleApplyPreset('starter')}
                  title="Zero pressure: 4s target, 2s gate, no progression increase"
                >
                  🐣 Starter (4s)
                </button>
                <button
                  type="button"
                  className={`btn-preset ${settings.progressionSpeed === 'gentle' && settings.targetMode === 'auto' ? 'active' : ''}`}
                  onClick={() => handleApplyPreset('gentle')}
                  title="Ultra gentle: baseline target, 2s gate, +0.05s/video growth"
                >
                  🌿 Gentle Flow
                </button>
                <button
                  type="button"
                  className={`btn-preset ${settings.manualTargetSec === 7 ? 'active' : ''}`}
                  onClick={() => handleApplyPreset('balanced')}
                  title="Balanced: 7s target, 2s gate, +0.10s/video growth"
                >
                  🎯 Balanced (7s)
                </button>
                <button
                  type="button"
                  className={`btn-preset ${settings.manualTargetSec === 10 ? 'active' : ''}`}
                  onClick={() => handleApplyPreset('deep')}
                  title="Mindful discipline: 10s target, 3s gate, +0.15s/video growth"
                >
                  🧘 Deep (10s)
                </button>
              </div>
            </div>

            {/* Platform Toggles: YouTube Shorts & Instagram Reels */}
            <div className="setting-group" id="setting-group-platforms">
              <div className="setting-title-row">
                <span className="setting-title">Active Platforms</span>
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

            {/* 1. Target Increase Speed Control */}
            <div className="setting-group" id="setting-group-speed">
              <div className="setting-title-row">
                <span className="setting-title">Target Progression Speed</span>
                <span className="setting-active-val">
                  {settings.progressionSpeed === 'fixed' ? '0.0s (Fixed)' : `+${effectiveProgRate}s / video`}
                </span>
              </div>
              <p className="setting-desc">
                How much the target focus duration increases after each watched video.
              </p>
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

              {settings.progressionSpeed === 'custom' && (
                <div className="custom-speed-row">
                  <span>Step: +</span>
                  <input
                    type="range"
                    className="slider-input"
                    min="0.01"
                    max="1.0"
                    step="0.01"
                    value={settings.customIncreasePerShortSec}
                    onChange={(e) => updateSetting('customIncreasePerShortSec', parseFloat(e.target.value))}
                  />
                  <div className="stepper-control">
                    <input
                      type="number"
                      className="stepper-number-input"
                      min="0.01"
                      max="3.0"
                      step="0.01"
                      value={settings.customIncreasePerShortSec}
                      onChange={(e) => updateSetting('customIncreasePerShortSec', parseFloat(e.target.value) || 0.05)}
                    />
                    <span style={{ fontSize: '10px', color: '#94a3b8' }}>s/vid</span>
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

            {/* 3. Minimum Scroll Gate & Max Ceiling */}
            <div className="setting-group" id="setting-group-gate">
              <div className="setting-title-row">
                <span className="setting-title">Scroll Gate & Max Ceiling</span>
                <span className="setting-active-val">
                  Gate: {settings.gateMode === 'auto' ? 'Auto (~2s)' : `${settings.manualGateSec}s`} • Cap: {settings.maxTargetCapSec}s
                </span>
              </div>
              <div className="target-input-row">
                <span style={{ fontSize: '10px', color: '#cbd5e1' }}>Gate Mode:</span>
                <div className="segmented-mode-toggle" style={{ flex: 1 }}>
                  <button
                    type="button"
                    className={`btn-mode-tab ${settings.gateMode === 'auto' ? 'active' : ''}`}
                    onClick={() => updateSetting('gateMode', 'auto')}
                  >
                    Auto Gate
                  </button>
                  <button
                    type="button"
                    className={`btn-mode-tab ${settings.gateMode === 'fixed' ? 'active' : ''}`}
                    onClick={() => updateSetting('gateMode', 'fixed')}
                  >
                    Fixed Gate
                  </button>
                </div>
              </div>

              {settings.gateMode === 'fixed' && (
                <div className="target-input-row">
                  <span style={{ fontSize: '10px', color: '#cbd5e1' }}>Fixed Gate:</span>
                  <input
                    type="range"
                    className="slider-input"
                    min="1"
                    max="10"
                    step="1"
                    value={settings.manualGateSec}
                    onChange={(e) => updateSetting('manualGateSec', parseInt(e.target.value, 10))}
                  />
                  <span style={{ fontSize: '11px', fontWeight: 600, color: '#22d3ee', minWidth: '24px', textAlign: 'right' }}>
                    {settings.manualGateSec}s
                  </span>
                </div>
              )}

              <div className="target-input-row">
                <span style={{ fontSize: '10px', color: '#cbd5e1' }}>Max Cap:</span>
                <input
                  type="range"
                  className="slider-input"
                  min="8"
                  max="60"
                  step="2"
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
                  <span>Reloading YouTube & Instagram Tabs...</span>
                </>
              ) : saveSuccess ? (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                  <span>Settings Applied & Tabs Reloaded!</span>
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path>
                  </svg>
                  <span>Hard Reload Tabs & Extension</span>
                </>
              )}
            </button>
            <div className="reload-notice">
              Settings sync live in real-time. Click above if you wish to do a clean hard refresh across all open tabs.
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
                <span>Calibration ({stats.calibrationCount}/{stats.calibrationTarget} Videos)</span>
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
            ? `Intervention active. Target progression: ${settings.progressionSpeed === 'fixed' ? 'Fixed (no increase)' : `+${effectiveProgRate}s/video`}.`
            : 'Focus protection starts with a gentle 2s breath pause while calculating your personalized baseline.'}
        </div>
      </section>

      {/* Core Metrics Grid */}
      <section className="stats-grid" id="stats-grid">
        {/* Target */}
        <div className={`stat-card ${stats.isCalibrated ? 'highlight' : ''}`} id="stat-card-target">
          <span className="stat-label">Focus Target</span>
          <span className="stat-value cyan">
            {stats.currentTargetSec}s
          </span>
          <span className="stat-subtext">
            Gate: {stats.minimumGateSec}s • {settings.progressionSpeed === 'fixed' ? 'Fixed' : `+${effectiveProgRate}s`}
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
            {stats.todayCount > 0 ? `${stats.todayCount} total videos today` : 'No videos today'}
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

      {/* Recent Shorts & Reels Activity Feed */}
      <section className="recent-section" id="recent-section">
        <div className="recent-header">
          <span>Recent Activity (Shorts & Reels)</span>
          <span>{stats.events.length > 0 ? `${stats.events.length} recorded` : ''}</span>
        </div>

        {stats.events.length === 0 ? (
          <div className="empty-state" id="empty-state">
            No Shorts or Reels recorded yet. Open YouTube Shorts or Instagram Reels to begin.
          </div>
        ) : (
          <div className="recent-list" id="recent-list">
            {stats.events.slice(0, 6).map((ev) => {
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
        )}
      </section>

      {/* Action Buttons & Sandbox Simulation */}
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
            <div className="simulation-label">Sandbox Preview Controls:</div>
            <div className="simulation-buttons">
              <button
                type="button"
                className="btn-simulate"
                id="btn-simulate-yt"
                onClick={() => handleSimulateSingleEvent('youtube')}
              >
                + Sim YT Short
              </button>
              <button
                type="button"
                className="btn-simulate"
                id="btn-simulate-ig"
                onClick={() => handleSimulateSingleEvent('instagram')}
              >
                + Sim IG Reel
              </button>
              {!stats.isCalibrated ? (
                <button
                  type="button"
                  className="btn-simulate-fast"
                  id="btn-simulate-fast-calib"
                  onClick={handleSimulateFastTrackCalibration}
                >
                  ⚡ Fast 3 Calib Views
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      <div className="footer-note">
        FocusScroll • YouTube Shorts & Instagram Reels
      </div>
    </div>
  );
}
