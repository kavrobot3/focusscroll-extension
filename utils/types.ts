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
}

export const DEFAULT_FOCUS_SETTINGS: FocusSettings = {
  targetMode: 'auto',
  manualTargetSec: 10,
  progressionSpeed: 'gentle', // Gentle increase rate: +0.15s per Short
  customIncreasePerShortSec: 0.15,
  gateMode: 'auto',
  manualGateSec: 3,
  maxTargetCapSec: 30,
};

export interface ShortViewEvent {
  id: string;
  videoId: string | null;
  url: string;
  startedAt: number;
  endedAt: number;
  dwellMs: number;
  timestamp: string;
  // Gentle intervention mode fields
  calibration: boolean;
  currentTargetSec: number | null;
  minimumGateSec: number | null;
  earlyScrollAttempts: number;
  gateUnlocked: boolean;
}

export interface CalibrationInfo {
  isCalibrated: boolean;
  calibrationCount: number;
  calibrationTarget: number;
  baselineDwellMs: number;
  baselineDwellSec: number;
  currentTargetSec: number | null;
  minimumGateSec: number | null;
  progressionRateSec: number;
  settings: FocusSettings;
}

export interface ShortsStats {
  todayCount: number;
  avgDwellMs: number;
  longestDwellMs: number;
  totalDwellMsToday: number;
  // Gentle intervention & calibration metrics
  isCalibrated: boolean;
  calibrationCount: number;
  calibrationTarget: number;
  baselineAvgDwellMs: number;
  currentTargetSec: number | null;
  minimumGateSec: number | null;
  totalEarlyScrollAttempts: number;
  events: ShortViewEvent[];
  settings: FocusSettings;
}

