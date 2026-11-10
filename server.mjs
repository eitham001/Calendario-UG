// Plataforma Calendario — Campus Virtual U. Guayaquil (Moodle)
// Servidor Node sin dependencias: inicia sesión en el campus, descarga el
// calendario mensual y el estado de cada tarea (pendiente / enviada /
// calificada / vencida). Sirve el tablero en http://localhost:3210
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// En local lee config.json; en Render (o cualquier host) usa variables de entorno
const fileCfg = fs.existsSync(path.join(__dirname, "config.json"))
  ? JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"))
  : {};
const cfg = {
  baseUrl: process.env.CAMPUS_URL ?? fileCfg.baseUrl,
  username: process.env.CAMPUS_USER ?? fileCfg.username,
  password: process.env.CAMPUS_PASS ?? fileCfg.password,
};
const BASE = cfg.baseUrl.replace(/\/$/, "");
const PORT = process.env.PORT || 3210;
// Credenciales de acceso al tablero (por defecto = las del campus)
const APP_USER = process.env.APP_USER ?? cfg.username;
const APP_PASS = process.env.APP_PASS ?? cfg.password;
const sesiones = new Set();
function nuevoSid() { return crypto.randomBytes(16).toString("hex"); }
function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k) out[k] = decodeURIComponent(v.join("="));
  }
  return out;
}
function autenticado(req) { const sid = parseCookies(req).sid; return !!sid && sesiones.has(sid); }
async function leerBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}
const CACHE_FILE = path.join(__dirname, "cache-estado.json");
const TTL_ESTADO = 6 * 3600 * 1000;   // 6 h de vigencia del estado por tarea
const TTL_CALENDARIO = 30 * 60 * 1000; // 30 min del calendario por mes

// ── Sesión en el campus ──────────────────────────────────────────────────────
let jar = new Map();
let loggedAt = 0;

const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
function saveCookies(res) {
  for (const c of (res.headers.getSetCookie?.() ?? [])) {
    const [pair] = c.split(";");
    const eq = pair.indexOf("=");
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}
const decodeEntities = (s = "") => s
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">").replace(/&ntilde;/g, "ñ").replace(/&Ntilde;/g, "Ñ")
  .replace(/&aacute;/g, "á").replace(/&eacute;/g, "é").replace(/&iacute;/g, "í")
  .replace(/&oacute;/g, "ó").replace(/&uacute;/g, "ú").replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

async function fetchCampus(url, { method = "GET", body } = {}) {
  const res = await fetch(url, {
    method,
    redirect: "manual",
    headers: { Cookie: cookieHeader(), "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Mozilla/5.0 CalendarioUG" },
    body,
  });
  saveCookies(res);
  return res;
}

async function login() {
  jar = new Map();
  const lp = await fetchCampus(`${BASE}/login/index.php`);
  const lpHtml = await lp.text();
  const logintoken = (lpHtml.match(/name="logintoken"\s*value="([^"]+)"/) ?? [])[1] ?? "";
  const body = new URLSearchParams({ username: cfg.username, password: cfg.password, logintoken }).toString();
  const resp = await fetchCampus(`${BASE}/login/index.php`, { method: "POST", body });
  const redir = resp.headers.get("location");
  if (!redir || redir.includes("login")) {
    const html = await resp.text();
    if (/Invalid login|Datos incorrectos/i.test(html)) throw new Error("Credenciales rechazadas por el campus");
  }
  if (redir) await fetchCampus(redir);
  loggedAt = Date.now();
  console.log(`[sesión] conectado como ${cfg.username}`);
}

function sesionValida() { return jar.size > 0 && Date.now() - loggedAt < 50 * 60 * 1000; }
async function asegurarSesion() { if (!sesionValida()) await login(); }

// ── Parser del calendario mensual ────────────────────────────────────────────
const LIMPIEZA_NOMBRE = [
  /^Vencimiento de[:\s]+/i, /^Vencimiento[:\s]+/i, /^Cierre de[:\s]+/i,
  /^\s*fecha l[íi]mite para env[íi]os?$/i, /^\s*fecha l[íi]mite de entrega:?$/i,
];

function limpiarNombre(titulo) {
  let s = decodeEntities(titulo).trim();
  for (let i = 0; i < 2; i++) for (const re of LIMPIEZA_NOMBRE) s = s.replace(re, "").trim();
  return s || titulo;
}

