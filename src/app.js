const path = require('path');
const express = require('express');
const cors = require('cors');
const { router, RechazoLocal } = require('./api');
const { ErrorBanco } = require('./banco');

const app = express();

// Vercel sirve la app detrás de un proxy HTTPS
app.set('trust proxy', 1);

// CORS apagado por defecto (la interfaz se sirve desde este mismo servidor).
// Para permitir otro origen: CORS_ORIGIN=https://otro-dominio.com
app.use(cors({ origin: process.env.CORS_ORIGIN || false, credentials: true }));
app.use(express.json({ limit: '10kb' }));

app.get('/api/salud', (req, res) => res.json({ ok: true }));
app.use('/api', router);
app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }));

// Interfaz: en local la sirve Express; en Vercel la sirve su CDN desde public/
app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

app.use((err, req, res, next) => {
  if (err instanceof RechazoLocal) {
    return res.status(err.status).json({ error: err.message, rechazado_por: 'cajero', pasos: err.pasos });
  }
  if (err instanceof ErrorBanco) {
    return res.status(err.status).json({ error: err.message, codigo: err.codigo, rechazado_por: 'banco' });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'El cuerpo de la petición no es JSON válido.' });
  }

  console.error(err);
  res.status(500).json({ error: 'Error interno del cajero.' });
});

module.exports = app;
