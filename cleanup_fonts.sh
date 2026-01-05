#!/bin/bash

# Cleanup script to remove unused font files
# Keeps only Regular, Bold, Italic, and BoldItalic variants

echo "=== Font Cleanup Script ==="
echo "Removing unused font variants..."
echo ""

# Backup font directory first
BACKUP_DIR="/root/HausPay/apiPdfConvert/fonts_backup_$(date +%Y%m%d_%H%M%S)"
echo "Creating backup at: $BACKUP_DIR"
cp -r /root/HausPay/apiPdfConvert/fonts "$BACKUP_DIR"
echo "✓ Backup created"
echo ""

# Keep only these files in Google_Sans/static
echo "Cleaning Google Sans fonts..."
cd /root/HausPay/apiPdfConvert/fonts/Google_Sans/static/
KEEP_GOOGLE_SANS=(
  "GoogleSans-Regular.ttf"
  "GoogleSans-Bold.ttf"
  "GoogleSans-Italic.ttf"
  "GoogleSans-BoldItalic.ttf"
)

for file in *.ttf; do
  if [[ ! " ${KEEP_GOOGLE_SANS[@]} " =~ " ${file} " ]]; then
    echo "  Removing: $file"
    rm "$file"
  fi
done

# Remove variable fonts
cd /root/HausPay/apiPdfConvert/fonts/Google_Sans/
if [ -f "GoogleSans-Italic-VariableFont_GRAD,opsz,wght.ttf" ]; then
  echo "  Removing variable font: GoogleSans-Italic-VariableFont_GRAD,opsz,wght.ttf"
  rm "GoogleSans-Italic-VariableFont_GRAD,opsz,wght.ttf"
fi
if [ -f "GoogleSans-VariableFont_GRAD,opsz,wght.ttf" ]; then
  echo "  Removing variable font: GoogleSans-VariableFont_GRAD,opsz,wght.ttf"
  rm "GoogleSans-VariableFont_GRAD,opsz,wght.ttf"
fi

echo "✓ Google Sans cleaned"
echo ""

# Keep only these files in Sarabun
echo "Cleaning Sarabun fonts..."
cd /root/HausPay/apiPdfConvert/fonts/Sarabun/
KEEP_SARABUN=(
  "Sarabun-Regular.ttf"
  "Sarabun-Bold.ttf"
  "Sarabun-Italic.ttf"
  "Sarabun-BoldItalic.ttf"
)

for file in *.ttf; do
  if [[ ! " ${KEEP_SARABUN[@]} " =~ " ${file} " ]]; then
    echo "  Removing: $file"
    rm "$file"
  fi
done

echo "✓ Sarabun cleaned"
echo ""

# Keep only Regular and Bold for Noto Sans Thai
echo "Cleaning Noto Sans Thai fonts..."
cd /root/HausPay/apiPdfConvert/fonts/Noto_Sans_Thai/static/
KEEP_NOTO=(
  "NotoSansThai-Regular.ttf"
  "NotoSansThai-Bold.ttf"
)

for file in *.ttf; do
  if [[ ! " ${KEEP_NOTO[@]} " =~ " ${file} " ]]; then
    echo "  Removing: $file"
    rm "$file"
  fi
done

# Remove variable font
cd /root/HausPay/apiPdfConvert/fonts/Noto_Sans_Thai/
if [ -f "NotoSansThai-VariableFont_wdth,wght.ttf" ]; then
  echo "  Removing variable font: NotoSansThai-VariableFont_wdth,wght.ttf"
  rm "NotoSansThai-VariableFont_wdth,wght.ttf"
fi

echo "✓ Noto Sans Thai cleaned"
echo ""

# Summary
echo "=== Cleanup Complete ==="
echo ""
echo "Remaining fonts:"
echo "Google Sans: 4 files (Regular, Bold, Italic, BoldItalic)"
ls -lh /root/HausPay/apiPdfConvert/fonts/Google_Sans/static/*.ttf | wc -l
echo ""
echo "Sarabun: 4 files (Regular, Bold, Italic, BoldItalic)"
ls -lh /root/HausPay/apiPdfConvert/fonts/Sarabun/*.ttf | wc -l
echo ""
echo "Noto Sans Thai: 2 files (Regular, Bold)"
ls -lh /root/HausPay/apiPdfConvert/fonts/Noto_Sans_Thai/static/*.ttf | wc -l
echo ""
echo "Backup location: $BACKUP_DIR"
echo ""
echo "To restore backup if needed:"
echo "  rm -rf /root/HausPay/apiPdfConvert/fonts"
echo "  mv $BACKUP_DIR /root/HausPay/apiPdfConvert/fonts"
