#!/usr/bin/env bash
# Notifies Bing/IndexNow of all indexable URLs on vanneck.xyz.
# Run this on the server (needs outbound internet) after any content
# update - new blog post, edited About page, etc.
set -euo pipefail

HOST="vanneck.xyz"
KEY="3add04d481b1266f0ed82e763853156c"
KEY_LOCATION="https://vanneck.xyz/${KEY}.txt"

URLS=$(cat <<'EOF'
https://vanneck.xyz/
https://vanneck.xyz/about/
https://vanneck.xyz/blog/
https://vanneck.xyz/deals/
https://vanneck.xyz/blog/introducing-vanneck-capital/
https://vanneck.xyz/blog/how-the-accelerator-fund-works/
https://vanneck.xyz/blog/our-standard-terms/
https://vanneck.xyz/blog/what-to-prepare-before-a-first-call/
https://vanneck.xyz/blog/what-comes-with-the-check/
https://vanneck.xyz/blog/why-we-backed-skalor/
https://vanneck.xyz/blog/institutional-tokenization-founders/
https://vanneck.xyz/blog/how-to-read-a-token-unlock-schedule/
https://vanneck.xyz/blog/safe-saft-token-warrant-hybrid/
https://vanneck.xyz/blog/how-to-check-an-investor/
https://vanneck.xyz/blog/liquidation-preference-and-anti-dilution/
https://vanneck.xyz/blog/build-your-data-room/
https://vanneck.xyz/blog/token-unlock-schedule-worked-example/
https://vanneck.xyz/blog/pro-rata-rights-explained/
https://vanneck.xyz/blog/what-dtcc-on-solana-means-for-token-founders/
EOF
)

URL_JSON=$(printf '%s\n' "$URLS" | sed 's/.*/"&"/' | paste -sd, -)

curl -s -X POST "https://api.indexnow.org/indexnow" \
  -H "Content-Type: application/json; charset=utf-8" \
  -d "{\"host\":\"${HOST}\",\"key\":\"${KEY}\",\"keyLocation\":\"${KEY_LOCATION}\",\"urlList\":[${URL_JSON}]}" \
  -w "\nHTTP %{http_code}\n"
