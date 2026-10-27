# ALLINONEVIEW — Free 24/7 deployment

Primary target: Oracle Cloud Infrastructure Always Free VM.

## VM
- Ubuntu 24.04
- Always Free VM.Standard.E2.1.Micro or Always Free Ampere A1 shape
- Public IPv4
- Open inbound TCP 22, 80 and 443
- Keep all market credentials server-side only

## Server setup

```bash
sudo apt update
sudo apt install -y git curl build-essential nginx certbot python3-certbot-nginx

curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2

sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

git clone -b backend-market-data-worker https://github.com/ssmitpparekh/TradingAllInOneStrategy.git
cd TradingAllInOneStrategy
npm install
```

Create `.env.local` on the VM. Never commit it.

Required private values:
- FYERS_APP_ID
- FYERS_APP_SECRET
- FYERS_REDIRECT_URI
- OANDA_API_TOKEN
- OANDA_ENVIRONMENT=live
- DATABASE_URL
- DATABASE_URL_UNPOOLED

Then:

```bash
npm run typecheck
npm run build
npm run db:setup
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

Run the exact command printed by `pm2 startup`, then run `pm2 save` again.

## Nginx

Point a DNS hostname to the VM public IP, then create:

```bash
sudo nano /etc/nginx/sites-available/allinoneview
```

Use:

```nginx
server {
    listen 80;
    server_name YOUR_HOSTNAME;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 3600s;
    }
}
```

Enable it:

```bash
sudo ln -s /etc/nginx/sites-available/allinoneview /etc/nginx/sites-enabled/allinoneview
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d YOUR_HOSTNAME
```

## FYERS production callback

Change the FYERS app redirect URL and the VM's `FYERS_REDIRECT_URI` to:

```
https://YOUR_HOSTNAME/api/auth/fyers/callback
```

Then:

```bash
pm2 restart allinoneview-web --update-env
```

Open the site and complete Connect FYERS once after a daily token expiry.

## Health checks

```bash
curl -s https://YOUR_HOSTNAME/api/health
curl -s https://YOUR_HOSTNAME/api/fyers/status
curl -s https://YOUR_HOSTNAME/api/oanda/status
curl -s https://YOUR_HOSTNAME/api/kraken/status
pm2 status
```

Expected production processes:
- allinoneview-web
- allinoneview-orderflow
- allinoneview-history-sync

## Data rules

Only provider-returned or deterministically calculated values are persisted.
No guessed order flow, no estimated candles, no fabricated volumes.

Current provenance:
- FYERS candles: provider OHLCV/OI where returned
- Kraken trade tape: exact provider trade side, price and quantity
- Kraken candles: provider OHLCV
- OANDA candles: provider midpoint OHLC with OANDA tick/price-count volume semantics
- OANDA live: provider bid/ask/mid pricing stream

Every stored candle retains provider, market, symbol, resolution, source and quality metadata.