function parsearMaterias(html) {
  return [...html.matchAll(/<option[^>]*value="(\d+)"[^>]*>([^<]+)<\/option>/g)]
    .map(m => ({ id: m[1], nombre: decodeEntities(m[2].replace(/\s+/g, " ").trim()) }))
    .filter(o => o.id !== "1" && o.nombre);
}

function parsearCalendario(html, year, month) {
  const eventos = [];
  const dias = [...html.matchAll(/<td[^>]*data-region="day"[^>]*>([\s\S]*?)<\/td>/g)];
  for (const [, td] of dias) {
    const dia = Number((td.match(/data-day="(\d+)"/) ?? [])[1]);
    if (!dia) continue;
    for (const m of td.matchAll(/<li([^>]*data-region="event-item"[^>]*)>([\s\S]*?)<\/li>/g)) {
      const liAttrs = m[1], li = m[2];
      const component = (liAttrs.match(/data-event-component="([^"]*)"/) ?? [])[1] ?? "";
      const eventtype = (liAttrs.match(/data-event-eventtype="([^"]*)"/) ?? [])[1] ?? "";
      const href = (li.match(/href="([^"]*)"/) ?? [])[1];
      const title = (li.match(/title="([^"]*)"/) ?? [])[1] ?? "";
      if (!href) continue;
      const cmid = Number((href.match(/[?&]id=(\d+)/) ?? [])[1]);
      eventos.push({
        id: `ev-${cmid}-${eventtype}`,
        cmid,
        component,                       // mod_assign | mod_workshop | mod_quiz | …
        tipo: eventtype,                 // due | closesubmission | …
        day: dia,
        year, month,
        url: href,
        titulo: decodeEntities(title),
        actividad: component === "mod_assign" ? "Tarea" :
                   component === "mod_workshop" ? "Taller" :
                   component === "mod_quiz" ? "Cuestionario" : "Actividad",
        fecha: `${year}-${String(month).padStart(2, "0")}-${String(dia).padStart(2, "0")}`,
      });
  }
  }
  return eventos;
}

// ── Parser del estado de entregas (página de cada actividad) ─────────────────
function parsearCursoDe(html) {
  const curso = html.match(/<a[^>]*href="[^"]*course\/view\.php\?id=\d+"[^>]*>\s*([^<]+?)\s*<\/a>/);
  if (curso) return decodeEntities(curso[1]);
  const bc = [...html.matchAll(/<li class="breadcrumb-item">[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/g)];
  return bc.length ? decodeEntities(bc[bc.length - 1][1]) : null;
}

function parsearEstadoAsign(html) {
  const estado = { curso: null, enviado: false, calificada: false, nota: null, tarde: false, freno: null };
  estado.curso = parsearCursoDe(html);
  const fila = (etiqueta) => {
    const re = new RegExp(`<th[^>]*>\\s*${etiqueta}\\s*</th>\\s*<td[^>]*>\\s*(?:<[^>]*>\\s*)*([\\s\\S]*?)</td>`, "i");
    return (html.match(re) ?? [])[1] ?? "";
  };
  const entrega = (html.match(/<th[^>]*>\s*Estado de la entrega\s*<\/th>\s*<td\s+class="([^"]*)"/i) ?? [])[1] ?? "";
  estado.enviado = /submitted/i.test(entrega);
  const califTd = (html.match(/<th[^>]*>\s*Estado de la calificación\s*<\/th>\s*<td\s+class="([^"]*)"[^>]*>([\s\S]*?)<\/td>/i) ?? []);
  if (califTd[1] && !/notgraded|notgradedlater/i.test(califTd[1]) && !/sin calificar|not[\s]*graded|not yet/i.test(califTd[2])) estado.calificada = true;
  if (/Calificada|Graduad|Graded/i.test(califTd[2] ?? "")) estado.calificada = true;
  const notaCrud = fila("Calificación").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (notaCrud) estado.nota = notaCrud.split(/[-–/,·]/)[0].trim().slice(0, 24);
  const tiempo = fila("Tiempo restante");
  if (tiempo && /despu[ée]s de la fecha (l[íi]mite|de vencimiento)|after the due date|late/i.test(tiempo) && !/calificaci[oó]n \w+ despu/i.test(tiempo)) {
    estado.tarde = true;
    estado.freno = decodeEntities(tiempo).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  }
  return estado;
}

function estadoDe(e, det) {
  const hoy = new Date();
  const due = new Date(e.year, e.month - 1, e.day, 23, 59, 59);
  const pasado = due < hoy;

  if (e.component !== "mod_assign") {
    // Taller / quiz / otros: el campus no expone estado estable aquí → por fecha
    return { estado: pasado ? "vencida" : "pendiente", sinEstadoExacto: true };
  }
  if (!det) return { estado: pasado ? "vencida" : "pendiente" };
  let est;
  if (det.calificada) est = "calificada";
  else if (det.enviado) est = "enviada";
  else if (pasado) est = "vencida";
  else est = "pendiente";
  return { estado: est, note: det.tarde ? "Entregada después de la fecha límite" : undefined };
}

// ── Caché de estados ─────────────────────────────────────────────────────────
let cacheEstado = {};
try { cacheEstado = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")); } catch {}
const guardarCache = () => fs.writeFileSync(CACHE_FILE, JSON.stringify(cacheEstado, null, 1));

async function consultarEstado(e, forzar = false) {
  const k = String(e.cmid);
  const c = cacheEstado[k];
  if (!forzar && c && Date.now() - c.ts < TTL_ESTADO) return c;
  const res = await fetchCampus(e.url);
  const html = res.status === 200 ? await res.text() : "";
  const guardar = html && !/login\/index\.php/.test(html.slice(0, 4000));
  if (!guardar) { if (c) return c; throw new Error(`actividad ${e.cmid} no accesible`); }
  let det;
  if (e.component === "mod_assign") {
    det = parsearEstadoAsign(html);
  } else {
    // Taller / quiz / otro: solo el curso (el estado exacto no es fiable aquí)
    det = { curso: parsearCursoDe(html) };
  }
  cacheEstado[k] = { ts: Date.now(), det };
  return cacheEstado[k];
}

// Cola de peticiones con límite de concurrencia (no saturar el campus)
async function enParalelo(items, fn, tam = 4) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(tam, items.length) }, async () => {
    while (i < items.length) { const idx = i++; try { out[idx] = await fn(items[idx]); } catch (err) { out[idx] = null; console.error("[fila]", err.message); } }
  });
  await Promise.all(workers);
  return out;
}

