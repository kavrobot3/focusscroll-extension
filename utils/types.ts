export type ProgressionSpeed = 'gentle' | 'normal' | 'brisk' | 'fixed' | 'custom';
export type TargetMode = 'auto' | 'manual';
export type GateMode = 'auto' | 'fixed';

export interface FocusSettings {
  targetMode: TargetMode;
  manualTargetSec: number;
  progressionSpeed: ProgressionSpeed;
  customIncreasePerShortSec: number;
  gateMode: GateMode;
  manualGateSec: number;
  maxTargetCapSec: number;
  enableYouTube: boolean;
  enableInstagram: boolean;
}

export const DEFAULT_FOCUS_SETTINGS: FocusSettings = {
  targetMode: 'auto',
  manualTargetSec: 5,
  progressionSpeed: 'gentle',
  customIncreasePerShortSec: 0.05,
  gateMode: 'auto',
  manualGateSec: 2,
  maxTargetCapSec: 20,
  enableYouTube: true,
  enableInstagram: true,
};

export interface ShortViewEvent {
  id: string;
  videoId: string | null;
  url: string;
  startedAt: number;
  endedAt: number;
  dwellMs: number;
  timestamp: string;
  calibration: boolean;
  currentTargetSec: number;
  minimumGateSec: number;
  earlyScrollAttempts: number;
  gateUnlocked: boolean;
}

export interface CalibrationInfo {
  isCalibrated: boolean;
  calibrationCount: number;
  calibrationTarget: number;
  baselineDwellMs: number;
  baselineDwellSec: number;
  currentTargetSec: number;
  minimumGateSec: number;
  progressionRateSec: number;
  settings: FocusSettings;
}

export interface ShortsStats {
  todayCount: number;
  avgDwellMs: number;
  longestDwellMs: number;
  totalDwellMsToday: number;
  isCalibrated: boolean;
  calibrationCount: number;
  calibrationTarget: number;
  baselineAvgDwellMs: number;
  currentTargetSec: number;
  minimumGateSec: number;
  totalEarlyScrollAttempts: number;
  events: ShortViewEvent[];
  settings: FocusSettings;
}


