/**
 * Auto strategy — KAP sentiment entries + take-profit / stop-loss / timeout exits.
 */
const { isBistCode } = require('../symbols');
const yahoo = require('../yahoo');
const { config } = require('./config');
const paperStore = require('./store');
const signals = require('./signals');
const matcher = require('./matcher');
const engine = require('./engine');

function roundShares(n) {
    return matcher.roundShares(n);
}

function inCooldown(symbol, settings) {
    const at = settings.cooldowns && settings.cooldowns[symbol];
    if (!at) return false;
    return Date.now() - Number(at) < config.cooldownMs;
}

function hasOpenOrder(symbol, side) {
    return paperStore.getOpenOrders().some((o) => {
        return o.symbol === symbol && o.side === side;
    });
}

function positionNotional(portfolio, symbol, mark) {
    const pos = portfolio.positions[symbol];
    if (!pos || !(pos.qty > 0)) return 0;
    const px = typeof mark === 'number' ? mark : pos.avgCost;
    return pos.qty * px;
}

/**
 * Place a market order from strategy; returns order or null.
 */
function tryPlace({ side, symbol, qty, reason, signalId }) {
    try {
        const order = engine.placeOrder({
            side,
            symbol,
            qty,
            type: 'market',
            source: 'auto'
        });
        order.strategyReason = reason;
        order.signalId = signalId || null;
        // Persist reason onto saved order
        const orders = paperStore.getOrders();
        const saved = orders.find((o) => o.id === order.id);
        if (saved) {
            saved.strategyReason = reason;
            saved.signalId = signalId || null;
            paperStore.saveOrders(orders);
        }
        signals.touchCooldown(symbol);
        return order;
    } catch (err) {
        return { error: err.message || String(err) };
    }
}

function sizeBuyQty(portfolio, symbol, mark) {
    if (!(mark > 0)) return 0;
    const budget = portfolio.cash * config.positionPct;
    const maxSymbol = portfolio.startingCash * config.maxSymbolPct;
    const already = positionNotional(portfolio, symbol, mark);
    const room = Math.max(0, maxSymbol - already);
    const spend = Math.min(budget, room, portfolio.cash * 0.99);
    if (spend < mark * 0.01) return 0;
    // Leave room for fee + spread
    const qty = spend / (mark * (1 + config.halfSpread + config.feeRate));
    return roundShares(qty);
}

/**
 * Handle a classification record from KAP (or future news).
 * @returns {{ signal: object, order: object|null, skipped: string|null }}
 */
function onClassification(record, quotesBySymbol = {}) {
    const settings = signals.getSettings();
    const stock = yahoo.canonicalize((record && record.stock) || '');
    const sentiment = String((record && record.sentiment) || '').toLowerCase();
    const confidence = Number(record && record.confidence);

    const signal = {
        id: paperStore.newId('sig'),
        source: (record && record.source) || 'kap',
        stock: stock || null,
        sentiment,
        confidence: Number.isFinite(confidence) ? confidence : null,
        summary: (record && (record.summary || record.headline)) || '',
        reason: (record && record.reason) || '',
        disclosureId: (record && record.id) || null,
        sourceUrl: (record && record.sourceUrl) || null,
        at: new Date().toISOString(),
        action: 'none',
        detail: null
    };

    if (!settings.autoTrade) {
        signal.detail = 'auto trade paused';
        signals.appendSignal(signal);
        return { signal, order: null, skipped: signal.detail };
    }

    if (!stock || !isBistCode(stock)) {
        signal.detail = 'not a curated BIST symbol';
        signals.appendSignal(signal);
        return { signal, order: null, skipped: signal.detail };
    }

    if (!Number.isFinite(confidence) || confidence < config.confidenceMin) {
        signal.detail = `confidence below ${config.confidenceMin}`;
        signals.appendSignal(signal);
        return { signal, order: null, skipped: signal.detail };
    }

    if (sentiment !== 'good' && sentiment !== 'bad') {
        signal.detail = 'neutral — no trade';
        signals.appendSignal(signal);
        return { signal, order: null, skipped: signal.detail };
    }

    if (sentiment === 'good' && inCooldown(stock, settings)) {
        signal.detail = 'symbol in cooldown';
        signals.appendSignal(signal);
        return { signal, order: null, skipped: signal.detail };
    }

    const portfolio = paperStore.getPortfolio();
    let order = null;

    if (sentiment === 'good') {
        if (hasOpenOrder(stock, 'buy')) {
            signal.detail = 'buy order already open';
            signals.appendSignal(signal);
            return { signal, order: null, skipped: signal.detail };
        }
        const quote = quotesBySymbol[stock];
        const mark = quote && typeof quote.price === 'number' ? quote.price : null;
        // If no mark yet, size later path: use a placeholder qty of 1 lot attempt via cash/avg — skip until quote
        if (!(mark > 0)) {
            signal.action = 'buy_pending_quote';
            signal.detail = 'waiting for quote to size order';
            signals.appendSignal(signal);
            // Stash intent: place a small provisional? Better: store pending buy intents
            // For simplicity place after quote in evaluatePending — use signals with buy_pending_quote
            return { signal, order: null, skipped: signal.detail };
        }
        const qty = sizeBuyQty(portfolio, stock, mark);
        if (!(qty > 0)) {
            signal.detail = 'insufficient cash or symbol cap';
            signals.appendSignal(signal);
            return { signal, order: null, skipped: signal.detail };
        }
        signal.action = 'buy';
        const placed = tryPlace({
            side: 'buy',
            symbol: stock,
            qty,
            reason: `kap_good conf=${confidence}`,
            signalId: signal.id
        });
        if (placed && placed.error) {
            signal.detail = placed.error;
            signals.appendSignal(signal);
            return { signal, order: null, skipped: placed.error };
        }
        order = placed;
        signal.detail = `buy ${qty} ${stock}`;
        signals.appendSignal(signal);
        return { signal, order, skipped: null };
    }

    // bad → sell all
    const pos = portfolio.positions[stock];
    const qty = pos && pos.qty ? pos.qty : 0;
    if (!(qty > 0)) {
        signal.detail = 'no position to sell';
        signals.appendSignal(signal);
        return { signal, order: null, skipped: signal.detail };
    }
    if (hasOpenOrder(stock, 'sell')) {
        signal.detail = 'sell order already open';
        signals.appendSignal(signal);
        return { signal, order: null, skipped: signal.detail };
    }
    signal.action = 'sell';
    const placed = tryPlace({
        side: 'sell',
        symbol: stock,
        qty,
        reason: `kap_bad conf=${confidence}`,
        signalId: signal.id
    });
    if (placed && placed.error) {
        signal.detail = placed.error;
        signals.appendSignal(signal);
        return { signal, order: null, skipped: placed.error };
    }
    order = placed;
    signal.detail = `sell ${qty} ${stock}`;
    signals.appendSignal(signal);
    return { signal, order, skipped: null };
}

