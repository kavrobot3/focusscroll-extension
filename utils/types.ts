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
}

