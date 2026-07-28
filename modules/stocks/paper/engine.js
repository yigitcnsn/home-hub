/**
 * Paper trading engine — place / cancel / reset / mark-to-market (Stage 1).
 */
const { isBistCode } = require('../symbols');
const yahoo = require('../yahoo');
const { config } = require('./config');
const paperStore = require('./store');
const matcher = require('./matcher');
const signals = require('./signals');

function assertBist(symbol) {
    const code = yahoo.canonicalize(symbol);
    if (!code || !isBistCode(code)) {
        throw new Error('Paper trading is BIST-only (symbol not in BIST 100 list)');
    }
    return code;
}

function markPortfolio(portfolio, quotesBySymbol) {
    let positionsValue = 0;
    const positions = [];
    Object.keys(portfolio.positions || {}).forEach((symbol) => {
        const pos = portfolio.positions[symbol];
        if (!pos || !(pos.qty > 0)) return;
        const q = quotesBySymbol[symbol];
        const mark = q && typeof q.price === 'number' ? q.price : pos.avgCost;
        const marketValue = matcher.roundMoney(pos.qty * mark);
        const unrealized = matcher.roundMoney((mark - pos.avgCost) * pos.qty);
        positionsValue = matcher.roundMoney(positionsValue + marketValue);
        positions.push({
            symbol,
            qty: pos.qty,
            avgCost: pos.avgCost,
            openedAt: pos.openedAt || null,
            mark,
            marketValue,
            unrealizedPnl: unrealized,
            limitPressure: matcher.limitPressure(q || {})
        });
    });
    const unrealizedPnl = matcher.roundMoney(
        positions.reduce((sum, p) => sum + p.unrealizedPnl, 0)
    );
    const equity = matcher.roundMoney(portfolio.cash + positionsValue);
    const totalPnl = matcher.roundMoney(equity - portfolio.startingCash);
    const returnPct = portfolio.startingCash > 0
        ? matcher.roundMoney((totalPnl / portfolio.startingCash) * 10000) / 100
        : 0;
    return {
        startingCash: portfolio.startingCash,
        cash: portfolio.cash,
        positionsValue,
        equity,
        realizedPnl: portfolio.realizedPnl,
        unrealizedPnl,
        totalPnl,
        returnPct,
        positions,
        createdAt: portfolio.createdAt,
        updatedAt: portfolio.updatedAt
    };
}

function getState(quotesBySymbol = {}) {
    const portfolio = paperStore.getPortfolio();
    const marked = markPortfolio(portfolio, quotesBySymbol);
    return {
        portfolio: marked,
        openOrders: paperStore.getOpenOrders(),
        orders: paperStore.getOrders().slice(0, 100),
        fills: paperStore.getFills().slice(0, 100),
        autoTrade: signals.getSettings().autoTrade,
        signals: signals.getSignals().slice(0, 50),
        config: {
            startingCashTry: config.startingCashTry,
            minFillDelayMs: config.minFillDelayMs,
            halfSpread: config.halfSpread,
            feeRate: config.feeRate,
            dailyLimitPct: config.dailyLimitPct,
            orderTtlMs: config.orderTtlMs,
            confidenceMin: config.confidenceMin,
            positionPct: config.positionPct,
            maxSymbolPct: config.maxSymbolPct,
            cooldownMs: config.cooldownMs,
            takeProfitPct: config.takeProfitPct,
            stopLossPct: config.stopLossPct,
            maxHoldMs: config.maxHoldMs
        },
        disclaimer: 'Paper trading only. Not investment advice. Delayed Yahoo marks; soft daily-limit friction.'
    };
}

function placeOrder({ side, symbol, qty, type, limitPrice, source }) {
    const code = assertBist(symbol);
    const orderSide = String(side || '').toLowerCase();
    if (orderSide !== 'buy' && orderSide !== 'sell') {
        throw new Error('side must be buy or sell');
    }
    const orderType = String(type || 'market').toLowerCase();
    if (orderType !== 'market' && orderType !== 'limit') {
        throw new Error('type must be market or limit');
    }
    const shares = matcher.roundShares(Number(qty));
    if (!(shares > 0)) throw new Error('qty must be positive');

    let limit = null;
    if (orderType === 'limit') {
        limit = Number(limitPrice);
        if (!(limit > 0)) throw new Error('limitPrice required for limit orders');
    }

    const portfolio = paperStore.getPortfolio();
    if (orderSide === 'sell') {
        const held = portfolio.positions[code];
        const have = held && held.qty ? held.qty : 0;
        if (shares > have + 0.0001) {
            throw new Error(`Insufficient shares: have ${have}, sell ${shares}`);
        }
    }

    const now = new Date();
    const order = {
        id: paperStore.newId('ord'),
        symbol: code,
        side: orderSide,
        type: orderType,
        qty: shares,
        filledQty: 0,
        limitPrice: limit,
        status: 'open',
        source: source || 'manual',
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + config.orderTtlMs).toISOString()
    };

    const orders = paperStore.getOrders();
    orders.unshift(order);
    paperStore.saveOrders(orders);
    return order;
}

function cancelOrder(orderId) {
    const id = String(orderId || '');
    const orders = paperStore.getOrders();
    const order = orders.find((o) => o.id === id);
    if (!order) throw new Error('order not found');
    if (order.status !== 'open' && order.status !== 'partial') {
        throw new Error(`cannot cancel order in status ${order.status}`);
    }
    order.status = 'cancelled';
    order.updatedAt = new Date().toISOString();
    paperStore.saveOrders(orders);
    return order;
}

function reset(startingCash) {
    return paperStore.resetPortfolio(startingCash);
}

function runMatch(quotesBySymbol) {
    return matcher.matchOpenOrders(quotesBySymbol || {});
}

/** Symbols needed for marks + open order matching. */
function symbolsOfInterest() {
    const portfolio = paperStore.getPortfolio();
    const set = new Set(Object.keys(portfolio.positions || {}));
    paperStore.getOpenOrders().forEach((o) => {
        if (o && o.symbol) set.add(o.symbol);
    });
    try {
        signals.getSignals().slice(0, 30).forEach((s) => {
            if (s && s.action === 'buy_pending_quote' && s.stock) set.add(s.stock);
        });
    } catch (_) {
        /* ignore */
    }
    return [...set];
}

function setAutoTrade(enabled) {
    return signals.setAutoTrade(enabled);
}

module.exports = {
    getState,
    placeOrder,
    cancelOrder,
    reset,
    runMatch,
    symbolsOfInterest,
    markPortfolio,
    setAutoTrade
};
