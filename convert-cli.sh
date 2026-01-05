#!/usr/bin/env bash
# convert-cli.sh
# CLI helper to POST an HTML file to the Playwright render API /convert endpoint
# Usage: ./convert-cli.sh --file path/to/file.html [options]
# Requires: curl. Preferably jq or python3 for safe JSON encoding.

set -euo pipefail

# Defaults
API_URL="${API_URL:-http://localhost:3000/convert}"
API_KEY=""
CONTENT_TYPE="application/json"
TMP_JSON=""
CURL_OPTS=()
OUTFILE=""
SAVE=false
OUTPATH=""
METHOD="post"

show_help() {
  cat <<'EOF'
Usage: convert-cli.sh [options]

Options:
  --file PATH           Read HTML from PATH (use '-' for stdin). Required unless --html supplied.
  --html STRING         Pass HTML string directly (careful with shell quoting).
  --api-key KEY         API key (or set API_KEY env)
  --png                 Output PNG instead of PDF
  --format FORMAT       Paper format: A4 (default), A5, Letter, Legal
  --orientation ORIENT  portrait (default) or landscape
  --margin MARGIN       e.g. 10mm (default)
  --single              Fit to single page (shrink-to-fit)
  --scale SCALE         Numeric override for scale (0.1-2)
  --dpi DPI             DPI for PNG (default 96)
  --filename NAME       Suggested filename returned in response header and saved file
  --save                Tell server to save file under its /output; server returns JSON path
  --outpath PATH        Path under server /output where file will be saved (when --save)
  --output PATH         Local path to write the returned file (when server streams file)
  --url URL             Alternative API URL (overrides API_URL env)
  -h, --help            Show this help and exit

Examples:
  ./convert-cli.sh --file example.html --api-key key-abc123 --output out.pdf
  ./convert-cli.sh --file example.html --api-key key-abc123 --png --dpi 150 --output out.png
  ./convert-cli.sh --file example.html --api-key key-abc123 --save --outpath invoices/one.pdf

EOF
}

# parse args
ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --file) FILE="$2"; shift 2;;
    --file=*) FILE="${1#*=}"; shift 1;;
    --html) HTML_STR="$2"; shift 2;;
    --html=*) HTML_STR="${1#*=}"; shift 1;;
    --api-key) API_KEY="$2"; shift 2;;
    --api-key=*) API_KEY="${1#*=}"; shift 1;;
    --png) OPT_PNG=true; shift;;
    --format) OPT_FORMAT="$2"; shift 2;;
    --format=*) OPT_FORMAT="${1#*=}"; shift 1;;
    --orientation) OPT_ORIENTATION="$2"; shift 2;;
    --orientation=*) OPT_ORIENTATION="${1#*=}"; shift 1;;
    --margin) OPT_MARGIN="$2"; shift 2;;
    --margin=*) OPT_MARGIN="${1#*=}"; shift 1;;
    --single) OPT_SINGLE=true; shift;;
    --scale) OPT_SCALE="$2"; shift 2;;
    --scale=*) OPT_SCALE="${1#*=}"; shift 1;;
    --dpi) OPT_DPI="$2"; shift 2;;
    --dpi=*) OPT_DPI="${1#*=}"; shift 1;;
    --filename) OPT_FILENAME="$2"; shift 2;;
    --filename=*) OPT_FILENAME="${1#*=}"; shift 1;;
    --save) SAVE=true; shift;;
    --outpath) OUTPATH="$2"; shift 2;;
    --outpath=*) OUTPATH="${1#*=}"; shift 1;;
    --output) OUTFILE="$2"; shift 2;;
    --output=*) OUTFILE="${1#*=}"; shift 1;;
    --url) API_URL="$2"; shift 2;;
    --url=*) API_URL="${1#*=}"; shift 1;;
    -h|--help) show_help; exit 0;;
    *) ARGS+=("$1"); shift;;
  esac
done

# sanity: require file or html string
if [[ -z "${FILE:-}" && -z "${HTML_STR:-}" ]]; then
  echo "Error: either --file or --html is required." >&2
  show_help
  exit 2
