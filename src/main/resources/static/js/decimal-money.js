(function (global) {
    'use strict';

    var DECIMAL = /^([+-]?)(\d+)(?:\.(\d+))?$/;

    function parse(value) {
        var match = DECIMAL.exec(String(value == null ? '' : value).trim());
        if (!match) return null;
        var whole = match[2].replace(/^0+(?=\d)/, '') || '0';
        var fraction = match[3] || '';
        if (fraction.length > 2 && /[1-9]/.test(fraction.slice(2))) return null;
        fraction = (fraction + '00').slice(0, 2);
        var zero = whole === '0' && fraction === '00';
        return { negative: match[1] === '-' && !zero, positive: match[1] !== '-' && !zero,
            whole: whole, fraction: fraction, cents: whole + fraction };
    }

    function format(value, options) {
        var amount = parse(value);
        if (!amount) return '-';
        options = options || {};
        var whole = amount.whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        var sign = options.absolute ? '' : amount.negative ? '-' : options.signed && amount.positive ? '+' : '';
        var currency = options.currency === false ? '' : '¥';
        return sign + currency + whole + '.' + amount.fraction;
    }

    function sign(value) {
        var amount = parse(value);
        return !amount ? null : amount.negative ? -1 : amount.positive ? 1 : 0;
    }

    function percent(value, maximum) {
        var amount = parse(value);
        var max = parse(maximum);
        if (!amount || !max || max.cents === '0') return 0;
        var result = Number((BigInt(amount.cents) * 100n) / BigInt(max.cents));
        return result > 0 ? Math.max(3, Math.min(100, result)) : 0;
    }

    global.DecimalMoney = { format: format, sign: sign, percent: percent };
})(window);
