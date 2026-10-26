# eToro Autonomous Trading Observability Dashboard (`trader-dashboard`)

[![Deploy to GitHub Pages](https://github.com/knightkalman/trader-dashboard/actions/workflows/deploy-dashboard.yml/badge.svg)](https://github.com/knightkalman/trader-dashboard/actions/workflows/deploy-dashboard.yml)
[![Live Dashboard](https://img.shields.io/badge/GitHub%20Pages-Live%20Dashboard-48cfad?logo=github)](https://knightkalman.github.io/trader-dashboard/)

An automated financial observability dashboard and telemetry visualization suite for the **eToro Autonomous Trading Agent** ([`knightkalman/trader-agent`](https://github.com/knightkalman/trader-agent)) and its **10-minute Trading Orchestrator**, monitoring **Oil (Non Expiry) (`OIL` · eToro `Instrument ID: 17`)**, its active CFD positions, leverage parameters, order lifecycles, and Human-in-the-Loop (HITL) control plane.

Deployed serverlessly on **GitHub Pages**: **[`https://knightkalman.github.io/trader-dashboard/`](https://knightkalman.github.io/trader-dashboard/)**

---

## 1. Live Features & Architecture

```mermaid
flowchart TD
    subgraph AgentRepo["Trading Agent (knightkalman/trader-agent)"]
        S3["Step 3 Data Enrichment\n(9-min Oil Snapshots)"]
        Orch["10-Min Orchestrator Engine\n(Cycle Reports)"]
        Exec["Execution Pipeline\n(Order Receipts & Confirmations)"]
        Issue1["🎛️ Issue #1 Live Control Panel\n(Human-in-the-Loop Checkboxes)"]
    end

    subgraph DashboardCI["Self-Updating Dashboard CI (trader-dashboard)"]
        Workflow[".github/workflows/deploy-dashboard.yml\n(Cron: */10m · push · dispatch)"]
        Aggregator["scripts/build_dashboard_data.py\n(Parses snapshots, reconciles P&L, redacts keys)"]
        StaticData[("site/data/*.json\nsummary · orchestrator · positions · market · history")]
        PagesDeploy["actions/deploy-pages@v4"]
    end

    subgraph LivePages["GitHub Pages Web Dashboard"]
        UI["https://knightkalman.github.io/trader-dashboard/\n• KPI Metric Strip (Equity, Cash, Margin, P&L)\n• Active Trades & HITL Control Links\n• 100-Point Confluence & Parity Visualizer\n• Live Oil Market & Benchmark Divergence\n• Reconciled Equity Curve & Fees Drag"]
    end

    S3 --> Aggregator
    Orch --> Aggregator
    Exec --> Aggregator
    Workflow --> Aggregator --> StaticData --> PagesDeploy --> UI
    UI -.->|1. Alter SL/TP, Trailing, Scale Out| Issue1
    UI -.->|2. One-Click CLI Copy (gh workflow run)| Exec
```

---

## 2. Dashboard Visual Panels

| Panel | Core Visualizations | Interactive Capabilities |
|-------|---------------------|--------------------------|
| **1. KPI Metric Strip** | Total Equity, Available Cash, Used Margin, Unrealized Floating P&L, Realized Net P&L Today. | Color-coded performance states and mode badge (`DEMO` / `REAL`). |
| **2. Active Trades & HITL Control Center** | Live open CFD positions (`direct.positions`), leverage multiplier, open vs current rates, distance to SL/TP, floating P&L. | **`[✏️ Alter SL/TP]`** · **`[🛡️ Trailing SL]`** · **`[🌗 Scale 50%]`** · **`[🛑 Close 100%]`** (pre-filled Issue forms) and **`[📋 CLI]`** copyable commands. |
| **3. Stage 1 Preparations Banner** | Prepared orders awaiting operator approval: Signal ID, quote, SHA-256 hash, and TTL countdown. | **`[✅ One-Click Approve in Issue]`** deep-linking directly to Issue #1. |
| **4. 100-Point Confluence Visualizer** | Progress gauge vs threshold (65 / 100), plus 5 breakdown pillars (Regime & News 35, HTF 20, Momentum 15, Volatility 15, Spread 15). | Real-time diagnostic text and 6-block data parity checklist. |
| **5. Live Oil Market & Technicals** | Oil ID 17 quote (Bid/Ask/Spread), WTI & Brent physical spot benchmarks, Divergence meter, EMA20/50/200, RSI(14), ADX(14), ATR%, RVOL, and AI News Sentiment. | Visual warning indicator if divergence exceeds 2.5% veto limit. |
| **6. Reconciled Performance & Journal** | Interactive Canvas equity curve ($$\text{RealizedNetPnL} = \text{netProfit} - \text{fees}$$), Win Rate, Profit Factor, Expectancy ($E$), and closed trade journal. | Accurate deduction of overnight/weekend CFD financing costs. |

---

## 3. Human-in-the-Loop (HITL) Controls

Every trade displayed on the dashboard implements the control protocols defined in [`step-2-order-communication-and-protocols.md`](https://github.com/knightkalman/trader-agent/blob/main/plan/trading-agent-core/step-2-order-communication-and-protocols.md):

1. **Alter SL / TP (`action=modify`)**:
   Generates a pre-filled issue URL that loads `knightkalman/trader-agent/issues/new` with pre-populated parameters for `stopLossRate` and `takeProfitRate`.
2. **Trailing Stop-Loss Mode (`action=modify`)**:
   Toggles `stopLossType: "trailing"` on any running position.
3. **Scale-Out 50% (`action=close`)**:
   Partially terminates half the position units (`unitsToDeduct = units / 2.0`).
4. **Full Termination 100% (`action=close`)**:
   Closes the open position completely.
5. **Copyable CLI Execution**:
   Clicking **`[📋 CLI]`** copies the corresponding `gh workflow run` terminal command:
   ```bash
   gh workflow run trading-agent-pipeline.yml -R knightkalman/trader-agent \
     -f account=demo -f action=close -f position_id=3625442511
   ```

---

## 4. Local Development & Testing

```bash
# 1. Ingest latest agent data and generate static payloads
python3 scripts/build_dashboard_data.py --local-agent-dir ../trading-agent --output-dir site/data

# 2. Run unit tests
python3 -m unittest discover -s tests -v

# 3. Serve the static site locally
python3 -m http.server 8080 --directory site
# Navigate to: http://localhost:8080
```

---

## 5. Repository Structure

```
├── .github/
│   └── workflows/
│       └── deploy-dashboard.yml     # Self-updating GitHub Pages deployment workflow
├── scripts/
│   └── build_dashboard_data.py      # Telemetry ingestion, parity check, & net P&L reconciliation
├── site/
│   ├── index.html                   # Responsive SPA web dashboard
│   ├── css/
│   │   └── style.css                # Dark financial UI styling
│   ├── js/
│   │   ├── app.js                   # Client auto-refresh (60s) & table renderers
│   │   └── charts.js                # Canvas equity progression curve & divergence gauge
│   └── data/                        # Static JSON payloads (summary, orchestrator, positions, market, history)
├── tests/
│   └── test_build_data.py           # Unit tests for data builder & parsers
├── plan/
│   └── step-5-observability-dashboards-and-reporting.md # Step 5 specification
└── README.md
```

---

## 6. Safety & Credential Isolation

- **Zero Secret Exposure**: The dashboard is 100% public on GitHub Pages. The build script actively strips and redacts authentication headers, API keys (`ETORO_API_KEY`, `ETORO_USER_KEY`, `OIL_SIGNAL_API_KEY`), account IDs, and signed placement tokens before producing static JSON artifacts.
- **Read-Only Ingestion**: The dashboard pipeline strictly reads telemetry and never executes placement operations autonomously. All trade actions require human initiation through GitHub Actions.
