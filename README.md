# Tracker de Métricas — Creative OS

App para organizar el testeo de creativos: subir cada anuncio, ver sus métricas
de Meta Ads y dejar que el algoritmo lo categorice como **Ganador**, **Potencial
ganador**, **Bueno**, **Regular** o **Malo**, con análisis a fondo por creativo.

## Instalación

```bash
npm install
npm run dev
```

Abre `http://localhost:5173`. Ya viene con 5 creativos de ejemplo (Berrinches,
Método Hormonal, CalistenIA) para que veas el sistema funcionando de inmediato.

## Estructura del proyecto

```
src/
  types.ts               tipos de datos (Creative, RawMetrics, ScoreResult...)
  lib/
    scoring.ts           el algoritmo: sub-scores, confianza, categoría, fatiga, diagnóstico
    health.ts            clasifica una métrica en saludable / normal / no saludable
    category.ts          colores y etiquetas de cada categoría
  data/mockData.ts        creativos de ejemplo
  components/
    Dashboard.tsx          pantalla principal con filtros y grilla
    CreativeCard.tsx        tarjeta de creativo (miniatura respeta el formato real)
    CreativeDetail.tsx      análisis a fondo de un creativo
    UploadModal.tsx          formulario para cargar un creativo nuevo
```

## Cómo funciona el algoritmo (`src/lib/scoring.ts`)

1. **Sub-scores (0-100)**: Enganche (CTR, hook rate, hold rate), Resultado (ROAS,
   CPA) y Eficiencia (frecuencia, CPM) — cada uno comparado contra el benchmark
   del nicho.
2. **Score compuesto**: promedio ponderado de los tres sub-scores. Los pesos
   están definidos por nicho en `DEFAULT_BENCHMARKS` (dentro de `scoring.ts`) —
   edítalos ahí mismo cuando tengas tus números reales.
3. **Confianza estadística**: baja / media / alta, según el gasto acumulado y
   el número de compras — evita categorizar un creativo como "Ganador" con
   apenas un par de dólares gastados.
4. **Categoría final**: combina score compuesto + confianza.
5. **Detección de fatiga**: compara la primera mitad del historial contra la
   segunda; si la frecuencia sube mientras el CTR cae, marca el creativo como
   "en fatiga".
6. **Diagnóstico a fondo**: reglas que traducen los números en una recomendación
   concreta (ej. "el problema es la oferta, no el creativo").

### Ajustar los umbrales a tus números reales

Abre `src/lib/scoring.ts` y edita `DEFAULT_BENCHMARKS`. Ahí defines, por nicho:
`ctrTarget`, `hookRateTarget`, `holdRateTarget`, `roasTarget`, `cpaTarget` y los
`weights` de cada sub-score. Esto es lo que próximamente conversamos para
afinar con tu historial real de campañas.

## Conectar la API de Meta Ads

La integración con la Graph API de Meta está implementada con Netlify
Functions. **El token de acceso NUNCA se guarda en el cliente** — vive solo
en variables de entorno del servidor.

### 1. Generar el token

1. Ve a **Meta Business Manager → Configuración de negocio → Conexiones → Tokens de acceso**
2. Crea un token con permiso **`ads_read`** (necesita también `ads_management`
   si quieres que la function liste campañas/conjuntos con sus status)
3. Copia el token (largo, empieza con `EAA...`)

> ⚠️ **Importante**: cualquier persona con este token puede ver y operar
> sobre tu cuenta de anuncios. Trátalo como una contraseña. Si lo compartes
> por chat, email o screenshot, rótalo de inmediato.

### 2. Configurar variables de entorno

#### Local (desarrollo)

Crea un archivo `.env` en la raíz (ya está en `.gitignore`):

```bash
cp .env.example .env
# Edita .env y completa:
META_ACCESS_TOKEN=EAAxxxxxxxxxxxxx...

# Genera un secreto random para proteger las Netlify Functions:
#   openssl rand -hex 32
# Pon el mismo valor en ambas variables:
APP_SECRET=<tu-secreto>
VITE_APP_SECRET=<tu-secreto>
```

`netlify-cli` ya está en `devDependencies`, no hace falta instalar nada extra.

#### Producción (Netlify)

1. Entra a **Netlify → tu sitio → Site settings → Environment variables**
2. Agrega `META_ACCESS_TOKEN` = tu token
3. Agrega `APP_SECRET` = el mismo secreto que usas en local
4. Agrega `VITE_APP_SECRET` = el mismo valor que `APP_SECRET`
5. Redeploy

### 3. Desarrollo local: usa `netlify dev`, no `npm run dev`

```bash
netlify dev
```

Esto levanta Vite + las Netlify Functions en `http://localhost:8888`.

> **¿Por qué no `npm run dev`?** El comando `npm run dev` solo ejecuta
> Vite, que sirve la app pero **no las Netlify Functions**. Cualquier
> llamada a `/.netlify/functions/*` devuelve la página 404 de Vite (HTML),
> y el frontend mostrará un error tipo "Unexpected token '<'" o un mensaje
> pidiendo que uses `netlify dev`. Siempre usa `netlify dev` cuando
> trabajes con la integración de Meta.

### 4. Usar la integración

- **Subir un creativo nuevo**: en el modal, elige en cascada **Cuenta →
  Campaña → Conjunto → Anuncio** (cada select se habilita cuando eliges
  el anterior). Al elegir el anuncio final, dale a **"Sincronizar con Meta
  Ads"** y todos los campos se llenan solos.
- **Actualizar un creativo existente**: ábrelo y dale al botón azul
  **"Sincronizar con Meta Ads"** arriba a la derecha.

### Endpoints disponibles

| Función | Método | Descripción |
|---------|--------|-------------|
| `/.netlify/functions/meta-hierarchy?level=accounts` | `GET` | Lista cuentas publicitarias |
| `/.netlify/functions/meta-hierarchy?level=campaigns&parentId={act_X}` | `GET` | Lista campañas activas/pausadas |
| `/.netlify/functions/meta-hierarchy?level=adsets&parentId={campaign_id}` | `GET` | Lista conjuntos de anuncios |
| `/.netlify/functions/meta-hierarchy?level=ads&parentId={adset_id}` | `GET` | Lista anuncios del conjunto |
| `/.netlify/functions/meta-insights` | `POST` | Devuelve métricas normalizadas de un anuncio |

## Guardado de datos

Por ahora los creativos se guardan en `localStorage` del navegador (no se
pierden al recargar, pero sí son locales a ese navegador). El mismo patrón
de GanApp (Google Sheets como backend) se puede aplicar aquí cuando quieras
tener los datos centralizados y accesibles desde varios dispositivos.

## Despliegue

Mismo flujo que GanApp:

```bash
npm run build
```

Y subir la carpeta `dist/` a Netlify (o conectar el repo para auto-deploy).