// ── Calendario de un mes (con caché) ─────────────────────────────────────────
const calCache = new Map(); // "y-m" → { ts, eventos }
function fechaVenc(e) { return new Date(e.year, e.month - 1, e.day, 23, 59, 59); }
async function calendarioMes(year, month, forzar = false) {
  const k = `${year}-${month}`;
  let cal = calCache.get(k);
  if (!forzar && cal && Date.now() - cal.ts < TTL_CALENDARIO) return { eventos: cal.eventos, materias: cal.materias };
  await asegurarSesion();
  const res = await fetchCampus(`${BASE}/calendar/view.php?view=month&year=${year}&month=${month}`);
  if (res.status !== 200) { await login(); return calendarioMes(year, month, true); }
  const html = await res.text();
  if (/name="logintoken"|id="login"/i.test(html.slice(0, 6000))) { await login(); return calendarioMes(year, month, true); }
  const eventos = parsearCalendario(html, year, month);
  const materias = parsearMaterias(html);
  calCache.set(k, { ts: Date.now(), eventos, materias });
  return { eventos, materias };
}

// Aplica estados a los eventos: desde caché, y opcionalmente consultando en el
// campus solo las tareas que faltan (resolver) o todas (forzarEstado).
async function aplicarEstados(eventos, { resolver = false, forzarEstado = false } = {}) {
  const faltantes = eventos.filter(e => !cacheEstado[String(e.cmid)] || forzarEstado);
  if (resolver && faltantes.length) {
    await enParalelo(faltantes, (e) => consultarEstado(e, forzarEstado), 8);
    guardarCache();
  }
  for (const e of eventos) {
    const cached = cacheEstado[String(e.cmid)];
    const det = cached ? cached.det : null;
    if (det) {
      if (det.curso) e.curso = det.curso;
      e.nota = det.nota; e.tarde = det.tarde;
      e.enviado = det.enviado; e.califOk = det.calificada;
    }
    const st = estadoDe(e, det);
    e.estado = st.estado;
    e.sinEstadoExacto = !det || (e.component !== "mod_assign");
  }
  return eventos;
}

// ── Servidor HTTP ────────────────────────────────────────────────────────────
const PUBLICO = path.join(__dirname, "public");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };

