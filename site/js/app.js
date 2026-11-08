/**
 * Autonomous Trading Observability Dashboard Application (`site/js/app.js`).
 * Handles state loading, client auto-refresh, table generation, and HITL action handlers.
 */

let refreshCountdown = 60;
let refreshTimerInterval = null;
let currentOrchestrator = null;
let currentMarket = null;
let selectedTicker = null;
let activeMatrixFilter = "all";

async function fetchJson(endpoint) {
  try {
    const res = await fetch(`${endpoint}?_t=${Date.now()}`, {
      cache: "no-store",
      headers: {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
      },
    });
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

function selectTicker(symbol) {
  if (!symbol) return;
  selectedTicker = symbol.toUpperCase();
  if (currentOrchestrator) {
    renderOrchestratorFunnel(currentOrchestrator, selectedTicker);
  }
  if (currentMarket) {
    renderMarketAndTechnicals(currentMarket, selectedTicker, activeMatrixFilter);
  }
}

function setupMatrixFilters() {
  const bar = document.getElementById("matrix-filter-bar");
  if (!bar || bar.dataset.initialized) return;
  bar.dataset.initialized = "true";
  bar.addEventListener("click", (e) => {
    const btn = e.target.closest(".filter-btn");
    if (!btn) return;
    bar.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    activeMatrixFilter = btn.dataset.filter || "all";
    if (currentMarket) {
      renderMarketAndTechnicals(currentMarket, selectedTicker, activeMatrixFilter);
    }
  });
}

async function loadDashboardData() {
  const [summary, positions, orchestrator, market, history] = await Promise.all([
    fetchJson("data/summary.json"),
    fetchJson("data/positions.json"),
    fetchJson("data/orchestrator.json"),
    fetchJson("data/market.json"),
    fetchJson("data/history.json"),
  ]);

  currentOrchestrator = orchestrator;
  currentMarket = market;
  if (!selectedTicker) {
    selectedTicker = orchestrator?.topCandidate || market?.defaultSelectedTicker || "OIL";
  }

  renderHeaderAndKpis(summary);
  renderActiveTrades(positions, summary);
  renderOrchestratorFunnel(orchestrator, selectedTicker);
  renderMarketAndTechnicals(market, selectedTicker, activeMatrixFilter);
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
    const todayPnl = port.realizedNetPnLToday ?? 0;
    realizedEl.innerText = formatCurrency(todayPnl);
    realizedEl.className = `kpi-value ${todayPnl >= 0 ? "val-green" : "val-red"}`;
  }

  const realizedSubEl = document.getElementById("kpi-realized-sub");
  if (realizedSubEl) {
    const todayCount = port.closedTradesToday ?? 0;
    if (port.realizedNetPnLTotal !== undefined && port.realizedNetPnLTotal !== null) {
      realizedSubEl.innerText = `${todayCount} closed today · All-time: ${formatCurrency(port.realizedNetPnLTotal)}`;
    } else {
      realizedSubEl.innerText = "Fully Loaded (netProfit - fees)";
    }
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

  const instIdMap = { "OIL": 17, "NVDA": 1137 };

  container.innerHTML = positions.map(pos => {
    const pnlClass = pos.unrealizedPnL >= 0 ? "val-green" : "val-red";
    const dirBadge = pos.direction === "buy" || pos.direction === "long"
      ? '<span class="badge badge-buy">BUY</span>'
      : '<span class="badge badge-short">SELL</span>';
    const links = pos.actionLinks || {};
    const sym = pos.symbol || "OIL";
    const idTag = instIdMap[sym] ? `(ID ${instIdMap[sym]})` : "";
    const nameLabel = pos.displayName && pos.displayName !== sym
      ? `<br><span style="color:var(--text-dim); font-size:11px;">${pos.displayName}</span>`
      : "";

    return `
      <tr>
        <td class="mono"><strong>#${pos.positionId}</strong></td>
        <td><strong>${sym}</strong> <span style="color:var(--text-muted); font-size:11px;">${idTag}</span>${nameLabel}</td>
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

function renderOrchestratorFunnel(orch, selTicker) {
  if (!orch) return;

  const scoreEl = document.getElementById("confluence-score-val");
  const thresholdEl = document.getElementById("confluence-threshold-val");
  const fillEl = document.getElementById("confluence-progress-fill");
  const markerEl = document.getElementById("confluence-threshold-marker");
  const statusEl = document.getElementById("orchestrator-status-text");
  const diagEl = document.getElementById("orchestrator-diag-text");
  const tierBadge = document.getElementById("sentiment-tier-badge");
  const tickerSelect = document.getElementById("funnel-ticker-select");

  // 1. Pipeline Summary Counters
  const fn = orch.funnelMetrics || {};
  const totalWatched = fn.totalWatched || (orch.watchlist?.length || 0);
  const parityPassed = fn.parityPassed || totalWatched;
  const confluenceEligible = fn.confluenceEligible !== undefined ? fn.confluenceEligible : 0;
  const actionableEntries = fn.actionableEntries !== undefined ? fn.actionableEntries : 0;

  const wEl = document.getElementById("fn-stage-watched");
  const pEl = document.getElementById("fn-stage-parity");
  const cEl = document.getElementById("fn-stage-confluence");
  const aEl = document.getElementById("fn-stage-actionable");
  if (wEl) wEl.innerText = totalWatched;
  if (pEl) pEl.innerText = parityPassed;
  if (cEl) cEl.innerText = confluenceEligible;
  if (aEl) aEl.innerText = actionableEntries;

  // 2. Resolve Active Candidate
  const targetSymbol = (selTicker || orch.topCandidate || orch.instrument || "OIL").toUpperCase();
  const evals = orch.evaluations || {};
  const activeEval = evals[targetSymbol] || orch.rankedCandidates?.find(c => c.symbol === targetSymbol) || orch;

  // 3. Populate Ticker Select Dropdown if needed
  if (tickerSelect) {
    const symbols = Object.keys(evals).length > 0
      ? Object.keys(evals)
      : (orch.rankedCandidates?.length > 0 ? orch.rankedCandidates.map(c => c.symbol) : (orch.watchlist || ["OIL"]));
    
    const rankedMap = {};
    (orch.rankedCandidates || []).forEach((c) => { rankedMap[c.symbol] = c.confluenceScore; });

    const currentOpts = Array.from(tickerSelect.options).map(o => o.value).join(",");
    const newOpts = symbols.join(",");
    if (currentOpts !== newOpts) {
      tickerSelect.innerHTML = symbols.map(s => {
        const sc = rankedMap[s] !== undefined ? ` (${rankedMap[s].toFixed(1)})` : "";
        return `<option value="${s}">${s}${sc}</option>`;
      }).join("");

      tickerSelect.onchange = (e) => {
        selectTicker(e.target.value);
      };
    }
    tickerSelect.value = targetSymbol;
  }

  // 4. Confluence Score & Marker
  const score = activeEval.confluenceScore !== undefined ? activeEval.confluenceScore : (orch.confluenceScore || 0);
  const threshold = activeEval.confluenceThreshold !== undefined ? activeEval.confluenceThreshold : (orch.confluenceThreshold || 75.0);

  if (scoreEl) scoreEl.innerText = score.toFixed(1);
  if (thresholdEl) thresholdEl.innerText = `/ 100.0 (Min: ${threshold.toFixed(1)})`;

  const pct = Math.min(Math.max(score, 0), 100);
  if (fillEl) {
    fillEl.style.width = `${pct}%`;
    fillEl.style.background = score >= threshold ? "var(--green)" : (score >= 50 ? "var(--amber)" : "var(--red)");
  }
  if (markerEl) {
    markerEl.style.left = `${threshold}%`;
  }

  // 5. Sentiment Tier Badge
  if (tierBadge) {
    const isFallback = activeEval.isFallbackSentiment;
    const provider = (activeEval.assessmentProvider || "").toLowerCase();
    if (isFallback) {
      tierBadge.innerText = "⚠️ TIER 4: FALLBACK (0.40x)";
      tierBadge.className = "badge badge-tier-fallback";
      tierBadge.title = "Tier 4 Exhaustion Fallback active: score discounted 60%, max confidence 40%, confluence capped at 60.0";
    } else if (provider.includes("copilot")) {
      tierBadge.innerText = "TIER 1: COPILOT (1.00x)";
      tierBadge.className = "badge badge-tier-copilot";
      tierBadge.title = "Full AI sentiment fidelity via GitHub Copilot Models";
    } else if (provider.includes("antigravity")) {
      tierBadge.innerText = "TIER 2: ANTIGRAVITY (1.00x)";
      tierBadge.className = "badge badge-tier-antigravity";
      tierBadge.title = "Full AI sentiment fidelity via Antigravity SDK inference";
    } else if (provider.includes("gemini")) {
      tierBadge.innerText = "TIER 3: GEMINI API (1.00x)";
      tierBadge.className = "badge badge-tier-gemini";
      tierBadge.title = "Full AI sentiment fidelity via direct Gemini API reserve";
    } else {
      tierBadge.innerText = "TIER 1: AI SENTIMENT";
      tierBadge.className = "badge badge-tier-copilot";
      tierBadge.title = "Standard AI sentiment";
    }
  }

  // 6. Status & Diagnostic
  if (statusEl) {
    const stat = activeEval.status || orch.status || "UNKNOWN";
    statusEl.innerHTML = `Focus: <strong>${targetSymbol}</strong> · Status: <strong>${stat}</strong> · Cadence: <span class="mono">${orch.cadence || "9m"}</span>`;
  }
  if (diagEl) {
    const diag = activeEval.diagnostic || orch.diagnostic || "No cycle diagnostics recorded.";
    const vetoes = activeEval.hardVetoes && activeEval.hardVetoes.length > 0
      ? `Active Veto: ${activeEval.hardVetoes.join(" · ")}`
      : diag;
    diagEl.innerText = vetoes;
  }

  // 7. Breakdown Pillars
  const bd = activeEval.confluenceBreakdown || orch.confluenceBreakdown || {};
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

function renderMarketAndTechnicals(market, selTicker, activeFilter = "all") {
  if (!market) return;
  setupMatrixFilters();

  const container = document.getElementById("market-matrix-table-body");
  const countBadge = document.getElementById("market-ticker-count");
  if (!container) return;

  const tickersMap = market.tickers || (market.instrument ? { [market.instrument.symbol || "OIL"]: market } : {});
  const symbols = Object.keys(tickersMap);

  if (countBadge) {
    countBadge.innerText = `${symbols.length} Tickers`;
  }

  if (symbols.length === 0) {
    container.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--text-dim); padding:20px;">No ticker snapshots available.</td></tr>`;
    return;
  }

  const activeSym = (selTicker || market.defaultSelectedTicker || symbols[0]).toUpperCase();

  let filtered = symbols;
  if (activeFilter === "stocks") {
    filtered = symbols.filter(s => tickersMap[s].instrument?.assetClass === "stocks");
  } else if (activeFilter === "commodities") {
    filtered = symbols.filter(s => tickersMap[s].instrument?.assetClass === "commodities");
  } else if (activeFilter === "top") {
    filtered = symbols.filter(s => (tickersMap[s].confluenceScore || 0) >= 70);
  }

  filtered.sort((a, b) => {
    const scA = tickersMap[a].confluenceScore || 0;
    const scB = tickersMap[b].confluenceScore || 0;
    return scB - scA;
  });

  if (filtered.length === 0) {
    container.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--text-dim); padding:20px;">No tickers match the active filter "${activeFilter}".</td></tr>`;
    return;
  }

  container.innerHTML = filtered.map(sym => {
    const item = tickersMap[sym] || {};
    const inst = item.instrument || {};
    const q = item.quote || {};
    const tech = item.technicals || {};
    const sent = item.sentiment || {};
    const cfl = item.confluenceScore !== undefined ? item.confluenceScore : 0;
    const sugg = item.upstreamSignal || item.suggestion || {};
    const action = (sugg.action || "hold").toUpperCase();

    const isSelected = sym === activeSym;
    const rowClass = isSelected ? "active-row" : "";
    const chgVal = q.dailyChangePercent || 0;
    const chgClass = chgVal >= 0 ? "val-green" : "val-red";

    const spVal = q.spreadPct || 0;
    const spWarn = spVal > 0.20 ? ' <span title="Wide spread" style="color:var(--amber);">⚠️</span>' : '';

    const sentDir = (sent.dominantDirection || "neutral").toUpperCase();
    const sentScore = sent.netSentimentScore !== undefined ? (sent.netSentimentScore >= 0 ? `+${sent.netSentimentScore.toFixed(2)}` : sent.netSentimentScore.toFixed(2)) : "--";
    const sentCounts = sent.recent24h ? `${sent.recent24h.bullish || 0}B/${sent.recent24h.bearish || 0}b` : "";
    const sentBadgeClass = sentDir === "BULLISH" ? "val-green" : (sentDir === "BEARISH" ? "val-red" : "val-amber");

    const trendIcon = tech.trendAlignment === "bullish" ? "🟢" : (tech.trendAlignment === "bearish" ? "🔴" : "⚪");
    const htfTrendIcon = tech.htfTrendAlignment === "bullish" ? "🟢" : (tech.htfTrendAlignment === "bearish" ? "🔴" : "⚪");
    const rsiVal = tech.rsi14 ? Number(tech.rsi14).toFixed(0) : "--";
    const rvolVal = tech.rvol ? `${Number(tech.rvol).toFixed(1)}x` : "--";

    const cflBadgeClass = cfl >= 75 ? "badge-safe" : (cfl >= 60 ? "badge-demo" : "badge-short");

    return `
      <tr class="${rowClass}" onclick="selectTicker('${sym}')">
        <td class="mono">
          <strong>${sym}</strong> <span style="font-size:10px; color:var(--text-dim);">${inst.instrumentId || ""}</span>
        </td>
        <td class="mono"><strong>$${Number(q.mid || 0).toFixed(2)}</strong></td>
        <td class="mono ${chgClass}"><strong>${formatPct(chgVal)}</strong></td>
        <td class="mono">${Number(spVal).toFixed(2)}%${spWarn}</td>
        <td>
          <span class="${sentBadgeClass}" style="font-weight:600; font-size:11px;">${sentDir}</span>
          <span class="mono" style="font-size:10px; color:var(--text-muted);">${sentScore} (${sentCounts})</span>
        </td>
        <td style="font-size:11px;">
          <span title="Trend (15m/4h)">${trendIcon}/${htfTrendIcon}</span>
          <span class="mono" style="color:var(--text-muted); margin-left:4px;">RSI:${rsiVal}</span>
          <span class="mono" style="color:var(--text-dim); margin-left:4px;">${rvolVal}</span>
        </td>
        <td>
          <span class="badge ${cflBadgeClass}">${cfl.toFixed(0)} · ${action}</span>
        </td>
        <td style="text-align:center;">
          <button class="btn-action" style="padding:2px 6px; font-size:10px;" onclick="event.stopPropagation(); selectTicker('${sym}')">🔍 Focus</button>
        </td>
      </tr>
    `;
  }).join("");
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
    const countBadge = document.getElementById("closed-trades-count");
    if (countBadge) {
      countBadge.innerText = `${trades.length} ${trades.length === 1 ? 'trade' : 'trades'}`;
      countBadge.style.display = "inline-flex";
    }

    if (trades.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-dim); padding:16px;">No closed trades recorded in reporting period.</td></tr>`;
      updateClosedTradesScroll();
      return;
    }

    tbody.innerHTML = trades.map(t => {
      const pnlClass = t.realizedNetPnL >= 0 ? "val-green" : "val-red";
      const closedDateLabel = t.closeDateTime
        ? new Date(t.closeDateTime).toISOString().replace("T", " ").slice(0, 16) + " UTC"
        : "";
      return `
        <tr>
          <td class="mono">#${t.positionId}</td>
          <td><strong>${t.symbol}</strong></td>
          <td><span class="badge ${t.direction === 'buy' || t.direction === 'long' ? 'badge-buy' : 'badge-short'}">${t.direction.toUpperCase()}</span> <span style="font-size:11px; color:var(--text-muted);">${t.leverage}x</span></td>
          <td class="mono">${t.openRate} &rarr; ${t.closeRate}</td>
          <td class="mono">${formatCurrency(t.fees)}</td>
          <td class="mono ${pnlClass}"><strong>${formatCurrency(t.realizedNetPnL)}</strong> <span style="font-size:10px; opacity:0.85;">(${formatPct(t.returnPct)})</span></td>
          <td class="cell-exit">
            <div class="trade-exit-reason">${t.exitReason}</div>
            ${closedDateLabel ? `<div class="mono trade-close-date">Closed: ${closedDateLabel}</div>` : ""}
          </td>
        </tr>
      `;
    }).join("");

    updateClosedTradesScroll();
  }
}

function updateClosedTradesScroll() {
  const container = document.getElementById("closed-trades-container");
  const tbody = document.getElementById("closed-trades-table-body");
  if (!container || !tbody) return;

  const rows = tbody.querySelectorAll("tr");
  if (rows.length > 10) {
    const thead = container.querySelector("thead");
    const headerHeight = thead ? thead.offsetHeight : 34;
    let tenRowsHeight = 0;
    for (let i = 0; i < 10; i++) {
      tenRowsHeight += rows[i].offsetHeight;
    }
    container.style.maxHeight = `${headerHeight + tenRowsHeight + 1}px`;
    container.classList.add("has-overflow");
  } else {
    container.style.maxHeight = "none";
    container.classList.remove("has-overflow");
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
    updateClosedTradesScroll();
    fetchJson("data/history.json").then(hist => {
      if (hist && typeof renderEquityCurve === "function") {
        renderEquityCurve("equity-curve-canvas", hist.equityProgression);
      }
    });
  });
});

