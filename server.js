// Arranque local (en Vercel se usa api/index.js)
require('dotenv').config({ quiet: true });

const app = require('./src/app');

const puerto = process.env.PORT || 3001;

app.listen(puerto, () => {
  console.log(`Cajero escuchando en http://localhost:${puerto}  (panel: /admin)`);
});
