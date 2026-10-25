# PORTal: ports nativos de PS4 a PC

Directorio de los ports **nativos y no oficiales** de juegos de PS4 a PC que están apareciendo en GitHub
(Bloodborne, God of War III, Uncharted, Shadow of the Colossus, inFAMOUS, Driveclub, P.T., CTR…).
Muestra para cada juego **todos los ports que existen** y para cada port:

- **Estado**: completo / jugable / parcial / temprano / no jugable
- **Rendimiento** reportado (FPS, resolución y hardware)
- **Fallos conocidos**
- Plataformas, versión del juego requerida (CUSA), en qué proyecto se basa
- Métricas en vivo: estrellas, commits de la semana, última release y si el repo fue **eliminado** (DMCA)
- **Reportes de la comunidad** enviados desde un formulario

Además tiene un **Radar** que encuentra solo los ports nuevos.

## Cómo funciona

```
data/catalog.json      ← curado a mano: juegos, ports, estado, rendimiento, fallos
data/github.json       ← automático: métricas de cada repo del catálogo
data/candidates.json   ← automático: radar de repos nuevos detectados
data/reports.json      ← automático: reportes de rendimiento (issues con label "reporte")
data/ignore.json       ← repos que el radar no debe volver a proponer
```

`scripts/update.mjs` corre en GitHub Actions **cada 6 horas** (`.github/workflows/site.yml`):

1. **Refresca** cada repo del catálogo con la API de GitHub. Si un repo desaparece, lo marca como eliminado y conserva los últimos datos.
2. **Radar**: hace ~16 búsquedas en GitHub (`"pc port" ps4`, `CUSA vulkan port`, `bbport`, `gow3_pc`, `SacredFire`, topics `pc-port`+`ps4`…)
   y revisa los forks nuevos de los proyectos base (bbport, SpartanPort…). A cada repo le lee el README y lo clasifica (`scripts/lib.mjs`):
   - suma puntos por: PS4/CUSA, "native", "PC port", "bring your own dump", runtimes conocidos, Vulkan…
   - descarta: **spam/piratería** (torrent, t.me, repack…), **homebrew hacia PS4** (GoldHEN, OpenOrbis), **herramientas** (launchers, wikis, traducciones) y otras consolas.
   - extrae CUSA, plataformas, cifras de FPS y una pista de estado ("playable", "start to finish"…), y adivina el juego.
3. Cuando aparecen candidatos nuevos **abre un issue** "Radar: N ports nuevos" para revisarlos. Confirmar uno = moverlo a `catalog.json`.
4. Lee los issues con label `reporte` (formulario `.github/ISSUE_TEMPLATE/reporte.yml`) y los muestra en la ficha del port.
5. **Detecta actualizaciones importantes** (`analyzeRelease` en `scripts/lib.mjs`): lee las notas de cada release nueva
   (en inglés, español o portugués) y la marca como **grande** si trae mejoras de FPS ("+25% FPS", "30 → 60 fps", "+FPS"),
   3 o más funciones nuevas (FSR 4, DLSS, frame generation, online, ultrawide…; solo cuentan las que no estaban en la release anterior),
   un hito ("start to finish", "de principio a fin") o un salto de versión con novedades. También avisa si un repo desaparece.
   Todo queda en `data/updates.json` y en el feed `data/feed.xml`.
6. **Avisos**: comenta en el issue "seguir" de cada port (formulario `seguir.yml`, botón 🔔 Avisarme en la ficha) y en el issue
   global con label `avisos`. Quien esté suscripto recibe mail y notificación en la app de GitHub.
7. Hace commit de `data/` y publica el sitio en la rama `gh-pages` (GitHub Pages).

### Favoritos y notificaciones

- **★ Favorito** en la ficha de cada port: se guarda en tu navegador. Hay un filtro "Mis favoritos" y la campana 🔔
  del encabezado cuenta las novedades grandes de tus favoritos desde tu última visita.
- **🔔 Avisarme**: abre (o crea) el issue de seguimiento de ese port en GitHub → mail + push en la app de GitHub.
- **Todas las novedades**: suscribirse al issue `avisos`.
- **Notificación del navegador**: se activa en la pestaña Novedades; avisa al abrir el sitio.
- **RSS/Atom**: `https://isidropenh.github.io/PORTal/data/feed.xml`.

El sitio es HTML/CSS/JS estático, sin dependencias ni build (`index.html`, `assets/`).

## Publicación

Ya está andando: el sitio se publica en **https://isidropenh.github.io/PORTal/** desde la rama `gh-pages`,
que el workflow regenera en cada actualización. No hace falta tocar Settings.
Para forzar una actualización: **Actions → "Actualizar y publicar" → Run workflow**.

## Desarrollo local

```bash
python3 -m http.server 8000          # abrir http://localhost:8000
node scripts/test.mjs                # tests del clasificador y del catálogo
GITHUB_TOKEN=$(gh auth token) node scripts/update.mjs   # refrescar datos a mano
```

## Agregar o corregir un port

Editar `data/catalog.json`. Campos de cada port:

| campo | valores |
|---|---|
| `type` | `native` (x86-64 original + runtime), `recomp` (recompilación estática), `decomp`, `reimpl` (motor reescrito), `wrapper` (fork de emulador) |
| `status` | `complete`, `playable`, `partial`, `early`, `research` |
| `platforms` | `windows`, `linux`, `macos` |
| `performance`, `issues`, `features` | listas de texto |

`node scripts/test.mjs` valida el catálogo.

## Aviso

Solo se enlaza a código fuente. Ningún proyecto listado incluye archivos de juego ni firmware; todos requieren un dump de tu propia copia.
No se aceptan enlaces a descargas de juegos.