fi

# read HTML content
if [[ -n "${FILE:-}" ]]; then
  if [[ "$FILE" == "-" ]]; then
    HTML_CONTENT="$(cat -)"
  else
    if [[ ! -f "$FILE" ]]; then
      echo "Error: file not found: $FILE" >&2
      exit 2
    fi
    HTML_CONTENT="$(cat "$FILE")"
  fi
else
  HTML_CONTENT="${HTML_STR}"
fi

# build options JSON object
# default options
OPT_FORMAT="${OPT_FORMAT:-A4}"
OPT_ORIENTATION="${OPT_ORIENTATION:-portrait}"
OPT_MARGIN="${OPT_MARGIN:-10mm}"
OPT_SCALE="${OPT_SCALE:-null}"
OPT_DPI="${OPT_DPI:-96}"
OPT_FILENAME="${OPT_FILENAME:-}"

# assemble options object for JSON
# We'll construct using jq if available, otherwise python3, otherwise a fallback escaped string.
build_json_with_jq() {
  # shellcheck disable=SC2086
  jq -n --arg html "$HTML_CONTENT" \
     --arg format "$OPT_FORMAT" \
     --arg orientation "$OPT_ORIENTATION" \
     --arg margin "$OPT_MARGIN" \
     --arg scale "${OPT_SCALE:-}" \
     --argjson single $([[ "${OPT_SINGLE:-false}" == "true" ]] && echo true || echo false) \
     --argjson png $([[ "${OPT_PNG:-false}" == "true" ]] && echo true || echo false) \
     --arg dpi "$OPT_DPI" \
     --arg filename "$OPT_FILENAME" \
     --argjson save $([[ "$SAVE" == "true" ]] && echo true || echo false) \
     --arg outPath "$OUTPATH" \
     '{
        html: $html,
        options: {
          format: ($format|tostring),
          orientation: ($orientation|tostring),
          margin: ($margin|tostring),
          single: $single,
          scale: (if $scale=="" or $scale==null then null else ($scale|tonumber) end),
          png: $png,
          dpi: ($dpi|tonumber),
          filename: (if $filename=="" then null else $filename end)
        },
        save: $save,
        outPath: (if $outPath=="" then null else $outPath end)
      }'
}

build_json_with_python() {
  python3 - <<PYJSON
import json,sys
html = ${json_escaped_python(HTML_CONTENT)}
obj = {
  "html": html,
  "options": {
    "format": "${OPT_FORMAT}",
    "orientation": "${OPT_ORIENTATION}",
    "margin": "${OPT_MARGIN}",
    "single": ${OPT_SINGLE:-false},
    "scale": ${OPT_SCALE:-null if OPT_SCALE=="" else OPT_SCALE},
    "png": ${OPT_PNG:-false},
    "dpi": ${OPT_DPI},
    "filename": ${json.dumps(OPT_FILENAME) if OPT_FILENAME else "None"}
  },
  "save": ${str(SAVE).lower()},
  "outPath": ${json.dumps(OUTPATH) if OUTPATH else "None"}
}
print(json.dumps(obj))
PYJSON
}

# Helper: produce Python-friendly escaped string for inline python here-doc
json_escaped_python() {
  # Function body is replaced at runtime below (we cannot easily embed functions inside heredoc)
  :
}

# Try to build JSON using jq, then python3, else fallback to sed-based naive escaping
if command -v jq >/dev/null 2>&1; then
  REQUEST_JSON="$(build_json_with_jq)"
elif command -v python3 >/dev/null 2>&1; then
  # Use python to safely produce JSON. We'll call a small python program that reads HTML from stdin env var
  REQUEST_JSON="$(python3 - <<PY
import json,sys,os
html = sys.stdin.read()
def maybe_num(s):
    try:
        return float(s)
    except:
        return None
