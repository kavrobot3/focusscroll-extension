export interface ShortViewEvent {
  id: string;
  videoId: string | null;
  url: string;
  startedAt: number;
  endedAt: number;
  dwellMs: number;
  timestamp: string;
}

export interface ShortsStats {
  todayCount: number;
  avgDwellMs: number;
  longestDwellMs: number;
  totalDwellMsToday: number;
  events: ShortViewEvent[];
}
