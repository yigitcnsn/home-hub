/**
 * Paper trading defaults (env-overridable).
 */
function num(name, fallback) {
    const v = Number(process.env[name]);
    return Number.isFinite(v) ? v : fallback;
}

function flag(name, defaultOn) {
    const raw = process.env[name];
    if (raw == null || raw === '') return defaultOn;
    return String(raw) !== '0';
}

const config = {
    startingCashTry: num('PAPER_STARTING_CASH_TRY', 100000),
    /** Minimum age before an open order may fill (ms). */
    minFillDelayMs: num('PAPER_MIN_FILL_DELAY_MS', 30000),
    /** Half-spread as fraction of last (buy pays +, sell receives −). */
    halfSpread: num('PAPER_HALF_SPREAD', 0.0005),
    /** Commission as fraction of notional per fill side. */
    feeRate: num('PAPER_FEE_RATE', 0.0005),
    /** Daily limit band (± fraction). Soft friction near edges. */
    dailyLimitPct: num('PAPER_DAILY_LIMIT_PCT', 0.10),
    /** Start applying soft limit friction this close to the band. */
    limitSoftZone: num('PAPER_LIMIT_SOFT_ZONE', 0.02),
    /** Max shares filled per matcher pass when order is large. */
    partialFillMaxShares: num('PAPER_PARTIAL_FILL_MAX', 50),
    /** Orders expire after this many ms if still open. */
    orderTtlMs: num('PAPER_ORDER_TTL_MS', 6 * 60 * 60 * 1000),
    /** Keep this many recent fills on disk. */
    maxFills: num('PAPER_MAX_FILLS', 500),

    /** Auto-trade from KAP classifications (kill switch defaults on). */
    autoTradeDefault: flag('PAPER_AUTO_TRADE', true),
    /** Min model confidence to act. */
    confidenceMin: num('PAPER_CONFIDENCE_MIN', 0.55),
    /** Fraction of free cash to deploy on a buy signal. */
    positionPct: num('PAPER_POSITION_PCT', 0.1),
    /** Cap one symbol at this fraction of starting cash (at entry). */
    maxSymbolPct: num('PAPER_MAX_SYMBOL_PCT', 0.25),
    /** Cooldown after an auto order for the same symbol (ms). */
    cooldownMs: num('PAPER_COOLDOWN_MS', 30 * 60 * 1000),
    /** Take-profit as fraction above avg cost. */
    takeProfitPct: num('PAPER_TAKE_PROFIT_PCT', 0.08),
    /** Stop-loss as fraction below avg cost. */
    stopLossPct: num('PAPER_STOP_LOSS_PCT', 0.05),
    /** Max hold before timeout exit (ms). Default ~10 calendar days. */
    maxHoldMs: num('PAPER_MAX_HOLD_MS', 10 * 24 * 60 * 60 * 1000),
    /** Keep this many recent signals. */
    maxSignals: num('PAPER_MAX_SIGNALS', 300)
};

module.exports = { config };