opt = {
  "html": html,
  "options": {
    "format": "${OPT_FORMAT}",
    "orientation": "${OPT_ORIENTATION}",
    "margin": "${OPT_MARGIN}",
    "single": ${OPT_SINGLE:-false},
    "scale": ${OPT_SCALE:-null if (("${OPT_SCALE:-}"=="") or ("${OPT_SCALE:-}"=="null")) else OPT_SCALE_PLACEHOLDER},
    "png": ${OPT_PNG:-false},
    "dpi": ${OPT_DPI},
    "filename": ${json.dumps(OPT_FILENAME) if OPT_FILENAME else "None"}
  },
  "save": ${str(SAVE).lower()},
  "outPath": ${json.dumps(OUTPATH) if OUTPATH else "None"}
}
# Since we cannot easily inject raw OPT_SCALE value in a safe manner above, do a safer approach:
# Rebuild options now properly:
opts = opt["options"]
scale_raw = "${OPT_SCALE:-}"
if scale_raw == "" or scale_raw.lower() == "null":
    opts["scale"] = None
else:
    try:
        num = float(scale_raw)
        opts["scale"] = num
    except:
        opts["scale"] = None
print(json.dumps(opt))
PY
<<< "$HTML_CONTENT")"
else
  # fallback: naive escaping (may fail for very complex HTML)
  esc=$(printf '%s' "$HTML_CONTENT" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))' 2>/dev/null || sed -e 's/"/\\"/g' -e ':a;N;$!ba;s/\n/\\n/g' <<<"$HTML_CONTENT")
  # build manually
  cat > /tmp/convert_cli_req.json <<EOF
{
  "html": $esc,
  "options": {
    "format": "${OPT_FORMAT}",
    "orientation": "${OPT_ORIENTATION}",
    "margin": "${OPT_MARGIN}",
    "single": ${OPT_SINGLE:-false},
    "scale": ${OPT_SCALE:-null},
    "png": ${OPT_PNG:-false},
    "dpi": ${OPT_DPI},
    "filename": ${OPT_FILENAME:+\"$OPT_FILENAME\"}
  },
  "save": ${SAVE},
  "outPath": ${OUTPATH:+\"$OUTPATH\"}
}
EOF
  REQUEST_JSON="$(cat /tmp/convert_cli_req.json)"
fi

# Prepare curl headers
HEADER_AUTH=()
if [[ -n "${API_KEY:-}" ]]; then
  HEADER_AUTH=(-H "Authorization: Bearer ${API_KEY}")
fi

# If output should be saved to local file when server streams, default filename
if [[ -z "${OUTFILE}" ]]; then
  if [[ "${OPT_PNG:-false}" == "true" ]]; then
    OUTFILE="output.png"
  else
    OUTFILE="output.pdf"
  fi
fi

# perform request
if [[ "$SAVE" == "true" ]]; then
  # server returns JSON describing saved path; write result to stdout
  echo "Sending request to ${API_URL} (save=true) ..."
  http_code=$(curl -sS -w "%{http_code}" "${HEADER_AUTH[@]}" -H "Content-Type: ${CONTENT_TYPE}" --data-binary "$REQUEST_JSON" "$API_URL")
  # separate body and code
  # but above returns only code in http_code since -w appended; simpler do full capture:
  response=$(curl -sS -H "Content-Type: ${CONTENT_TYPE}" "${HEADER_AUTH[@]}" --data-binary "$REQUEST_JSON" "$API_URL" || true)
  echo "$response"
  exit 0
else
  echo "Posting to ${API_URL} ..."
  # stream binary output to file
  curl -sS -H "Content-Type: ${CONTENT_TYPE}" "${HEADER_AUTH[@]}" --data-binary "$REQUEST_JSON" "$API_URL" -o "$OUTFILE" -D /tmp/convert_headers || { echo "Request failed"; exit 3; }
  # print headers for info
  echo "Saved response to: $OUTFILE"
  if [[ -f /tmp/convert_headers ]]; then
    echo "Response headers:"
    sed -n '1,50p' /tmp/convert_headers
  fi
  exit 0
fi

