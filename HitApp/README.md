# HIT — Entrena en Casa 🏠💪

App de entrenamiento en casa con rutinas diarias únicas generadas por IA.

## Estructura del proyecto

```
hit-app/
├── api/
│   └── workout.js        ← Backend Vercel (protege la API key)
├── public/
│   ├── index.html        ← App principal
│   ├── manifest.json     ← Config PWA
│   └── sw.js             ← Service Worker
└── vercel.json           ← Config Vercel
```

## Deploy en Vercel

1. Sube esta carpeta a un repositorio de GitHub
2. Ve a [vercel.com](https://vercel.com) → New Project → importa el repo
3. En **Environment Variables** agrega:
   - `ANTHROPIC_API_KEY` = tu API key de Anthropic
4. Deploy ✅

## Instalar como app en el teléfono

Una vez publicada en Vercel:
- **iPhone**: Safari → botón compartir → "Agregar a pantalla de inicio"
- **Android**: Chrome → menú ⋮ → "Instalar app"
