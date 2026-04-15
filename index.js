const express = require('express');
const cors = require('cors');
const fs = require('fs');
const app = express();

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Ruta para obtener las zonas del mapa
app.get('/api/mapa', (req, res) => {
  fs.readFile('./map.geojson', 'utf8', (err, data) => {
    if (err) return res.status(500).send('Error leyendo el archivo GeoJSON');
    res.json(JSON.parse(data));
  });
});

// Ruta para obtener reservas
app.get('/api/reservas', (req, res) => {
  fs.readFile('./reservas.json', 'utf8', (err, data) => {
    if (err) return res.status(500).send('Error leyendo reservas');
    res.json(JSON.parse(data));
  });
});

// Ruta para guardar una reserva nueva
app.post('/api/reservas', (req, res) => {
  const nuevaReserva = req.body;

  fs.readFile('./reservas.json', 'utf8', (err, data) => {
    if (err) return res.status(500).send('Error leyendo reservas');

    const reservas = JSON.parse(data);
    reservas.push(nuevaReserva);

    fs.writeFile('./reservas.json', JSON.stringify(reservas, null, 2), (err) => {
      if (err) return res.status(500).send('Error guardando reserva');
      res.status(201).json(nuevaReserva);
    });
  });
});

app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});