/**
 * Retry buys that were waiting on a quote.
 */
function flushPendingBuys(quotesBySymbol) {
    if (!signals.getSettings().autoTrade) return [];
    const recent = signals.getSignals().filter((s) => s.action === 'buy_pending_quote').slice(0, 20);
    const placed = [];
    const seen = new Set();

    recent.forEach((s) => {
        const stock = s.stock;
        if (!stock || seen.has(stock)) return;
        seen.add(stock);
        if (inCooldown(stock, signals.getSettings())) return;
        if (hasOpenOrder(stock, 'buy')) return;
        const quote = quotesBySymbol[stock];
        const mark = quote && typeof quote.price === 'number' ? quote.price : null;
        if (!(mark > 0)) return;
        const portfolio = paperStore.getPortfolio();
        const qty = sizeBuyQty(portfolio, stock, mark);
        if (!(qty > 0)) return;
        const order = tryPlace({
            side: 'buy',
            symbol: stock,
            qty,
            reason: `kap_good_flush conf=${s.confidence}`,
            signalId: s.id
        });
        if (order && !order.error) {
            placed.push(order);
            signals.appendSignal({
                ...s,
                id: paperStore.newId('sig'),
                action: 'buy',
                detail: `buy ${qty} ${stock} (flushed)`,
                at: new Date().toISOString()
            });
        }
    });
    return placed;
}

/**
 * Price / time based exits. Returns placed sell orders.
 */
function evaluateExits(quotesBySymbol = {}) {
    if (!signals.getSettings().autoTrade) return [];
    const portfolio = paperStore.getPortfolio();
    const now = Date.now();
    const placed = [];

    Object.keys(portfolio.positions || {}).forEach((symbol) => {
        const pos = portfolio.positions[symbol];
        if (!pos || !(pos.qty > 0)) return;
        if (hasOpenOrder(symbol, 'sell')) return;

        const quote = quotesBySymbol[symbol];
        const mark = quote && typeof quote.price === 'number' ? quote.price : null;
        if (!(mark > 0) || !(pos.avgCost > 0)) return;

        const pnlPct = (mark - pos.avgCost) / pos.avgCost;
        let reason = null;

        if (pnlPct >= config.takeProfitPct) {
            reason = `take_profit ${(pnlPct * 100).toFixed(2)}%`;
        } else if (pnlPct <= -config.stopLossPct) {
            reason = `stop_loss ${(pnlPct * 100).toFixed(2)}%`;
        } else {
            const openedMs = Date.parse(pos.openedAt || '') || 0;
            if (openedMs && now - openedMs >= config.maxHoldMs) {
                reason = 'max_hold_timeout';
            }
        }

        if (!reason) return;

        const order = tryPlace({
            side: 'sell',
            symbol,
            qty: pos.qty,
            reason,
            signalId: null
        });
        if (order && !order.error) {
            placed.push(order);
            signals.appendSignal({
                id: paperStore.newId('sig'),
                source: 'exit',
                stock: symbol,
                sentiment: null,
                confidence: null,
                summary: reason,
                reason,
                disclosureId: null,
                sourceUrl: null,
                at: new Date().toISOString(),
                action: 'sell',
                detail: reason
            });
        }
    });

    return placed;
}

function setAutoTrade(enabled) {
    return signals.setAutoTrade(enabled);
}

function getAutoTrade() {
    return signals.getSettings().autoTrade;
}

module.exports = {
    onClassification,
    flushPendingBuys,
    evaluateExits,
    setAutoTrade,
    getAutoTrade
};
