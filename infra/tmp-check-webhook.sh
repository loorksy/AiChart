#!/usr/bin/env bash
TOKEN=$(grep '^TELEGRAM_BOT_TOKEN=' /opt/aichart/web/.env | cut -d= -f2- | tr -d '\r')
curl -s "https://api.telegram.org/bot${TOKEN}/getWebhookInfo"
echo ""
pm2 list | grep aichart
