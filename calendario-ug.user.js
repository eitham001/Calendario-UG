// ==UserScript==
// @name         Calendario UG — panel dentro del Campus Virtual
// @namespace    https://github.com/eitham001/Calendario-UG
// @version      1.0.0
// @description  Muestra tus tareas, foros y talleres del campus con su estado real (pendiente / enviada / calificada / no enviada) dentro del Campus Virtual UG.
// @match        https://campusvirtual2.ug.edu.ec/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

/*
 * No modifica el sitio de la UG: corre en tu navegador, sobre la página que ya
 * estás viendo, usando tu sesión iniciada. No guarda ni envía credenciales.
 */
(() => {
  "use strict";

  const BASE = location.origin;
  const TTL = 10 * 60 * 1000; // re-consulta automática cada 10 min
  const KEY = "calUG.panel";

  /* ── guardado local (solo preferencias y caché de eventos, nunca claves) ── */
  let guardado = {};
  try { guardado = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch {}
  const estado = Object.assign({
    abierto: true,
    filtro: "todos",
    curso: "todos",
    mes: null,
    anio: null,
    eventos: [],
    materias: [],
    ts: 0,
  }, guardado);
  const persistir = () => { try { localStorage.setItem(KEY, JSON.stringify(estado)); } catch {} };

  /* ── utilidades ── */
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s = "") => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const decodeEntities = (s = "") => s
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&ntilde;/g, "ñ").replace(/&Ntilde;/g, "Ñ")
    .replace(/&aacute;/g, "á").replace(/&eacute;/g, "é").replace(/&iacute;/g, "í")
    .replace(/&oacute;/g, "ó").replace(/&uacute;/g, "ú").replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  const NOMBRES_MES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
  const NOMBRES_DIA = ["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"];

  async function texto(url) {
    const r = await fetch(url, { credentials: "include", headers: { "X-Requested-With": "XMLHttpRequest" } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.text();
  }
  async function enParalelo(items, fn, tam = 8) {
    const out = new Array(items.length);
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(tam, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        try { out[idx] = await fn(items[idx]); } catch { out[idx] = null; }
      }
    }));
    return out;
  }

  /* ── parseo del calendario mensual ── */
  function parsearMaterias(html) {
    return [...html.matchAll(/<option[^>]*value="(\d+)"[^>]*>([^<]+)<\/option>/g)]
      .map(m => ({ id: m[1], nombre: decodeEntities(m[2].replace(/\s+/g, " ").trim()) }))
      .filter(o => o.id !== "1" && o.nombre);
  }
  function parsearCalendario(html, year, month, cursoPorId) {
    const eventos = [];
    for (const [, td] of html.matchAll(/<td[^>]*data-region="day"[^>]*>([\s\S]*?)<\/td>/g)) {
      const dia = Number((td.match(/data-day="(\d+)"/) || [])[1]);
      if (!dia) continue;
      for (const m of td.matchAll(/<li([^>]*data-region="event-item"[^>]*)>([\s\S]*?)<\/li>/g)) {
        const attrs = m[1], li = m[2];
        const component = (attrs.match(/data-event-component="([^"]*)"/) || [])[1] || "";
        const tipo = (attrs.match(/data-event-eventtype="([^"]*)"/) || [])[1] || "";
        const href = (li.match(/href="([^"]*)"/) || [])[1];
        const title = (li.match(/title="([^"]*)"/) || [])[1] || "";
        if (!href) continue;
        const cmid = Number((href.match(/[?&]id=(\d+)/) || [])[1]);
        const cid = (attrs.match(/data-event-courseid="(\d+)"/) || [])[1];
        eventos.push({
          id: `ev-${cmid}-${tipo}`, cmid, component, tipo, day: dia, year, month,
          url: href, titulo: decodeEntities(title),
          curso: cursoPorId.get(cid) || null,
          actividad: component === "mod_assign" ? "Tarea" :
                     component === "mod_workshop" ? "Taller" :
                     component === "mod_quiz" ? "Cuestionario" : "Actividad",
          fecha: `${year}-${String(month).padStart(2, "0")}-${String(dia).padStart(2, "0")}`,
        });
      }
    }
    return eventos;
  }

  /* ── parseo del estado de cada actividad ── */
  function parsearCursoDe(html) {
    const c = html.match(/<a[^>]*href="[^"]*course\/view\.php\?id=\d+"[^>]*>\s*([^<]+?)\s*<\/a>/);
    if (c) return decodeEntities(c[1]);
    const bc = [...html.matchAll(/<li class="breadcrumb-item">[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/g)];
    return bc.length ? decodeEntities(bc[bc.length - 1][1]) : null;
  }
  function parsearEstadoAsign(html) {
    const det = { curso: parsearCursoDe(html), enviado: false, calificada: false, nota: null, tarde: false };
    const fila = (etq) => {
      const re = new RegExp(`<th[^>]*>\\s*${etq}\\s*</th>\\s*<td[^>]*>\\s*(?:<[^>]*>\\s*)*([\\s\\S]*?)</td>`, "i");
      return (html.match(re) || [])[1] || "";
    };
    const entrega = (html.match(/<th[^>]*>\s*Estado de la entrega\s*<\/th>\s*<td\s+class="([^"]*)"/i) || [])[1] || "";
    det.enviado = /submitted/i.test(entrega);
    const cal = (html.match(/<th[^>]*>\s*Estado de la calificación\s*<\/th>\s*<td\s+class="([^"]*)"[^>]*>([\s\S]*?)<\/td>/i) || []);
    if (cal[1] && !/notgraded|notgradedlater/i.test(cal[1]) && !/sin calificar|not yet/i.test(cal[2])) det.calificada = true;
    if (/Calificada|Graduad|Graded/i.test(cal[2] || "")) det.calificada = true;
    const nota = fila("Calificación").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (nota) det.nota = nota.split(/[-–/,·]/)[0].trim().slice(0, 24);
    const tiempo = fila("Tiempo restante");
    if (tiempo && /despu[ée]s de la fecha (l[íi]mite|de vencimiento)|after the due date|late/i.test(tiempo)) det.tarde = true;
    return det;
  }
  function estadoDe(e, det) {
    const pasado = new Date(e.year, e.month - 1, e.day, 23, 59, 59) < new Date();
    if (e.component !== "mod_assign") return { estado: pasado ? "vencida" : "pendiente" };
    if (!det) return { estado: pasado ? "vencida" : "pendiente" };
    if (det.calificada) return { estado: "calificada" };
    if (det.enviado) return { estado: "enviada" };
    return { estado: pasado ? "vencida" : "pendiente" };
  }

  /* ── carga ── */
  async function cargar(forzar = false) {
    const aviso = $("#cug-aviso");
    if (aviso) aviso.textContent = "Consultando el campus…";
    const y = estado.anio || new Date().getFullYear();
    const m = estado.mes || new Date().getMonth() + 1;
    try {
      const html = await texto(`${BASE}/calendar/view.php?view=month&year=${y}&month=${m}`);
      if (/name="logintoken"/i.test(html.slice(0, 6000))) throw new Error("Sesión expirada: entra al campus de nuevo");
      const materias = parsearMaterias(html);
      const cursoPorId = new Map(materias.map(x => [x.id, x.nombre]));
      const eventos = parsearCalendario(html, y, m, cursoPorId);
      await enParalelo(eventos.filter(e => e.component === "mod_assign"), async (e) => {
        const detHTML = await texto(e.url);
        if (/name="logintoken"/i.test(detHTML.slice(0, 6000))) return;
        const det = parsearEstadoAsign(detHTML);
        e.curso = e.curso || det.curso; e.nota = det.nota; e.tarde = det.tarde; e.det = det;
      });
      await enParalelo(eventos.filter(e => e.component !== "mod_assign"), async (e) => {
        if (e.curso) return;
        try {
          const detHTML = await texto(e.url);
          e.curso = parsearCursoDe(detHTML);
          if (e.component === "mod_forum") e.respondido = /Darse de baja|Unsubscribe/i.test(detHTML);
        } catch {}
      });
      for (const e of eventos) {
        const st = estadoDe(e, e.det);
        e.estado = st.estado;
        e.sinEstadoExacto = e.component !== "mod_assign";
      }
      estado.eventos = eventos; estado.materias = materias; estado.ts = Date.now();
      estado.anio = y; estado.mes = m;
      persistir();
      pintar();
      if (aviso) aviso.textContent = `Actualizado ${new Date().toLocaleTimeString()}`;
    } catch (err) {
      if (aviso) aviso.textContent = "Error: " + err.message;
    }
  }

  /* ── interfaz ── */
  const TXT = { todos: "Todos", pendiente: "Pendientes", enviada: "Enviadas", calificada: "Calificadas", vencida: "No enviadas", foros: "Foros" };
  const COLORES = { pendiente: "#e0a800", enviada: "#2e9e5b", calificada: "#1a5fb4", vencida: "#c23b3b", foro: "#1a5fb4" };

  function crearPanel() {
    const style = document.createElement("style");
    style.textContent = `
      #cug-panel{position:fixed;top:12px;right:12px;width:370px;max-height:88vh;background:#fff;border:1px solid #d9dde6;border-radius:14px;box-shadow:0 10px 34px rgba(20,30,60,.22);z-index:99999;display:flex;flex-direction:column;font:13px/1.4 "Segoe UI",system-ui,sans-serif;color:#1f2328;overflow:hidden}
      #cug-panel[hidden]{display:none}
      #cug-cab{background:linear-gradient(120deg,#123c78,#1a5fb4);color:#fff;padding:12px 14px;display:flex;align-items:center;gap:8px}
      #cug-cab b{font-size:14px;flex:1}
      #cug-cab button{background:rgba(255,255,255,.18);border:0;border-radius:8px;color:#fff;padding:5px 9px;cursor:pointer;font-size:12px}
      #cug-cab button:hover{background:rgba(255,255,255,.3)}
      #cug-filtros{padding:9px 12px;border-bottom:1px solid #eef0f4;display:flex;flex-wrap:wrap;gap:5px}
      #cug-filtros button,#cug-filtros select{background:#f2f5fa;border:1px solid #dde3ec;border-radius:8px;padding:5px 8px;font-size:11px;cursor:pointer;color:#334}
      #cug-filtros button.activa{background:#1a5fb4;color:#fff;border-color:#1a5fb4}
      #cug-lista{overflow:auto;padding:8px 12px 14px;flex:1}
      #cug-aviso{padding:5px 12px;font-size:11px;color:#667}
      .cug-item{display:flex;gap:9px;align-items:flex-start;border:1px solid #e7eaf0;border-left-width:4px;border-radius:9px;padding:8px 10px;margin-top:7px}
      .cug-item .t{flex:1;min-width:0}
      .cug-item .t a{color:#1a5fb4;text-decoration:none;font-weight:600}
      .cug-item .m{font-size:11px;color:#5b6472;margin-top:2px}
      .cug-item .tag{font-size:10px;font-weight:700;border-radius:6px;padding:2px 6px;white-space:nowrap}
      #cug-flotante{position:fixed;top:12px;right:12px;z-index:99999;background:#1a5fb4;color:#fff;border:0;border-radius:10px;padding:9px 12px;box-shadow:0 6px 18px rgba(0,0,0,.2);cursor:pointer;font:13px "Segoe UI",sans-serif}
      #cug-flotante[hidden]{display:none}
    `;
    document.head.appendChild(style);

    const panel = document.createElement("div");
    panel.id = "cug-panel";
    panel.innerHTML = `
      <div id="cug-cab"><b>📅 Calendario UG</b>
        <button id="cug-ant" title="Mes anterior">◀</button>
        <button id="cug-act" title="Actualizar">⟳</button>
        <button id="cug-post" title="Mes siguiente">▶</button>
        <button id="cug-cerrar" title="Cerrar">✕</button>
      </div>
      <div id="cug-filtros"></div>
      <div id="cug-lista"></div>
      <div id="cug-aviso"></div>`;
    document.body.appendChild(panel);

    const flotante = document.createElement("button");
    flotante.id = "cug-flotante"; flotante.textContent = "📅 Calendario";
    document.body.appendChild(flotante);

    $("#cug-cerrar").onclick = () => { estado.abierto = false; persistir(); pintar(); };
    flotante.onclick = () => { estado.abierto = true; persistir(); pintar(); };
    $("#cug-ant").onclick = () => cambiarMes(-1);
    $("#cug-post").onclick = () => cambiarMes(1);
    $("#cug-act").onclick = () => cargar(true);
    $("#cug-filtros").onclick = (e) => {
      const b = e.target.closest("button[data-f]"); if (!b) return;
      estado.filtro = b.dataset.f; persistir(); pintar();
    };
    $("#cug-filtros").onchange = (e) => {
      if (e.target.id === "cug-curso") { estado.curso = e.target.value; persistir(); pintar(); }
    };
    $("#cug-lista").onclick = (e) => {
      const a = e.target.closest("a[data-url]");
      if (a) { e.preventDefault(); window.open(a.dataset.url, "_blank", "noopener"); }
    };
  }
  function cambiarMes(d) {
    let m = (estado.mes || new Date().getMonth() + 1) + d, y = estado.anio || new Date().getFullYear();
    if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; }
    estado.mes = m; estado.anio = y; persistir(); cargar();
  }

  function pintar() {
    const panel = $("#cug-panel"), flotante = $("#cug-flotante");
    if (!panel) return;
    panel.hidden = !estado.abierto;
    flotante.hidden = estado.abierto;
    if (!estado.abierto) return;

    const y = estado.anio || new Date().getFullYear(), m = estado.mes || new Date().getMonth() + 1;
    $("#cug-cab").querySelector("b").textContent = `📅 ${NOMBRES_MES[m - 1]} ${y}`;
    $("#cug-filtros").innerHTML =
      Object.keys(TXT).map(k => `<button data-f="${k}" class="${estado.filtro === k ? "activa" : ""}">${TXT[k]}</button>`).join("") +
      `<select id="cug-curso"><option value="todos">Todos los cursos</option>` +
      estado.materias.map(c => `<option value="${esc(c.nombre)}" ${estado.curso === c.nombre ? "selected" : ""}>${esc(c.nombre)}</option>`).join("") + `</select>`;

    let evs = estado.eventos.slice();
    if (estado.filtro === "foros") evs = evs.filter(e => e.component === "mod_forum");
    else if (estado.filtro !== "todos") evs = evs.filter(e => e.estado === estado.filtro);
    if (estado.curso !== "todos") evs = evs.filter(e => e.curso === estado.curso);
    evs.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.titulo.localeCompare(b.titulo));

    $("#cug-lista").innerHTML = evs.length ? evs.map(e => {
      const foro = e.component === "mod_forum";
      const color = foro ? COLORES.foro : (COLORES[e.estado] || "#888");
      const tag = foro ? (e.respondido ? "Respondido" : "Revisar")
        : { pendiente: "Pendiente", enviada: e.tarde ? "Enviada (atrasada)" : "Enviada", calificada: "Calificada", vencida: "No enviada" }[e.estado] || e.estado;
      const meta = [`<span>📅 ${NOMBRES_DIA[new Date(e.year, e.month - 1, e.day).getDay()]} ${e.day} ${NOMBRES_MES[e.month - 1]}</span>`];
      if (e.curso) meta.push(`<span>📚 ${esc(e.curso)}</span>`);
      if (e.nota) meta.push(`<span>⭐ ${esc(e.nota)}</span>`);
      if (foro) meta.push(`<span class="m">${e.respondido ? "respondido" : "revisar en el campus"}</span>`);
      return `<div class="cug-item" style="border-left-color:${color}">
        <div class="t"><a href="#" data-url="${esc(e.url)}">${esc(e.titulo)}</a>
          <div class="m">${meta.join(" · ")}</div></div>
        <span class="tag" style="background:${color};color:#fff">${tag}</span>
      </div>`;
    }).join("") : `<div class="m" style="padding:14px;text-align:center">Sin actividades con este filtro.</div>`;
  }

  /* ── arranque ── */
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
  else iniciar();
  function iniciar() {
    crearPanel();
    pintar();
    const frescos = Date.now() - (estado.ts || 0) < TTL;
    cargar(!frescos);
    setInterval(() => cargar(), TTL);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && Date.now() - (estado.ts || 0) > 2 * 60 * 1000) cargar();
    });
  }
})();
