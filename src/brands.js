/**
 * Marcas atendidas pelo mesmo sistema. Cada uma tem domínio, logo e ícones próprios.
 * Os domínios podem ser trocados por variável de ambiente sem mexer no código.
 */
const clean = (u) => (u || "").replace(/\/+$/, "");

export const BRANDS = {
  miz: {
    id: "miz",
    name: "MIZ",
    publicUrl: clean(process.env.PUBLIC_URL_MIZ || process.env.PUBLIC_URL || "https://catalogo.usemiz.com"),
    // altura da logo (px) na barra escura do catálogo e no painel
    viewerLogoHeight: 30,
    adminLogoHeight: 26,
    loginLogoHeight: 42,
  },
  mark: {
    id: "mark",
    name: "Mark",
    publicUrl: clean(process.env.PUBLIC_URL_MARK || "https://catalogo.marktextil.com.br"),
    viewerLogoHeight: 17,
    adminLogoHeight: 16,
    loginLogoHeight: 24,
  },
};

export const BRAND_IDS = Object.keys(BRANDS);
export const DEFAULT_BRAND = BRANDS[process.env.DEFAULT_BRAND] ? process.env.DEFAULT_BRAND : "miz";

export const assetsOf = (id) => {
  const base = `/assets/brands/${id}`;
  return {
    logo: `${base}/logo.png`, // para fundo claro (painel)
    logoLight: `${base}/logo-light.png`, // para fundo escuro (catálogo)
    favicon: `${base}/favicon-32.png`,
    icon512: `${base}/icon-512.png`,
    appleTouch: `${base}/apple-touch-icon.png`,
  };
};

const hostOf = (url) => {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return "";
  }
};

/** Marca dona do domínio acessado (ou null para localhost / domínio do Easypanel). */
export function brandForHost(host) {
  const h = String(host || "").toLowerCase();
  return BRAND_IDS.find((id) => hostOf(BRANDS[id].publicUrl) === h) || null;
}

const isLocal = (host) => /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(String(host || ""));

/**
 * Endereço base para os links de uma marca. Em teste local usa o próprio
 * endereço acessado, para os links funcionarem no computador.
 */
export function baseUrlFor(brandId, req) {
  if (req && isLocal(req.get("host"))) return `${req.protocol}://${req.get("host")}`;
  return BRANDS[brandId]?.publicUrl || (req ? `${req.protocol}://${req.get("host")}` : "");
}

export function brandHeadIcons(id) {
  const a = assetsOf(id);
  return [
    `<link rel="icon" type="image/png" sizes="32x32" href="${a.favicon}">`,
    `<link rel="icon" type="image/png" sizes="512x512" href="${a.icon512}">`,
    `<link rel="apple-touch-icon" href="${a.appleTouch}">`,
  ].join("\n");
}

export function publicBrandList(ids = BRAND_IDS, req) {
  return ids.map((id) => ({
    id,
    name: BRANDS[id].name,
    url: baseUrlFor(id, req),
    logo: assetsOf(id).logo,
    adminLogoHeight: BRANDS[id].adminLogoHeight,
    loginLogoHeight: BRANDS[id].loginLogoHeight,
    favicon: assetsOf(id).favicon,
  }));
}