const LOGIN_HTML = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Iniciar sesión — Calendario UG</title>
<style>
:root{--azul:#1a5fb4;--bg:#f4f6fb;--card:#fff;--borde:#d9dde6;--texto:#1f2328;--muted:#5b6472;--vencida:#c0392b;}
*{box-sizing:border-box}
body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:var(--bg);color:var(--texto);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.card{background:var(--card);border:1px solid var(--borde);border-radius:14px;padding:32px 28px;width:100%;max-width:360px;box-shadow:0 8px 24px rgba(0,0,0,.06)}
h1{margin:0 0 6px;font-size:1.3rem}
p{margin:0 0 20px;color:var(--muted);font-size:.9rem}
label{display:block;font-size:.85rem;font-weight:600;margin:12px 0 4px}
input{width:100%;padding:10px 12px;border:1px solid var(--borde);border-radius:8px;font-size:1rem}
button{margin-top:18px;width:100%;padding:11px;border:0;border-radius:8px;background:var(--azul);color:#fff;font-size:1rem;font-weight:600;cursor:pointer}
button:hover{filter:brightness(1.05)}
.err{color:var(--vencida);font-size:.85rem;margin-top:10px;display:none}
.err.show{display:block}
.foot{margin-top:16px;text-align:center;font-size:.75rem;color:var(--muted)}
</style>
</head>
<body>
<form class="card" method="post" action="/login">
  <h1>📅 Calendario UG</h1>
  <p>Inicia sesión para ver tu calendario académico.</p>
  <label for="u">Usuario</label>
  <input id="u" name="user" autocomplete="username" required>
  <label for="p">Contraseña</label>
  <input id="p" name="pass" type="password" autocomplete="current-password" required>
  <button type="submit">Entrar</button>
  <div class="err" id="err">Usuario o contraseña incorrectos.</div>
  <div class="foot">Campus Virtual · U. Guayaquil</div>
</form>
<script>
if (location.search.includes("error=1")) document.getElementById("err").classList.add("show");
</script>
</body>
</html>`;

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  try {
    // --- Login / logout ---
    if (u.pathname === "/login") {
      if (req.method === "GET") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(LOGIN_HTML);
        return;
      }
      if (req.method === "POST") {
        const body = await leerBody(req);
        const params = new URLSearchParams(body);
        if (params.get("user") === APP_USER && params.get("pass") === APP_PASS) {
          const sid = nuevoSid();
          sesiones.add(sid);
          res.writeHead(302, {
            "Set-Cookie": `sid=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`,
            "Location": "/",
          });
        } else {
          res.writeHead(302, { "Location": "/login?error=1" });
        }
        res.end();
        return;
      }
    }
    if (u.pathname === "/logout") {
      const sid = parseCookies(req).sid;
      if (sid) sesiones.delete(sid);
      res.writeHead(302, {
        "Set-Cookie": "sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
        "Location": "/login",
      });
      res.end();
      return;
    }
    // --- Guardia de autenticación ---
    if (!autenticado(req)) {
      if (u.pathname.startsWith("/api/")) {
        res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "No autenticado" }));
        return;
      }
      res.writeHead(302, { "Location": "/login" });
      res.end();
      return;
    }
    if (u.pathname === "/api/calendario" || u.pathname === "/api/estados" || u.pathname === "/api/refrescar") {
      const y = Number(u.searchParams.get("year")) || new Date().getFullYear();
      const m = Number(u.searchParams.get("month")) || new Date().getMonth() + 1;
      // /api/calendario  → solo el calendario + estados ya cacheados (rápido)
      // /api/estados     → consulta el campus solo lo que falta (1.ª vez: lento)
      // /api/refrescar   → recalcula todo el mes y re-verifica cada tarea
      const cal = await calendarioMes(y, m, u.pathname === "/api/refrescar");
      await aplicarEstados(cal.eventos, {
        resolver: u.pathname !== "/api/calendario",
        forzarEstado: u.pathname === "/api/refrescar",
      });
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ eventos: cal.eventos, materias: cal.materias, generadosEn: Date.now() }));
      return;
    }
    let file = u.pathname === "/" ? "/index.html" : u.pathname;
    file = file.replace(/\.\./g, "");
    const abs = path.join(PUBLICO, file);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      res.writeHead(200, { "Content-Type": MIME[path.extname(abs)] ?? "application/octet-stream", "Cache-Control": "no-store" });
      res.end(fs.readFileSync(abs));
      return;
    }
    res.writeHead(404); res.end("No encontrado");
  } catch (err) {
    console.error("[http]", err);
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: err.message }));
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`\n╔══════════════════════════════════════════════╗`);
  console.log(`║  Calendario UG → puerto ${PORT}                ║`);
  console.log(`╚══════════════════════════════════════════════╝`);
});
