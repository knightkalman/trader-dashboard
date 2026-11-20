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

const CHART_STATES = new WeakMap();

function formatExactUtc(isoStr) {
  if (!isoStr) return "--";
  const ms = Date.parse(isoStr);
  if (Number.isNaN(ms)) return isoStr;
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

function formatTooltipCurrency(val, signed = false) {
  const num = Number(val || 0);
  const absFormatted = `$${Math.abs(num).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (num < 0) return `-${absFormatted}`;
  if (signed && num > 0) return `+${absFormatted}`;
  return absFormatted;
}

function escapeTooltipHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getOrCreateChartTooltip(canvas) {
  const parent = canvas.parentElement;
  if (!parent) return null;
  let tooltip = parent.querySelector(".chart-hover-tooltip");
  if (!tooltip) {
    tooltip = document.createElement("div");
    tooltip.className = "chart-hover-tooltip";
    tooltip.style.cssText = [
      "position:absolute",
      "pointer-events:none",
      "display:none",
      "z-index:20",
      "background:rgba(13, 22, 28, 0.96)",
      "border:1px solid #2e4858",
      "border-radius:6px",
      "padding:8px 10px",
      "font-size:11px",
      "line-height:1.45",
      "color:#e2ecef",
      "box-shadow:0 6px 18px rgba(0, 0, 0, 0.45)",
      "min-width:190px",
      "max-width:270px",
      "white-space:normal",
    ].join(";");
    parent.appendChild(tooltip);
  }
  return tooltip;
}

function buildPointTooltipHtml(pt, valueKey, signedLabels) {
  const trade = pt.trade;
  const val = Number(pt[valueKey] || 0);
  const valLabel = valueKey === "equity" ? "Equity" : "Period Net P&L";
  const valColor = valueKey === "equity" ? "#4fc1e9" : (val >= 0 ? "#48cfad" : "#ff6b6b");
  const title = trade
    ? `${escapeTooltipHtml(trade.symbol)} · ${escapeTooltipHtml((trade.direction || "").toUpperCase())} · #${escapeTooltipHtml(trade.positionId)}`
    : escapeTooltipHtml(pt.label || "Snapshot");

  let html = `<div style="font-weight:700; color:#ffffff; margin-bottom:2px;">${title}</div>`;
  html += `<div style="color:#8d9fa6; font-size:10px; font-family:ui-monospace,monospace; margin-bottom:4px;">${escapeTooltipHtml(formatExactUtc(pt.timestamp))}</div>`;
  html += `<div><span style="color:#8d9fa6;">${valLabel}:</span> <strong style="color:${valColor}; font-family:ui-monospace,monospace;">${formatTooltipCurrency(val, signedLabels)}</strong></div>`;

  if (trade) {
    const tradePnl = Number(trade.realizedNetPnL || 0);
    const pnlColor = tradePnl >= 0 ? "#48cfad" : "#ff6b6b";
    const retPct = Number(trade.returnPct || 0);
    const retSign = retPct > 0 ? "+" : "";
    html += `<div><span style="color:#8d9fa6;">Trade Net P&amp;L:</span> <strong style="color:${pnlColor}; font-family:ui-monospace,monospace;">${formatTooltipCurrency(tradePnl, true)} (${retSign}${retPct.toFixed(2)}%)</strong></div>`;
    html += `<div style="color:#b8c7ce; font-family:ui-monospace,monospace; font-size:10px; margin-top:2px;">${escapeTooltipHtml(trade.openRate)} &rarr; ${escapeTooltipHtml(trade.closeRate)} · Fees: ${formatTooltipCurrency(trade.fees)}</div>`;
    if (trade.exitReason) {
      html += `<div style="color:#8d9fa6; font-size:10px; margin-top:2px;">${escapeTooltipHtml(trade.exitReason)}</div>`;
    }
  }
  return html;
}

function bindChartHover(canvas) {
  if (canvas.dataset.hoverBound === "true") return;
  canvas.dataset.hoverBound = "true";

  canvas.addEventListener("mousemove", (e) => {
    const state = CHART_STATES.get(canvas);
    if (!state || !state.points || state.points.length === 0) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    let bestIdx = -1;
    let bestDist = Infinity;
    state.points.forEach((pt, idx) => {
      const dist = Math.hypot(pt.x - mouseX, pt.y - mouseY);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = idx;
      }
    });

    if (bestIdx === -1 || bestDist > 42) {
      let bestXIdx = -1;
      let bestXDist = Infinity;
      state.points.forEach((pt, idx) => {
        const dx = Math.abs(pt.x - mouseX);
        if (dx < bestXDist) {
          bestXDist = dx;
          bestXIdx = idx;
        }
      });
      if (bestXIdx !== -1 && bestXDist <= 28) {
        bestIdx = bestXIdx;
      } else {
        bestIdx = -1;
      }
    }

    const tooltip = getOrCreateChartTooltip(canvas);
    if (bestIdx === -1) {
      if (state.hoveredIndex !== -1) {
        state.hoveredIndex = -1;
        drawTimeSeriesCanvas(canvas, state);
      }
      if (tooltip) tooltip.style.display = "none";
      return;
    }

    if (state.hoveredIndex !== bestIdx) {
      state.hoveredIndex = bestIdx;
      drawTimeSeriesCanvas(canvas, state);
    }

    if (tooltip) {
      const pt = state.points[bestIdx];
      tooltip.innerHTML = buildPointTooltipHtml(pt, state.valueKey, state.signedLabels);
      tooltip.style.display = "block";

      const tipW = tooltip.offsetWidth || 210;
      const tipH = tooltip.offsetHeight || 90;
      let left = pt.x + 12;
      if (left + tipW > state.width - 8) {
        left = pt.x - tipW - 12;
      }
      left = Math.max(8, Math.min(left, state.width - tipW - 8));

      let top = pt.y - tipH - 10;
      if (top < 6) {
        top = pt.y + 12;
      }
      top = Math.max(6, Math.min(top, state.height - tipH - 6));

      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
    }
  });

  canvas.addEventListener("mouseleave", () => {
    const state = CHART_STATES.get(canvas);
    const tooltip = getOrCreateChartTooltip(canvas);
    if (tooltip) tooltip.style.display = "none";
    if (state && state.hoveredIndex !== -1) {
      state.hoveredIndex = -1;
      drawTimeSeriesCanvas(canvas, state);
    }
  });
}

