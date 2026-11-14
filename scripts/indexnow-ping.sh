#!/usr/bin/env bash
# Notifies Bing/IndexNow of every URL listed in sitemap.xml.
# Run this on the server (needs outbound internet) after any content
# update - new blog post, edited About page, etc.
set -euo pipefail

HOST="vanneck.xyz"
KEY="3add04d481b1266f0ed82e763853156c"
KEY_LOCATION="https://vanneck.xyz/${KEY}.txt"

# URLs come from sitemap.xml, so every new page is pinged without editing this script.
SITEMAP="$(cd "$(dirname "$0")/.." && pwd)/sitemap.xml"
URLS=$(grep -o '<loc>[^<]*</loc>' "$SITEMAP" | sed -e 's/<loc>//' -e 's/<\/loc>//')
if [ -z "$URLS" ]; then echo "No URLs found in $SITEMAP" >&2; exit 1; fi
echo "Pinging $(printf '%s\n' "$URLS" | wc -l | tr -d ' ') URLs from sitemap.xml"

URL_JSON=$(printf '%s\n' "$URLS" | sed 's/.*/"&"/' | paste -sd, -)

curl -s -X POST "https://api.indexnow.org/indexnow" \
  -H "Content-Type: application/json; charset=utf-8" \
  -d "{\"host\":\"${HOST}\",\"key\":\"${KEY}\",\"keyLocation\":\"${KEY_LOCATION}\",\"urlList\":[${URL_JSON}]}" \
  -w "\nHTTP %{http_code}\n"
