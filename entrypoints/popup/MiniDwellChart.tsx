import React, { useState } from 'react';
import type { ShortViewEvent } from '@/utils/types';
import { formatDuration } from '@/utils/storage';

interface MiniDwellChartProps {
  events: ShortViewEvent[];
  currentTargetSec: number;
}

export function MiniDwellChart({ events, currentTargetSec }: MiniDwellChartProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  // Take the last 20 events, sorted chronologically ascending (oldest -> newest)
  const last20 = [...events]
    .sort((a, b) => a.startedAt - b.startedAt)
    .slice(-20);

  if (last20.length === 0) {
    return (
      <div className="mini-chart-empty" id="dwell-chart-empty">
        <div className="chart-empty-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 3v18h18" />
            <path d="M18 17V9" />
            <path d="M13 17V5" />
            <path d="M8 17v-3" />
          </svg>
        </div>
        <p className="chart-empty-text">No watch history yet</p>
        <span className="chart-empty-sub">Watch Shorts or Reels to plot your dwell time graph</span>
      </div>
    );
  }

  // Calculate dwell in seconds
  const points = last20.map((ev, index) => {
    const dwellSec = Number((ev.dwellMs / 1000).toFixed(1));
    const isInstagram = ev.url?.includes('instagram.com') || ev.videoId?.includes('reels') || ev.videoId?.includes('insta');
    const isTargetMet = dwellSec >= currentTargetSec;
    return {
      index,
      id: ev.id,
      videoId: ev.videoId || `short_${index + 1}`,
      dwellSec,
      dwellMs: ev.dwellMs,
      startedAt: ev.startedAt,
      isInstagram,
      isTargetMet,
      calibration: ev.calibration,
      earlyScrollAttempts: ev.earlyScrollAttempts || 0,
    };
  });

  const maxDwell = Math.max(currentTargetSec * 1.3, ...points.map((p) => p.dwellSec), 8);
  const minDwell = 0;

  // Chart dimensions inside SVG
  const width = 340;
  const height = 110;
  const paddingLeft = 32;
  const paddingRight = 14;
  const paddingTop = 14;
  const paddingBottom = 22;

  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  const getX = (index: number) => {
    if (points.length === 1) return paddingLeft + chartWidth / 2;
    return paddingLeft + (index / (points.length - 1)) * chartWidth;
  };

  const getY = (val: number) => {
    const clamped = Math.max(minDwell, Math.min(maxDwell, val));
    return paddingTop + chartHeight - ((clamped - minDwell) / (maxDwell - minDwell)) * chartHeight;
  };

  // Build SVG path
  const firstPointDwell = points[0]?.dwellSec ?? 0;
  const pathD = points.length === 1
    ? `M ${getX(0) - 10} ${getY(firstPointDwell)} L ${getX(0) + 10} ${getY(firstPointDwell)}`
    : points.reduce((acc, pt, idx) => {
        const x = getX(idx);
        const y = getY(pt.dwellSec);
        if (idx === 0) return `M ${x} ${y}`;
        // Smooth cubic bezier curve
        const prevPt = points[idx - 1];
        if (!prevPt) return `${acc} L ${x} ${y}`;
        const prevX = getX(idx - 1);
        const prevY = getY(prevPt.dwellSec);
        const cpX1 = prevX + (x - prevX) / 2;
        const cpY1 = prevY;
        const cpX2 = prevX + (x - prevX) / 2;
        const cpY2 = y;
        return `${acc} C ${cpX1} ${cpY1}, ${cpX2} ${cpY2}, ${x} ${y}`;
      }, '');

  // Area fill under curve
  const areaD = points.length > 1
    ? `${pathD} L ${getX(points.length - 1)} ${paddingTop + chartHeight} L ${getX(0)} ${paddingTop + chartHeight} Z`
    : '';

  // Target reference line position
  const targetY = getY(currentTargetSec);

  // Stats for the header
  const targetMetCount = points.filter((p) => p.isTargetMet).length;
  const targetMetPercent = Math.round((targetMetCount / points.length) * 100);
  const avgDwellRecent = (points.reduce((acc, p) => acc + p.dwellSec, 0) / points.length).toFixed(1);

  const hoveredPoint = hoveredIndex !== null ? points[hoveredIndex] : null;

  return (
    <div className="mini-chart-card" id="mini-dwell-chart">
      <div className="chart-header">
        <div className="chart-title-wrap">
          <span className="chart-icon">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
            </svg>
          </span>
          <span className="chart-title">Dwell Time Trend</span>
          <span className="chart-count-tag">Last {points.length} Shorts</span>
        </div>
        <div className="chart-summary-stat">
          <span className="chart-stat-label">Hit Target:</span>
          <span className={`chart-stat-val ${targetMetPercent >= 50 ? 'cyan' : 'amber'}`}>
            {targetMetPercent}% ({targetMetCount}/{points.length})
          </span>
        </div>
      </div>

      <div className="svg-container" style={{ position: 'relative' }}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="dwell-chart-svg"
          onMouseLeave={() => setHoveredIndex(null)}
        >
          <defs>
            {/* Area gradient */}
            <linearGradient id="dwellAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.35" />
              <stop offset="60%" stopColor="#0891b2" stopOpacity="0.10" />
              <stop offset="100%" stopColor="#0f172a" stopOpacity="0" />
            </linearGradient>

            {/* Line stroke gradient */}
            <linearGradient id="dwellLineGrad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#818cf8" />
              <stop offset="50%" stopColor="#22d3ee" />
              <stop offset="100%" stopColor="#34d399" />
            </linearGradient>
          </defs>

          {/* Grid horizontal lines */}
          <line
            x1={paddingLeft}
            y1={paddingTop + chartHeight}
            x2={width - paddingRight}
            y2={paddingTop + chartHeight}
            stroke="#1e293b"
            strokeWidth="1"
          />
          <line
            x1={paddingLeft}
            y1={paddingTop + chartHeight / 2}
            x2={width - paddingRight}
            y2={paddingTop + chartHeight / 2}
            stroke="#1e293b"
            strokeWidth="1"
            strokeDasharray="2 3"
          />

          {/* Y Axis labels */}
          <text
            x={paddingLeft - 6}
            y={getY(maxDwell) + 4}
            fill="#64748b"
            fontSize="9"
            textAnchor="end"
            fontFamily="monospace"
          >
            {Math.round(maxDwell)}s
          </text>
          <text
            x={paddingLeft - 6}
            y={getY(maxDwell / 2) + 3}
            fill="#475569"
            fontSize="8.5"
            textAnchor="end"
            fontFamily="monospace"
          >
            {Math.round(maxDwell / 2)}s
          </text>
          <text
            x={paddingLeft - 6}
            y={paddingTop + chartHeight}
            fill="#64748b"
            fontSize="9"
            textAnchor="end"
            fontFamily="monospace"
          >
            0s
          </text>

          {/* Target Reference Line */}
          {targetY >= paddingTop && targetY <= paddingTop + chartHeight && (
            <g className="chart-target-line-group">
              <line
                x1={paddingLeft}
                y1={targetY}
                x2={width - paddingRight}
                y2={targetY}
                stroke="#22d3ee"
                strokeWidth="1.2"
                strokeDasharray="4 3"
                opacity="0.8"
              />
              <rect
                x={width - paddingRight - 46}
                y={targetY - 8}
                width="46"
                height="14"
                rx="3"
                fill="#0f172a"
                stroke="rgba(6, 182, 212, 0.4)"
                strokeWidth="1"
              />
              <text
                x={width - paddingRight - 23}
                y={targetY + 2.5}
                fill="#22d3ee"
                fontSize="8.5"
                fontWeight="600"
                textAnchor="middle"
                fontFamily="sans-serif"
              >
                Target {currentTargetSec}s
              </text>
            </g>
          )}

          {/* Fill under line */}
          {areaD && <path d={areaD} fill="url(#dwellAreaGrad)" />}

          {/* Main Line */}
          <path
            d={pathD}
            fill="none"
            stroke="url(#dwellLineGrad)"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Interactive Data Points */}
          {points.map((pt, idx) => {
            const cx = getX(idx);
            const cy = getY(pt.dwellSec);
            const isHovered = hoveredIndex === idx;
            return (
              <g
                key={pt.id}
                onMouseEnter={() => setHoveredIndex(idx)}
                style={{ cursor: 'pointer' }}
              >
                {/* Larger transparent touch/hover target */}
                <circle cx={cx} cy={cy} r="12" fill="transparent" />

                {/* Point ring */}
                {isHovered && (
                  <circle
                    cx={cx}
                    cy={cy}
                    r="6.5"
                    fill="rgba(6, 182, 212, 0.3)"
                    stroke="#22d3ee"
                    strokeWidth="1.5"
                  />
                )}

                <circle
                  cx={cx}
                  cy={cy}
                  r={isHovered ? 4 : 2.5}
                  fill={pt.isTargetMet ? '#34d399' : '#38bdf8'}
                  stroke="#0f172a"
                  strokeWidth="1.2"
                  style={{ transition: 'r 0.15s ease' }}
                />
              </g>
            );
          })}
        </svg>

        {/* Hover Tooltip Overlay */}
        {hoveredPoint && (
          <div
            className="chart-tooltip"
            style={{
              left: `${Math.min(220, Math.max(10, getX(hoveredPoint.index) - 50))}px`,
              top: `${Math.max(0, getY(hoveredPoint.dwellSec) - 44)}px`,
            }}
          >
            <div className="tooltip-title">
              <span className={`tooltip-tag ${hoveredPoint.isInstagram ? 'ig' : 'yt'}`}>
                {hoveredPoint.isInstagram ? 'IG Reel' : 'YT Short'}
              </span>
              <span className="tooltip-id">#{hoveredPoint.videoId.slice(0, 8)}</span>
            </div>
            <div className="tooltip-row">
              <span className="tooltip-dwell">{hoveredPoint.dwellSec}s</span>
              <span className={`tooltip-status ${hoveredPoint.isTargetMet ? 'met' : 'under'}`}>
                {hoveredPoint.isTargetMet
                  ? `+${(hoveredPoint.dwellSec - currentTargetSec).toFixed(1)}s target met`
                  : `${(currentTargetSec - hoveredPoint.dwellSec).toFixed(1)}s under`}
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="chart-footer-meta">
        <span>← Earlier</span>
        <span>Avg: <strong style={{ color: '#f8fafc' }}>{avgDwellRecent}s</strong></span>
        <span>Latest →</span>
      </div>
    </div>
  );
}