function drawTimeSeriesCanvas(canvas, state) {
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const { width, height, padding, plotWidth, plotHeight, minVal, maxVal, range, startMs, endMs, timeSpan, windowKey, parsedTimes, valueKey, signedLabels, zeroBaseline, points, hoveredIndex } = state;

  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);

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

  const baselineY = zeroBaseline && minVal <= 0 && maxVal >= 0
    ? padding.top + plotHeight - ((0 - minVal) / range) * plotHeight
    : height - padding.bottom;

  // Per-segment trend area fills (green = upward/flat, red = downward)
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const isUp = Number(curr[valueKey] || 0) >= Number(prev[valueKey] || 0);
    const segRgb = isUp ? "72, 207, 173" : "255, 107, 107";

    const segGrad = ctx.createLinearGradient(0, padding.top, 0, height - padding.bottom);
    segGrad.addColorStop(0, `rgba(${segRgb}, 0.28)`);
    segGrad.addColorStop(1, `rgba(${segRgb}, 0.03)`);

    ctx.beginPath();
    ctx.moveTo(prev.x, baselineY);
    ctx.lineTo(prev.x, prev.y);
    ctx.lineTo(curr.x, curr.y);
    ctx.lineTo(curr.x, baselineY);
    ctx.closePath();
    ctx.fillStyle = segGrad;
    ctx.fill();
  }

  // Per-segment trend strokes
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const isUp = Number(curr[valueKey] || 0) >= Number(prev[valueKey] || 0);
    const segColor = isUp ? "#48cfad" : "#ff6b6b";

    ctx.beginPath();
    ctx.moveTo(prev.x, prev.y);
    ctx.lineTo(curr.x, curr.y);
    ctx.strokeStyle = segColor;
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.stroke();
  }

  // Hover crosshair
  if (hoveredIndex >= 0 && hoveredIndex < points.length) {
    const hp = points[hoveredIndex];
    ctx.save();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = "rgba(226, 236, 239, 0.45)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(hp.x, padding.top);
    ctx.lineTo(hp.x, height - padding.bottom);
    ctx.stroke();
    ctx.restore();
  }

  // Draw points
  points.forEach((pt, idx) => {
    const isAnchor = idx === 0 || (!pt.trade && pt.label);
    let dotColor = "#8d9fa6";
    if (!isAnchor && idx > 0) {
      const prev = points[idx - 1];
      dotColor = Number(pt[valueKey] || 0) >= Number(prev[valueKey] || 0) ? "#48cfad" : "#ff6b6b";
    } else if (pt.trade) {
      dotColor = Number(pt.trade.realizedNetPnL || 0) >= 0 ? "#48cfad" : "#ff6b6b";
    }

    const isHovered = idx === hoveredIndex;
    if (isHovered) {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 8, 0, Math.PI * 2);
      ctx.fillStyle = dotColor === "#ff6b6b" ? "rgba(255, 107, 107, 0.25)" : "rgba(72, 207, 173, 0.25)";
      ctx.fill();
    }

    ctx.beginPath();
    ctx.arc(pt.x, pt.y, isHovered ? 5 : 3.5, 0, Math.PI * 2);
    ctx.fillStyle = "#131f26";
    ctx.fill();
    ctx.strokeStyle = dotColor;
    ctx.lineWidth = 2;
    ctx.stroke();
  });
}

