"""AiChart isolated quant agent service.

A self-contained decision-engine service that turns market bars (pushed to it
over its own inbound API — it makes no outbound network calls) into
transparent, rule-based buy/sell recommendations. It is a second, genuinely
independent trading agent: it does not read, write, or import anything from
the main AiChart application, `mt_accounts`, `trading_settings`, or the
canonical `recommendations` table/guardrails.
"""

__version__ = "0.1.0"
