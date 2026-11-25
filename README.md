# 📅 Calendario académico — Campus Virtual UG

Tablero que conecta con el **Campus Virtual de la Universidad de Guayaquil** (Moodle)
y muestra tus fechas límite con su **estado real**:

| Estado | Significado |
|---|---|
| 🟡 **Pendiente** | La tarea aún no se entrega y no venció |
| 🟢 **Enviada** | Entregada en el campus (muestra ⚠️ si fue fuera de plazo) |
| 🔵 **Calificada** | El docente ya subió la nota (visible en el detalle del día) |
| 🔴 **No enviada** | No fue entregada y la fecha límite ya pasó |

## Verlo dentro del Campus Virtual (sin iniciar sesión otra vez)

Si ya estás logueado en el campus, puedes mostrar el tablero **dentro de la
propia página del campus** con el userscript `calendario-ug.user.js`:

1. Instala **Tampermonkey** en tu navegador (extensión gratuita).
2. Abre el panel de Tampermonkey → **Crear un script nuevo**.
3. Borra todo el contenido y pega el archivo `calendario-ug.user.js` completo.
4. Guarda (Ctrl+S) y abre el campus. Aparecerá un panel **📅 Calendario UG** arriba a la derecha.

El script corre en tu navegador con tu sesión actual: **no pide usuario ni
contraseña**, no modifica el sitio de la UG y no guarda credenciales. Lee el
mismo calendario y las mismas páginas de tareas que tu navegador ya descarga.
Tiene filtros por estado/curso, navegación de mes y se actualiza solo cada 10 min.

## Cómo usarlo

```bash
node server.mjs
```

y abrir **http://localhost:3210** en el navegador. La primera vez te pedirá
iniciar sesión con tu **usuario y contraseña del campus** (los mismos que
usas en el Campus Virtual). La sesión dura 24 h. (Debe quedar corriendo;
al cerrar la ventana, vuelve a ejecutar ese comando.)

No necesitas `config.json` ni variables de entorno: las credenciales se
piden al iniciar sesión y no se guardan en ningún archivo.

## Funciones

- Calendario mensual navegable (◀ ▶ / botón «Hoy»), con el día actual resaltado.
- **Pestañas de vista** (encima del calendario): los **botones por estado**
  (Pendientes / Atrasadas / Enviadas / Calificadas / No enviadas), **por curso**
  y **Foros / Talleres** (actividades que el campus no expone con estado fiable:
  se marcan como «Revisar en el campus») abren cada uno su **propia pestaña**,
  donde las tareas aparecen en lista (ordenadas por fecha, con su etiqueta de
  estado y nota). Puedes tener varias abiertas, cambiar entre ellas y
  cerrarlas con ✕.
- **Clic en cualquier tarea** (en el calendario, en una pestaña de vista, en
  el detalle del día) la abre en una **pestaña nueva del navegador**,
  directamente en el campus.
- **Actualización automática**: el tablero vuelve a consultar el campus cada
  **5 minutos** (y al volver a la pestaña si pasaron más de 2), sin borrar lo
  que ya se ve. El botón ⟳ **Actualizar** sigue sirviendo para forzar la
  re-consulta al instante tras entregar o calificar algo.
- Carga rápida en dos etapas: el calendario y el estado de las **tareas**
  aparecen en cuanto se consultan (≈8–15 s la primera vez); el resto
  (foros/talleres) se completa en segundo plano («⏳ consultando estados…»).
  Después todo sale del caché y es instantáneo. Las consultas al campus van
  en paralelo para acortar la espera.
- En el calendario, los **foros** se muestran con un color distinto (azul claro)
  y **no se incluyen** en los botones de estado. El programa detecta si ya
  respondiste (según la opción «Darse de baja / Suscribirse» del campus) y
  marca el foro como **Respondido** o **Revisar en el campus**.
  para no saturar el campus con recargas innecesarias. Usa ⟳ **Actualizar** tras
  entregar o calificar algo para forzar la re-consulta inmediata.

## Datos

- No se guardan credenciales en ningún archivo: el login valida tu usuario y
  contraseña directamente contra el campus virtual. Si las credenciales son
  incorrectas, el campus las rechaza y la app no entra.
- **Cada persona tiene su propia sesión**: las cookies del campus, los estados
  consultados y el calendario se guardan por separado para cada usuario que
  inicia sesión. Dos compañeros pueden usar el tablero al mismo tiempo sin ver
  las tareas del otro. El caché vive en memoria y se borra al cerrar la app o al
  volver a entrar.
- El estado se lee de la página de cada tarea de Moodle. Para
  **talleres y cuestionarios** el campus no expone estado estable, así que se marca
  solo por fecha (pendiente/vencida); su estado exacto se ve directamente en el campus.

## Subir a un servidor (Render, Railway, Fly…)

El proyecto no tiene dependencias: basta con Node ≥ 20.

1. Sube la carpeta `Universidad/` a un repositorio Git (el `.gitignore` ya
   evita subir `config.json` ni el caché).
2. En Render: **New → Web Service → conecta el repo**.
   - Build command: *(vacío)*
   - Start command: `node server.mjs`
3. En **Environment**, no hace falta poner credenciales: el login usa tu
   usuario y contraseña del campus directamente. Solo (opcional):
   - `CAMPUS_URL` = `https://campusvirtual2.ug.edu.ec` (valor por defecto)
   - Render asigna `PORT` automáticamente; el servidor la usa.
4. Despliega. La primera carga tarda ~40 s (consulta el campus).

⚠️ **Seguridad**: el login valida tu usuario y contraseña directamente contra
el campus virtual; no se guarda ninguna credencial en el servidor.

```
Universidad/
├─ server.mjs         ← servidor Node (sin dependencias) + conexión al campus
├─ package.json       ← scripts/engines para hosts (Render, etc.)
├─ .gitignore
└─ public/index.html  ← tablero (calendario, filtros, detalle)
```
