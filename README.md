# 📅 Calendario académico — Campus Virtual UG

Tablero que conecta con el **Campus Virtual de la Universidad de Guayaquil** (Moodle)
y muestra tus fechas límite con su **estado real**:

| Estado | Significado |
|---|---|
| 🟡 **Pendiente** | La tarea aún no se entrega y no venció |
| 🟢 **Enviada** | Entregada en el campus (muestra ⚠️ si fue fuera de plazo) |
| 🔵 **Calificada** | El docente ya subió la nota (visible en el detalle del día) |
| 🔴 **Vencida** | No fue entregada y la fecha límite ya pasó |

## Cómo usarlo

```bash
node server.mjs
```

y abrir **http://localhost:3210** en el navegador. La primera vez te pedirá
iniciar sesión con tu usuario y contraseña del campus (los mismos de
`config.json`); la sesión dura 24 h. (Debe quedar corriendo; al cerrar la
ventana, vuelve a ejecutar ese comando.)

## Funciones

- Calendario mensual navegable (◀ ▶ / botón «Hoy»), con el día actual resaltado.
- **Botón 📋 Lista**: abre un panel lateral derecho con todas las actividades
  agrupadas por estado — **Pendientes, Atrasadas (entregadas fuera de plazo),
  Enviadas, Calificadas (con nota) y Vencidas** — ordenadas por fecha.
  Clic en cualquier elemento abre la actividad en el campus; ✕ cierra el panel.
- **Pestañas de vista** (encima del calendario): los **botones por estado**
  (Pendientes / Atrasadas / Enviadas / Calificadas / Vencidas) y **por curso**
  abren cada uno su **propia pestaña**, donde las tareas aparecen en lista
  (ordenadas por fecha, con su etiqueta de estado y nota). Puedes tener
  varias abiertas, cambiar entre ellas y cerrarlas con ✕.
- **Clic en cualquier tarea** (en el calendario, en una pestaña de vista, en
  el detalle del día o en la lista lateral) la abre en una **ventana nueva
  del navegador**, directamente en el campus. Si tu navegador bloquea
  ventanas emergentes, se abre como pestaña.
- Botón ⟳ **Actualizar**: re-consulta el campus (úsalo tras entregar o calificar algo).
- Carga en dos etapas: el calendario aparece al instante (5 s aprox.) y los
  estados de cada tarea se consultan en el campus en segundo plano
  («⏳ consultando estados…»). Solo la primera vez toma ~40 s; después todo
  sale del caché y es instantáneo.
- Caché local: `cache-estado.json` guarda los estados 6 h y el calendario 30 min,
  para no saturar el campus con recargas innecesarias.

## Datos

- `config.json` contiene tu usuario y contraseña del campus.
  ⚠️ **No compartas ese archivo** ni lo subas a ninguna parte (Git, WhatsApp…).
- El estado gốc se lee de la página de cada tarea de Moodle. Para
  **talleres y cuestionarios** el campus no expone estado estable, así que se marca
  solo por fecha (pendiente/vencida); su estado exacto se ve directamente en el campus.

## Subir a un servidor (Render, Railway, Fly…)

El proyecto no tiene dependencias: basta con Node ≥ 20.

1. Sube la carpeta `Universidad/` a un repositorio Git (el `.gitignore` ya
   evita subir `config.json` ni el caché).
2. En Render: **New → Web Service → conecta el repo**.
   - Build command: *(vacío)*
   - Start command: `node server.mjs`
3. En **Environment**, crea estas variables (sin `config.json`):
   - `CAMPUS_URL` = `https://campusvirtual2.ug.edu.ec`
   - `CAMPUS_USER` = tu usuario del campus
   - `CAMPUS_PASS` = tu contraseña
   - `APP_USER` / `APP_PASS` = credenciales del tablero (opcional; por defecto
     son las del campus)
   - Render asigna `PORT` automáticamente; el servidor la usa.
4. Primer arranque: la primera carga tarda ~40 s (consulta el campus).
   Después sale del caché.

⚠️ **Seguridad**: el tablero no tiene login propio — quien tenga la URL ve tus
tareas. Si lo subes a un host público, avísame y le añado una clave de acceso
(`ACCESO=...` en las variables de entorno) para protegerlo.

```
Universidad/
├─ server.mjs         ← servidor Node (sin dependencias) + conexión al campus
├─ config.json        ← URL + credenciales (privado)
├─ cache-estado.json  ← caché de estados (se genera solo)
└─ public/index.html  ← tablero (calendario, filtros, detalle)
```
