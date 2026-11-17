/* =========================================================
   Sondage : L'IA et nous — script.js
   ---------------------------------------------------------
   👉 PEGA AQUÍ la URL de tu Web App de Google Apps Script
      (termina en /exec). Si la dejas vacía, todo se guarda
      solo en localStorage y se reenvía cuando la configures.
   ========================================================= */
const SHEET_ENDPOINT = "";

/* Contraseña de resultats.html (no es seguridad real) */
const RESULTS_PASSWORD = "lia2026";

/* ========================================================= */

(function () {
  "use strict";

  /* ---------------- Almacenamiento compartido ---------------- */
  const KEYS = {
    responses: "sondageIA.responses", // todas las respuestas de este dispositivo
    queue: "sondageIA.queue",         // pendientes de enviar a Google Sheets
    done: "sondageIA.done",           // última respuesta enviada (evita duplicados)
  };

  const Store = {
    read(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch (e) { return fallback; }
    },
    write(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
    },
    remove(key) { try { localStorage.removeItem(key); } catch (e) { /* nada */ } },
    all() { return Store.read(KEYS.responses, []); },
    queue() { return Store.read(KEYS.queue, []); },
    done() { return Store.read(KEYS.done, null); },
    clearDone() { Store.remove(KEYS.done); },
    save(record) {
      const all = Store.all();
      if (!all.some((r) => r.id === record.id)) all.push(record);
      Store.write(KEYS.responses, all);
      const q = Store.queue();
      if (!q.some((r) => r.id === record.id)) q.push(record);
      Store.write(KEYS.queue, q);
      Store.write(KEYS.done, record);
    },
    unqueue(id) { Store.write(KEYS.queue, Store.queue().filter((r) => r.id !== id)); },
  };

  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  /* Envío a Google Sheets. Con mode:"no-cors" la respuesta es opaca:
     si fetch no lanza error, la petición salió → la consideramos enviada.
     El Apps Script ignora IDs repetidos, así que reintentar es seguro. */
  function sendRecord(record) {
    if (!SHEET_ENDPOINT) return Promise.resolve(false);
    return fetch(SHEET_ENDPOINT, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(record),
      keepalive: true,
    }).then(() => true, () => false);
  }

  let flushing = false;
  async function flushQueue() {
    if (!SHEET_ENDPOINT || flushing) return;
    flushing = true;
    for (const record of Store.queue()) {
      if (await sendRecord(record)) Store.unqueue(record.id);
    }
    flushing = false;
  }

  const QUESTIONS = [
    { key: "q1", short: "Fréquence", options: ["Jamais", "Une fois par semaine", "Plusieurs fois par semaine", "Tous les jours"] },
    { key: "q2", short: "Outils utilisés", options: ["ChatGPT", "Gemini", "Claude", "Copilot", "Meta AI", "Autre"] },
    { key: "q3", short: "Usage principal", options: ["Faire mes devoirs", "Traduire des textes", "Chercher des informations", "Créer des images ou des vidéos", "Discuter quand je m'ennuie"] },
    { key: "q4", short: "L'IA m'aide à apprendre", options: [1, 2, 3, 4, 5] },
    { key: "q5", short: "Le plus grand danger", options: [] },
  ];

  window.Sondage = { SHEET_ENDPOINT, RESULTS_PASSWORD, Store, QUESTIONS, sendRecord, flushQueue };

  // Reintento de envíos pendientes en cada carga y al recuperar conexión
  flushQueue();
  window.addEventListener("online", flushQueue);

  /* Solo arranca la encuesta si estamos en index.html */
  const surveyEl = document.getElementById("survey");
  if (!surveyEl) return;

  if (typeof gsap === "undefined") {
    document.body.classList.remove("is-loading");
    console.warn("GSAP n'a pas pu être chargé.");
  }
  startSurvey();

  /* ========================================================
     ENCUESTA
     ======================================================== */
  function startSurvey() {
    if (typeof gsap === "undefined") return;

    const plugins = [window.SplitText, window.CustomEase, window.MorphSVGPlugin, window.DrawSVGPlugin].filter(Boolean);
    gsap.registerPlugin(...plugins);
    const HAS_MORPH = !!window.MorphSVGPlugin;
    const HAS_DRAW = !!window.DrawSVGPlugin;
    const HAS_SPLIT = !!window.SplitText;

    if (window.CustomEase) {
      CustomEase.create("cine", "0.77,0,0.175,1");
      CustomEase.create("silk", "0.16,1,0.3,1");
    }
    const CINE = window.CustomEase ? "cine" : "expo.inOut";
    const SILK = window.CustomEase ? "silk" : "expo.out";

    const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const FINE = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

    const $ = (s, el = document) => el.querySelector(s);
    const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));

    const screens = ["welcome", "q1", "q2", "q3", "q4", "q5", "final"].map((n) => $(`[data-screen="${n}"]`));
    const topbar = $(".topbar");
    const nav = $(".nav");
    const nextBtn = $("#nextBtn");
    const backBtn = $("#backBtn");
    const nextLabel = $(".btn__label", nextBtn);
    const toastEl = $("#toast");

    const state = {
      index: 0,
      busy: false,
      submitting: false,
      prenom: "",
      answers: { q1: null, q2: [], q3: null, q4: null, q5: "" },
    };

    const rand = (min, max) => min + Math.random() * (max - min);
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const lerp = (a, b, t) => a + (b - a) * t;

    /* ---------------- Cursor personalizado ---------------- */
    const cursorRing = $(".cursor__ring");
    const cursorDot = $(".cursor__dot");
    if (FINE) {
      document.body.classList.add("has-cursor");
      const dotX = gsap.quickTo(cursorDot, "x", { duration: 0.08, ease: "power3" });
      const dotY = gsap.quickTo(cursorDot, "y", { duration: 0.08, ease: "power3" });
      const ringX = gsap.quickTo(cursorRing, "x", { duration: REDUCED ? 0.1 : 0.5, ease: "power3" });
      const ringY = gsap.quickTo(cursorRing, "y", { duration: REDUCED ? 0.1 : 0.5, ease: "power3" });
      gsap.set([cursorDot, cursorRing], { x: innerWidth / 2, y: innerHeight / 2, opacity: 0 });
      let shown = false;
      window.addEventListener("pointermove", (e) => {
        if (e.pointerType === "touch") return;
        if (!shown) { shown = true; gsap.to([cursorDot, cursorRing], { opacity: 1, duration: 0.3 }); }
        dotX(e.clientX); dotY(e.clientY); ringX(e.clientX); ringY(e.clientY);
      }, { passive: true });
      const hoverSel = "button, input, textarea, [role='slider'], .slider__track, label";
      document.addEventListener("pointerover", (e) => {
        if (e.target.closest(hoverSel)) gsap.to(cursorRing, { scale: 1.7, borderColor: "rgba(226,196,131,.9)", duration: 0.35, ease: "power3" });
      });
      document.addEventListener("pointerout", (e) => {
        if (e.target.closest(hoverSel) && !(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest(hoverSel)))
          gsap.to(cursorRing, { scale: 1, borderColor: "#c9a45c", duration: 0.35, ease: "power3" });
      });
      document.addEventListener("pointerdown", (e) => { if (e.pointerType !== "touch") gsap.to(cursorRing, { scale: "-=0.4", duration: 0.15 }); });
      document.addEventListener("pointerup", (e) => { if (e.pointerType !== "touch") gsap.to(cursorRing, { scale: "+=0.4", duration: 0.3, ease: "back.out(3)" }); });
      document.documentElement.addEventListener("mouseleave", () => gsap.to([cursorDot, cursorRing], { opacity: 0, duration: 0.2 }));
      document.documentElement.addEventListener("mouseenter", () => gsap.to([cursorDot, cursorRing], { opacity: 1, duration: 0.2 }));
      // Si alguien toca la pantalla (laptop táctil), ocultamos el cursor
      window.addEventListener("touchstart", () => document.body.classList.remove("has-cursor"), { once: true, passive: true });
    }

    /* ---------------- Fondo vivo: blobs ---------------- */
    const blobs = $$(".blob");
    const blobLayer = $(".bg__blobs");
    if (!REDUCED) {
      blobs.forEach((b, i) => {
        const drift = () => gsap.to(b, {
          xPercent: rand(-18, 18), yPercent: rand(-18, 18), scale: rand(0.85, 1.2),
          duration: rand(9, 15), ease: "sine.inOut", onComplete: drift,
        });
        gsap.delayedCall(i * 0.6, drift);
      });
      const layerX = gsap.quickTo(blobLayer, "x", { duration: 2.2, ease: "power2.out" });
      const layerY = gsap.quickTo(blobLayer, "y", { duration: 2.2, ease: "power2.out" });
      window.addEventListener("pointermove", (e) => {
        layerX((e.clientX / innerWidth - 0.5) * -70);
        layerY((e.clientY / innerHeight - 0.5) * -70);
      }, { passive: true });
      window.addEventListener("deviceorientation", (e) => {
        if (e.gamma == null) return;
        layerX(gsap.utils.clamp(-60, 60, e.gamma * 1.4));
        layerY(gsap.utils.clamp(-60, 60, (e.beta - 45) * 1.2));
      }, { passive: true });
    }
    function askGyroPermission() {
      // iOS pide permiso para el giroscopio; Android no.
      const D = window.DeviceOrientationEvent;
      if (!REDUCED && D && typeof D.requestPermission === "function") D.requestPermission().catch(() => {});
    }

    /* ---------------- Partículas doradas ---------------- */
    const particles = (() => {
      const canvas = $("#particles");
      const ctx = canvas.getContext("2d");
      const sprite = document.createElement("canvas");
      sprite.width = sprite.height = 64;
      const sctx = sprite.getContext("2d");
      const grd = sctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      grd.addColorStop(0, "rgba(255,236,190,1)");
      grd.addColorStop(0.25, "rgba(226,196,131,.75)");
      grd.addColorStop(1, "rgba(201,164,92,0)");
      sctx.fillStyle = grd;
      sctx.fillRect(0, 0, 64, 64);

      let W = 0, H = 0, list = [];
      const mouse = { x: -999, y: -999 };
      function resize() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        W = innerWidth; H = innerHeight;
        canvas.width = W * dpr; canvas.height = H * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const n = Math.round(gsap.utils.clamp(22, 70, (W * H) / 15000));
        list = Array.from({ length: n }, () => ({
          x: Math.random() * W, y: Math.random() * H,
          s: rand(4, 16), vy: rand(0.12, 0.45), ph: rand(0, Math.PI * 2),
          sp: rand(0.006, 0.02), a: rand(0.25, 0.85),
        }));
        if (REDUCED) draw(0);
      }
      function draw(dr) {
        ctx.clearRect(0, 0, W, H);
        for (const p of list) {
          if (dr) {
            p.ph += p.sp * dr;
            p.y -= p.vy * dr;
            p.x += Math.sin(p.ph) * 0.3 * dr;
            const dx = p.x - mouse.x, dy = p.y - mouse.y, d2 = dx * dx + dy * dy;
            if (d2 < 10000) { const f = (1 - d2 / 10000) * 1.6 * dr; p.x += (dx / 100) * f; p.y += (dy / 100) * f; }
            if (p.y < -20) { p.y = H + 20; p.x = Math.random() * W; }
          }
          ctx.globalAlpha = p.a * (0.55 + 0.45 * Math.sin(p.ph * 2));
          ctx.drawImage(sprite, p.x - p.s / 2, p.y - p.s / 2, p.s, p.s);
        }
        ctx.globalAlpha = 1;
      }
      resize();
      let rt;
      window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(resize, 200); });
      window.addEventListener("pointermove", (e) => { mouse.x = e.clientX; mouse.y = e.clientY; }, { passive: true });
      if (!REDUCED) gsap.ticker.add(() => draw(gsap.ticker.deltaRatio(60)));
      return { resize };
    })();

    /* ---------------- Confeti ---------------- */
    const confetti = (() => {
      const canvas = $("#confetti");
      const ctx = canvas.getContext("2d");
      const colors = ["#c9a45c", "#e2c483", "#b5653f", "#f3e9dc", "#8a4a2c", "#d9b46a"];
      let pieces = [], W = 0, H = 0, running = false;
      function size() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        W = innerWidth; H = innerHeight;
        canvas.width = W * dpr; canvas.height = H * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      function burst(x, y, count, angle, spread, power) {
        for (let i = 0; i < count; i++) {
          const a = angle + rand(-spread, spread);
          const v = rand(power * 0.55, power);
          pieces.push({
            x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
            w: rand(6, 11), h: rand(8, 15), r: rand(0, Math.PI * 2), vr: rand(-0.25, 0.25),
            t: rand(0, Math.PI * 2), vt: rand(0.08, 0.2),
            c: pick(colors), round: Math.random() < 0.3,
          });
        }
      }
      function tick() {
        const dr = gsap.ticker.deltaRatio(60);
        ctx.clearRect(0, 0, W, H);
        for (const p of pieces) {
          p.vx *= Math.pow(0.985, dr); p.vy = p.vy * Math.pow(0.985, dr) + 0.32 * dr;
          p.x += p.vx * dr; p.y += p.vy * dr; p.r += p.vr * dr; p.t += p.vt * dr;
          ctx.save();
          ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.scale(1, Math.cos(p.t));
          ctx.fillStyle = p.c;
          if (p.round) { ctx.beginPath(); ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2); ctx.fill(); }
          else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
          ctx.restore();
        }
        pieces = pieces.filter((p) => p.y < H + 40);
        if (!pieces.length) { gsap.ticker.remove(tick); running = false; ctx.clearRect(0, 0, W, H); }
      }
      function fire() {
        if (REDUCED) return;
        size();
        const n = W < 600 ? 1 : 1.6;
        burst(0, H * 0.85, 70 * n, -Math.PI / 3.2, 0.35, 24);
        burst(W, H * 0.85, 70 * n, -Math.PI + Math.PI / 3.2, 0.35, 24);
        gsap.delayedCall(0.25, () => burst(W / 2, H * 0.3, 60 * n, -Math.PI / 2, Math.PI, 14));
        if (!running) { running = true; gsap.ticker.add(tick); }
      }
      return { fire };
    })();

    /* ---------------- Toast de feedback ---------------- */
    let toastTl;
    function toast(text) {
      if (!text) return;
      if (toastTl) toastTl.kill();
      $(".toast__text", toastEl).textContent = text;
      toastTl = gsap.timeline()
        .fromTo(toastEl, { autoAlpha: 0, y: 24, scale: 0.8 }, { autoAlpha: 1, y: 0, scale: 1, duration: REDUCED ? 0.2 : 0.55, ease: "back.out(2.2)" })
        .fromTo($(".toast__spark", toastEl), { rotation: -180, scale: 0 }, { rotation: 0, scale: 1, duration: 0.6, ease: "back.out(3)" }, 0.05)
        .to(toastEl, { autoAlpha: 0, y: -14, duration: 0.35, ease: "power2.in" }, "+=1.5");
    }

    const FEEDBACK = {
      q1: {
        "Jamais": ["Pas encore… mais ça viendra peut-être !", "Intéressant…"],
        "Une fois par semaine": ["Avec modération, c'est sage !", "Bon équilibre !"],
        "Plusieurs fois par semaine": ["Un vrai habitué !", "Ah, comme moi !"],
        "Tous les jours": ["Wow, tous les jours ! 🤖", "Accro à l'IA ?"],
      },
      q2: ["Excellent choix !", "Bonne sélection !", "Intéressant…", "Pas mal !"],
      q3: {
        "Faire mes devoirs": ["Chut… on ne dira rien au prof 🤫"],
        "Traduire des textes": ["Très pratique pour le français !"],
        "Chercher des informations": ["Curieux, j'aime ça !"],
        "Créer des images ou des vidéos": ["Quel artiste ! 🎨"],
        "Discuter quand je m'ennuie": ["L'IA, ta nouvelle amie ? 😄"],
      },
      q4: ["Pas convaincu, hein ?", "Un petit peu, alors.", "Pile au milieu !", "Ça aide bien !", "Énormément ! Super !"],
      q5: ["C'est vrai…", "Bonne réflexion.", "Je suis d'accord."],
    };

    /* ---------------- Botón magnético ---------------- */
    function magnetize(btn) {
      if (!FINE || REDUCED) return;
      const wrap = btn.parentElement;
      const label = $(".btn__label", btn);
      const xTo = gsap.quickTo(btn, "x", { duration: 0.5, ease: "power3" });
      const yTo = gsap.quickTo(btn, "y", { duration: 0.5, ease: "power3" });
      const lxTo = gsap.quickTo(label, "x", { duration: 0.5, ease: "power3" });
      const lyTo = gsap.quickTo(label, "y", { duration: 0.5, ease: "power3" });
      wrap.addEventListener("pointermove", (e) => {
        if (e.pointerType === "touch") return;
        const r = wrap.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        xTo(dx * 0.35); yTo(dy * 0.45); lxTo(dx * 0.12); lyTo(dy * 0.12);
      });
      wrap.addEventListener("pointerleave", () => {
        gsap.to([btn, label], { x: 0, y: 0, duration: 0.9, ease: "elastic.out(1, 0.35)", overwrite: true });
      });
    }
    $$(".btn--magnet").forEach(magnetize);

    /* ---------------- Opciones (cartas, chips, iconos, sugerencias) ---------------- */
    const SVGNS = "http://www.w3.org/2000/svg";
    const allOpts = $$(".opt");

    allOpts.forEach((opt) => {
      // Borde SVG que se "dibuja" al seleccionar
      const svg = document.createElementNS(SVGNS, "svg");
      svg.setAttribute("class", "opt__border");
      svg.setAttribute("aria-hidden", "true");
      const rect = document.createElementNS(SVGNS, "rect");
      svg.appendChild(rect);
      opt.prepend(svg);
      opt._rect = rect;
      sizeBorder(opt);

      opt.addEventListener("pointerdown", (e) => ripple(opt, e));
    });

    function sizeBorder(opt) {
      const w = opt.offsetWidth, h = opt.offsetHeight;
      if (!w || !h) return;
      const radius = Math.min(parseFloat(getComputedStyle(opt).borderTopLeftRadius) || 0, h / 2);
      const r = opt._rect;
      r.setAttribute("x", 1); r.setAttribute("y", 1);
      r.setAttribute("width", Math.max(0, w - 2)); r.setAttribute("height", Math.max(0, h - 2));
      r.setAttribute("rx", Math.max(0, radius - 1));
      if (HAS_DRAW) gsap.set(r, { drawSVG: opt.classList.contains("is-selected") ? "0% 100%" : "50% 50%" });
      else r.style.opacity = opt.classList.contains("is-selected") ? 1 : 0;
    }
    if ("ResizeObserver" in window) {
      const ro = new ResizeObserver((entries) => entries.forEach((en) => sizeBorder(en.target)));
      allOpts.forEach((o) => ro.observe(o));
    }

    function ripple(el, e) {
      if (REDUCED) return;
      const r = el.getBoundingClientRect();
      const x = (e && e.clientX != null && e.clientX !== 0) ? e.clientX - r.left : r.width / 2;
      const y = (e && e.clientY != null && e.clientY !== 0) ? e.clientY - r.top : r.height / 2;
      const span = document.createElement("span");
      span.className = "ripple";
      span.style.left = x + "px";
      span.style.top = y + "px";
      el.appendChild(span);
      const size = Math.hypot(Math.max(x, r.width - x), Math.max(y, r.height - y)) / 10 * 2.2;
      gsap.fromTo(span, { scale: 0, opacity: 1 }, { scale: size, opacity: 0, duration: 0.85, ease: "power2.out", onComplete: () => span.remove() });
    }

    function drawBorder(opt, on) {
      const r = opt._rect;
      if (!HAS_DRAW) { r.style.opacity = on ? 1 : 0; return; }
      if (REDUCED) { gsap.set(r, { drawSVG: on ? "0% 100%" : "50% 50%" }); return; }
      if (on) gsap.fromTo(r, { drawSVG: "50% 50%" }, { drawSVG: "0% 100%", duration: 0.8, ease: "power3.out", overwrite: true });
      else gsap.to(r, { drawSVG: "50% 50%", duration: 0.35, ease: "power2.in", overwrite: true });
    }

    function markSelected(opt, on, animate = true) {
      opt.classList.toggle("is-selected", on);
      if (opt.hasAttribute("aria-checked")) opt.setAttribute("aria-checked", on ? "true" : "false");
      if (opt.hasAttribute("aria-pressed")) opt.setAttribute("aria-pressed", on ? "true" : "false");
      if (animate) drawBorder(opt, on);
      else sizeBorder(opt);
    }

    function bounce(opt) {
      if (REDUCED) return;
      gsap.fromTo(opt, { scale: 0.9 }, { scale: 1, duration: 0.8, ease: "elastic.out(1, 0.38)", overwrite: "auto" });
    }

    // --- Selección única (Q1, Q3) ---
    $$('[data-type="single"]').forEach((group) => {
      const name = group.dataset.name;
      const opts = $$(".opt", group);
      opts.forEach((opt) => {
        opt.addEventListener("click", () => {
          if (state.busy) return;
          const already = opt.classList.contains("is-selected");
          opts.forEach((o) => { if (o !== opt && o.classList.contains("is-selected")) markSelected(o, false); });
          if (!already) markSelected(opt, true);
          bounce(opt);
          if (name === "q3") iconPop(opt);
          state.answers[name] = opt.dataset.value;
          updateNext();
          if (!already) {
            const pool = FEEDBACK[name][opt.dataset.value];
            toast(pick(pool));
          }
        });
      });
    });

    // --- Selección múltiple (Q2) ---
    let q2FeedbackCall;
    $$('[data-type="multi"]').forEach((group) => {
      const name = group.dataset.name;
      $$(".opt", group).forEach((opt) => {
        opt.addEventListener("click", () => {
          if (state.busy) return;
          const on = !opt.classList.contains("is-selected");
          markSelected(opt, on);
          const vals = state.answers[name];
          if (on) vals.push(opt.dataset.value);
          else vals.splice(vals.indexOf(opt.dataset.value), 1);
          if (!REDUCED) {
            if (on) {
              gsap.timeline({ overwrite: "auto" })
                .to(opt, { y: -12, scale: 1.1, duration: 0.18, ease: "power2.out" })
                .to(opt, { y: 0, scale: 1, duration: 0.9, ease: "elastic.out(1.2, 0.3)" });
            } else {
              gsap.fromTo(opt, { scaleX: 1.12, scaleY: 0.88 }, { scaleX: 1, scaleY: 1, duration: 0.6, ease: "elastic.out(1, 0.35)" });
            }
          }
          updateNext();
          if (q2FeedbackCall) q2FeedbackCall.kill();
          if (on) {
            q2FeedbackCall = gsap.delayedCall(0.55, () => {
              let msg = pick(FEEDBACK.q2);
              if (opt.dataset.value === "Claude") msg = "Ah, comme moi ! 😉";
              else if (vals.length >= 4) msg = "Tu les connais tous !";
              toast(msg);
            });
          }
        });
      });
    });

    /* ---------------- Q3: iconos animados ---------------- */
    const icoLoop = gsap.timeline({ paused: true, repeat: -1, defaults: { ease: "sine.inOut" } });
    if (!REDUCED) {
      icoLoop
        .to(".ico__pen", { rotation: -10, x: -1.5, transformOrigin: "20% 80%", duration: 0.4, yoyo: true, repeat: 3 }, 0)
        .to(".ico__swap", { y: -2.5, duration: 0.6, yoyo: true, repeat: 1 }, 0.3)
        .to(".ico__loupe", { keyframes: { x: [0, 2, 0, -2, 0], y: [0, -2, -3, -2, 0] }, duration: 1.6, ease: "none" }, 0)
        .to(".ico__sun", { scale: 1.35, transformOrigin: "50% 50%", duration: 0.5, yoyo: true, repeat: 1 }, 0.4)
        .to(".ico__dot", { y: -3, duration: 0.25, stagger: 0.12, yoyo: true, repeat: 1 }, 0.2)
        .to({}, { duration: 0.6 });
      if (FINE) {
        $$(".ico").forEach((ico) => {
          const svg = $(".ico__svg", ico);
          ico.addEventListener("pointerenter", () => gsap.to(svg, { scale: 1.12, rotation: -6, duration: 0.4, ease: "back.out(3)" }));
          ico.addEventListener("pointerleave", () => gsap.to(svg, { scale: 1, rotation: 0, duration: 0.5, ease: "elastic.out(1, 0.4)" }));
        });
      }
    }
    function iconPop(opt) {
      if (REDUCED) return;
      const svg = $(".ico__svg", opt);
      gsap.fromTo(svg, { rotation: -20, scale: 0.6 }, { rotation: 0, scale: 1, duration: 0.9, ease: "elastic.out(1, 0.4)" });
      if (HAS_DRAW) gsap.fromTo($$(".draw", svg), { drawSVG: "0%" }, { drawSVG: "100%", duration: 0.9, stagger: 0.12, ease: "power2.inOut" });
    }

    /* ---------------- Q4: slider + carita ---------------- */
    const slider = (() => {
      const wrap = $(".slider");
      const track = $("#sliderTrack");
      const thumb = $("#sliderThumb");
      const fill = $(".slider__fill");
      const halo = $(".slider__halo");
      const face = $(".face__svg");
      const mouth = $(".face__mouth");
      const browL = $(".face__brow--l");
      const browR = $(".face__brow--r");
      const eyes = $$(".face__eye");
      const blush = $$(".face__blush");
      const numEl = $(".face__num");
      const wordEl = $(".face__word");
      const tintCold = $(".bg__tint--cold");
      const tintWarm = $(".bg__tint--warm");
      const WORDS = ["Pas du tout", "Un petit peu", "Moyennement", "Beaucoup", "Énormément"];

      let value = 3;          // valor continuo 1..5
      let shown = 3;          // entero mostrado
      let dragging = false;
      let active = false;     // ¿Q4 está en pantalla? (para el tinte de fondo)
      const proxy = { v: 3 };

      const haloPulse = REDUCED ? null : gsap.timeline({ repeat: -1, repeatDelay: 0.4 })
        .fromTo(halo, { scale: 0.6, opacity: 0.9 }, { scale: 1.4, opacity: 0, duration: 1.2, ease: "power2.out" });

      function render(v) {
        value = v;
        const t = (v - 1) / 4;
        const w = track.clientWidth;
        gsap.set(thumb, { x: t * w });
        gsap.set(fill, { scaleX: t });
        // Expresión de la carita (de triste a feliz)
        const cy = lerp(69, 61, t), qy = lerp(54, 82, t);
        mouth.setAttribute("d", `M34 ${cy.toFixed(2)} Q50 ${qy.toFixed(2)} 66 ${cy.toFixed(2)}`);
        browL.setAttribute("d", `M30 ${lerp(33, 29, t).toFixed(2)} L42 ${lerp(27, 30, t).toFixed(2)}`);
        browR.setAttribute("d", `M58 ${lerp(27, 30, t).toFixed(2)} L70 ${lerp(33, 29, t).toFixed(2)}`);
        eyes.forEach((e) => e.setAttribute("ry", lerp(3.6, 5.6, t).toFixed(2)));
        blush.forEach((b) => b.setAttribute("opacity", lerp(0, 0.75, t).toFixed(2)));
        if (active) tint(t);
        const n = Math.round(v);
        if (n !== shown) {
          shown = n;
          numEl.textContent = n;
          wordEl.textContent = WORDS[n - 1];
          thumb.setAttribute("aria-valuenow", n);
          thumb.setAttribute("aria-valuetext", `${n} — ${WORDS[n - 1]}`);
          if (!REDUCED) {
            gsap.fromTo(numEl, { yPercent: -40, scale: 1.4 }, { yPercent: 0, scale: 1, duration: 0.5, ease: "back.out(3)", overwrite: true });
            gsap.fromTo(face, { scale: 1.08, rotation: (Math.random() - 0.5) * 12 }, { scale: 1, rotation: 0, duration: 0.7, ease: "elastic.out(1, 0.4)", overwrite: true });
          }
        }
      }
      function tint(t) {
        gsap.to(tintCold, { opacity: (1 - t) * 0.95, duration: 0.4, overwrite: true });
        gsap.to(tintWarm, { opacity: t * 0.95, duration: 0.4, overwrite: true });
      }
      function setActive(on) {
        active = on;
        if (on) tint((value - 1) / 4);
        else gsap.to([tintCold, tintWarm], { opacity: 0, duration: 0.8, overwrite: true });
      }
      function commit(n, withFeedback = true) {
        const first = state.answers.q4 == null;
        const changed = state.answers.q4 !== n;
        state.answers.q4 = n;
        wrap.classList.add("is-answered");
        if (haloPulse) { haloPulse.pause(); gsap.set(halo, { opacity: 0 }); }
        updateNext();
        if (withFeedback && (first || changed)) toast(FEEDBACK.q4[n - 1]);
      }
      function animateTo(n, withFeedback = true) {
        proxy.v = value;
        gsap.to(proxy, {
          v: n, duration: REDUCED ? 0.01 : 0.6, ease: "elastic.out(1, 0.55)", overwrite: true,
          onUpdate: () => render(proxy.v),
        });
        commit(n, withFeedback);
      }
      function valueFromEvent(e) {
        const r = track.getBoundingClientRect();
        return 1 + gsap.utils.clamp(0, 1, (e.clientX - r.left) / r.width) * 4;
      }

      track.addEventListener("pointerdown", (e) => {
        if (state.busy) return;
        dragging = true;
        track.setPointerCapture(e.pointerId);
        gsap.killTweensOf(proxy);
        gsap.to(thumb, { scale: 1.25, duration: 0.3, ease: "back.out(3)" });
        render(valueFromEvent(e));
        e.preventDefault();
      });
      track.addEventListener("pointermove", (e) => { if (dragging) render(valueFromEvent(e)); });
      const end = () => {
        if (!dragging) return;
        dragging = false;
        gsap.to(thumb, { scale: 1, duration: 0.5, ease: "elastic.out(1, 0.4)" });
        animateTo(Math.round(value));
      };
      track.addEventListener("pointerup", end);
      track.addEventListener("pointercancel", end);
      track.addEventListener("lostpointercapture", end);

      thumb.addEventListener("keydown", (e) => {
        let n = state.answers.q4 ?? Math.round(value);
        if (e.key === "ArrowRight" || e.key === "ArrowUp") n++;
        else if (e.key === "ArrowLeft" || e.key === "ArrowDown") n--;
        else if (e.key === "Home") n = 1;
        else if (e.key === "End") n = 5;
        else return;
        e.preventDefault();
        animateTo(gsap.utils.clamp(1, 5, n));
      });
      $$(".slider__labels button").forEach((b) => b.addEventListener("click", () => animateTo(+b.dataset.v)));
      window.addEventListener("resize", () => render(value));

      function reset() {
        wrap.classList.remove("is-answered");
        shown = 0;
        render(3);
        if (haloPulse) haloPulse.restart();
      }
      render(3);
      return { render, animateTo, setActive, reset, get value() { return value; } };
    })();

    /* ---------------- Q5: textarea ---------------- */
    const area = $("#q5Input");
    const areaGlow = $(".area__glow");
    const areaCount = $("#q5Count");
    const suggs = $$(".sugg__btn");
    function onAreaChange(glow = true) {
      state.answers.q5 = area.value;
      areaCount.textContent = area.value.length;
      suggs.forEach((s) => {
        const match = s.dataset.value === area.value.trim();
        if (match !== s.classList.contains("is-selected")) markSelected(s, match);
      });
      if (glow && !REDUCED) {
        gsap.fromTo(areaGlow, { opacity: 0.9 }, { opacity: 0, duration: 0.7, ease: "power2.out", overwrite: true });
      }
      updateNext();
    }
    area.addEventListener("input", () => onAreaChange());
    let typing;
    suggs.forEach((s) => {
      s.addEventListener("click", () => {
        if (state.busy) return;
        bounce(s);
        const text = s.dataset.value;
        if (typing) typing.kill();
        if (REDUCED) { area.value = text; onAreaChange(false); return; }
        const p = { n: 0 };
        typing = gsap.to(p, {
          n: text.length, duration: Math.min(0.9, text.length * 0.035), ease: "none",
          onUpdate: () => { area.value = text.slice(0, Math.round(p.n)); onAreaChange(); },
          onComplete: () => { area.value = text; onAreaChange(); toast(pick(FEEDBACK.q5)); },
        });
      });
    });

    /* ---------------- Botón Suivant: bloqueo / desbloqueo ---------------- */
    let locked = true;
    let lockTl;
    function setLocked(lock) {
      if (lock === locked) return;
      locked = lock;
      if (lockTl) lockTl.progress(1).kill();
      nextBtn.setAttribute("aria-disabled", lock ? "true" : "false");
      if (lock || REDUCED) {
        nextBtn.classList.toggle("is-locked", lock);
        gsap.set([".btn__lock", ".btn__shackle", $(".btn__arrow", nextBtn)], { clearProps: "transform,opacity" });
        return;
      }
      // Animación de "desbloqueo"
      lockTl = gsap.timeline()
        .to(".btn__shackle", { y: -3, rotation: 25, duration: 0.2, ease: "power2.out" })
        .to(".btn__lock", { scale: 0, rotation: -40, opacity: 0, duration: 0.22, ease: "back.in(2)" }, "+=0.05")
        .add(() => nextBtn.classList.remove("is-locked"))
        .fromTo($(".btn__arrow", nextBtn), { x: -12, opacity: 0 }, { x: 0, opacity: 1, duration: 0.5, ease: "back.out(3)" })
        .fromTo(nextBtn, { scale: 0.94 }, { scale: 1, duration: 0.8, ease: "elastic.out(1, 0.35)" }, "<")
        .fromTo(".btn__shine", { xPercent: -160 }, { xPercent: 260, duration: 0.8, ease: "power2.inOut" }, "<")
        .add(() => gsap.set([".btn__lock", ".btn__shackle"], { clearProps: "transform,opacity" }));
    }

    function isAnswered(i) {
      const a = state.answers;
      switch (i) {
        case 1: return a.q1 != null;
        case 2: return a.q2.length > 0;
        case 3: return a.q3 != null;
        case 4: return a.q4 != null;
        case 5: return a.q5.trim().length >= 2;
        default: return true;
      }
    }
    function updateNext() {
      if (state.index >= 1 && state.index <= 5) setLocked(!isAnswered(state.index) || state.submitting);
    }

    nextBtn.addEventListener("click", () => {
      if (state.busy || state.submitting) return;
      // Si la sugerencia aún se está "escribiendo", la completamos antes de seguir
      if (typing && typing.isActive()) typing.progress(1);
      if (locked) {
        // Todavía no ha respondido: sacudimos el botón y avisamos
        if (!REDUCED) gsap.fromTo(nextBtn, { x: -8 }, { x: 0, duration: 0.5, ease: "elastic.out(1.5, 0.2)" });
        toast(state.index === 5 ? "Écris quelques mots d'abord ✍️" : "Choisis une réponse d'abord 🙂");
        return;
      }
      if (state.index === 5) submit();
      else go(state.index + 1);
    });
    backBtn.addEventListener("click", () => {
      if (state.busy || state.submitting) return;
      if (state.index >= 1) go(state.index - 1);
    });

    /* ---------------- Progreso + chrome ---------------- */
    const progressFill = $(".progress__fill");
    const progressGlint = $(".progress__glint");
    const progressNum = $(".progress__num");
    function setProgress(i) {
      gsap.to(progressFill, { scaleX: i / 5, duration: REDUCED ? 0.2 : 1.3, ease: "elastic.out(1, 0.45)", overwrite: true });
      if (!REDUCED) gsap.fromTo(progressGlint, { x: 0 }, { x: progressGlint.parentElement.clientWidth + 80, duration: 1.1, ease: "power2.inOut", delay: 0.15 });
      if (progressNum.textContent !== String(i)) {
        if (REDUCED) { progressNum.textContent = i; return; }
        gsap.timeline()
          .to(progressNum, { yPercent: -100, opacity: 0, duration: 0.2, ease: "power2.in" })
          .add(() => { progressNum.textContent = i; })
          .fromTo(progressNum, { yPercent: 100, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.45, ease: "back.out(3)" });
      }
    }
    let chromeShown = false;
    function setChrome(show) {
      if (show === chromeShown) return;
      chromeShown = show;
      const d = REDUCED ? 0.2 : 0.6;
      gsap.to(topbar, { autoAlpha: show ? 1 : 0, y: show ? 0 : -20, duration: d, ease: SILK });
      gsap.to(nav, { autoAlpha: show ? 1 : 0, y: show ? 0 : 30, duration: d, ease: SILK });
    }

    /* ---------------- Intro de cada pantalla ---------------- */
    const splits = new Map();
    function splitWords(el) {
      if (!HAS_SPLIT) return null;
      if (!splits.has(el)) splits.set(el, SplitText.create(el, { type: "words", mask: "words" }));
      return splits.get(el);
    }
    function introQuestion(screen) {
      const title = $(".q__title", screen);
      const kicker = $(".q__kicker", screen);
      const items = $$(".opt:not(.sugg__btn), .face, .slider, .area, .sugg__label, .sugg__btn", screen);
      if (REDUCED) { gsap.fromTo([kicker, title, ...items], { opacity: 0 }, { opacity: 1, duration: 0.3 }); return; }
      const split = splitWords(title);
      const tl = gsap.timeline();
      tl.fromTo(kicker, { y: 14, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, ease: SILK }, 0);
      if (split) tl.fromTo(split.words, { yPercent: 115 }, { yPercent: 0, duration: 0.9, ease: SILK, stagger: 0.04 }, 0.05);
      else tl.fromTo(title, { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.8, ease: SILK }, 0.05);
      tl.fromTo(items, { y: 36, opacity: 0 }, { y: 0, opacity: 1, duration: 0.8, ease: "back.out(1.6)", stagger: 0.06 }, 0.25);
      if (screen.dataset.screen === "q3" && HAS_DRAW) {
        tl.fromTo($$(".ico__svg .draw", screen), { drawSVG: "0%" }, { drawSVG: "100%", duration: 1, ease: "power2.inOut", stagger: 0.03 }, 0.35);
      }
      return tl;
    }

    function onEnter(i) {
      const screen = screens[i];
      screen.scrollTop = 0;
      if (i >= 1 && i <= 5) introQuestion(screen);
      if (i === 3) icoLoop.play(); else icoLoop.pause();
      slider.setActive(i === 4);
      if (i === 4) slider.render(state.answers.q4 ?? slider.value);
      if (i === 5 && FINE) gsap.delayedCall(0.6, () => area.focus({ preventScroll: true }));
      if (i === 6) introFinal();
    }

    /* ---------------- Transiciones cinematográficas ---------------- */
    const fxWipe = $(".fx__wipe");
    const curtains = $$(".fx__curtain");
    const morphSvg = $(".fx__morph");
    const morphPath = $("#morphPath");
    const SHAPES = {
      dot: "M50,49 C50.6,49 51,49.4 51,50 C51,50.6 50.6,51 50,51 C49.4,51 49,50.6 49,50 C49,49.4 49.4,49 50,49 Z",
      blob: "M50,14 C74,10 90,30 86,52 C83,76 64,90 46,86 C24,82 10,66 14,46 C17,28 30,17 50,14 Z",
      full: "M-30,-30 C40,-40 60,-40 130,-30 C140,40 140,60 130,130 C60,140 40,140 -30,130 C-40,60 -40,40 -30,-30 Z",
      blob2: "M52,8 C80,12 96,34 90,58 C84,82 60,96 40,90 C18,84 4,62 10,40 C16,20 30,6 52,8 Z",
      exit: "M50,109 C50.6,109 51,109.4 51,110 C51,110.6 50.6,111 50,111 C49.4,111 49,110.6 49,110 C49,109.4 49.4,109 50,109 Z",
    };

    function show(el) {
      el.classList.add("is-active");
      gsap.set(el, { autoAlpha: 1 });
    }
    function hide(el) {
      el.classList.remove("is-active");
      gsap.set(el, { autoAlpha: 0, clearProps: "transform" });
    }

    const FX = {
      // Bienvenue → Q1 : barrido dorado
      wipe(from, to, dir, swap) {
        const left = dir > 0 ? "left center" : "right center";
        const right = dir > 0 ? "right center" : "left center";
        return gsap.timeline()
          .set(fxWipe, { transformOrigin: left, scaleX: 0 })
          .to(fxWipe, { scaleX: 1, duration: 0.6, ease: CINE })
          .to(from, { x: -60 * dir, duration: 0.6, ease: "power2.in" }, 0)
          .add(swap)
          .set(to, { x: 60 * dir })
          .set(fxWipe, { transformOrigin: right })
          .to(fxWipe, { scaleX: 0, duration: 0.65, ease: CINE })
          .to(to, { x: 0, duration: 0.9, ease: SILK }, "<0.1");
      },
      // Q1 → Q2 : zoom
      zoom(from, to, dir, swap) {
        return gsap.timeline()
          .to(from, { scale: dir > 0 ? 1.35 : 0.7, autoAlpha: 0, duration: 0.45, ease: "power3.in" })
          .add(swap)
          .fromTo(to, { scale: dir > 0 ? 0.7 : 1.35, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.8, ease: SILK });
      },
      // Q2 → Q3 : rotación 3D
      flip(from, to, dir, swap) {
        return gsap.timeline()
          .to(from, { rotationY: -80 * dir, x: -60 * dir, z: -200, autoAlpha: 0, transformOrigin: dir > 0 ? "0% 50%" : "100% 50%", duration: 0.55, ease: "power2.in" })
          .add(swap)
          .fromTo(to, { rotationY: 80 * dir, x: 60 * dir, z: -200, autoAlpha: 0, transformOrigin: dir > 0 ? "100% 50%" : "0% 50%" },
            { rotationY: 0, x: 0, z: 0, autoAlpha: 1, duration: 0.9, ease: SILK });
      },
      // Q3 → Q4 : cortina
      curtain(from, to, dir, swap) {
        const [top, bottom] = curtains;
        return gsap.timeline()
          .set(top, { transformOrigin: "top center" }).set(bottom, { transformOrigin: "bottom center" })
          .to(curtains, { scaleY: 1, duration: 0.55, ease: CINE })
          .to(from, { scale: 0.92, duration: 0.55, ease: "power2.in" }, 0)
          .add(swap)
          .set(top, { transformOrigin: "top center" })
          .to(curtains, { scaleY: 0, duration: 0.7, ease: CINE }, "+=0.08")
          .fromTo(to, { scale: 1.08 }, { scale: 1, duration: 1, ease: SILK }, "<");
      },
      // Q4 → Q5 : morph orgánico (MorphSVG)
      morph(from, to, dir, swap) {
        if (!HAS_MORPH) return FX.zoom(from, to, dir, swap);
        return gsap.timeline()
          .set(morphSvg, { visibility: "visible" })
          .set(morphPath, { attr: { d: SHAPES.dot } })
          .to(morphPath, { morphSVG: SHAPES.blob, duration: 0.35, ease: "power2.in" })
          .to(morphPath, { morphSVG: SHAPES.full, duration: 0.4, ease: "power3.out" })
          .to(from, { y: -30 * dir, autoAlpha: 0, duration: 0.5, ease: "power2.in" }, 0)
          .add(swap)
          .set(to, { y: 30 * dir })
          .to(morphPath, { morphSVG: SHAPES.blob2, duration: 0.4, ease: "power3.in" })
          .to(morphPath, { morphSVG: SHAPES.exit, duration: 0.4, ease: "power3.out" })
          .to(to, { y: 0, duration: 0.9, ease: SILK }, "<-0.2")
          .set(morphSvg, { visibility: "hidden" });
      },
      // Q5 → Merci : destello + escala
      burst(from, to, dir, swap) {
        return gsap.timeline()
          .to(from, { scale: 0.85, autoAlpha: 0, duration: 0.45, ease: "power3.in" })
          .set(fxWipe, { transformOrigin: "center center", scaleX: 0 }, 0)
          .to(fxWipe, { scaleX: 1, duration: 0.45, ease: CINE }, 0.1)
          .add(swap)
          .to(fxWipe, { autoAlpha: 0, duration: 0.6, ease: "power2.out" })
          .set(fxWipe, { scaleX: 0, autoAlpha: 1 })
          .fromTo(to, { scale: 1.15, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.9, ease: SILK }, "<");
      },
      fade(from, to, dir, swap) {
        return gsap.timeline()
          .to(from, { autoAlpha: 0, duration: 0.2 })
          .add(swap)
          .fromTo(to, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.25 });
      },
    };
    // FX_ORDER[i] = transición entre la pantalla i y la i+1
    const FX_ORDER = ["wipe", "zoom", "flip", "curtain", "morph", "burst"];

    async function go(to, opts = {}) {
      if (state.busy || to === state.index || !screens[to]) return;
      state.busy = true;
      const fromI = state.index;
      const from = screens[fromI];
      const target = screens[to];
      const dir = to > fromI ? 1 : -1;
      let type = opts.type || (dir > 0 ? FX_ORDER[fromI] : FX_ORDER[to]);
      if (REDUCED) type = "fade";

      const isQ = to >= 1 && to <= 5;
      setChrome(isQ);
      if (isQ) {
        setProgress(to);
        nextLabel.textContent = to === 5 ? "Envoyer" : "Suivant";
      }

      const swap = () => {
        hide(from);
        show(target);
        state.index = to;
        updateNext();
        onEnter(to);
      };
      await FX[type](from, target, dir, swap);
      state.busy = false;
    }

    /* ---------------- Bienvenue ---------------- */
    const nameForm = $("#nameForm");
    const nameInput = $("#prenom");
    const nameHint = $("#nameHint");
    const startBtn = $("#startBtn");

    nameForm.addEventListener("submit", (e) => {
      e.preventDefault();
      if (state.busy) return;
      const raw = nameInput.value.trim().replace(/\s+/g, " ");
      if (!raw) {
        nameHint.textContent = "Écris ton prénom pour commencer 🙂";
        if (!REDUCED) gsap.fromTo(".field", { x: -10 }, { x: 0, duration: 0.6, ease: "elastic.out(1.6, 0.2)" });
        nameInput.focus();
        return;
      }
      nameHint.textContent = "";
      state.prenom = raw.charAt(0).toUpperCase() + raw.slice(1);
      askGyroPermission();
      if (document.activeElement) document.activeElement.blur();
      if (!REDUCED) {
        gsap.fromTo(startBtn, { scale: 0.92 }, { scale: 1, duration: 0.6, ease: "elastic.out(1, 0.4)" });
      }
      toast(`Enchanté, ${state.prenom} !`);
      go(1);
    });

    function introWelcome() {
      const screen = screens[0];
      const title = $(".welcome__title", screen);
      const rest = [$(".eyebrow", screen), $(".welcome__lead", screen), $(".field", screen), $(".magnet-wrap", screen), $(".welcome__keys", screen)];
      document.body.classList.remove("is-loading");
      if (REDUCED) { gsap.fromTo([title, ...rest], { opacity: 0 }, { opacity: 1, duration: 0.4 }); return; }
      const tl = gsap.timeline({ delay: 0.15 });
      const split = HAS_SPLIT ? SplitText.create(title, { type: "words,chars" }) : null;
      if (split) {
        gsap.set(title, { perspective: 600 });
        tl.fromTo(split.chars,
          { yPercent: 110, rotationX: -90, opacity: 0, transformOrigin: "50% 100%" },
          { yPercent: 0, rotationX: 0, opacity: 1, duration: 1, ease: "back.out(1.8)", stagger: 0.045 }, 0.2);
      } else {
        tl.fromTo(title, { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 1, ease: SILK }, 0.2);
      }
      tl.fromTo(rest[0], { y: 12, opacity: 0, letterSpacing: "0.5em" }, { y: 0, opacity: 1, letterSpacing: "0.22em", duration: 1.2, ease: SILK }, 0)
        .fromTo(rest.slice(1), { y: 26, opacity: 0 }, { y: 0, opacity: 1, duration: 0.9, ease: SILK, stagger: 0.1 }, 0.9)
        .add(() => { if (FINE) nameInput.focus({ preventScroll: true }); });
      // Respiración suave del botón
      gsap.to($(".btn__glow", startBtn), { opacity: 0.35, scale: 0.9, duration: 1.6, yoyo: true, repeat: -1, ease: "sine.inOut", delay: 2 });
    }

    /* ---------------- Envío ---------------- */
    function buildRecord() {
      const a = state.answers;
      return {
        id: uid(),
        date: new Date().toISOString(),
        prenom: state.prenom,
        q1: a.q1,
        q2: a.q2.join(", "),
        q3: a.q3,
        q4: a.q4,
        q5: a.q5.trim(),
      };
    }

    let lastRecord = null;
    function submit() {
      if (state.submitting) return;
      state.submitting = true;
      setLocked(true);
      nextLabel.textContent = "Envoi…";
      const record = buildRecord();
      lastRecord = record;
      Store.save(record);
      // Envío en segundo plano; si falla, queda en la cola para el próximo intento
      sendRecord(record).then((ok) => {
        if (ok) Store.unqueue(record.id);
        else if (SHEET_ENDPOINT) console.info("Envoi impossible pour l'instant — réponse gardée localement.");
      });
      go(6).then(() => { state.submitting = false; });
    }

    /* ---------------- Merci ---------------- */
    const finalName = $(".final__name");
    const finalTitle = $(".final__title");
    const summaryEl = $("#summary");
    let finalSplit;

    function renderSummary(record) {
      summaryEl.textContent = "";
      QUESTIONS.forEach((q, i) => {
        const li = document.createElement("li");
        const n = document.createElement("span");
        n.className = "summary__n";
        n.textContent = i + 1;
        const body = document.createElement("div");
        const qq = document.createElement("span");
        qq.className = "summary__q";
        qq.textContent = q.short;
        const aa = document.createElement("span");
        aa.className = "summary__a";
        if (q.key === "q4") {
          aa.textContent = `${record.q4}/5`;
          const dots = document.createElement("span");
          dots.className = "summary__dots";
          for (let k = 1; k <= 5; k++) {
            const d = document.createElement("i");
            if (k <= record.q4) d.className = "on";
            dots.appendChild(d);
          }
          aa.appendChild(dots);
        } else {
          aa.textContent = record[q.key] || "—";
        }
        body.append(qq, aa);
        li.append(n, body);
        summaryEl.appendChild(li);
      });
    }

    function introFinal() {
      const record = lastRecord || Store.done();
      if (!record) return;
      if (finalSplit) { finalSplit.revert(); finalSplit = null; }
      finalName.textContent = record.prenom || "toi";
      renderSummary(record);
      const items = $$("li", summaryEl);
      const saved = $("#finalSaved");
      const again = $("#againBtn");
      if (REDUCED) {
        if (HAS_DRAW) gsap.set(".final__seal .draw", { drawSVG: "100%" });
        gsap.fromTo([finalTitle, saved, ...items, again], { opacity: 0 }, { opacity: 1, duration: 0.4 });
        return;
      }
      confetti.fire();
      const tl = gsap.timeline();
      if (HAS_DRAW) tl.fromTo(".final__seal .draw", { drawSVG: "0%" }, { drawSVG: "100%", duration: 0.9, ease: "power2.inOut", stagger: 0.25 }, 0);
      tl.fromTo(".final__seal", { scale: 0.4, rotation: -30 }, { scale: 1, rotation: 0, duration: 1.1, ease: "elastic.out(1, 0.45)" }, 0);
      if (HAS_SPLIT) {
        finalSplit = SplitText.create(finalTitle, { type: "words,chars" });
        tl.fromTo(finalSplit.chars, { yPercent: 120, rotation: 12, opacity: 0 },
          { yPercent: 0, rotation: 0, opacity: 1, duration: 0.9, ease: "back.out(2)", stagger: 0.035 }, 0.15);
      } else {
        tl.fromTo(finalTitle, { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.8 }, 0.15);
      }
      tl.fromTo(saved, { y: 12, opacity: 0 }, { y: 0, opacity: 1, duration: 0.7, ease: SILK }, 0.7)
        .fromTo(items, { y: 30, opacity: 0, scale: 0.96 }, { y: 0, opacity: 1, scale: 1, duration: 0.8, ease: "back.out(1.6)", stagger: 0.09 }, 0.9)
        .fromTo($$(".summary__dots i.on", summaryEl), { scale: 0 }, { scale: 1, duration: 0.5, ease: "back.out(4)", stagger: 0.08 }, 1.4)
        .fromTo(again, { opacity: 0 }, { opacity: 1, duration: 0.6 }, 1.6);
    }

    // Permite que otra persona responda en el mismo celular
    $("#againBtn").addEventListener("click", () => {
      if (state.busy) return;
      Store.clearDone();
      lastRecord = null;
      resetAnswers();
      go(0, { type: "wipe" }).then(() => {
        const s = screens[0];
        gsap.fromTo($$(".welcome > *", s), { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.7, stagger: 0.06, ease: SILK });
      });
    });

    function resetAnswers() {
      state.prenom = "";
      state.answers = { q1: null, q2: [], q3: null, q4: null, q5: "" };
      allOpts.forEach((o) => { if (o.classList.contains("is-selected")) markSelected(o, false, false); });
      nameInput.value = "";
      area.value = "";
      areaCount.textContent = "0";
      slider.reset();
      locked = false;
      setLocked(true);
    }

    /* ---------------- Teclado ---------------- */
    document.addEventListener("keydown", (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const i = state.index;
      const inField = e.target.matches("input, textarea");

      if (e.key === "Enter") {
        if (i === 0) return; // el form ya maneja Enter
        if (i >= 1 && i <= 5) {
          if (e.target.id === "q5Input" && e.shiftKey) return; // Shift+Enter = salto de línea
          if (e.target === backBtn) return; // Enter sobre "Retour" = volver
          e.preventDefault(); // evita el "click" nativo de la opción con foco
          nextBtn.click();
        }
        return;
      }

      if (inField || state.busy) return;
      const n = parseInt(e.key, 10);
      if (!(n >= 1 && n <= 9)) return;
      const screen = screens[i];
      if (i === 4) { if (n <= 5) slider.animateTo(n); return; }
      const opts = $$(".opt", screen);
      if (opts[n - 1]) {
        opts[n - 1].click();
        opts[n - 1].focus({ preventScroll: true });
      }
    });

    /* ---------------- Arranque ---------------- */
    const fontsReady = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    Promise.race([fontsReady, new Promise((r) => setTimeout(r, 1200))]).then(() => {
      allOpts.forEach(sizeBorder);
      const done = Store.done();
      if (done) {
        // Ya respondió en este dispositivo: mostramos su resumen, sin reenviar
        lastRecord = done;
        state.prenom = done.prenom;
        document.body.classList.remove("is-loading");
        hide(screens[0]);
        show(screens[6]);
        state.index = 6;
        onEnter(6);
      } else {
        introWelcome();
      }
    });
  }
})();