function renderTimeSeriesChart(canvasId, seriesPoints, options = {}) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const rect = canvas.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;

  if (!seriesPoints || seriesPoints.length === 0) {
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);
    CHART_STATES.delete(canvas);
    const tooltip = getOrCreateChartTooltip(canvas);
    if (tooltip) tooltip.style.display = "none";
    return;
  }

  const valueKey = options.valueKey || "equity";
  const signedLabels = Boolean(options.signedLabels);
  const zeroBaseline = Boolean(options.zeroBaseline);
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

  const points = seriesPoints.map((p, idx) => {
    const tMs = p.timestamp ? Date.parse(p.timestamp) : NaN;
    const x = !Number.isNaN(tMs)
      ? padding.left + Math.min(Math.max((tMs - startMs) / timeSpan, 0), 1) * plotWidth
      : padding.left + (plotWidth / (seriesPoints.length - 1 || 1)) * idx;
    const val = Number(p[valueKey] || 0);
    const y = padding.top + plotHeight - ((val - minVal) / range) * plotHeight;
    return { x, y, ...p };
  });

  const state = {
    width,
    height,
    padding,
    plotWidth,
    plotHeight,
    minVal,
    maxVal,
    range,
    startMs,
    endMs,
    timeSpan,
    windowKey,
    parsedTimes,
    valueKey,
    signedLabels,
    zeroBaseline,
    points,
    hoveredIndex: -1,
  };

  CHART_STATES.set(canvas, state);
  bindChartHover(canvas);
  drawTimeSeriesCanvas(canvas, state);
  const tooltip = getOrCreateChartTooltip(canvas);
  if (tooltip) tooltip.style.display = "none";
}

function renderEquityCurve(canvasId, equityPoints, options = {}) {
  renderTimeSeriesChart(canvasId, equityPoints, {
    ...options,
    valueKey: "equity",
    relativePadding: 0.0005,
  });
}

function renderRealizedPnlCurve(canvasId, pnlPoints, options = {}) {
  renderTimeSeriesChart(canvasId, pnlPoints, {
    ...options,
    valueKey: "realizedNetPnL",
    zeroBaseline: true,
    signedLabels: true,
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

