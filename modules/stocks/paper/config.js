/**
 * Paper trading defaults (env-overridable). Stage 1: ledger + matcher.
 */
function num(name, fallback) {
    const v = Number(process.env[name]);
    return Number.isFinite(v) ? v : fallback;
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
    maxFills: num('PAPER_MAX_FILLS', 500)
};

module.exports = { config };
