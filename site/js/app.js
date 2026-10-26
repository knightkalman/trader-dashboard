/**
 * Autonomous Trading Observability Dashboard Application (`site/js/app.js`).
 * Handles state loading, client auto-refresh, table generation, and HITL action handlers.
 */

let refreshCountdown = 60;
let refreshTimerInterval = null;

async function fetchJson(endpoint) {
  try {
    const res = await fetch(`${endpoint}?_t=${Date.now()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${endpoint}`);
    return await res.json();
  } catch (err) {
    console.warn(`[WARN] Failed loading ${endpoint}:`, err);
    return null;
  }
}

function showToast(message) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.innerText = message;
  toast.className = "show";
  setTimeout(() => { toast.className = toast.className.replace("show", ""); }, 3000);
}

function copyToClipboard(text, successMsg = "Command copied to clipboard!") {
  navigator.clipboard.writeText(text).then(
    () => showToast(successMsg),
    () => showToast("Failed copying to clipboard")
  );
}

function formatCurrency(val, decimals = 2) {
  if (val === null || val === undefined) return "$0.00";
  const num = Number(val);
  const sign = num < 0 ? "-" : "";
  return `${sign}$${Math.abs(num).toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

function formatPct(val, withSign = true) {
  if (val === null || val === undefined) return "0.00%";
  const num = Number(val);
  const sign = withSign && num > 0 ? "+" : "";
  return `${sign}${num.toFixed(2)}%`;
}

async function loadDashboardData() {
  const [summary, positions, orchestrator, market, history] = await Promise.all([
    fetchJson("data/summary.json"),
    fetchJson("data/positions.json"),
    fetchJson("data/orchestrator.json"),
    fetchJson("data/market.json"),
    fetchJson("data/history.json"),
  ]);

  renderHeaderAndKpis(summary);
  renderActiveTrades(positions, summary);
  renderOrchestratorFunnel(orchestrator);
  renderMarketAndTechnicals(market);
  renderPerformanceAndJournal(history);

  const lastUpdatedEl = document.getElementById("last-updated-text");
  if (lastUpdatedEl) {
    lastUpdatedEl.innerText = `Last Refreshed: ${new Date().toLocaleTimeString()}`;
  }
}

function renderHeaderAndKpis(summary) {
  if (!summary) return;

  const modeBadge = document.getElementById("account-mode-badge");
  if (modeBadge) {
    modeBadge.innerText = (summary.account || "demo").toUpperCase();
    modeBadge.className = summary.account === "real" ? "badge badge-live" : "badge badge-demo";
  }

  const orchBadge = document.getElementById("orchestrator-status-badge");
  if (orchBadge) {
    const mode = summary.system?.executionMode || "prepare_only";
    orchBadge.innerText = `MODE: ${mode}`;
  }

  const port = summary.portfolio || {};
  document.getElementById("kpi-equity").innerText = formatCurrency(port.totalEquity);
  document.getElementById("kpi-cash").innerText = formatCurrency(port.availableCash);
  document.getElementById("kpi-margin").innerText = formatCurrency(port.usedMargin);

  const unrlzEl = document.getElementById("kpi-unrealized");
  if (unrlzEl) {
    unrlzEl.innerText = formatCurrency(port.unrealizedPnL);
    unrlzEl.className = `kpi-value ${port.unrealizedPnL >= 0 ? "val-green" : "val-red"}`;
  }

  const realizedEl = document.getElementById("kpi-realized");
  if (realizedEl) {
    realizedEl.innerText = formatCurrency(port.realizedNetPnLToday);
    realizedEl.className = `kpi-value ${port.realizedNetPnLToday >= 0 ? "val-green" : "val-red"}`;
  }

  const issueBtn = document.getElementById("link-issue-panel");
  if (issueBtn && summary.controlPanelIssueUrl) {
    issueBtn.href = summary.controlPanelIssueUrl;
  }
}

function renderActiveTrades(posData, summary) {
  const container = document.getElementById("active-positions-table-body");
  const prepBanner = document.getElementById("preparations-banner");
  if (!posData || !container) return;

  // 1. Stage 1 Preparations Banner
  const preps = posData.preparations || [];
  if (prepBanner) {
    if (preps.length > 0) {
      prepBanner.style.display = "flex";
      const prepList = preps.map(p => `
        <div style="display:flex; justify-content:space-between; align-items:center; width:100%; gap:12px;">
          <div>
            <strong>⏳ Prepared ${p.action} Order (${p.signalId})</strong>: 
            <span style="color:var(--text-muted);">${p.targetDetails}</span> · Quote: <span class="mono">${p.quote}</span> · Hash: <span class="mono">${p.orderParamsHash}</span>
          </div>
          <div style="display:flex; gap:8px;">
            <a href="${p.approvalUrl}" target="_blank" class="btn-ctrl btn-primary" style="padding:4px 10px; font-size:12px;">
              ✅ One-Click Approve in Issue
            </a>
            <a href="${p.controlPanelIssueUrl}" target="_blank" class="btn-ctrl" style="padding:4px 10px; font-size:12px;">
              🎛️ Issue #1 Control Panel
            </a>
          </div>
        </div>
      `).join("<hr style='border:0; border-top:1px solid var(--amber-border); margin:8px 0;'>");
      prepBanner.innerHTML = prepList;
    } else {
      prepBanner.style.display = "none";
    }
  }

  // 2. Active Positions Table
  const positions = posData.positions || [];
  if (positions.length === 0) {
    container.innerHTML = `<tr><td colspan="9" style="text-align:center; color:var(--text-dim); padding:24px;">No active open positions currently running on ${posData.account || "demo"} account.</td></tr>`;
    return;
  }

  container.innerHTML = positions.map(pos => {
    const pnlClass = pos.unrealizedPnL >= 0 ? "val-green" : "val-red";
    const dirBadge = pos.direction === "buy" ? '<span class="badge badge-buy">BUY</span>' : '<span class="badge badge-short">SELL</span>';
    const links = pos.actionLinks || {};

    return `
      <tr>
        <td class="mono"><strong>#${pos.positionId}</strong></td>
        <td><strong>${pos.symbol}</strong> <span style="color:var(--text-muted); font-size:11px;">(ID 17)</span></td>
        <td>${dirBadge} <span class="mono">${pos.leverage}</span></td>
        <td class="mono">${pos.units}</td>
        <td class="mono">${formatCurrency(pos.invested)}</td>
        <td class="mono">${pos.openRate} &rarr; <strong>${pos.currentRate}</strong></td>
        <td class="mono ${pnlClass}"><strong>${formatCurrency(pos.unrealizedPnL)}</strong> (${formatPct(pos.unrealizedPnLPct)})</td>
        <td class="mono" style="font-size:11px;">
          SL: ${pos.stopLossRate || "None"} (${pos.stopLossType})<br>
          TP: ${pos.takeProfitRate || "None"}
        </td>
        <td>
          <div class="action-buttons">
            <a href="${links.modifyUrl || '#'}" target="_blank" class="btn-action action-modify" title="Alter Stop-Loss & Take-Profit">✏️ Alter SL/TP</a>
            <a href="${links.trailingSlUrl || '#'}" target="_blank" class="btn-action action-modify" title="Switch to Trailing SL">🛡️ Trailing SL</a>
            <a href="${links.closeHalfUrl || '#'}" target="_blank" class="btn-action action-scale" title="Partially scale out 50% of units">🌗 Scale 50%</a>
            <a href="${links.closeFullUrl || '#'}" target="_blank" class="btn-action action-close" title="Fully close running position">🛑 Close 100%</a>
            <button onclick="copyToClipboard('${escapeJsString(links.cliClose || '')}', 'Close command copied to clipboard!')" class="btn-action action-copy" title="Copy gh workflow run close command">📋 CLI</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

function escapeJsString(str) {
  return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');
}

function renderOrchestratorFunnel(orch) {
  if (!orch) return;

  const scoreEl = document.getElementById("confluence-score-val");
  const thresholdEl = document.getElementById("confluence-threshold-val");
  const fillEl = document.getElementById("confluence-progress-fill");
  const markerEl = document.getElementById("confluence-threshold-marker");
  const statusEl = document.getElementById("orchestrator-status-text");
  const diagEl = document.getElementById("orchestrator-diag-text");

  const score = orch.confluenceScore || 0;
  const threshold = orch.confluenceThreshold || 65.0;

  if (scoreEl) scoreEl.innerText = score.toFixed(2);
  if (thresholdEl) thresholdEl.innerText = `/ 100.0 (Min: ${threshold.toFixed(1)})`;

  const pct = Math.min(Math.max(score, 0), 100);
  if (fillEl) {
    fillEl.style.width = `${pct}%`;
    fillEl.style.background = score >= threshold ? "var(--green)" : (score >= 50 ? "var(--amber)" : "var(--red)");
  }
  if (markerEl) {
    markerEl.style.left = `${threshold}%`;
  }

  if (statusEl) {
    statusEl.innerHTML = `Cycle Status: <strong>${orch.status || "UNKNOWN"}</strong> · Cadence: <span class="mono">${orch.cadence || "10m"}</span>`;
  }
  if (diagEl) {
    diagEl.innerText = orch.diagnostic || "No cycle diagnostics recorded.";
  }

  // Breakdown Pillars
  const bd = orch.confluenceBreakdown || {};
  renderPillar("pillar-regime-bar", "pillar-regime-val", bd.regimeAndNews);
  renderPillar("pillar-htf-bar", "pillar-htf-val", bd.windowAndHtf);
  renderPillar("pillar-mom-bar", "pillar-mom-val", bd.momentum);
  renderPillar("pillar-vol-bar", "pillar-vol-val", bd.volatilityRvol);
  renderPillar("pillar-spread-bar", "pillar-spread-val", bd.spreadEfficiency);
}

function renderPillar(barId, valId, data) {
  const bar = document.getElementById(barId);
  const val = document.getElementById(valId);
  if (!data) return;

  const score = data.score || 0;
  const max = data.max || 1;
  const pct = Math.min((score / max) * 100, 100);

  if (bar) {
    bar.style.width = `${pct}%`;
    bar.style.background = pct >= 70 ? "var(--green)" : (pct >= 40 ? "var(--blue)" : "var(--amber)");
  }
  if (val) {
    val.innerText = `${score.toFixed(1)} / ${max}`;
  }
}

function renderMarketAndTechnicals(market) {
  if (!market) return;

  const quote = market.quote || {};
  document.getElementById("mkt-oil-quote").innerText = `$${Number(quote.mid || 100.48).toFixed(2)}`;
  document.getElementById("mkt-oil-spread").innerText = `Spread: $${Number(quote.spread || 0.02).toFixed(2)} (${Number(quote.spreadPct || 0.02).toFixed(2)}%)`;
  document.getElementById("mkt-oil-chg").innerText = formatPct(quote.dailyChangePercent);
  document.getElementById("mkt-oil-chg").className = `mono ${quote.dailyChangePercent >= 0 ? "val-green" : "val-red"}`;

  const bench = market.benchmarks || {};
  document.getElementById("mkt-wti-price").innerText = `$${Number(bench.wti?.price || 101.09).toFixed(2)}`;
  document.getElementById("mkt-brent-price").innerText = `$${Number(bench.brent?.price || 109.70).toFixed(2)}`;
  
  if (typeof renderDivergenceGauge === "function") {
    renderDivergenceGauge("divergence-gauge-box", bench.priceDivergencePct || 0.6);
  }

  const tech = market.technicals || {};
  document.getElementById("tech-ema20").innerText = tech.ema20 ? Number(tech.ema20).toFixed(2) : "--";
  document.getElementById("tech-ema50").innerText = tech.ema50 ? Number(tech.ema50).toFixed(2) : "--";
  document.getElementById("tech-sma200").innerText = tech.sma200 ? Number(tech.sma200).toFixed(2) : "--";
  document.getElementById("tech-rsi").innerText = tech.rsi14 ? Number(tech.rsi14).toFixed(1) : "--";
  document.getElementById("tech-adx").innerText = tech.adx14 ? Number(tech.adx14).toFixed(1) : "--";
  document.getElementById("tech-atr").innerText = tech.atrPct ? `${Number(tech.atrPct).toFixed(2)}%` : "--";
  document.getElementById("tech-rvol").innerText = tech.rvol ? `${Number(tech.rvol).toFixed(2)}x` : "--";

  const sent = market.sentiment || {};
  document.getElementById("sent-score").innerText = sent.netSentimentScore !== undefined ? `${sent.netSentimentScore >= 0 ? "+" : ""}${Number(sent.netSentimentScore).toFixed(2)}` : "--";
  document.getElementById("sent-dir").innerText = (sent.dominantDirection || "neutral").toUpperCase();
}

function renderPerformanceAndJournal(hist) {
  if (!hist) return;

  const metrics = hist.metrics || {};
  document.getElementById("hist-winrate").innerText = `${metrics.winRate || 0}%`;
  document.getElementById("hist-profitfactor").innerText = `${metrics.profitFactor || 0}`;
  document.getElementById("hist-expectancy").innerText = formatCurrency(metrics.expectancy || 0);
  document.getElementById("hist-fees").innerText = formatCurrency(metrics.totalFees || 0);

  // Render Equity Canvas Curve
  if (typeof renderEquityCurve === "function" && hist.equityProgression) {
    renderEquityCurve("equity-curve-canvas", hist.equityProgression);
  }

  // Closed Trades Table
  const tbody = document.getElementById("closed-trades-table-body");
  if (tbody) {
    const trades = hist.trades || [];
    if (trades.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-dim); padding:16px;">No closed trades recorded in reporting period.</td></tr>`;
      return;
    }

    tbody.innerHTML = trades.map(t => {
      const pnlClass = t.realizedNetPnL >= 0 ? "val-green" : "val-red";
      return `
        <tr>
          <td class="mono">#${t.positionId}</td>
          <td><strong>${t.symbol}</strong></td>
          <td><span class="badge ${t.direction === 'buy' ? 'badge-buy' : 'badge-short'}">${t.direction.toUpperCase()}</span> ${t.leverage}x</td>
          <td class="mono">${t.openRate} &rarr; ${t.closeRate}</td>
          <td class="mono">${formatCurrency(t.fees)}</td>
          <td class="mono ${pnlClass}"><strong>${formatCurrency(t.realizedNetPnL)}</strong> (${formatPct(t.returnPct)})</td>
          <td style="font-size:11px; color:var(--text-muted);">${t.exitReason}</td>
        </tr>
      `;
    }).join("");
  }
}

function startAutoRefresh() {
  refreshCountdown = 60;
  if (refreshTimerInterval) clearInterval(refreshTimerInterval);

  refreshTimerInterval = setInterval(() => {
    refreshCountdown -= 1;
    const timerEl = document.getElementById("refresh-countdown");
    if (timerEl) timerEl.innerText = `${refreshCountdown}s`;

    if (refreshCountdown <= 0) {
      refreshCountdown = 60;
      loadDashboardData();
    }
  }, 1000);
}

document.addEventListener("DOMContentLoaded", () => {
  loadDashboardData();
  startAutoRefresh();

  window.addEventListener("resize", () => {
    fetchJson("data/history.json").then(hist => {
      if (hist && typeof renderEquityCurve === "function") {
        renderEquityCurve("equity-curve-canvas", hist.equityProgression);
      }
    });
  });
});

