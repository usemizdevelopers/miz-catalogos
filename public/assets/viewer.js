/* Visualizador de catálogo: folhear, zoom (pinça, duplo toque, roda), páginas em alta resolução sob demanda. */
(() => {
  const C = window.CATALOG;
  const pages = C.pages;
  const total = pages.length;
  const $ = (id) => document.getElementById(id);
  const stage = $("stage");
  const spread = $("spread");
  const prevBtn = $("prev");
  const nextBtn = $("next");

  const MAX_ZOOM = 4;
  const hdUrl = (i) => `${C.base}/pages/${i + 1}.webp`;
  const thumbUrl = (i) => `${C.base}/thumbs/${i + 1}.webp`;
  const isTouch = matchMedia("(pointer: coarse)").matches;

  // ---------------- layout: página única ou par de páginas ----------------
  let units = []; // ex.: [[0],[1,2],[3,4]...]
  let twoUp = null;
  let unit = 0;
  let base = { w: 0, h: 0 }; // tamanho do conjunto em zoom 1
  let view = { s: 1, x: 0, y: 0 }; // zoom e posição atuais
  const portrait = pages.every((p) => p.h > p.w);

  function shouldTwoUp() {
    const r = stage.getBoundingClientRect();
    return portrait && total > 2 && r.width >= 700 && r.width > r.height * 0.95;
  }

  function buildUnits() {
    units = [];
    if (!twoUp) {
      for (let i = 0; i < total; i++) units.push([i]);
    } else {
      units.push([0]); // capa sozinha, como numa revista
      for (let i = 1; i < total; i += 2) units.push(i + 1 < total ? [i, i + 1] : [i]);
    }
  }

  const unitOf = (pageIdx) => Math.max(0, units.findIndex((u) => u.includes(pageIdx)));
  const currentPage = () => units[unit][0];

  function fitSize(u) {
    const r = stage.getBoundingClientRect();
    const padX = r.width > 900 ? 96 : r.width > 640 ? 72 : 8;
    const padY = r.width > 640 ? 24 : 8;
    const availW = r.width - padX * 2;
    const availH = r.height - padY * 2;
    const ratio = u.reduce((sum, i) => sum + pages[i].w / pages[i].h, 0);
    let h = availH;
    let w = h * ratio;
    if (w > availW) {
      w = availW;
      h = w / ratio;
    }
    return { w: Math.floor(w), h: Math.floor(h), ratio };
  }

  // ---------------- render ----------------
  function render() {
    const u = units[unit];
    const fit = fitSize(u);
    base = { w: fit.w, h: fit.h };
    spread.style.width = `${fit.w}px`;
    spread.style.height = `${fit.h}px`;
    spread.replaceChildren(
      ...u.map((i) => {
        const p = pages[i];
        const el = document.createElement("div");
        el.className = "page";
        el.style.width = `${Math.round((fit.h * p.w) / p.h)}px`;
        el.style.height = `${fit.h}px`;

        const ph = document.createElement("img");
        ph.className = "ph";
        ph.alt = "";
        ph.src = p.ph;

        const hd = document.createElement("img");
        hd.className = "hd";
        hd.alt = `Página ${i + 1}`;
        hd.decoding = "async";
        hd.fetchPriority = "high";
        hd.onload = () => {
          hd.classList.add("loaded");
          setTimeout(() => ph.remove(), 300);
        };
        hd.src = hdUrl(i);
        el.append(ph, hd);
        return el;
      })
    );
    // reinicia a animação de entrada
    spread.style.animation = "none";
    void spread.offsetWidth;
    spread.style.animation = "";

    resetView();
    updateUi();
    preloadAround();
  }

  function updateUi() {
    const u = units[unit];
    const first = u[0] + 1;
    const last = u[u.length - 1] + 1;
    $("counter").textContent = first === last ? `${first} / ${total}` : `${first}–${last} / ${total}`;
    $("progress").style.width = `${(last / total) * 100}%`;
    prevBtn.disabled = unit === 0;
    nextBtn.disabled = unit === units.length - 1;
    history.replaceState(null, "", `#${first}`);
  }

  // Baixa antes as próximas páginas para a troca ser instantânea.
  const preloaded = new Set();
  function preloadAround() {
    const wanted = [unit + 1, unit + 2, unit - 1].filter((x) => x >= 0 && x < units.length);
    const run = () =>
      wanted.forEach((uIdx) =>
        units[uIdx].forEach((i) => {
          if (preloaded.has(i)) return;
          preloaded.add(i);
          const img = new Image();
          img.decoding = "async";
          img.src = hdUrl(i);
        })
      );
    // espera a página atual carregar primeiro
    const current = spread.querySelector(".hd");
    if (current && !current.complete) current.addEventListener("load", run, { once: true });
    else run();
  }

  function go(toUnit) {
    toUnit = Math.max(0, Math.min(units.length - 1, toUnit));
    if (toUnit === unit) return;
    unit = toUnit;
    render();
  }
  const next = () => go(unit + 1);
  const prev = () => go(unit - 1);
  const goPage = (pageIdx) => go(unitOf(pageIdx));

  // ---------------- zoom e arraste ----------------
  let settleTimer;
  function apply(animate) {
    const r = stage.getBoundingClientRect();
    clamp(r);
    spread.style.transition = animate ? "transform 0.25s ease-out" : "none";
    // Durante o gesto o navegador usa uma camada (rápido); depois redesenha nítido.
    spread.style.willChange = "transform";
    spread.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.s})`;
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => (spread.style.willChange = "auto"), 200);
    stage.classList.toggle("zoomed", view.s > 1.01);
  }

  function clamp(r) {
    const w = base.w * view.s;
    const h = base.h * view.s;
    view.x = w <= r.width ? (r.width - w) / 2 : Math.min(0, Math.max(r.width - w, view.x));
    view.y = h <= r.height ? (r.height - h) / 2 : Math.min(0, Math.max(r.height - h, view.y));
  }

  function resetView(animate) {
    view = { s: 1, x: 0, y: 0 };
    apply(animate);
  }

  /** Zoom mantendo fixo o ponto (px, py) da tela. */
  function zoomAt(newScale, px, py, animate) {
    newScale = Math.max(1, Math.min(MAX_ZOOM, newScale));
    const k = newScale / view.s;
    view.x = px - (px - view.x) * k;
    view.y = py - (py - view.y) * k;
    view.s = newScale;
    apply(animate);
  }

  function zoomCenter(factor) {
    const r = stage.getBoundingClientRect();
    zoomAt(view.s * factor, r.width / 2, r.height / 2, true);
  }

  // ---------------- gestos (mouse e toque) ----------------
  const pointers = new Map();
  let gesture = null;
  let lastTap = null;

  const local = (e) => {
    const r = stage.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

  function startGesture() {
    const pts = [...pointers.values()];
    if (pts.length === 1) {
      gesture = { type: "pan", start: pts[0], vx: view.x, vy: view.y, t: performance.now(), moved: 0 };
    } else if (pts.length >= 2) {
      gesture = { type: "pinch", d: dist(pts[0], pts[1]), m: mid(pts[0], pts[1]), s: view.s, vx: view.x, vy: view.y, moved: 99 };
    }
  }

  stage.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button")) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    stage.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, local(e));
    startGesture();
  });

  stage.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId) || !gesture) return;
    pointers.set(e.pointerId, local(e));
    const pts = [...pointers.values()];

    if (gesture.type === "pinch" && pts.length >= 2) {
      const m = mid(pts[0], pts[1]);
      const s = Math.max(1, Math.min(MAX_ZOOM, gesture.s * (dist(pts[0], pts[1]) / gesture.d)));
      // o ponto do conteúdo que estava sob os dedos acompanha os dedos
      const cx = (gesture.m.x - gesture.vx) / gesture.s;
      const cy = (gesture.m.y - gesture.vy) / gesture.s;
      view = { s, x: m.x - cx * s, y: m.y - cy * s };
      apply(false);
    } else if (gesture.type === "pan") {
      const p = pts[0];
      const dx = p.x - gesture.start.x;
      const dy = p.y - gesture.start.y;
      gesture.moved = Math.max(gesture.moved, Math.hypot(dx, dy));
      gesture.dx = dx;
      gesture.dy = dy;
      if (view.s > 1.01) {
        stage.classList.add("dragging");
        view.x = gesture.vx + dx;
        view.y = gesture.vy + dy;
        apply(false);
      } else if (Math.abs(dx) > Math.abs(dy)) {
        // pequeno "arrasto" visual ao deslizar para trocar de página
        spread.style.transition = "none";
        spread.style.transform = `translate(${view.x + dx * 0.35}px, ${view.y}px)`;
      }
    }
  });

  function endPointer(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    stage.classList.remove("dragging");
    const g = gesture;

    if (pointers.size > 0) {
      startGesture(); // de 2 dedos para 1: continua arrastando sem pular
      return;
    }
    gesture = null;
    if (!g) return;

    if (g.type === "pinch") {
      if (view.s < 1.05) resetView(true);
      return;
    }

    const quick = performance.now() - g.t < 300;
    if (g.moved < 10 && quick && e.type === "pointerup") {
      // toque/clique: verifica duplo toque
      const p = local(e);
      const now = performance.now();
      if (lastTap && now - lastTap.t < 320 && dist(p, lastTap) < 30) {
        lastTap = null;
        if (view.s > 1.01) resetView(true);
        else zoomAt(2.5, p.x, p.y, true);
      } else {
        lastTap = { ...p, t: now };
      }
      return;
    }

    if (view.s <= 1.01) {
      const dx = g.dx || 0;
      const dy = g.dy || 0;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.2) {
        if (dx < 0 && unit < units.length - 1) return next();
        if (dx > 0 && unit > 0) return prev();
      }
      resetView(true); // volta o arrasto visual
    }
  }
  stage.addEventListener("pointerup", endPointer);
  stage.addEventListener("pointercancel", endPointer);

  // roda do mouse / trackpad
  let wheelAcc = 0;
  let wheelLock = 0;
  stage.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const p = local(e);
      if (e.ctrlKey || e.metaKey) {
        // pinça no trackpad (ou Ctrl + roda)
        zoomAt(view.s * Math.exp(-e.deltaY * 0.01), p.x, p.y, false);
        return;
      }
      if (view.s > 1.01) {
        view.x -= e.deltaX;
        view.y -= e.deltaY;
        apply(false);
        return;
      }
      const now = performance.now();
      if (now < wheelLock) return;
      wheelAcc += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (Math.abs(wheelAcc) > 80) {
        wheelAcc > 0 ? next() : prev();
        wheelAcc = 0;
        wheelLock = now + 450;
      }
    },
    { passive: false }
  );

  // ---------------- teclado ----------------
  document.addEventListener("keydown", (e) => {
    if (!$("grid").hidden) {
      if (e.key === "Escape") closeGrid();
      return;
    }
    switch (e.key) {
      case "ArrowRight":
      case "PageDown":
      case " ":
        e.preventDefault();
        next();
        break;
      case "ArrowLeft":
      case "PageUp":
        e.preventDefault();
        prev();
        break;
      case "Home":
        go(0);
        break;
      case "End":
        go(units.length - 1);
        break;
      case "+":
      case "=":
        zoomCenter(1.5);
        break;
      case "-":
        zoomCenter(1 / 1.5);
        break;
      case "0":
      case "Escape":
        resetView(true);
        break;
    }
  });

  // ---------------- botões ----------------
  prevBtn.addEventListener("click", prev);
  nextBtn.addEventListener("click", next);
  $("btnZoomIn").addEventListener("click", () => zoomCenter(1.6));
  $("btnZoomOut").addEventListener("click", () => zoomCenter(1 / 1.6));

  const fsEl = document.documentElement;
  const canFs = !!(fsEl.requestFullscreen || fsEl.webkitRequestFullscreen);
  const btnFull = $("btnFull");
  if (!canFs) btnFull.hidden = true;
  btnFull.addEventListener("click", () => {
    const inFs = document.fullscreenElement || document.webkitFullscreenElement;
    if (inFs) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    else (fsEl.requestFullscreen || fsEl.webkitRequestFullscreen).call(fsEl);
  });

  if (C.download) {
    const a = $("btnDownload");
    a.href = C.download;
    a.setAttribute("download", "");
    a.hidden = false;
  }

  // ---------------- grade de miniaturas ----------------
  let gridBuilt = false;
  function openGrid() {
    const list = $("gridList");
    if (!gridBuilt) {
      gridBuilt = true;
      list.append(
        ...pages.map((p, i) => {
          const b = document.createElement("button");
          b.className = "thumb";
          b.dataset.i = i;
          const img = document.createElement("img");
          img.loading = "lazy";
          img.decoding = "async";
          img.alt = "";
          img.style.aspectRatio = `${p.w} / ${p.h}`;
          img.src = thumbUrl(i);
          const s = document.createElement("span");
          s.textContent = i + 1;
          b.append(img, s);
          b.addEventListener("click", () => {
            closeGrid();
            goPage(i);
          });
          return b;
        })
      );
    }
    const cur = units[unit];
    list.querySelectorAll(".thumb").forEach((b) => b.classList.toggle("current", cur.includes(Number(b.dataset.i))));
    $("grid").hidden = false;
    list.querySelector(".thumb.current")?.scrollIntoView({ block: "center" });
  }
  function closeGrid() {
    $("grid").hidden = true;
  }
  $("btnGrid").addEventListener("click", openGrid);
  $("gridClose").addEventListener("click", closeGrid);

  // ---------------- dica inicial ----------------
  function showHint() {
    let seen = false;
    try {
      seen = localStorage.getItem("miz-hint") === "1";
      localStorage.setItem("miz-hint", "1");
    } catch {}
    if (seen) return;
    const h = $("hint");
    h.textContent = isTouch ? "Deslize para folhear · toque 2× para ampliar" : "Use ← → para folhear · clique 2× para ampliar";
    h.classList.add("show");
    setTimeout(() => h.classList.remove("show"), 3500);
  }

  // ---------------- início e redimensionamento ----------------
  function layout() {
    const keep = units.length ? currentPage() : startPage();
    twoUp = shouldTwoUp();
    buildUnits();
    unit = unitOf(keep);
    render();
  }

  function startPage() {
    const n = parseInt(location.hash.slice(1), 10);
    return Number.isFinite(n) ? Math.max(0, Math.min(total - 1, n - 1)) : 0;
  }

  let resizeRaf;
  window.addEventListener("resize", () => {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
      if (shouldTwoUp() !== twoUp) layout();
      else {
        // só ajusta tamanhos, sem recarregar imagens
        const fit = fitSize(units[unit]);
        base = { w: fit.w, h: fit.h };
        spread.style.width = `${fit.w}px`;
        spread.style.height = `${fit.h}px`;
        [...spread.children].forEach((el, k) => {
          const p = pages[units[unit][k]];
          el.style.width = `${Math.round((fit.h * p.w) / p.h)}px`;
          el.style.height = `${fit.h}px`;
        });
        resetView();
      }
    });
  });

  window.addEventListener("hashchange", () => {
    const n = startPage();
    if (!units[unit].includes(n)) goPage(n);
  });

  layout();
  showHint();
})();
