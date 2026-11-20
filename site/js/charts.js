/**
 * Canvas/SVG Interactive Charts for Trading Observability (`site/js/charts.js`).
 * Pure lightweight JavaScript with zero external chart library dependencies.
 */

const UTC_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatUtcTickLabel(ms, windowKey) {
  const d = new Date(ms);
  const mon = UTC_MONTHS[d.getUTCMonth()];
  const day = d.getUTCDate();
  if (windowKey === "24h") {
    const hh = String(d.getUTCHours()).padStart(2, "0");
    return hh === "00" ? `${mon} ${day}` : `${hh}:00`;
  }
  return `${mon} ${day}`;
}

function buildTimeTicks(startMs, endMs, windowKey) {
  const hourMs = 3600 * 1000;
  const dayMs = 24 * hourMs;
  const stepMs = windowKey === "24h" ? 4 * hourMs : (windowKey === "7d" ? dayMs : 7 * dayMs);
  const alignMs = windowKey === "24h" ? 4 * hourMs : dayMs;

  const firstTick = Math.ceil(startMs / alignMs) * alignMs;
  const ticks = [];
  for (let t = firstTick; t <= endMs; t += stepMs) {
    ticks.push({ ms: t, label: formatUtcTickLabel(t, windowKey) });
  }
  return ticks;
}

