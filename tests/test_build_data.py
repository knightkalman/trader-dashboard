"""Unit tests for Dashboard Data Aggregator (`tests/test_build_data.py`)."""

import json
from pathlib import Path
import unittest

from scripts.build_dashboard_data import (
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
| `3625442511` | **OIL** | `short` | `5x` | `9.826078` | `$200.00` | `101.77` $\rightarrow$ `102.16` | **`$-3.83`** | `SL=103.0 (fixed), TP=0.01` | **[Actions]** |
"""
        parsed = parse_monitor_markdown(sample_md, "knightkalman/trader-agent", "demo")
        self.assertEqual(parsed["portfolioValue"], 108479.48)
        self.assertEqual(parsed["availableCash"], 108283.31)
        self.assertEqual(parsed["unrealizedPnL"], -3.83)
        self.assertEqual(parsed["intradayDrawdown"], -0.01)
        self.assertFalse(parsed["killSwitchActive"])
        self.assertEqual(len(parsed["positions"]), 1)
        self.assertEqual(parsed["positions"][0]["positionId"], 3625442511)
        self.assertEqual(len(parsed["preparations"]), 1)
        self.assertEqual(parsed["preparations"][0]["signalId"], "sig_20261025_oil_002")


if __name__ == "__main__":
    unittest.main()
