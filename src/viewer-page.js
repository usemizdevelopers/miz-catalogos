import { BRANDS, DEFAULT_BRAND, assetsOf, brandHeadIcons } from "./brands.js";

// muda a cada deploy/reinício para o navegador buscar JS/CSS novos
export const ASSET_V = Date.now().toString(36);

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

// JSON seguro para colocar dentro de <script>
const jsonForScript = (obj) =>
  JSON.stringify(obj).replace(/[<\u2028\u2029]/g, (ch) => "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0"));

export function renderViewer(c, baseUrl) {
  const brand = BRANDS[c.brand] || BRANDS[DEFAULT_BRAND];
  const assets = assetsOf(brand.id);
  const media = `/media/${c.id}/v${c.version}`;
  const manifest = {
    title: c.title,
    brand: brand.name,
    base: media,
    pages: c.pages,
    download: c.allowDownload ? `/c/${encodeURIComponent(c.slug)}/pdf` : null,
  };
  const url = `${baseUrl}/c/${c.slug}`;
  const desc = `${brand.name} · ${c.pages.length} páginas. Toque para folhear.`;
  const first = c.pages[0];

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(c.title)} · ${esc(brand.name)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#141414">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(c.title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(baseUrl + media)}/og.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
${brandHeadIcons(brand.id)}
<link rel="preload" as="image" href="${media}/pages/1.webp" fetchpriority="high">
<link rel="stylesheet" href="/assets/viewer.css?v=${ASSET_V}">
</head>
<body>
<div class="app" id="app">
  <header class="bar">
    <div class="bar-title">
      <img class="brand-logo" src="${assets.logoLight}" alt="${esc(brand.name)}" style="height:${brand.viewerLogoHeight}px">
      <span class="title">${esc(c.title)}</span>
    </div>
    <div class="bar-actions">
      <span class="counter" id="counter" aria-live="polite"></span>
      <button class="icon-btn" id="btnZoomOut" title="Diminuir zoom" aria-label="Diminuir zoom"><svg viewBox="0 0 24 24"><path d="M5 12h14"/></svg></button>
      <button class="icon-btn" id="btnZoomIn" title="Aumentar zoom" aria-label="Aumentar zoom"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button>
      <button class="icon-btn" id="btnGrid" title="Todas as páginas" aria-label="Ver todas as páginas"><svg viewBox="0 0 24 24"><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/></svg></button>
      <button class="icon-btn" id="btnFull" title="Tela cheia" aria-label="Tela cheia"><svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg></button>
      <a class="icon-btn" id="btnDownload" title="Baixar PDF" aria-label="Baixar PDF" hidden><svg viewBox="0 0 24 24"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg></a>
    </div>
  </header>

  <main class="stage" id="stage" style="--first-ratio:${first ? (first.w / first.h).toFixed(4) : 0.7}">
    <div class="spread" id="spread"></div>
    <button class="nav prev" id="prev" aria-label="Página anterior"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>
    <button class="nav next" id="next" aria-label="Próxima página"><svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg></button>
    <div class="hint" id="hint"></div>
  </main>

  <div class="progress"><div class="progress-fill" id="progress"></div></div>

  <section class="grid" id="grid" hidden>
    <div class="grid-head">
      <span>Todas as páginas</span>
      <button class="icon-btn" id="gridClose" aria-label="Fechar"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    </div>
    <div class="grid-list" id="gridList"></div>
  </section>
</div>
<script>window.CATALOG = ${jsonForScript(manifest)};</script>
<script src="/assets/viewer.js?v=${ASSET_V}" defer></script>
</body>
</html>`;
}

export function renderMessage(brandId, title, text, autoRefresh = false) {
  const brand = BRANDS[brandId] || BRANDS[DEFAULT_BRAND];
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · ${esc(brand.name)}</title>
${brandHeadIcons(brand.id)}
${autoRefresh ? '<meta http-equiv="refresh" content="30">' : ""}
<style>
  :root{color-scheme:light dark}
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#141414;color:#eee;font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;padding:24px;box-sizing:border-box}
  .box{max-width:420px;text-align:center}
  .brand{width:auto;display:block;margin:0 auto}
  h1{font-weight:500;font-size:22px;margin:16px 0 8px}
  p{margin:0;opacity:.75}
</style></head>
<body><div class="box"><img class="brand" src="${assetsOf(brand.id).logoLight}" alt="${esc(brand.name)}" style="height:${Math.round(brand.viewerLogoHeight * 1.5)}px"><h1>${esc(title)}</h1><p>${esc(text)}</p></div></body></html>`;
}