function formatAxisCurrency(val, signed = false) {
  const num = Number(val || 0);
  const absFormatted = `$${Math.abs(num).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;
  if (num < 0) return `-${absFormatted}`;
  if (signed && num > 0) return `+${absFormatted}`;
  return absFormatted;
}

function renderTimeSeriesChart(canvasId, seriesPoints, options = {}) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();

  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const width = rect.width;
  const height = rect.height;
  ctx.clearRect(0, 0, width, height);

  if (!seriesPoints || seriesPoints.length === 0) return;

  const valueKey = options.valueKey || "equity";
  const signedLabels = Boolean(options.signedLabels);
  const zeroBaseline = Boolean(options.zeroBaseline);
  const strokeColor = options.strokeColor || "#48cfad";
  const fillRgb = options.fillRgb || "72, 207, 173";
  const padding = { top: 20, right: 30, bottom: 30, left: 64 };

  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const values = seriesPoints.map((p) => Number(p[valueKey] || 0));
  let rawMin = Math.min(...values);
  let rawMax = Math.max(...values);
  if (zeroBaseline) {
    rawMin = Math.min(rawMin, 0);
    rawMax = Math.max(rawMax, 0);
  }

  let minVal;
  let maxVal;
  if (options.relativePadding) {
    minVal = rawMin * (1 - options.relativePadding);
    maxVal = rawMax * (1 + options.relativePadding);
  } else {
    const span = rawMax - rawMin;
    const pad = span > 0 ? span * 0.1 : 10;
    minVal = rawMin - pad;
    maxVal = rawMax + pad;
  }
  const range = maxVal - minVal || 1;

  const parsedTimes = seriesPoints
    .map((p) => (p.timestamp ? Date.parse(p.timestamp) : NaN))
    .filter((ms) => !Number.isNaN(ms));
  const hasTimeBounds =
    typeof options.startMs === "number" &&
    typeof options.endMs === "number" &&
    options.endMs > options.startMs;
  const startMs = hasTimeBounds
    ? options.startMs
    : (parsedTimes.length > 0 ? Math.min(...parsedTimes) : 0);
  const endMs = hasTimeBounds
    ? options.endMs
    : (parsedTimes.length > 0 ? Math.max(...parsedTimes) : 1);
  const timeSpan = endMs - startMs || 1;
  const windowKey = options.windowKey || "30d";

  // Horizontal Grid Lines
  ctx.strokeStyle = "#243844";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= 4; i++) {
    const y = padding.top + (plotHeight / 4) * i;
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);

    const labelVal = maxVal - (range / 4) * i;
    ctx.fillStyle = "#8d9fa6";
    ctx.font = "10px ui-monospace, monospace";
    ctx.textAlign = "right";
    ctx.fillText(formatAxisCurrency(labelVal, signedLabels), padding.left - 8, y + 3);
  }
  ctx.stroke();

  // Optional $0.00 Baseline
  if (zeroBaseline && minVal <= 0 && maxVal >= 0) {
    const zeroY = padding.top + plotHeight - ((0 - minVal) / range) * plotHeight;
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = "rgba(141, 159, 166, 0.45)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding.left, zeroY);
    ctx.lineTo(width - padding.right, zeroY);
    ctx.stroke();
    ctx.restore();
  }

  // Vertical Time Grid Lines & Timestamp Labels
  if (parsedTimes.length > 0) {
    const ticks = buildTimeTicks(startMs, endMs, windowKey);
    ctx.strokeStyle = "rgba(36, 56, 68, 0.7)";
    ctx.lineWidth = 1;
    ctx.fillStyle = "#8d9fa6";
    ctx.font = "10px ui-monospace, monospace";

    ticks.forEach((tick) => {
      const ratio = (tick.ms - startMs) / timeSpan;
      const x = padding.left + Math.min(Math.max(ratio, 0), 1) * plotWidth;

      ctx.beginPath();
      ctx.moveTo(x, padding.top);
      ctx.lineTo(x, height - padding.bottom);
      ctx.stroke();

      if (x - padding.left < 18) {
        ctx.textAlign = "left";
      } else if (width - padding.right - x < 18) {
        ctx.textAlign = "right";
      } else {
        ctx.textAlign = "center";
      }
      ctx.fillText(tick.label, x, height - padding.bottom + 16);
    });
  }

  // Plot Curve (positioned by timestamp when available)
  const points = seriesPoints.map((p, idx) => {
    const tMs = p.timestamp ? Date.parse(p.timestamp) : NaN;
    const x = !Number.isNaN(tMs)
      ? padding.left + Math.min(Math.max((tMs - startMs) / timeSpan, 0), 1) * plotWidth
      : padding.left + (plotWidth / (seriesPoints.length - 1 || 1)) * idx;
    const val = Number(p[valueKey] || 0);
    const y = padding.top + plotHeight - ((val - minVal) / range) * plotHeight;
    return { x, y, ...p };
  });

  // Area fill anchored to zero baseline (if enabled) or bottom
  const baselineY = zeroBaseline && minVal <= 0 && maxVal >= 0
    ? padding.top + plotHeight - ((0 - minVal) / range) * plotHeight
    : height - padding.bottom;
  const gradient = ctx.createLinearGradient(0, padding.top, 0, height - padding.bottom);
  gradient.addColorStop(0, `rgba(${fillRgb}, 0.25)`);
  gradient.addColorStop(1, `rgba(${fillRgb}, 0.03)`);

  ctx.beginPath();
  ctx.moveTo(points[0].x, baselineY);
  points.forEach((pt) => ctx.lineTo(pt.x, pt.y));
  ctx.lineTo(points[points.length - 1].x, baselineY);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  // Stroke line
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  points.forEach((pt) => ctx.lineTo(pt.x, pt.y));
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = "round";
  ctx.stroke();

  // Draw points
  points.forEach((pt) => {
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = "#131f26";
    ctx.fill();
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 2;
    ctx.stroke();
  });
}

function renderEquityCurve(canvasId, equityPoints, options = {}) {
  renderTimeSeriesChart(canvasId, equityPoints, {
    ...options,
    valueKey: "equity",
    relativePadding: 0.0005,
    strokeColor: "#48cfad",
    fillRgb: "72, 207, 173",
  });
}

function renderRealizedPnlCurve(canvasId, pnlPoints, options = {}) {
  const lastVal = pnlPoints && pnlPoints.length > 0
    ? Number(pnlPoints[pnlPoints.length - 1].realizedNetPnL || 0)
    : 0;
  const isPositive = lastVal >= 0;

  renderTimeSeriesChart(canvasId, pnlPoints, {
    ...options,
    valueKey: "realizedNetPnL",
    zeroBaseline: true,
    signedLabels: true,
    strokeColor: isPositive ? "#48cfad" : "#ff6b6b",
    fillRgb: isPositive ? "72, 207, 173" : "255, 107, 107",
  });
}

function renderDivergenceGauge(containerId, divergencePct) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const safeVal = Math.min(Math.max(divergencePct || 0, -3.0), 3.0);
  const isVeto = Math.abs(safeVal) > 2.5;
  const color = isVeto ? "#ff6b6b" : (Math.abs(safeVal) > 1.5 ? "#f6bb42" : "#48cfad");
  const pctWidth = Math.min(Math.abs(safeVal) / 3.0 * 100, 100);

  container.innerHTML = `
    <div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:4px;">
      <span style="color:#8d9fa6;">Spread / Quote Drift:</span>
      <span class="mono" style="color:${color}; font-weight:700;">${safeVal >= 0 ? "+" : ""}${safeVal.toFixed(2)}% ${isVeto ? "⚠️ VETO" : "NORMAL"}</span>
    </div>
    <div style="width:100%; height:6px; background:#243844; border-radius:3px; overflow:hidden;">
      <div style="width:${pctWidth}%; height:100%; background:${color}; border-radius:3px;"></div>
    </div>
  `;
}

