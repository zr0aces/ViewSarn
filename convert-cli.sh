#!/usr/bin/env bash
# convert-cli.sh
# CLI helper to POST an HTML file to the ViewSarn /convert endpoint.
# Usage: ./convert-cli.sh --file path/to/file.html [options]
# Requires: curl and jq (jq builds the JSON, so HTML is always escaped correctly).

set -euo pipefail

API_URL="${API_URL:-http://localhost:3000/convert}"
API_KEY="${API_KEY:-}"
OUTFILE=""
SAVE=false
OUTPATH=""

show_help() {
  cat <<'HELP'
Usage: convert-cli.sh [options]

Options:
  --file PATH           Read HTML from PATH (use '-' for stdin). Required unless --html supplied.
  --html STRING         Pass HTML string directly (careful with shell quoting).
  --api-key KEY         API key (or set the API_KEY environment variable)
  --png                 Output PNG instead of PDF
  --format FORMAT       Paper format: A4 (default), A5, Letter, Legal
  --orientation ORIENT  portrait (default) or landscape
  --margin MARGIN       e.g. 10mm (default)
  --single              Fit to single page (shrink-to-fit)
  --scale SCALE         Numeric override for scale (0.1-2); omitted means "compute it"
  --dpi DPI             DPI for PNG (default 96)
  --filename NAME       Suggested filename returned in the response header and used for a saved file
  --save                Tell the server to save the file under its /output; the server returns JSON
  --outpath PATH        Path inside your own /output directory (when --save)
  --output PATH         Local path to write the returned file (default output.pdf / output.png)
  --url URL             Alternative API URL (overrides the API_URL environment variable)
  -h, --help            Show this help and exit

Examples:
  ./convert-cli.sh --file example.html --api-key key-abc123 --output out.pdf
  ./convert-cli.sh --file example.html --api-key key-abc123 --png --dpi 150 --output out.png
  ./convert-cli.sh --file example.html --api-key key-abc123 --save --outpath invoices/one.pdf
HELP
}

FILE=""
HTML_STR=""
OPT_PNG=false
OPT_SINGLE=false
OPT_FORMAT=""
OPT_ORIENTATION=""
OPT_MARGIN=""
OPT_SCALE=""
OPT_DPI=""
OPT_FILENAME=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --file) FILE="$2"; shift 2;;
    --file=*) FILE="${1#*=}"; shift;;
    --html) HTML_STR="$2"; shift 2;;
    --html=*) HTML_STR="${1#*=}"; shift;;
    --api-key) API_KEY="$2"; shift 2;;
    --api-key=*) API_KEY="${1#*=}"; shift;;
    --png) OPT_PNG=true; shift;;
    --format) OPT_FORMAT="$2"; shift 2;;
    --format=*) OPT_FORMAT="${1#*=}"; shift;;
    --orientation) OPT_ORIENTATION="$2"; shift 2;;
    --orientation=*) OPT_ORIENTATION="${1#*=}"; shift;;
    --margin) OPT_MARGIN="$2"; shift 2;;
    --margin=*) OPT_MARGIN="${1#*=}"; shift;;
    --single) OPT_SINGLE=true; shift;;
    --scale) OPT_SCALE="$2"; shift 2;;
    --scale=*) OPT_SCALE="${1#*=}"; shift;;
    --dpi) OPT_DPI="$2"; shift 2;;
    --dpi=*) OPT_DPI="${1#*=}"; shift;;
    --filename) OPT_FILENAME="$2"; shift 2;;
    --filename=*) OPT_FILENAME="${1#*=}"; shift;;
    --save) SAVE=true; shift;;
    --outpath) OUTPATH="$2"; shift 2;;
    --outpath=*) OUTPATH="${1#*=}"; shift;;
    --output) OUTFILE="$2"; shift 2;;
    --output=*) OUTFILE="${1#*=}"; shift;;
    --url) API_URL="$2"; shift 2;;
    --url=*) API_URL="${1#*=}"; shift;;
    -h|--help) show_help; exit 0;;
    *) echo "Error: unknown option: $1" >&2; show_help >&2; exit 2;;
  esac
done

if ! command -v jq >/dev/null 2>&1; then
  echo "Error: jq is required (it builds the JSON request safely)." >&2
  exit 2
fi

if [[ -z "$FILE" && -z "$HTML_STR" ]]; then
  echo "Error: either --file or --html is required." >&2
  show_help >&2
  exit 2
fi

if [[ -n "$FILE" ]]; then
  if [[ "$FILE" == "-" ]]; then
    HTML_CONTENT="$(cat -)"
  elif [[ -f "$FILE" ]]; then
    HTML_CONTENT="$(cat "$FILE")"
  else
    echo "Error: file not found: $FILE" >&2
    exit 2
  fi
else
  HTML_CONTENT="$HTML_STR"
fi

# Private scratch space, removed on exit. The request body holds the caller's HTML,
# so it must not sit in a shared, predictable /tmp path.
umask 077
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Only options the caller gave are sent; the server applies its own defaults.
OPTIONS='{}'
set_str() { OPTIONS="$(jq -c --arg v "$2" ".$1 = \$v" <<<"$OPTIONS")"; }
set_json() { OPTIONS="$(jq -c --argjson v "$2" ".$1 = \$v" <<<"$OPTIONS")"; }
[[ -n "$OPT_FORMAT" ]] && set_str format "$OPT_FORMAT"
[[ -n "$OPT_ORIENTATION" ]] && set_str orientation "$OPT_ORIENTATION"
[[ -n "$OPT_MARGIN" ]] && set_str margin "$OPT_MARGIN"
[[ -n "$OPT_FILENAME" ]] && set_str filename "$OPT_FILENAME"
[[ -n "$OPT_SCALE" ]] && set_json scale "$OPT_SCALE"
[[ -n "$OPT_DPI" ]] && set_json dpi "$OPT_DPI"
[[ "$OPT_PNG" == "true" ]] && set_json png true
[[ "$OPT_SINGLE" == "true" ]] && set_json single true

jq -n --arg html "$HTML_CONTENT" --argjson options "$OPTIONS" \
      --argjson save "$SAVE" --arg outPath "$OUTPATH" \
      '{html: $html, options: $options}
       + (if $save then {save: true} else {} end)
       + (if $outPath != "" then {outPath: $outPath} else {} end)' > "$WORK/request.json"

HEADER_AUTH=()
if [[ -n "$API_KEY" ]]; then
  HEADER_AUTH=(-H "Authorization: Bearer ${API_KEY}")
fi

if [[ -z "$OUTFILE" ]]; then
  if [[ "$OPT_PNG" == "true" ]]; then OUTFILE="output.png"; else OUTFILE="output.pdf"; fi
fi

# One request. The status is read from curl itself, so an error response is
# reported as an error rather than written into the output file as if it were a PDF.
status="$(curl -sS ${HEADER_AUTH[@]+"${HEADER_AUTH[@]}"} -H "Content-Type: application/json" \
  --data-binary "@$WORK/request.json" -o "$WORK/response" -w '%{http_code}' "$API_URL")" || {
  echo "Request failed: could not reach ${API_URL}" >&2
  exit 3
}

if [[ "$status" != "200" ]]; then
  echo "Request failed: HTTP ${status}" >&2
  cat "$WORK/response" >&2
  echo >&2
  exit 3
fi

if [[ "$SAVE" == "true" ]]; then
  cat "$WORK/response"
  echo
else
  mv "$WORK/response" "$OUTFILE"
  echo "Saved response to: $OUTFILE"
fi
