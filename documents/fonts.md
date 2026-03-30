# ViewSarn Font Support

ViewSarn is optimized for high-fidelity rendering of Thai and English content. It comes pre-installed with premium, open-source fonts that ensure consistent output across all platforms.

---

## 🎨 Installed Fonts

The following font families are available within the ViewSarn container:

### 1. **Sarabun** (Thai Font)
Default elite Thai font from Google Fonts, standard for official Thai documents.
- **Weights**: Regular, Bold, Italic, BoldItalic
- **Use Case**: Official documents, receipts, invoices, and general Thai content.
- **CSS**: `font-family: 'Sarabun', sans-serif;`

### 2. **Inter** (Modern Sans-Serif)
A high-quality, open-source alternative to Google Sans / Product Sans. 
- **Weights**: Multiple weights (Thin to Black)
- **Use Case**: Modern UI text, English headings, and industrial-grade reports.
- **CSS**: `font-family: 'Inter', sans-serif;`

### 3. **Noto Sans Thai**
Google's universal font for Thai, used as a reliable fallback.
- **Weights**: Regular, Bold
- **Use Case**: Fallback for Thai characters to ensure zero "tofu" (missing characters).
- **CSS**: `font-family: 'Noto Sans Thai', sans-serif;`

---

## 🛠️ Usage in HTML/CSS

For the best results, use the following font-stack recommendations in your HTML `style` section:

### Standard Thai-English Hybrid
Perfect for invoices and reports with mixed language content.
```css
body {
  font-family: 'Sarabun', 'Inter', 'Noto Sans Thai', system-ui, -apple-system, sans-serif;
  font-size: 16px;
  -webkit-font-smoothing: antialiased;
}
```

### Premium English Headings
For a modern, "Google-esque" aesthetic.
```css
h1, h2, .premium-title {
  font-family: 'Inter', 'Helvetica Neue', Arial, sans-serif;
  font-weight: 600;
  letter-spacing: -0.02em;
}
```

### Official Thai Text
```css
.thai-content {
  font-family: 'Sarabun', 'Noto Sans Thai', sans-serif;
  line-height: 1.6;
}
```

---

## 🔍 Verification & Maintenance

### Checking Installed Fonts
To verify that fonts are correctly loaded within your running container:

```bash
# List all fonts recognized by the system
docker exec <container_id> fc-list

# Filter for specific families
docker exec <container_id> fc-list | grep -iE "sarabun|inter|noto"
```

### Updating Fonts
If you need to add custom fonts, follow these steps:
1. Add your font files (`.ttf` or `.otf`) to the `fonts/` directory in the project root.
2. Update the `Dockerfile` to copy these files into `/usr/local/share/fonts/`.
3. Rebuild the image: `docker compose build`.

---

## ⚖️ License Information
All pre-installed fonts are distributed under the **SIL Open Font License (OFL)**, making them safe for commercial use and distribution within the ViewSarn image.
