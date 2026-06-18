---
name: trading-lexicon
description: Comprehensive Trading Lexicon and analysis strategies (SMC, Wyckoff, Elliott Waves, Indicators) for Crypto and Forex.
metadata: {"aichart":{"requires":{"env":[]}}}
---

# Trading Lexicon & Strategy Invalidation Skill

This skill represents the complete technical and fundamental framework for the trading Agent to analyze markets, formulate trading setup hypotheses, and determine confluence entries for both Crypto and Forex.

---

## 1. Advanced Technical Analysis Methodologies

### 1.1 Smart Money Concepts (SMC / ICT)
A methodology focused on tracking institutional market makers and liquidity rather than retail indicators:
*   **Order Blocks (OB)**: The last bearish candle before a strong bullish move (Bullish OB), or the last bullish candle before a strong bearish move (Bearish OB). These represent institutional order zones where price reactions are expected upon retest.
*   **Fair Value Gap (FVG) / Imbalance**: A 3-candle pattern where a price inefficiency exists between the wick of the 1st candle and the wick of the 3rd candle. Price tends to return to fill these gaps (Rebalance).
*   **Break of Structure (BOS)**: Continuation of the current trend where price breaks the previous swing high (in an uptrend) or swing low (in a downtrend) and closes the candle body beyond it.
*   **Change of Character (CHoCH) / Market Structure Shift (MSS)**: The first signal of a potential trend reversal, occurring when price breaks the recent structural higher low (in an uptrend) or lower high (in a downtrend).
*   **Liquidity Sweeps**: Impulsive price movement designed to trigger stop-loss orders resting beyond major highs or lows (e.g., Previous Daily High/Low - PDH/PDL), followed by a rapid reversal in the opposite direction.

### 1.2 Wyckoff Method
Tracking market cycles driven by composite operators across four main phases:
1.  **Accumulation**: Range-bound phase where institutional buyers build long positions.
    *   **Spring**: A brief false breakout below the accumulation range support to sweep retail buyers' stop losses and test supply before starting the markup.
    *   **Sign of Strength (SOS)**: An impulsive bullish move accompanied by high volume that breaks out above the range resistance.
2.  **Markup**: Clear, established uptrend.
3.  **Distribution**: Range-bound phase where institutional sellers distribute their positions.
    *   **Upthrust After Distribution (UTAD)**: A false bullish rally above the distribution range resistance to trap buyers before starting the markdown.
    *   **Sign of Weakness (SOW)**: An impulsive bearish drop breaking key support levels of the range.
4.  **Markdown**: Clear, established downtrend.

### 1.3 Elliott Wave Theory
Reading the geometric structure of price action based on collective crowd psychology:
*   **Impulse Wave**: Consists of 5 waves in the direction of the primary trend (1, 2, 3, 4, 5).
    *   Wave 3 is typically the longest and strongest wave and can never be the shortest.
    *   Wave 4 cannot overlap into the price territory of Wave 1 (except in diagonal patterns).
*   **Corrective Wave**: Consists of 3 waves against the primary trend (A, B, C), taking forms such as Zigzags, Flats, or Triangles.

---

## 2. Classic & Quantitative Indicators

*   **Relative Strength Index (RSI)**:
    *   Overbought: RSI > 70 · Oversold: RSI < 30.
    *   **Divergence**: Price making a higher high while RSI makes a lower high (Bearish Divergence), or price making a lower low while RSI makes a higher low (Bullish Divergence). Signals momentum exhaustion.
*   **MACD (Moving Average Convergence Divergence)**:
    *   MACD line crossing above the Signal Line indicates bullish momentum; crossing below indicates bearish momentum.
    *   Histogram momentum shifts predict the end of corrective waves.
*   **Fibonacci Retracement & Extension**:
    *   Retracement support/resistance levels: **0.50**, **0.618** (Golden Pocket), and **0.786**.
    *   Extensions for profit targets: **1.272** and **1.618**.

---

## 3. Crypto Market Trading Rules
When analyzing crypto assets on Binance (Spot & Futures), the Agent must apply these rules:
*   **Funding Rates**:
    *   High Positive Funding: Longs pay Shorts. Bullish bias overextended, increasing risk of a sudden crash to sweep leverage (Long Squeeze).
    *   High Negative Funding: Shorts pay Longs. Bearish bias overextended, increasing risk of a sudden surge to liquidate shorts (Short Squeeze).
*   **Open Interest (OI)**:
    *   Price Increase + OI Increase = New buying volume entering (Strong Bullish signal).
    *   Price Decrease + OI Increase = New selling volume entering (Strong Bearish signal).
    *   Sideways Price + OI Sharp Decrease = Position liquidations / mass closures.
*   **Smart Money Flow & Web3 Signals**:
    *   Use `smart_money_signals` to track on-chain institutional movement.
    *   Use `crypto_market_rank` to align social-hype and smart money flows for altcoins.

---

## 4. Forex Market Trading Rules
When analyzing currency pairs and gold on MetaTrader 5, the Agent must adhere to these rules:
*   **Global Trading Sessions**:
    *   **London Session**: Volatility and liquidity begin to surge. Opens at 07:00 UTC.
    *   **New York Session**: Opens at 13:00 UTC. Overlaps with London session, representing peak daily liquidity and volatility.
    *   **Tokyo/Asian Session**: Quiet consolidation and narrow ranges. Best for mean-reversion or waiting for false breakouts at the London Open (Judas Swing).
*   **Economic Calendar & Macro News**:
    *   **High-Impact News (Red Folder)**: Interest rates, CPI, NFP (Non-Farm Payroll), Retail Sales.
    *   **Execution Rule**: Avoid recommending entry 30 minutes before and after high-impact news releases due to wide spreads, slippage, and random volatility.
*   **MT5 Leverage & Spread Management**:
    *   Check `spreadPips` via `get_live_account` or `get_ea_diagnostics`. Postpone entries if spreads are abnormally high.

---

## 5. Confluence Checklist
The Agent must cross-reference multiple parameters before recommending a `buy` or `sell`:
1.  **Structure Confluence**: H4/H1 trend alignment + M15 Order Block / FVG reaction.
2.  **Indicator Confluence**: RSI oversold/overbought + MACD signal line crossover.
3.  **Fundamental Confluence**: Live news sentiment + Fear & Greed index confirmation.
4.  **Confidence Assessment**: Dynamically calculate the confidence rating (0-100) based on the number of matching confluences (e.g., 4 factors matching = 85% confidence, 2 factors matching = 60% confidence).
