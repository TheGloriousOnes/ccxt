"use strict";

//  ---------------------------------------------------------------------------

const Exchange = require ('./base/Exchange');
const { ExchangeError } = require ('./base/errors');

//  ---------------------------------------------------------------------------

module.exports = class exmo extends Exchange {

    describe () {
        return this.deepExtend (super.describe (), {
            'id': 'exmo',
            'name': 'EXMO',
            'countries': [ 'ES', 'RU' ], // Spain, Russia
            'rateLimit': 1000, // once every 350 ms ≈ 180 requests per minute ≈ 3 requests per second
            'version': 'v1',
            'hasCORS': false,
            'hasFetchTickers': true,
            'hasFetchOrderBooks': true,
            'hasWithdraw': true,
            'urls': {
                'logo': 'https://user-images.githubusercontent.com/1294454/27766491-1b0ea956-5eda-11e7-9225-40d67b481b8d.jpg',
                'api': 'https://api.exmo.com',
                'www': 'https://exmo.me',
                'doc': [
                    'https://exmo.me/en/api_doc',
                    'https://github.com/exmo-dev/exmo_api_lib/tree/master/nodejs',
                ],
                'fees': 'https://exmo.com/en/docs/fees',
            },
            'api': {
                'public': {
                    'get': [
                        'currency',
                        'order_book',
                        'pair_settings',
                        'ticker',
                        'trades',
                    ],
                },
                'private': {
                    'post': [
                        'user_info',
                        'order_create',
                        'order_cancel',
                        'user_open_orders',
                        'user_trades',
                        'user_cancelled_orders',
                        'order_trades',
                        'required_amount',
                        'deposit_address',
                        'withdraw_crypt',
                        'withdraw_get_txid',
                        'excode_create',
                        'excode_load',
                        'wallet_history',
                    ],
                },
            },
            'fees': {
                'trading': {
                    'maker': 0.2 / 100,
                    'taker': 0.2 / 100,
                },
                'funding': {
                    'witdhraw': {
                        'BTC': 0.001,
                        'LTC': 0.01,
                        'DOGE': 1,
                        'DASH': 0.01,
                        'ETH': 0.01,
                        'WAVES': 0.001,
                        'ZEC': 0.001,
                        'USDT': 25,
                        'XMR': 0.05,
                        'XRP': 0.02,
                        'KICK': 350,
                        'ETC': 0.01,
                        'BCH': 0.001,
                    },
                    'deposit': {
                        'USDT': 15,
                        'KICK': 50,
                    },
                },
            },
        });
    }

    async fetchMarkets () {
        let markets = await this.publicGetPairSettings ();
        let keys = Object.keys (markets);
        let result = [];
        for (let p = 0; p < keys.length; p++) {
            let id = keys[p];
            let market = markets[id];
            let symbol = id.replace ('_', '/');
            let [ base, quote ] = symbol.split ('/');
            result.push ({
                'id': id,
                'symbol': symbol,
                'base': base,
                'quote': quote,
                'limits': {
                    'amount': {
                        'min': market['min_quantity'],
                        'max': market['max_quantity'],
                    },
                    'price': {
                        'min': market['min_price'],
                        'max': market['max_price'],
                    },
                    'cost': {
                        'min': market['min_amount'],
                        'max': market['max_amount'],
                    },
                },
                'precision': {
                    'amount': 8,
                    'price': 8,
                },
                'info': market,
            });
        }
        return result;
    }

    async fetchBalance (params = {}) {
        await this.loadMarkets ();
        let response = await this.privatePostUserInfo ();
        let result = { 'info': response };
        let currencies = Object.keys (this.currencies);
        for (let i = 0; i < currencies.length; i++) {
            let currency = currencies[i];
            let account = this.account ();
            if (currency in response['balances'])
                account['free'] = parseFloat (response['balances'][currency]);
            if (currency in response['reserved'])
                account['used'] = parseFloat (response['reserved'][currency]);
            account['total'] = this.sum (account['free'], account['used']);
            result[currency] = account;
        }
        return this.parseBalance (result);
    }

    async fetchOrderBook (symbol, params = {}) {
        await this.loadMarkets ();
        let market = this.market (symbol);
        let response = await this.publicGetOrderBook (this.extend ({
            'pair': market['id'],
        }, params));
        let result = response[market['id']];
        let orderbook = this.parseOrderBook (result, undefined, 'bid', 'ask');
        return this.extend (orderbook, {
            'bids': this.sortBy (orderbook['bids'], 0, true),
            'asks': this.sortBy (orderbook['asks'], 0),
        });
    }

    async fetchOrderBooks (symbols, params = {}) {
        await this.loadMarkets();
        let requestSymbols = [];
        let orderBooksResult = [];
        if (!symbols) {
            symbols = this.symbols;
        }
        for (let i = 0; i < symbols.length; i++) {
            requestSymbols.push(symbols[i]);
            let maxRequestSymbolsReached = (i % 200 === 0 && i > 0);
            let endReached = (i === symbols.length - 1);
            if (maxRequestSymbolsReached || endReached) {
                let fetchPairString = this.parseSymbolOrderBooksString(requestSymbols);
                try {
                    let response = await this.publicGetOrderBook(this.extend({'pair': fetchPairString}, params));
                    if (response) {
                        let orderBooks = Object.values(response);
                        let keys = Object.keys(response);
                        for (let j = 0; j < orderBooks.length; j++) {
                            let key = keys[j];
                            let orderbook = this.parseOrderBook(orderBooks[j], undefined, 'bid', 'ask', '0', '1');
                            orderBooksResult.push(this.extend(orderbook, {symbol: key.replace("_", "/")}));
                            }
                        }
                    }
                } catch(e) {
                    throw new ExchangeError ('fetchOrderBooks() returned error:' + e.message +' for pair string: ' + fetchPairString);
                }
                requestSymbols = [];
            }
        }
        return orderBooksResult;
    }

    parseSymbolOrderBooksString (symbols) {
        let symbolsResultList = [];
        for (let i = 0; i < symbols.length; i++) {
            symbolsResultList.push(symbols[i].replace("/", "_"));
        }
        return symbolsResultList.join(",");
    }

    parseTicker (ticker, market = undefined) {
        let timestamp = ticker['updated'] * 1000;
        let symbol = undefined;
        if (market)
            symbol = market['symbol'];
        return {
            'symbol': symbol,
            'timestamp': timestamp,
            'datetime': this.iso8601 (timestamp),
            'high': parseFloat (ticker['high']),
            'low': parseFloat (ticker['low']),
            'bid': parseFloat (ticker['buy_price']),
            'ask': parseFloat (ticker['sell_price']),
            'vwap': undefined,
            'open': undefined,
            'close': undefined,
            'first': undefined,
            'last': parseFloat (ticker['last_trade']),
            'change': undefined,
            'percentage': undefined,
            'average': parseFloat (ticker['avg']),
            'baseVolume': parseFloat (ticker['vol']),
            'quoteVolume': parseFloat (ticker['vol_curr']),
            'info': ticker,
        };
    }

    async fetchTickers (symbols = undefined, params = {}) {
        await this.loadMarkets ();
        let response = await this.publicGetTicker (params);
        let result = {};
        let ids = Object.keys (response);
        for (let i = 0; i < ids.length; i++) {
            let id = ids[i];
            let market = this.markets_by_id[id];
            let symbol = market['symbol'];
            let ticker = response[id];
            result[symbol] = this.parseTicker (ticker, market);
        }
        return result;
    }

    async fetchTicker (symbol, params = {}) {
        await this.loadMarkets ();
        let response = await this.publicGetTicker (params);
        let market = this.market (symbol);
        return this.parseTicker (response[market['id']], market);
    }

    parseTrade (trade, market) {
        let timestamp = trade['date'] * 1000;
        return {
            'id': trade['trade_id'].toString (),
            'info': trade,
            'timestamp': timestamp,
            'datetime': this.iso8601 (timestamp),
            'symbol': market['symbol'],
            'order': undefined,
            'type': undefined,
            'side': trade['type'],
            'price': parseFloat (trade['price']),
            'amount': parseFloat (trade['quantity']),
        };
    }

    async fetchTrades (symbol, since = undefined, limit = undefined, params = {}) {
        await this.loadMarkets ();
        let market = this.market (symbol);
        let response = await this.publicGetTrades (this.extend ({
            'pair': market['id'],
        }, params));
        return this.parseTrades (response[market['id']], market, since, limit);
    }

    async createOrder (symbol, type, side, amount, price = undefined, params = {}) {
        await this.loadMarkets ();
        let prefix = '';
        if (type == 'market')
            prefix = 'market_';
        if (typeof price === 'undefined')
            price = 0;
        let order = {
            'pair': this.marketId (symbol),
            'quantity': amount,
            'price': price,
            'type': prefix + side,
        };
        let response = await this.privatePostOrderCreate (this.extend (order, params));
        return {
            'info': response,
            'id': response['order_id'].toString (),
        };
    }

    async cancelOrder (id, symbol = undefined, params = {}) {
        await this.loadMarkets ();
        return await this.privatePostOrderCancel ({ 'order_id': id });
    }

    async withdraw (currency, amount, address, params = {}) {
        await this.loadMarkets ();
        let result = await this.privatePostWithdrawCrypt (this.extend ({
            'amount': amount,
            'currency': currency,
            'address': address,
        }, params));
        return {
            'info': result,
            'id': result['task_id'],
        };
    }

    sign (path, api = 'public', method = 'GET', params = {}, headers = undefined, body = undefined) {
        let url = this.urls['api'] + '/' + this.version + '/' + path;
        if (api == 'public') {
            if (Object.keys (params).length)
                url += '?' + this.urlencode (params);
        } else {
            this.checkRequiredCredentials ();
            let nonce = this.nonce ();
            body = this.urlencode (this.extend ({ 'nonce': nonce }, params));
            headers = {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Key': this.apiKey,
                'Sign': this.hmac (this.encode (body), this.encode (this.secret), 'sha512'),
            };
        }
        return { 'url': url, 'method': method, 'body': body, 'headers': headers };
    }

    async request (path, api = 'public', method = 'GET', params = {}, headers = undefined, body = undefined) {
        let response = await this.fetch2 (path, api, method, params, headers, body);
        if ('result' in response) {
            if (response['result'])
                return response;
            throw new ExchangeError (this.id + ' ' + this.json (response));
        }
        return response;
    }
}
