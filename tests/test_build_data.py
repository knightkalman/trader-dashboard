"""Unit tests for Dashboard Data Aggregator (`tests/test_build_data.py`)."""

from datetime import datetime, timezone
import json
from pathlib import Path
import unittest

from scripts.build_dashboard_data import (
    build_history_payload,
    build_market_payload,
    build_position_action_links,
    parse_monitor_markdown,
    parse_orchestrator_report,
)


class TestDashboardDataBuilder(unittest.TestCase):
    def test_parse_orchestrator_report(self):
        sample_md = """# 🧠 10-Minute Trading Orchestrator Cycle Report (`DEMO`)

- **Cycle Timestamp (UTC)**: `2026-10-26T06:18:15Z`
- **Orchestrator Enabled**: `True` · **Cadence**: `10m` · **Execution Mode**: `prepare_only` (`channel=inline_prepare`)
- **Allowed Watchlist**: `OIL` (Single Source of Truth: Step 3 `oil-17-latest.json`, `inlineRefresh=True`)

## 1. Instrument Evaluation: `OIL` (`ID: 17`) — Status: **`NO_ACTION`**

- **Step 3 Snapshot ID**: `snap_oil_17_20261026T061815Z`
- **100-Point Confluence Score**: **`60.46 / 100.0`** (Entry Threshold: `65.0`)
  - *Oil Signal Regime & News*: `10.46 / 35` · *Window & HTF*: `16.0 / 20` · *Momentum (RSI/ADX)*: `15.0 / 15` · *Volatility/RVOL*: `4.0 / 15` · *Spread Efficiency*: `15.0 / 15`
- **Diagnostic**: Confluence score 60.46 < threshold 65.00; no new trade.
"""
        parsed = parse_orchestrator_report(sample_md)
        self.assertEqual(parsed["status"], "NO_ACTION")
        self.assertEqual(parsed["confluenceScore"], 60.46)
        self.assertEqual(parsed["confluenceThreshold"], 65.0)
        self.assertEqual(parsed["confluenceBreakdown"]["regimeAndNews"]["score"], 10.46)
        self.assertEqual(parsed["confluenceBreakdown"]["windowAndHtf"]["score"], 16.0)
        self.assertEqual(parsed["confluenceBreakdown"]["momentum"]["score"], 15.0)
        self.assertEqual(parsed["confluenceBreakdown"]["volatilityRvol"]["score"], 4.0)
        self.assertEqual(parsed["confluenceBreakdown"]["spreadEfficiency"]["score"], 15.0)
        self.assertTrue(parsed["parityChecks"]["allPassed"])

    def test_parse_multi_ticker_orchestrator_report(self):
        multi_md = """# 🧠 10-Minute Trading Orchestrator Cycle Report (`DEMO`)

- **Cycle Timestamp (UTC)**: `2026-11-08T06:10:58Z`
- **Orchestrator Enabled**: `True` · **Cadence**: `10m` · **Execution Mode**: `auto_execute_all` (`channel=inline_prepare`)
- **Allowed Watchlist**: `OIL, NVDA, QCOM`

## 📊 Active Trading Suggestions Summary (`OIL` & `NVDA`)

| Ticker (`ID`) | eToro Live Quote (`Ask / Bid / Mid`) | Upstream Signal Benchmark | Synthesized Suggestion (`Dir · Conv`) | Suggested Sizing & `SL / TP` | Confluence (`0–100`) | Cycle Status & Execution Gate |
|---------------|--------------------------------------|---------------------------|---------------------------------------|------------------------------|----------------------|-------------------------------|
| **`OIL`** (`ID: 17`) | Ask `$90.000` / Bid `$89.540` (Mid `$89.770`, Sp `0.5111%`) | `CL=F` `$90.830` (`+0.34%`, `bullish`) | **`neutral`** (`action=hold`, `conv=0.0869`) | `$200` @ `5x` · `SL=88.33` · `TP=92.64` | **`43.00 / 100.0`** | **`NO_ACTION`** (Market is closed for the weekend (isWeekendClosed=true).) |
| **`NVDA`** (`ID: 1137`) | Ask `$186.760` / Bid `$186.750` (Mid `$186.755`, Sp `0.0054%`) | `NVDA` `$186.640` (`+2.78%`, `bullish`) | **`buy`** (`action=open`, `conv=0.5793`) | `$350` @ `5x` · `SL=180.08` · `TP=200.13` | **`74.00 / 100.0`** | **`NO_ACTION`** (Market is closed for the weekend (isWeekendClosed=true).) |
| **`QCOM`** (`ID: 1485`) | Ask `$165.570` / Bid `$165.530` (Mid `$165.550`, Sp `0.0242%`) | `QCOM` `$165.410` (`+5.52%`, `bullish`) | **`buy`** (`action=open`, `conv=0.6102`) | `$350` @ `5x` · `SL=160.2` · `TP=176.3` | **`89.00 / 100.0`** | **`NO_ACTION`** (Market is closed for the weekend (isWeekendClosed=true).) |

## 1. Instrument Evaluation: `OIL` (`ID: 17`) — Status: **`NO_ACTION`**

- **Step 3 Snapshot ID**: `snap_oil_17_20261108T061043Z`
- **100-Point Confluence Score**: **`43.00 / 100.0`** (Entry Threshold: `75.0`)
  - *Oil Signal Regime & News*: `24.0 / 35` · *Window & HTF*: `5.0 / 20` · *Momentum (RSI/ADX)*: `10.0 / 15` · *Volatility/RVOL*: `4.0 / 15` · *Spread Efficiency*: `0.0 / 15`
- **Active Hard Vetoes**: `Market is closed for the weekend (isWeekendClosed=true).`
- **Diagnostic**: New OIL entry blocked by hard veto(es): ['Market is closed for the weekend (isWeekendClosed=true).']

## 2. Instrument Evaluation: `QCOM` (`ID: 1485`) — Status: **`NO_ACTION`**

- **Step 3 Snapshot ID**: `snap_qcom_1485_20261108T061044Z`
- **100-Point Confluence Score**: **`89.00 / 100.0`** (Entry Threshold: `75.0`)
  - *QCOM Signal Regime & News*: `24.0 / 35` · *Window & HTF*: `15.0 / 20` · *Momentum (RSI/ADX)*: `10.0 / 15` · *Volatility/RVOL*: `20.0 / 15` · *Spread Efficiency*: `20.0 / 15`
- **Active Hard Vetoes**: `Market is closed for the weekend (isWeekendClosed=true).`
- **Diagnostic**: New QCOM entry blocked by hard veto(es): ['Market is closed for the weekend (isWeekendClosed=true).']
"""
        parsed = parse_orchestrator_report(multi_md)
        self.assertEqual(parsed["topCandidate"], "QCOM")
        self.assertEqual(parsed["confluenceScore"], 89.0)
        self.assertEqual(parsed["confluenceThreshold"], 75.0)
        self.assertEqual(parsed["funnelMetrics"]["totalWatched"], 3)
        self.assertEqual(parsed["funnelMetrics"]["confluenceEligible"], 1)
        self.assertEqual(len(parsed["rankedCandidates"]), 3)
        self.assertEqual(parsed["rankedCandidates"][0]["symbol"], "QCOM")
        self.assertEqual(parsed["rankedCandidates"][1]["symbol"], "NVDA")
        self.assertEqual(parsed["rankedCandidates"][2]["symbol"], "OIL")
        self.assertIn("QCOM", parsed["evaluations"])
        self.assertEqual(parsed["evaluations"]["QCOM"]["confluenceBreakdown"]["spreadEfficiency"]["score"], 20.0)

    def test_build_multi_ticker_market_payload(self):
        snapshots = {
            "OIL": {
                "snapshotId": "snap_oil_17",
                "instrument": {"symbol": "OIL", "instrumentId": 17, "assetClass": "commodities"},
                "etoroInstrument": {"quote": {"mid": 89.77, "spreadPct": 0.51}, "performance": {"dailyChangePercent": 0.34}},
                "technicals": {"rsi14": 45.7, "rvol": 0.8},
                "oilSignalFeed": {"newsSentiment": {"netSentimentScore": 0.12, "dominantDirection": "neutral"}},
            },
            "NVDA": {
                "snapshotId": "snap_nvda_1137",
                "instrument": {"symbol": "NVDA", "instrumentId": 1137, "assetClass": "stocks"},
                "etoroInstrument": {"quote": {"mid": 186.75, "spreadPct": 0.005}, "performance": {"dailyChangePercent": 2.78}},
                "technicals": {"rsi14": 62.4, "rvol": 2.8},
                "oilSignalFeed": {"newsSentiment": {"netSentimentScore": 0.22, "dominantDirection": "bullish"}},
            },
        }
        payload = build_market_payload(snapshots, default_selected="NVDA")
        self.assertEqual(payload["totalTickers"], 2)
        self.assertEqual(payload["defaultSelectedTicker"], "NVDA")
        self.assertIn("OIL", payload["tickers"])
        self.assertIn("NVDA", payload["tickers"])
        self.assertEqual(payload["tickers"]["NVDA"]["quote"]["mid"], 186.75)
        self.assertEqual(payload["quote"]["mid"], 186.75)  # backward compatible top-level

    def test_build_position_action_links(self):
        pos = {
            "positionId": 3625442511,
            "units": 9.826,
            "stopLossRate": 103.0,
            "takeProfitRate": 0.01,
            "currentRate": 102.16,
            "direction": "short",
        }
        links = build_position_action_links("knightkalman/trader-agent", "demo", pos, "OIL")
        self.assertIn("https://github.com/knightkalman/trader-agent/issues/new", links["modifyUrl"])
        self.assertIn("Position+3625442511", links["modifyUrl"])
        self.assertIn("trailing", links["trailingSlUrl"])
        self.assertIn("unitsToDeduct", links["closeHalfUrl"])
        self.assertIn("action=close", links["cliClose"])
        self.assertIn("action=modify", links["cliModify"])

    def test_parse_monitor_markdown(self):
        sample_md = r"""# 🎛️ Active Trades Control Center (`DEMO`)
- **Total Portfolio Value**: `$108,479.48`
- **Available Cash**: `$108,283.31`
- **Unrealized P&L**: `$-3.83`
- **Intraday Drawdown**: `-0.01%`
- **Kill-Switch Active**: `False`

## ⏳ Pending Stage 1 Preparations Awaiting Operator Approval (Stage 2)

| Signal ID | Action | Target Details | Quote | SHA-256 Hash | Clickable Approval |
|-----------|--------|----------------|-------|--------------|--------------------|
| `sig_20261025_oil_002` | **`OPEN`** | OPEN OIL buy $200.0 (5x) | `102.66` | `8123089a4333...` | **[✅ Confirm](https://github.com/knightkalman/trader-agent/issues/new?title=test)** |

## 1. Currently Running Direct Positions

| Position ID | Instrument | Direction | Leverage | Units | Invested | Open $\rightarrow$ Current | Unrealized P&L | Stop-Loss / Take-Profit | Clickable Actions |
|-------------|------------|-----------|----------|-------|----------|----------------------------|----------------|-------------------------|-------------------|
| `3625442511` | **OIL** (Oil (Non Expiry)) | `short` | `5x` | `9.826078` | `$200.00` | `101.77` $\rightarrow$ `102.16` | **`$-3.83`** | `SL=103.0 (fixed), TP=0.01` | **[Actions]** |
| `3631717687` | **NVDA** (NVIDIA Corporation) | `long` | `2x` | `1.936202` | `$199.99` | `206.59` $\rightarrow$ `206.72` | **`$0.25`** | `SL=204.41 (fixed), TP=211.85` | **[Actions]** |
"""
        parsed = parse_monitor_markdown(sample_md, "knightkalman/trader-agent", "demo")
        self.assertEqual(parsed["portfolioValue"], 108479.48)
        self.assertEqual(parsed["availableCash"], 108283.31)
        self.assertEqual(parsed["unrealizedPnL"], -3.83)
        self.assertEqual(parsed["intradayDrawdown"], -0.01)
        self.assertFalse(parsed["killSwitchActive"])
        self.assertEqual(len(parsed["positions"]), 2)
        self.assertEqual(parsed["positions"][0]["positionId"], 3625442511)
        self.assertEqual(parsed["positions"][0]["symbol"], "OIL")
        self.assertEqual(parsed["positions"][0]["displayName"], "Oil (Non Expiry)")
        self.assertIn("Position+3625442511+%28OIL%29", parsed["positions"][0]["actionLinks"]["modifyUrl"])

        self.assertEqual(parsed["positions"][1]["positionId"], 3631717687)
        self.assertEqual(parsed["positions"][1]["symbol"], "NVDA")
        self.assertEqual(parsed["positions"][1]["displayName"], "NVIDIA Corporation")
        self.assertIn("Position+3631717687+%28NVDA%29", parsed["positions"][1]["actionLinks"]["modifyUrl"])
        self.assertIn("NVDA", parsed["positions"][1]["actionLinks"]["closeFullUrl"])

        self.assertEqual(len(parsed["preparations"]), 1)
        self.assertEqual(parsed["preparations"][0]["signalId"], "sig_20261025_oil_002")
        self.assertEqual(parsed["preparations"][0]["symbol"], "OIL")

    def test_build_history_payload_separates_today_from_historical_pnl(self):
        history_doc = {
            "closedTrades": [
                {
                    "positionId": 3625646006,
                    "market": {"symbol": "OIL"},
                    "direction": "short",
                    "leverage": 5,
                    "openTime": "2026-10-26T07:24:53Z",
                    "closeTime": "2026-10-26T15:50:52Z",
                    "openRate": 100.93,
                    "closeRate": 102.00,
                    "investment": 199.99,
                    "fees": 0.0,
                    "netProfit": -10.60,
                    "stopLossRate": 102.00,
                    "takeProfitRate": 98.51,
                },
                {
                    "positionId": 3625441963,
                    "market": {"symbol": "OIL"},
                    "direction": "long",
                    "leverage": 5,
                    "openTime": "2026-10-25T14:46:45Z",
                    "closeTime": "2026-10-25T14:51:53Z",
                    "openRate": 102.76,
                    "closeRate": 102.07,
                    "investment": 199.99,
                    "fees": 0.0,
                    "netProfit": -6.71,
                    "stopLossRate": 98.50,
                    "takeProfitRate": 110.00,
                },
            ]
        }

        # On 2026-11-01, no trades closed today -> realizedNetPnLToday must be 0.0
        payload_nov1 = build_history_payload(
            history_doc=history_doc,
            current_equity=108467.90,
            now_utc=datetime(2026, 11, 1, 18, 0, 0, tzinfo=timezone.utc),
        )
        self.assertEqual(payload_nov1["metrics"]["realizedNetPnLToday"], 0.0)
        self.assertEqual(payload_nov1["metrics"]["closedTradesToday"], 0)
        self.assertEqual(payload_nov1["metrics"]["realizedNetPnL"], -17.31)

        # On 2026-10-26, only the Oct 26 trade (-10.60) closed today
        payload_oct26 = build_history_payload(
            history_doc=history_doc,
            current_equity=108467.90,
            now_utc=datetime(2026, 10, 26, 18, 0, 0, tzinfo=timezone.utc),
        )
        self.assertEqual(payload_oct26["metrics"]["realizedNetPnLToday"], -10.60)
        self.assertEqual(payload_oct26["metrics"]["closedTradesToday"], 1)
        self.assertEqual(payload_oct26["metrics"]["realizedNetPnL"], -17.31)


if __name__ == "__main__":
    unittest.main()
