/**
 * Gold Agent X — trade journal persistence helpers.
 */
import { execute, insertReturningId, query } from "@/lib/db";
import type { TradeJournalEntry } from "./types";

export async function persistJournalEntry(entry: TradeJournalEntry): Promise<number> {
  try {
    return await insertReturningId(
      `INSERT INTO gold_agent_journal
        (user_id, bot_id, side, entry_price, exit_price, lot, pnl, regime, session,
         confidence, trade_quality, trade_score, danger_level, advisor_votes_json,
         weights_json, exit_reason, duration_ms, fingerprint, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [
        entry.userId,
        entry.botId,
        entry.side,
        entry.entryPrice,
        entry.exitPrice,
        entry.lot,
        entry.pnl,
        entry.regime,
        entry.session,
        entry.confidence,
        entry.tradeQuality,
        entry.tradeScore,
        entry.dangerLevel,
        JSON.stringify(entry.advisorVotes),
        JSON.stringify(entry.weights),
        entry.exitReason,
        entry.durationMs,
        entry.fingerprint,
      ],
    );
  } catch {
    return 0;
  }
}

export async function loadRecentJournal(
  userId: number,
  botId: number,
  limit = 100,
): Promise<TradeJournalEntry[]> {
  try {
    const rows = await query<{
      bot_id: number;
      user_id: number;
      side: string;
      entry_price: number;
      exit_price: number;
      lot: number;
      pnl: number;
      regime: string;
      session: string;
      confidence: number;
      trade_quality: number;
      trade_score: number;
      danger_level: string;
      advisor_votes_json: string;
      weights_json: string;
      exit_reason: string;
      duration_ms: number;
      fingerprint: string;
    }>(
      `SELECT * FROM gold_agent_journal
       WHERE user_id = ? AND bot_id = ?
       ORDER BY id DESC LIMIT ?`,
      [userId, botId, limit],
    );

    return rows.map((r) => ({
      botId: r.bot_id,
      userId: r.user_id,
      side: r.side as TradeJournalEntry["side"],
      entryPrice: r.entry_price,
      exitPrice: r.exit_price,
      lot: r.lot,
      pnl: r.pnl,
      regime: r.regime as TradeJournalEntry["regime"],
      session: r.session as TradeJournalEntry["session"],
      confidence: r.confidence,
      tradeQuality: r.trade_quality,
      tradeScore: r.trade_score,
      dangerLevel: r.danger_level as TradeJournalEntry["dangerLevel"],
      advisorVotes: JSON.parse(r.advisor_votes_json),
      weights: JSON.parse(r.weights_json),
      exitReason: r.exit_reason,
      durationMs: r.duration_ms,
      fingerprint: r.fingerprint,
    }));
  } catch {
    return [];
  }
}

export async function persistPerformanceSnapshot(
  userId: number,
  botId: number,
  statsJson: string,
): Promise<void> {
  try {
    await execute(
      `INSERT INTO gold_agent_performance (user_id, bot_id, stats_json, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(user_id, bot_id) DO UPDATE SET
         stats_json = excluded.stats_json,
         updated_at = datetime('now')`,
      [userId, botId, statsJson],
    );
  } catch {
    /* table may not exist yet */
  }
}

export async function persistSetupRecord(
  userId: number,
  botId: number,
  fingerprint: string,
  winRate: number,
  profitFactor: number,
  samples: number,
): Promise<void> {
  try {
    await execute(
      `INSERT INTO gold_agent_setups
        (user_id, bot_id, fingerprint, win_rate, profit_factor, samples, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(user_id, bot_id, fingerprint) DO UPDATE SET
         win_rate = excluded.win_rate,
         profit_factor = excluded.profit_factor,
         samples = excluded.samples,
         updated_at = datetime('now')`,
      [userId, botId, fingerprint, winRate, profitFactor, samples],
    );
  } catch {
    /* ignore */
  }
}
