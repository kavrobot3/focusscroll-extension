export interface ShortViewEvent {
  id: string;
  videoId: string | null;
  url: string;
  startedAt: number;
  endedAt: number;
  dwellMs: number;
  timestamp: string;
  // Intervention fields
  calibration: boolean;
  currentTargetSec: number;
  minimumGateSec: number;
  earlyScrollAttempts: number;
  gateUnlocked: boolean;
}

export interface ShortsStats {
  todayCount: number;
  avgDwellMs: number;
  longestDwellMs: number;
  totalDwellMsToday: number;
  // Intervention & Calibration stats
  isCalibrated: boolean;
  calibrationCount: number;
  calibrationTotal: number;
  baselineDwellMs: number;
  currentTargetSec: number;
  minimumGateSec: number;
  totalEarlyScrollAttempts: number;
  events: ShortViewEvent[];
}
