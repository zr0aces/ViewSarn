# Font Installation - apiPdfConvert

## Installed Fonts

The PDF conversion service includes the following fonts for high-quality document rendering:

### 1. **Sarabun** (Thai Font from Google Fonts)

- **Variants**: Regular, Bold, Italic, BoldItalic
- **Use Case**: Thai language content, receipts,  invoices
- **Source**: [Google Fonts - Sarabun](https://github.com/google/fonts/tree/main/ofl/sarabun)
- **License**: Open Font License (OFL)

### 2. **Inter** (Modern Sans-Serif - Google Sans Alternative)

- **Variants**: Multiple weights (Thin to Black)
- **Use Case**: English content, modern UI text, headings
- **Source**: [Inter Font Family](https://github.com/rsms/inter)
- **License**: SIL Open Font License
- **Note**: Inter is used as an open-source alternative to Google Sans (which is proprietary)

### 3. **Noto Sans Thai**

- **Variants**: Regular, Bold
- **Use Case**: Fallback for Thai characters, cross-platform consistency
- **Source**: [Noto Fonts](https://github.com/notofonts/noto-fonts)
- **License**: SIL Open Font License

## Font Usage in HTML/CSS

### Using Sarabun for Thai Content

```css
body {
  font-family: 'Sarabun', 'Noto Sans Thai', sans-serif;
}
```

### Using Inter (Google Sans Alternative)

```css
.header, .title {
  font-family: 'Inter', 'Google Sans', sans-serif;
}
```

### Font Stack Recommendation

```css
/* For Thai-English Mixed Content */
.receipt {
  font-family: 'Sarabun', 'Inter', 'Noto Sans Thai', system-ui, -apple-system, sans-serif;
}

/* For English Headings */
.heading {
  font-family: 'Inter', 'Google Sans', 'Helvetica Neue', Arial, sans-serif;
  font-weight: 600;
}

/* For Thai Text */
.thai-text {
  font-family: 'Sarabun', 'Noto Sans Thai', sans-serif;
}
```

## Rebuilding the Container

After updating the Dockerfile, rebuild the container:

```bash
docker-compose build apipdfconvert
# or
docker build -t hauspay-apipdfconvert ./apiPdfConvert
```

## Verifying Font Installation

To verify fonts are installed correctly in the container:

```bash
# List all installed fonts
docker exec hauspay-apipdfconvert-1 fc-list

# Check for specific fonts
docker exec hauspay-apipdfconvert-1 fc-list | grep -i "sarabun"
docker exec hauspay-apipdfconvert-1 fc-list | grep -i "inter"
docker exec hauspay-apipdfconvert-1 fc-list | grep -i "noto"
```

## Note on Google Sans

**Google Sans is a proprietary font** owned by Google and is not freely distributable. This Dockerfile uses **Inter** as an open-source alternative that provides a similar modern, clean aesthetic.

If you have a license to use the actual Google Sans / Product Sans font:

1. Place the font files in a secure location
2. Uncomment the alternative download section in the Dockerfile
3. Update the URL to point to your font source
4. Rebuild the container

## Font File Locations in Container

- Sarabun: `/usr/local/share/fonts/truetype/sarabun/`
- Inter (Google Sans alt): `/usr/local/share/fonts/truetype/google-sans/`
- Noto Sans Thai: `/usr/local/share/fonts/truetype/noto/`
