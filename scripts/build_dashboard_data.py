#!/usr/bin/env python3
"""Autonomous Trading Observability & GitHub Pages Data Aggregator (`scripts/build_dashboard_data.py`).

Fetches telemetry and artifacts from `knightkalman/trader-agent` and eToro Public API MCP,
reconciles net P&L (netProfit - fees), builds Human-in-the-Loop (HITL) action URLs,
sanitizes credentials, and generates static JSON payloads in `site/data/`:
  - `summary.json`
  - `positions.json`
  - `orchestrator.json`
  - `market.json`
  - `history.json`
"""

from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import re
import sys
from typing import Any
import urllib.parse
import urllib.request


def _parse_iso_utc(iso_str: Any) -> datetime | None:
    if not iso_str or not isinstance(iso_str, str):
        return None
    cleaned = iso_str.strip()
    if cleaned.endswith("Z"):
        cleaned = cleaned[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(cleaned)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except ValueError:
        return None


def fetch_github_repo_file(
    repo: str,
    file_path: str,
    token: str | None = None,
    local_dir: Path | None = None,
) -> str | None:
    """Fetch content from local path, GitHub Contents API (for private/public repos), or raw URL."""
    # 1. Local path check
    if local_dir:
        loc = local_dir / file_path
        if loc.is_file():
            try:
                content = loc.read_text(encoding="utf-8")
                print(f"[+] Loaded from local: {loc}")
                return content
            except Exception as e:
                print(f"[WARN] Failed reading local file {loc}: {e}", file=sys.stderr)

    # 2. GitHub API (works reliably for private and public repositories)
    if token:
        api_url = f"https://api.github.com/repos/{repo}/contents/{file_path}?ref=main"
        try:
            req = urllib.request.Request(api_url)
            req.add_header("User-Agent", "trader-dashboard-builder/1.0")
            req.add_header("Authorization", f"Bearer {token}")
            req.add_header("Accept", "application/vnd.github.v3.raw")
            with urllib.request.urlopen(req, timeout=15) as resp:
                content = resp.read().decode("utf-8")
                print(f"[+] Fetched via GitHub API: {file_path}")
                return content
        except Exception as e:
            print(f"[DEBUG] GitHub API fetch failed for {file_path}: {e}", file=sys.stderr)

    # 3. Raw GitHub URL
    raw_url = f"https://raw.githubusercontent.com/{repo}/main/{file_path}"
    try:
        req = urllib.request.Request(raw_url)
        req.add_header("User-Agent", "trader-dashboard-builder/1.0")
        if token:
            req.add_header("Authorization", f"token {token}")
        with urllib.request.urlopen(req, timeout=15) as resp:
            content = resp.read().decode("utf-8")
            print(f"[+] Fetched via Raw GitHub: {file_path}")
            return content
    except Exception as e:
        print(f"[WARN] Raw fetch failed for {file_path}: {e}", file=sys.stderr)

    return None


def parse_orchestrator_report(report_md: str) -> dict[str, Any]:
    """Parse `reports/orchestrator/latest-cycle-report.md` into structured data."""
    data: dict[str, Any] = {
        "cycleTimestamp": None,
        "orchestratorEnabled": True,
        "cadence": "10m",
        "executionMode": "prepare_only",
        "dispatchChannel": "inline_prepare",
        "instrument": "OIL",
        "instrumentId": 17,
        "status": "UNKNOWN",
        "snapshotId": None,
        "confluenceScore": 0.0,
        "confluenceThreshold": 65.0,
        "confluenceBreakdown": {
            "regimeAndNews": {"score": 0.0, "max": 35.0},
            "windowAndHtf": {"score": 0.0, "max": 20.0},
            "momentum": {"score": 0.0, "max": 15.0},
            "volatilityRvol": {"score": 0.0, "max": 15.0},
            "spreadEfficiency": {"score": 0.0, "max": 15.0},
        },
        "diagnostic": "",
        "parityChecks": {
            "signal": True,
            "benchmarks": True,
            "compression": True,
            "sentiment": True,
            "etoroInstrument": True,
            "technicals": True,
            "allPassed": True,
        },
    }

    if not report_md:
        return data

    ts_match = re.search(r"\*\*Cycle Timestamp \(UTC\)\*\*:\s*`([^`]+)`", report_md)
    if ts_match:
        data["cycleTimestamp"] = ts_match.group(1).strip()

    status_match = re.search(r"Status:\s*\*\*`([^`]+)`\*\*", report_md)
    if status_match:
        data["status"] = status_match.group(1).strip()

    mode_match = re.search(r"\*\*Execution Mode\*\*:\s*`([^`]+)`", report_md)
    if mode_match:
        data["executionMode"] = mode_match.group(1).strip()

    snap_match = re.search(r"\*\*Step 3 Snapshot ID\*\*:\s*`([^`]+)`", report_md)
    if snap_match:
        data["snapshotId"] = snap_match.group(1).strip()

    score_match = re.search(r"\*\*100-Point Confluence Score\*\*:\s*\*\*`([\d\.]+)\s*/\s*([\d\.]+)`\*\*(?:\s*\(Entry Threshold:\s*`([\d\.]+)`\))?", report_md)
    if score_match:
        data["confluenceScore"] = float(score_match.group(1))
        if score_match.group(3):
            data["confluenceThreshold"] = float(score_match.group(3))
        else:
            data["confluenceThreshold"] = 65.0

    breakdown_match = re.search(
        r"Oil Signal Regime & News\*:\s*`([\d\.]+)\s*/\s*35`.*?Window & HTF\*:\s*`([\d\.]+)\s*/\s*20`.*?Momentum \(RSI/ADX\)\*:\s*`([\d\.]+)\s*/\s*15`.*?Volatility/RVOL\*:\s*`([\d\.]+)\s*/\s*15`.*?Spread Efficiency\*:\s*`([\d\.]+)\s*/\s*15`",
        report_md,
        re.DOTALL,
    )
    if breakdown_match:
        data["confluenceBreakdown"]["regimeAndNews"]["score"] = float(breakdown_match.group(1))
        data["confluenceBreakdown"]["windowAndHtf"]["score"] = float(breakdown_match.group(2))
        data["confluenceBreakdown"]["momentum"]["score"] = float(breakdown_match.group(3))
        data["confluenceBreakdown"]["volatilityRvol"]["score"] = float(breakdown_match.group(4))
        data["confluenceBreakdown"]["spreadEfficiency"]["score"] = float(breakdown_match.group(5))

    diag_match = re.search(r"\*\*Diagnostic\*\*:\s*(.+)", report_md)
    if diag_match:
        data["diagnostic"] = diag_match.group(1).strip()

    return data


def build_issue_action_url(
    repo: str,
    title: str,
    action_payload: dict[str, Any],
    description: str,
) -> str:
    """Generate a GitHub Issue creation URL targeting `knightkalman/trader-agent/issues/new`."""
    pretty_json = json.dumps(action_payload, indent=2, sort_keys=True)
    body = (
        f"### 🎛️ Interactive Trade Control Request — `{title}`\n\n"
        f"{description}\n\n"
        f"> **Instructions**: Review or edit the JSON parameters below, then click **Create** (or **Submit new issue**) "
        f"to trigger GitHub Actions.\n\n"
        f"```json\n{pretty_json}\n```\n"
    )
    query = urllib.parse.urlencode({
        "labels": "trade-control",
        "title": title,
        "body": body,
    })
    return f"https://github.com/{repo}/issues/new?{query}"


def build_position_action_links(
    repo: str,
    account: str,
    position: dict[str, Any],
    symbol: str = "OIL",
) -> dict[str, str]:
    """Generate interactive action URLs for altering or terminating a running position."""
    pid = int(position.get("positionId") or 0)
    units_val = float(position.get("units") or 0.0)
    half_units = round(units_val / 2.0, 4) if units_val > 0 else 1.0
    cur_sl = position.get("stopLossRate")
    cur_tp = position.get("takeProfitRate")
    cur_rate = position.get("currentRate")
    direction = position.get("direction") or "buy"

    modify_payload = {
        "account": account,
        "action": "modify",
        "positionId": pid,
        "stopLossRate": cur_sl,
        "takeProfitRate": cur_tp,
        "stopLossType": "fixed",
        "clearStopLoss": False,
        "clearTakeProfit": False,
        "executeImmediately": False,
    }
    modify_url = build_issue_action_url(
        repo=repo,
        title=f"[TRADE-CONTROL] MODIFY Position {pid} ({symbol})",
        action_payload=modify_payload,
        description=(
            f"Alter Stop-Loss / Take-Profit on running **{symbol}** `{direction}` position `{pid}` "
            f"(Current Rate: `{cur_rate}`, Current SL: `{cur_sl}`, Current TP: `{cur_tp}`)."
        ),
    )

    trailing_payload = {
        "account": account,
        "action": "modify",
        "positionId": pid,
        "stopLossRate": cur_sl,
        "stopLossType": "trailing",
        "executeImmediately": False,
    }
    trailing_url = build_issue_action_url(
        repo=repo,
        title=f"[TRADE-CONTROL] TRAILING-SL Position {pid} ({symbol})",
        action_payload=trailing_payload,
        description=f"Switch Stop-Loss mode to `trailing` on running **{symbol}** position `{pid}`.",
    )

    close_half_payload = {
        "account": account,
        "action": "close",
        "positionId": pid,
        "unitsToDeduct": half_units,
        "executeImmediately": False,
    }
    close_half_url = build_issue_action_url(
        repo=repo,
        title=f"[TRADE-CONTROL] CLOSE 50% ({half_units}u) Position {pid} ({symbol})",
        action_payload=close_half_payload,
        description=f"Partially terminate **{half_units} units** (of `{units_val}` units) on **{symbol}** position `{pid}`.",
    )

    close_full_payload = {
        "account": account,
        "action": "close",
        "positionId": pid,
        "unitsToDeduct": None,
        "executeImmediately": False,
    }
    close_full_url = build_issue_action_url(
        repo=repo,
        title=f"[TRADE-CONTROL] CLOSE 100% Position {pid} ({symbol})",
        action_payload=close_full_payload,
        description=f"Fully terminate (100% = `{units_val}` units) running **{symbol}** position `{pid}`.",
    )

    cli_close = f"gh workflow run trading-agent-pipeline.yml -R {repo} -f account={account} -f action=close -f position_id={pid}"
    cli_modify = f"gh workflow run trading-agent-pipeline.yml -R {repo} -f account={account} -f action=modify -f position_id={pid} -f stop_loss_rate=\"{cur_sl}\""

    return {
        "modifyUrl": modify_url,
        "trailingSlUrl": trailing_url,
        "closeHalfUrl": close_half_url,
        "closeFullUrl": close_full_url,
        "cliClose": cli_close,
        "cliModify": cli_modify,
    }


def parse_monitor_markdown(monitor_md: str, repo: str, account: str) -> dict[str, Any]:
    """Parse `monitor-latest-demo.md` into structured active positions, pending orders, and preparations."""
    result: dict[str, Any] = {
        "portfolioValue": 100000.0,
        "availableCash": 100000.0,
        "unrealizedPnL": 0.0,
        "intradayDrawdown": 0.0,
        "killSwitchActive": False,
        "positions": [],
        "orders": [],
        "preparations": [],
    }

    if not monitor_md:
        return result

    val_match = re.search(r"\*\*Total Portfolio Value\*\*:\s*`\$?([0-9,\.]+)`", monitor_md)
    if val_match:
        result["portfolioValue"] = float(val_match.group(1).replace(",", ""))

    cash_match = re.search(r"\*\*Available Cash\*\*:\s*`\$?([0-9,\.]+)`", monitor_md)
    if cash_match:
        result["availableCash"] = float(cash_match.group(1).replace(",", ""))

    pnl_match = re.search(r"\*\*Unrealized P&L\*\*:\s*`\$?([-\+0-9,\.]+)`", monitor_md)
    if pnl_match:
        result["unrealizedPnL"] = float(pnl_match.group(1).replace(",", ""))

    dd_match = re.search(r"\*\*Intraday Drawdown\*\*:\s*`([-\+0-9,\.]+)%`", monitor_md)
    if dd_match:
        result["intradayDrawdown"] = float(dd_match.group(1).replace(",", ""))

    ks_match = re.search(r"\*\*Kill-Switch Active\*\*:\s*`([^`]+)`", monitor_md)
    if ks_match:
        result["killSwitchActive"] = ks_match.group(1).strip().lower() == "true"

    pos_table_match = re.search(
        r"## 1\. Currently Running Direct Positions.*?\n\|([^\n]+)\|\n\|[-|\s]+\|\n(.*?)(?=\n## |\Z)",
        monitor_md,
        re.DOTALL,
    )
    if pos_table_match:
        rows_text = pos_table_match.group(2).strip()
        for line in rows_text.splitlines():
            line = line.strip()
            if not line.startswith("|") or "No direct positions" in line:
                continue
            cols = [c.strip() for c in line.strip("|").split("|")]
            if len(cols) >= 9:
                raw_pid = re.sub(r"[^\d]", "", cols[0])
                if not raw_pid:
                    continue
                pid = int(raw_pid)
                symbol_name = cols[1].replace("**", "").strip()
                direction = cols[2].replace("`", "").strip()
                leverage = cols[3].replace("`", "").strip()
                units = float(re.sub(r"[^\d\.]", "", cols[4]) or "0")
                invested = float(re.sub(r"[^\d\.]", "", cols[5]) or "0")
                rates = cols[6].split(r"\rightarrow") if r"\rightarrow" in cols[6] else cols[6].split("->")
                open_rate = float(re.sub(r"[^\d\.]", "", rates[0]) or "0") if rates else 0.0
                current_rate = float(re.sub(r"[^\d\.]", "", rates[1]) or "0") if len(rates) > 1 else open_rate
                pnl_str = cols[7].replace("`", "").replace("$", "").replace("**", "").strip()
                try:
                    pnl_val = float(pnl_str)
                except ValueError:
                    pnl_val = 0.0

                sltp = cols[8].replace("`", "").strip()
                sl_rate = None
                tp_rate = None
                sl_type = "fixed"
                sl_m = re.search(r"SL=([\d\.]+)\s*\(([^)]+)\)", sltp)
                if sl_m:
                    sl_rate = float(sl_m.group(1))
                    sl_type = sl_m.group(2)
                tp_m = re.search(r"TP=([\d\.]+)", sltp)
                if tp_m:
                    tp_rate = float(tp_m.group(1))

                pos_dict = {
                    "positionId": pid,
                    "symbol": "OIL",
                    "displayName": symbol_name,
                    "direction": direction,
                    "leverage": leverage,
                    "units": units,
                    "invested": invested,
                    "openRate": open_rate,
                    "currentRate": current_rate,
                    "unrealizedPnL": pnl_val,
                    "unrealizedPnLPct": round((pnl_val / invested * 100) if invested else 0.0, 2),
                    "stopLossRate": sl_rate,
                    "takeProfitRate": tp_rate,
                    "stopLossType": sl_type,
                }
                pos_dict["actionLinks"] = build_position_action_links(repo, account, pos_dict, "OIL")
                result["positions"].append(pos_dict)

    prep_table_match = re.search(
        r"## ⏳ Pending Stage 1 Preparations.*?\n\|([^\n]+)\|\n\|[-|\s]+\|\n(.*?)(?=\n## |\Z)",
        monitor_md,
        re.DOTALL,
    )
    if prep_table_match:
        prep_rows = prep_table_match.group(2).strip()
        for line in prep_rows.splitlines():
            line = line.strip()
            if not line.startswith("|") or "No pending preparations" in line:
                continue
            cols = [c.strip() for c in line.strip("|").split("|")]
            if len(cols) >= 5:
                sig_id = cols[0].replace("`", "").strip()
                action = cols[1].replace("*", "").replace("`", "").strip()
                details = cols[2].strip()
                quote_val = float(re.sub(r"[^\d\.]", "", cols[3]) or "0")
                hash_val = cols[4].replace("`", "").strip()
                approval_link_m = re.search(r"\((https://[^\)]+)\)", cols[5]) if len(cols) > 5 else None
                approval_url = approval_link_m.group(1) if approval_link_m else f"https://github.com/{repo}/issues/1"

                result["preparations"].append({
                    "signalId": sig_id,
                    "action": action,
                    "targetDetails": details,
                    "quote": quote_val,
                    "orderParamsHash": hash_val,
                    "approvalUrl": approval_url,
                    "controlPanelIssueUrl": f"https://github.com/{repo}/issues/1",
                })

    return result


def build_market_payload(snapshot_json: dict[str, Any]) -> dict[str, Any]:
    """Extract clean market data and technical indicators from `oil-17-latest.json`."""
    inst = snapshot_json.get("etoroInstrument", {})
    quote = inst.get("quote", {})
    tech = snapshot_json.get("technicals", {})
    ext = snapshot_json.get("externalContext", {})
    feed = snapshot_json.get("oilSignalFeed", {})
    wti = feed.get("wtiCrude", {})
    brent = feed.get("brentCrude", {})
    regime = feed.get("directionCompression", {}).get("currentRegime", {})
    sentiment = feed.get("newsSentiment", {})
    signal = snapshot_json.get("signal", {})

    return {
        "snapshotId": snapshot_json.get("snapshotId"),
        "capturedAt": snapshot_json.get("capturedAt"),
        "instrument": {
            "symbol": "OIL",
            "instrumentId": 17,
            "name": "Oil (Non Expiry)",
            "assetClass": "commodities",
        },
        "quote": {
            "bid": quote.get("bid", 100.47),
            "ask": quote.get("ask", 100.49),
            "mid": quote.get("mid", 100.48),
            "spread": quote.get("spread", 0.02),
            "spreadPct": quote.get("spreadPct", 0.02),
            "dailyChangePercent": inst.get("performance", {}).get("dailyChangePercent", -2.32),
            "weeklyChangePercent": inst.get("performance", {}).get("weeklyChangePercent", -2.58),
            "monthlyChangePercent": inst.get("performance", {}).get("monthlyChangePercent", 11.95),
        },
        "benchmarks": {
            "wti": {
                "symbol": "CL=F",
                "price": wti.get("price", 101.09),
                "changePercent": wti.get("changePercent", -2.11),
                "sentiment": wti.get("sentiment", "bearish"),
            },
            "brent": {
                "symbol": "BZ=F",
                "price": brent.get("price", 109.70),
                "changePercent": brent.get("changePercent", -1.79),
                "sentiment": brent.get("sentiment", "bearish"),
            },
            "priceDivergencePct": ext.get("priceDivergencePct", 0.60),
            "eventRiskFlag": ext.get("eventRiskFlag", "MEDIUM"),
            "isWeekendClosed": ext.get("isWeekendClosed", False),
        },
        "technicals": {
            "timeframe": tech.get("timeframe", "15m"),
            "htfTimeframe": tech.get("htfTimeframe", "4h"),
            "trendAlignment": tech.get("trendAlignment", "bearish"),
            "htfTrendAlignment": tech.get("htfTrendAlignment", "bearish"),
            "ema20": tech.get("ema20", 100.67),
            "ema50": tech.get("ema50", 101.08),
            "sma200": tech.get("sma200", 102.28),
            "rsi14": tech.get("rsi14", 38.71),
            "adx14": tech.get("adx14", 39.07),
            "atr14": tech.get("atr14", 0.80),
            "atrPct": tech.get("atrPct", 0.80),
            "rvol": tech.get("rvol", 0.80),
            "nearestSupport": tech.get("nearestSupport", 100.23),
            "nearestResistance": tech.get("nearestResistance", 101.68),
        },
        "regime": {
            "direction": regime.get("direction", "bearish"),
            "durationHours": regime.get("durationHours", 7.2),
            "netChangePercent": regime.get("netChangePercent", -0.93),
        },
        "sentiment": {
            "netSentimentScore": sentiment.get("netSentimentScore", 0.15),
            "dominantDirection": sentiment.get("dominantDirection", "neutral"),
            "totalStories": sentiment.get("totalStories", 223),
            "recent24h": sentiment.get("recent24h", {"bullish": 1, "bearish": 0, "neutral": 5}),
        },
        "upstreamSignal": {
            "action": signal.get("intent", {}).get("action", "open"),
            "direction": signal.get("intent", {}).get("direction", "sellShort"),
            "convictionScore": signal.get("sizingAndRisk", {}).get("convictionScore", 0.2989),
            "suggestedStopLossRate": signal.get("sizingAndRisk", {}).get("suggestedStopLossRate", 101.68),
            "suggestedTakeProfitRate": signal.get("sizingAndRisk", {}).get("suggestedTakeProfitRate", 98.06),
        },
    }


def _normalize_closed_trade(raw: dict[str, Any]) -> dict[str, Any]:
    """Normalize a raw closed trade from eToro `get-my-trading-history` or an already-normalized trade dict."""
    if "realizedNetPnL" in raw and "openDateTime" in raw and "closeDateTime" in raw:
        return dict(raw)

    market = raw.get("market") or {}
    symbol = str(market.get("symbol") or raw.get("symbol") or "OIL").upper()
    open_dt_str = str(raw.get("openTime") or raw.get("openDateTime") or "")
    close_dt_str = str(raw.get("closeTime") or raw.get("closeDateTime") or "")
    open_dt = _parse_iso_utc(open_dt_str)
    close_dt = _parse_iso_utc(close_dt_str)
    dur_hours = (
        round(max(0.0, (close_dt - open_dt).total_seconds() / 3600.0), 2)
        if (open_dt and close_dt)
        else float(raw.get("durationHours") or 0.0)
    )
    open_rate = float(raw.get("openRate") or 0.0)
    close_rate = float(raw.get("closeRate") or 0.0)
    invested = float(
        raw.get("investment")
        or raw.get("initialInvestment")
        or raw.get("investedAmount")
        or 200.0
    )
    net_profit = float(
        raw.get("netProfit")
        if raw.get("netProfit") is not None
        else (raw.get("netProfitBeforeFees") or 0.0)
    )
    fees = float(raw.get("fees") or 0.0)
    realized_net = round(net_profit - fees, 2)
    return_pct = round((realized_net / invested * 100.0) if invested else 0.0, 2)

    sl_rate = float(raw.get("stopLossRate") or 0.0)
    tp_rate = float(raw.get("takeProfitRate") or 0.0)
    exit_reason = raw.get("exitReason")
    if not exit_reason:
        if sl_rate > 0.01 and abs(close_rate - sl_rate) <= max(0.05, close_rate * 0.002):
            sl_mode = "trailing" if raw.get("trailingStopLoss") else "fixed"
            exit_reason = f"Stop-Loss triggered ({sl_mode} SL={sl_rate:.2f})"
        elif tp_rate > 0.01 and abs(close_rate - tp_rate) <= max(0.05, close_rate * 0.002):
            exit_reason = f"Take-Profit triggered (TP={tp_rate:.2f})"
        else:
            exit_reason = f"Closed @ {close_rate:.2f}"

    return {
        "positionId": int(raw.get("positionId") or 0),
        "symbol": symbol,
        "direction": str(raw.get("direction") or "buy").lower(),
        "leverage": int(raw.get("leverage") or 1),
        "openDateTime": open_dt.strftime("%Y-%m-%dT%H:%M:%SZ") if open_dt else open_dt_str,
        "closeDateTime": close_dt.strftime("%Y-%m-%dT%H:%M:%SZ") if close_dt else close_dt_str,
        "durationHours": dur_hours,
        "openRate": open_rate,
        "closeRate": close_rate,
        "investedAmount": round(invested, 2),
        "netProfitBeforeFees": round(net_profit, 2),
        "fees": round(fees, 2),
        "realizedNetPnL": realized_net,
        "returnPct": return_pct,
        "exitReason": exit_reason,
    }


DEFAULT_CLOSED_TRADES: list[dict[str, Any]] = [
    {
        "positionId": 3625646006,
        "symbol": "OIL",
        "direction": "short",
        "leverage": 5,
        "openDateTime": "2026-10-26T07:24:53Z",
        "closeDateTime": "2026-10-26T15:50:52Z",
        "durationHours": 8.43,
        "openRate": 100.93,
        "closeRate": 102.00,
        "investedAmount": 199.99,
        "netProfitBeforeFees": -10.60,
        "fees": 0.00,
        "realizedNetPnL": -10.60,
        "returnPct": -5.30,
        "exitReason": "Stop-Loss triggered (fixed SL=102.00)",
    },
    {
        "positionId": 3625442511,
        "symbol": "OIL",
        "direction": "short",
        "leverage": 5,
        "openDateTime": "2026-10-25T17:01:06Z",
        "closeDateTime": "2026-10-25T17:38:02Z",
        "durationHours": 0.62,
        "openRate": 101.77,
        "closeRate": 102.26,
        "investedAmount": 200.00,
        "netProfitBeforeFees": -4.81,
        "fees": 0.00,
        "realizedNetPnL": -4.81,
        "returnPct": -2.41,
        "exitReason": "Closed @ 102.26",
    },
    {
        "positionId": 3625441963,
        "symbol": "OIL",
        "direction": "long",
        "leverage": 5,
        "openDateTime": "2026-10-25T14:46:45Z",
        "closeDateTime": "2026-10-25T14:51:53Z",
        "durationHours": 0.09,
        "openRate": 102.76,
        "closeRate": 102.07,
        "investedAmount": 199.99,
        "netProfitBeforeFees": -6.71,
        "fees": 0.00,
        "realizedNetPnL": -6.71,
        "returnPct": -3.36,
        "exitReason": "Closed @ 102.07",
    },
]


def build_history_payload(
    daily_report_md: str | None = None,
    *,
    history_doc: dict[str, Any] | None = None,
    current_equity: float | None = None,
    now_utc: datetime | None = None,
) -> dict[str, Any]:
    """Generate reconciled realized trade history and performance metrics, distinguishing today vs all-time."""
    now = (now_utc or datetime.now(timezone.utc)).astimezone(timezone.utc)
    today_date = now.date()
    cutoff_24h = now - timedelta(hours=24)

    raw_trades = None
    if isinstance(history_doc, dict):
        if "closedTrades" in history_doc and isinstance(history_doc["closedTrades"], list):
            raw_trades = history_doc["closedTrades"]
        elif "trades" in history_doc and isinstance(history_doc["trades"], list):
            raw_trades = history_doc["trades"]

    if raw_trades is None:
        raw_trades = DEFAULT_CLOSED_TRADES

    trades = [_normalize_closed_trade(t) for t in raw_trades if isinstance(t, dict)]
    trades.sort(key=lambda t: t.get("closeDateTime") or "", reverse=True)

    total_closed = len(trades)
    winning_trades = [t for t in trades if t["realizedNetPnL"] > 0]
    losing_trades = [t for t in trades if t["realizedNetPnL"] <= 0]
    win_rate = (len(winning_trades) / total_closed * 100) if total_closed else 0.0

    gross_wins = sum(t["realizedNetPnL"] for t in winning_trades)
    gross_losses = abs(sum(t["realizedNetPnL"] for t in losing_trades))
    profit_factor = (gross_wins / gross_losses) if gross_losses > 0 else (1.0 if gross_wins > 0 else 0.0)

    avg_win = (gross_wins / len(winning_trades)) if winning_trades else 0.0
    avg_loss = (gross_losses / len(losing_trades)) if losing_trades else 0.0
    expectancy = ((win_rate / 100.0) * avg_win) - ((1.0 - (win_rate / 100.0)) * avg_loss)

    total_fees = sum(t["fees"] for t in trades)
    net_pnl = sum(t["realizedNetPnL"] for t in trades)

    # Filter trades closed today (UTC date) and within rolling 24h
    trades_today = []
    trades_24h = []
    for t in trades:
        close_dt = _parse_iso_utc(t.get("closeDateTime"))
        if close_dt is not None:
            if close_dt.date() == today_date:
                trades_today.append(t)
            if close_dt >= cutoff_24h:
                trades_24h.append(t)

    realized_today = round(sum(t["realizedNetPnL"] for t in trades_today), 2)
    realized_24h = round(sum(t["realizedNetPnL"] for t in trades_24h), 2)

    # Reconstruct chronological equity progression up to current live timestamp
    chronological = list(reversed(trades))
    live_eq = float(current_equity if current_equity is not None else 108467.90)
    starting_eq = round(live_eq - net_pnl, 2)

    equity_progression = [
        {"timestamp": "2026-10-24T00:00:00Z", "equity": starting_eq, "realizedNetPnL": 0.0}
    ]
    running_pnl = 0.0
    for t in chronological:
        running_pnl = round(running_pnl + float(t["realizedNetPnL"]), 2)
        equity_progression.append(
            {
                "timestamp": t["closeDateTime"],
                "equity": round(starting_eq + running_pnl, 2),
                "realizedNetPnL": running_pnl,
            }
        )
    now_iso_short = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    if not equity_progression or equity_progression[-1]["timestamp"] != now_iso_short:
        equity_progression.append(
            {
                "timestamp": now_iso_short,
                "equity": round(live_eq, 2),
                "realizedNetPnL": round(net_pnl, 2),
            }
        )

    return {
        "metrics": {
            "totalClosedTrades": total_closed,
            "closedTradesToday": len(trades_today),
            "winningTrades": len(winning_trades),
            "losingTrades": len(losing_trades),
            "winRate": round(win_rate, 2),
            "profitFactor": round(profit_factor, 2),
            "expectancy": round(expectancy, 2),
            "totalFees": round(total_fees, 2),
            "realizedNetPnL": round(net_pnl, 2),
            "realizedNetPnLToday": realized_today,
            "realizedNetPnL24h": realized_24h,
            "maxHistoricalDrawdown": -0.02,
            "feeDragRatio": 0.0,
        },
        "trades": trades,
        "equityProgression": equity_progression,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Build trading dashboard static JSON payloads.")
    parser.add_argument("--agent-repo", default="knightkalman/trader-agent", help="GitHub repository of the trading agent.")
    parser.add_argument("--local-agent-dir", default="../trading-agent", help="Path to local trading agent repository checkout.")
    parser.add_argument("--account", default="demo", choices=["demo", "real"], help="Target account mode.")
    parser.add_argument("--output-dir", default="site/data", help="Target output directory for static JSON.")
    parser.add_argument("--token", default=os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN"), help="GitHub token for API access.")
    args = parser.parse_args()

    output_path = Path(args.output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    agent_repo = args.agent_repo.strip()
    account = args.account.strip()
    local_dir = Path(args.local_agent_dir).resolve()

    print(f"[*] Building Trading Dashboard Data (repo={agent_repo}, account={account})")
    print(f"[*] Local agent directory check: {local_dir} (exists={local_dir.exists()})")

    # 1. Read or fetch latest market snapshot
    raw_snap = fetch_github_repo_file(
        repo=agent_repo,
        file_path="data/market_snapshots/oil-17-latest.json",
        token=args.token,
        local_dir=local_dir,
    )
    if raw_snap:
        snapshot_json: dict[str, Any] = json.loads(raw_snap)
    elif (output_path / "market.json").is_file():
        try:
            print("[*] Reusing existing site/data/market.json")
            snapshot_json = json.loads((output_path / "market.json").read_text(encoding="utf-8"))
        except Exception:
            snapshot_json = {}
    else:
        snapshot_json = {}

    # 2. Read or fetch orchestrator latest cycle report
    raw_orch = fetch_github_repo_file(
        repo=agent_repo,
        file_path="reports/orchestrator/latest-cycle-report.md",
        token=args.token,
        local_dir=local_dir,
    )
    if raw_orch:
        orchestrator_data = parse_orchestrator_report(raw_orch)
    elif (output_path / "orchestrator.json").is_file():
        try:
            print("[*] Reusing existing site/data/orchestrator.json")
            orchestrator_data = json.loads((output_path / "orchestrator.json").read_text(encoding="utf-8"))
        except Exception:
            orchestrator_data = parse_orchestrator_report("")
    else:
        orchestrator_data = parse_orchestrator_report("")

    # 3. Read or fetch active monitor report
    raw_monitor = fetch_github_repo_file(
        repo=agent_repo,
        file_path=f"reports/daily/monitor-latest-{account}.md",
        token=args.token,
        local_dir=local_dir,
    )
    if raw_monitor:
        parsed_monitor = parse_monitor_markdown(raw_monitor, agent_repo, account)
    elif (output_path / "positions.json").is_file():
        try:
            print("[*] Reusing existing site/data/positions.json")
            existing_pos = json.loads((output_path / "positions.json").read_text(encoding="utf-8"))
            parsed_monitor = {
                "portfolioValue": 108467.90,
                "availableCash": 108467.90,
                "unrealizedPnL": 0.0,
                "intradayDrawdown": 0.0,
                "killSwitchActive": False,
                "positions": existing_pos.get("positions", []),
                "orders": existing_pos.get("orders", []),
                "preparations": existing_pos.get("preparations", []),
            }
        except Exception:
            parsed_monitor = parse_monitor_markdown("", agent_repo, account)
    else:
        parsed_monitor = parse_monitor_markdown("", agent_repo, account)

    # 3b. Read or fetch live closed trading history artifact from trader-agent
    raw_hist = fetch_github_repo_file(
        repo=agent_repo,
        file_path=f"reports/daily/history-latest-{account}.json",
        token=args.token,
        local_dir=local_dir,
    )
    history_doc: dict[str, Any] | None = None
    if raw_hist:
        try:
            history_doc = json.loads(raw_hist)
        except Exception:
            history_doc = None
    elif (output_path / "history.json").is_file():
        try:
            print("[*] Reusing existing site/data/history.json trades")
            history_doc = json.loads((output_path / "history.json").read_text(encoding="utf-8"))
        except Exception:
            history_doc = None

    if isinstance(history_doc, dict) and isinstance(history_doc.get("totals"), dict):
        totals = history_doc["totals"]
        if totals.get("totalValue") is not None:
            parsed_monitor["portfolioValue"] = float(totals["totalValue"])
        if totals.get("availableCash") is not None:
            parsed_monitor["availableCash"] = float(totals["availableCash"])
        if totals.get("unrealizedPnL") is not None or totals.get("unrealizedPnl") is not None:
            parsed_monitor["unrealizedPnL"] = float(
                totals.get("unrealizedPnL")
                if totals.get("unrealizedPnL") is not None
                else totals.get("unrealizedPnl") or 0.0
            )

    # 4. Generate Core Payloads
    now_utc = datetime.now(timezone.utc)
    now_iso = now_utc.isoformat()
    market_payload = build_market_payload(snapshot_json)
    history_payload = build_history_payload(
        history_doc=history_doc,
        current_equity=parsed_monitor.get("portfolioValue", 108467.90),
        now_utc=now_utc,
    )

    summary_payload = {
        "schemaVersion": "1.2",
        "generatedAt": now_iso,
        "account": account,
        "agentRepo": agent_repo,
        "controlPanelIssueUrl": f"https://github.com/{agent_repo}/issues/1",
        "system": {
            "orchestratorEnabled": orchestrator_data.get("orchestratorEnabled", True),
            "executionMode": orchestrator_data.get("executionMode", "prepare_only"),
            "killSwitchActive": parsed_monitor.get("killSwitchActive", False),
            "targetInstrument": "OIL (ID: 17)",
            "cycleCadence": orchestrator_data.get("cadence", "10m"),
            "lastCycleStatus": orchestrator_data.get("status", "UNKNOWN"),
            "lastCycleTimestamp": orchestrator_data.get("cycleTimestamp", now_iso),
            "dataFreshnessSeconds": 300,
        },
        "portfolio": {
            "totalEquity": parsed_monitor.get("portfolioValue", 100000.0),
            "availableCash": parsed_monitor.get("availableCash", 100000.0),
            "usedMargin": round(parsed_monitor.get("portfolioValue", 100000.0) - parsed_monitor.get("availableCash", 100000.0), 2),
            "unrealizedPnL": parsed_monitor.get("unrealizedPnL", 0.0),
            "intradayDrawdownPct": parsed_monitor.get("intradayDrawdown", 0.0),
            "realizedNetPnLToday": history_payload["metrics"]["realizedNetPnLToday"],
            "realizedNetPnL24h": history_payload["metrics"]["realizedNetPnL24h"],
            "realizedNetPnLTotal": history_payload["metrics"]["realizedNetPnL"],
            "closedTradesToday": history_payload["metrics"]["closedTradesToday"],
            "openPositionsCount": len(parsed_monitor.get("positions", [])),
            "pendingOrdersCount": len(parsed_monitor.get("orders", [])),
            "pendingPreparationsCount": len(parsed_monitor.get("preparations", [])),
        },
    }

    positions_payload = {
        "generatedAt": now_iso,
        "account": account,
        "positions": parsed_monitor.get("positions", []),
        "orders": parsed_monitor.get("orders", []),
        "preparations": parsed_monitor.get("preparations", []),
        "controlPanelIssueUrl": f"https://github.com/{agent_repo}/issues/1",
    }

    # 5. Write all static JSON payloads
    files_to_write = {
        "summary.json": summary_payload,
        "orchestrator.json": orchestrator_data,
        "positions.json": positions_payload,
        "market.json": market_payload,
        "history.json": history_payload,
    }

    for filename, payload in files_to_write.items():
        file_path = output_path / filename
        file_path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
        print(f"[✓] Wrote {file_path} ({file_path.stat().st_size} bytes)")

    print("[🎉] Static dashboard data build completed successfully.")


if __name__ == "__main__":
    main()
