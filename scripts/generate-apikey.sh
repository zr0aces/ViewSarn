#!/usr/bin/env bash
# scripts/generate-apikey.sh
# Automate API key generation for ViewSarn.
# Delegates to generate-apikey.js when node is available,
# or generates 256-bit cryptographically secure keys via openssl/urandom.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JS_SCRIPT="${SCRIPT_DIR}/generate-apikey.js"

if command -v node >/dev/null 2>&1 && [ -f "${JS_SCRIPT}" ]; then
  exec node "${JS_SCRIPT}" "$@"
fi

# Fallback when Node.js is not available in the current environment
COUNT=1
OUTFILE=""
COMMENT=""
QUIET=false
OVERWRITE=false

show_help() {
  cat <<'EOF'
ViewSarn API Key Generator (shell fallback)

Usage:
  ./scripts/generate-apikey.sh [options]

Options:
  -f, --file [PATH]       Append/write key(s) to keys file (default: apikeys.txt)
  -n, --count NUM         Number of keys to generate (default: 1)
  -c, --comment TEXT      Add a descriptive comment above the key in the file
      --overwrite         Overwrite target file instead of appending
  -q, --raw, --quiet      Output raw key(s) only (one per line, ideal for scripts)
  -h, --help              Show this help message
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      show_help
      exit 0
      ;;
    -q|--raw|--quiet)
      QUIET=true
      shift
      ;;
    --overwrite)
      OVERWRITE=true
      shift
      ;;
    -f|--file)
      if [[ $# -gt 1 && ! "$2" =~ ^- ]]; then
        OUTFILE="$2"
        shift 2
      else
        OUTFILE="${API_KEYS_FILE:-apikeys.txt}"
        shift
      fi
      ;;
    --file=*)
      OUTFILE="${1#*=}"
      shift
      ;;
    -f=*)
      OUTFILE="${1#*=}"
      shift
      ;;
    -n|--count)
      COUNT="$2"
      shift 2
      ;;
    --count=*)
      COUNT="${1#*=}"
      shift
      ;;
    -n=*)
      COUNT="${1#*=}"
      shift
      ;;
    -c|--comment)
      COMMENT="$2"
      shift 2
      ;;
    --comment=*)
      COMMENT="${1#*=}"
      shift
      ;;
    -c=*)
      COMMENT="${1#*=}"
      shift
      ;;
    *)
      echo "Error: Unknown option: $1" >&2
      exit 2
      ;;
  esac
done

if ! [[ "$COUNT" =~ ^[1-9][0-9]*$ ]]; then
  echo "Error: count must be a positive integer" >&2
  exit 2
fi

gen_key() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

calc_principal() {
  local k="$1"
  local hex=""
  if command -v openssl >/dev/null 2>&1; then
    hex="$(printf '%s' "$k" | openssl dgst -sha256 | awk '{print $NF}')"
  elif command -v sha256sum >/dev/null 2>&1; then
    hex="$(printf '%s' "$k" | sha256sum | awk '{print $1}')"
  fi
  echo "$hex"
}

KEYS=()
LABELS=()
PRINCIPALS=()

for ((i=0; i<COUNT; i++)); do
  K="$(gen_key)"
  HEX="$(calc_principal "$K")"
  if [ -n "$HEX" ]; then
    L="${HEX:0:12}"
    P="k:${HEX}"
  else
    L="unknown"
    P="unknown"
  fi
  KEYS+=("$K")
  LABELS+=("$L")
  PRINCIPALS+=("$P")
done

if [ -n "$OUTFILE" ]; then
  mkdir -p "$(dirname "$OUTFILE")"
  if [ "$OVERWRITE" = true ] || [ ! -f "$OUTFILE" ]; then
    cat > "$OUTFILE" << 'HEADER'
# ViewSarn API keys file
# One key per line. Lines starting with # are ignored.

HEADER
    chmod 600 "$OUTFILE" 2>/dev/null || true
  fi

  if [ -s "$OUTFILE" ] && [ "$(tail -c 1 "$OUTFILE" 2>/dev/null)" != "" ]; then
    echo "" >> "$OUTFILE"
  fi

  NOW="$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date)"
  for i in "${!KEYS[@]}"; do
    K="${KEYS[$i]}"
    L="${LABELS[$i]}"
    SUFFIX=""
    if [ "$COUNT" -gt 1 ]; then
      SUFFIX=" [$((i + 1))/$COUNT]"
    fi
    if [ -n "$COMMENT" ]; then
      echo "# ${COMMENT}${SUFFIX} (created ${NOW}, label ${L})" >> "$OUTFILE"
    else
      echo "# Generated ${NOW}${SUFFIX} (label ${L})" >> "$OUTFILE"
    fi
    echo "$K" >> "$OUTFILE"
  done
  chmod 600 "$OUTFILE" 2>/dev/null || true
fi

if [ "$QUIET" = true ]; then
  for K in "${KEYS[@]}"; do
    echo "$K"
  done
  exit 0
fi

if [ -n "$OUTFILE" ]; then
  if [ "$OVERWRITE" = true ]; then
    echo "Generated $COUNT API key(s) and overwrote $OUTFILE:"
  else
    echo "Generated $COUNT API key(s) and appended to $OUTFILE:"
  fi
else
  echo "Generated $COUNT API key(s):"
fi
echo ""

for i in "${!KEYS[@]}"; do
  echo "  Key:       ${KEYS[$i]}"
  echo "  Label:     ${LABELS[$i]} (matches server logs and directory names)"
  echo "  Principal: ${PRINCIPALS[$i]}"
  echo ""
done

if [ -n "$OUTFILE" ]; then
  echo "File permissions set to 0600 (owner read/write only)."
else
  echo "Tip: Use -f apikeys.txt to save to keys file, or -q / --raw for scripts."
fi
