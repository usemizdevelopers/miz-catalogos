import crypto from "node:crypto";
import { paths } from "./config.js";
import { JsonStore } from "./store.js";
import { BRANDS } from "./brands.js";

let store;

export function initFolders() {
  store = new JsonStore(paths.folders, []);
}

const err = (message, status = 400) => Object.assign(new Error(message), { status });

export const list = () => store.data;
export const get = (id) => store.data.find((f) => f.id === id);

function cleanName(name) {
  const n = String(name || "").trim().replace(/\s+/g, " ").slice(0, 80);
  if (!n) throw err("Dê um nome para a pasta.");
  return n;
}

/** Pasta + todas as subpastas (ids). */
export function descendantIds(id) {
  const out = [id];
  for (let i = 0; i < out.length; i++) {
    for (const f of store.data) if (f.parentId === out[i]) out.push(f.id);
  }
  return out;
}

/** Garante que parentId é null ou uma pasta da mesma marca. */
export function assertParent(parentId, brand) {
  if (parentId == null) return null;
  const p = get(parentId);
  if (!p || p.brand !== brand) throw err("Pasta de destino não encontrada.", 404);
  return p.id;
}

export function create({ brand, parentId, name, user }) {
  if (!BRANDS[brand]) throw err("Marca inválida.");
  const now = new Date().toISOString();
  const f = {
    id: crypto.randomBytes(6).toString("base64url"),
    brand,
    parentId: assertParent(parentId ?? null, brand),
    name: cleanName(name),
    createdAt: now,
    updatedAt: now,
    createdBy: user,
  };
  store.data.push(f);
  store.save();
  return f;
}

export function update(id, patch) {
  const f = get(id);
  if (!f) throw err("Pasta não encontrada.", 404);
  if (patch.name !== undefined) f.name = cleanName(patch.name);
  if (patch.parentId !== undefined) {
    const target = assertParent(patch.parentId, f.brand);
    if (target && descendantIds(id).includes(target)) {
      throw err("Não dá para mover uma pasta para dentro dela mesma.");
    }
    f.parentId = target;
  }
  f.updatedAt = new Date().toISOString();
  store.save();
  return f;
}

/** Remove a pasta e subpastas; devolve os ids removidos. */
export function removeTree(id) {
  if (!get(id)) throw err("Pasta não encontrada.", 404);
  const ids = descendantIds(id);
  store.data = store.data.filter((f) => !ids.includes(f.id));
  store.save();
  return ids;
}
