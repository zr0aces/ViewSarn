// RFC 6266 / RFC 5987: an ASCII fallback for old clients plus the UTF-8 name.
// Node's setHeader throws on any character above U+00FF, so a Thai filename put
// straight into `filename="..."` turned a finished render into a 500.
function contentDisposition(name) {
    const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    const encoded = encodeURIComponent(name)
        .replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
    return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

module.exports = { contentDisposition };
