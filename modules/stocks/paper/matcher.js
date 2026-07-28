/**
 * Soft fill matcher — delay, spread, fees, partials, soft ±10% daily limit friction.
 */
const { config } = require('./config');
const paperStore = require('./store');

function roundMoney(n) {
    return Math.round(n * 100) / 100;
}

function roundShares(n) {
    return Math.round(n * 10000) / 10000;
}

/**
 * How close price is to the daily ±limit band (0 = mid, 1 = at band).
 */
function limitPressure(quote) {
    const price = quote && typeof quote.price === 'number' ? quote.price : null;
    const prev = quote && typeof quote.previousClose === 'number' ? quote.previousClose : null;
    if (price == null || prev == null || prev <= 0) return 0;
    const move = Math.abs((price - prev) / prev);
    const band = config.dailyLimitPct;
    const soft = config.limitSoftZone;
    const softStart = Math.max(0, band - soft);
    if (move < softStart) return 0;
    if (move >= band) return 1;
    return (move - softStart) / (band - softStart);
}

/**
 * Soft rule: lower fill probability and smaller size near the daily cap.
 * Not a hard ban — at pressure 1, still a small chance of a tiny fill.
 */
function softFillChance(pressure) {
    if (pressure <= 0) return 1;
    // At full pressure: ~8% chance; linear blend otherwise.
    return 1 - pressure * 0.92;
}

function softSizeFactor(pressure) {
    if (pressure <= 0) return 1;
    return Math.max(0.05, 1 - pressure * 0.9);
}

function applySpread(side, last) {
    const half = config.halfSpread;
    if (side === 'buy') return last * (1 + half);
    return last * (1 - half);
}

function feeFor(notional) {
    return roundMoney(Math.abs(notional) * config.feeRate);
}

function positionQty(portfolio, symbol) {
    const p = portfolio.positions[symbol];
    return p && typeof p.qty === 'number' ? p.qty : 0;
}

/**
 * Apply a fill to portfolio (mutates copy). Returns { portfolio, realizedDelta }.
 */
function applyFillToPortfolio(portfolio, { side, symbol, qty, price, fee }) {
    const next = {
        ...portfolio,
        positions: { ...portfolio.positions },
        cash: portfolio.cash,
        realizedPnl: portfolio.realizedPnl
    };
    const notional = roundMoney(qty * price);
    let realizedDelta = 0;

    if (side === 'buy') {
        const cost = notional + fee;
        next.cash = roundMoney(next.cash - cost);
        const prev = next.positions[symbol] || { qty: 0, avgCost: 0 };
        const newQty = roundShares(prev.qty + qty);
        const newAvg = newQty > 0
            ? roundMoney(((prev.qty * prev.avgCost) + notional) / newQty)
            : 0;
        next.positions[symbol] = { qty: newQty, avgCost: newAvg };
    } else {
        const proceeds = notional - fee;
        next.cash = roundMoney(next.cash + proceeds);
        const prev = next.positions[symbol] || { qty: 0, avgCost: 0 };
        const sellQty = Math.min(qty, prev.qty);
        realizedDelta = roundMoney((price - prev.avgCost) * sellQty - fee);
        next.realizedPnl = roundMoney(next.realizedPnl + realizedDelta);
        const remain = roundShares(prev.qty - sellQty);
        if (remain <= 0.0001) {
            delete next.positions[symbol];
        } else {
            next.positions[symbol] = { qty: remain, avgCost: prev.avgCost };
        }
    }
    return { portfolio: next, realizedDelta };
}

/**
 * Attempt fills for open orders against current quotes.
 * @param {Record<string, object>} quotesBySymbol
 * @returns {{ fills: object[], orders: object[], portfolio: object, changed: boolean }}
 */
function matchOpenOrders(quotesBySymbol) {
    const now = Date.now();
    let portfolio = paperStore.getPortfolio();
    let orders = paperStore.getOrders().map((o) => ({ ...o }));
    const fills = [];
    let changed = false;

    for (const order of orders) {
        if (!order || (order.status !== 'open' && order.status !== 'partial')) continue;

        const createdMs = Date.parse(order.createdAt) || 0;
        if (order.expiresAt && Date.parse(order.expiresAt) <= now) {
            order.status = 'expired';
            order.updatedAt = new Date().toISOString();
            changed = true;
            continue;
        }
        if (now - createdMs < config.minFillDelayMs) continue;

        const quote = quotesBySymbol[order.symbol];
        if (!quote || typeof quote.price !== 'number' || quote.price <= 0) continue;

        const last = quote.price;
        const limit = typeof order.limitPrice === 'number' ? order.limitPrice : null;

        // Limit check against last (before spread).
        if (order.type === 'limit' && limit != null) {
            if (order.side === 'buy' && last > limit) continue;
            if (order.side === 'sell' && last < limit) continue;
        }

        const pressure = limitPressure(quote);
        const chance = softFillChance(pressure);
        if (Math.random() > chance) continue;

        const remaining = roundShares(order.qty - (order.filledQty || 0));
        if (remaining <= 0) {
            order.status = 'filled';
            order.updatedAt = new Date().toISOString();
            changed = true;
            continue;
        }

        let fillQty = Math.min(remaining, config.partialFillMaxShares);
        fillQty = roundShares(fillQty * softSizeFactor(pressure));
        if (fillQty < 0.0001) continue;

        // Market / limit aggressive price with spread.
        let fillPrice = applySpread(order.side, last);
        if (order.type === 'limit' && limit != null) {
            if (order.side === 'buy') fillPrice = Math.min(fillPrice, limit);
            else fillPrice = Math.max(fillPrice, limit);
        }
        fillPrice = roundMoney(fillPrice);

        if (order.side === 'buy') {
            const fee = feeFor(fillQty * fillPrice);
            const need = roundMoney(fillQty * fillPrice + fee);
            if (need > portfolio.cash + 0.001) {
                // Scale down to cash.
                const maxAfford = portfolio.cash / (fillPrice * (1 + config.feeRate));
                fillQty = roundShares(Math.min(fillQty, maxAfford));
                if (fillQty < 0.0001) continue;
            }
        } else {
            const held = positionQty(portfolio, order.symbol);
            fillQty = roundShares(Math.min(fillQty, held));
            if (fillQty < 0.0001) continue;
        }

        const fee = feeFor(fillQty * fillPrice);
        const applied = applyFillToPortfolio(portfolio, {
            side: order.side,
            symbol: order.symbol,
            qty: fillQty,
            price: fillPrice,
            fee
        });
        portfolio = applied.portfolio;

        const fill = {
            id: paperStore.newId('fill'),
            orderId: order.id,
            symbol: order.symbol,
            side: order.side,
            qty: fillQty,
            price: fillPrice,
            fee,
            realizedPnl: applied.realizedDelta,
            limitPressure: Math.round(pressure * 1000) / 1000,
            source: order.source || 'manual',
            filledAt: new Date().toISOString()
        };
        paperStore.appendFill(fill);
        fills.push(fill);

        order.filledQty = roundShares((order.filledQty || 0) + fillQty);
        order.updatedAt = new Date().toISOString();
        if (order.filledQty + 0.00005 >= order.qty) {
            order.status = 'filled';
        } else {
            order.status = 'partial';
        }
        changed = true;
    }

    if (changed) {
        paperStore.saveOrders(orders);
        paperStore.savePortfolio(portfolio);
    }

    return { fills, orders, portfolio, changed };
}

module.exports = {
    matchOpenOrders,
    limitPressure,
    applySpread,
    feeFor,
    roundMoney,
    roundShares
};
