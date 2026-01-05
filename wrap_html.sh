#!/bin/bash
HTML=$(cat "$1")

cat <<EOF
{
  "html": "$HTML",
  "options": {
    "format": "A5",
    "orientation": "landscape",
    "scale": "1"
  }
}
EOF

