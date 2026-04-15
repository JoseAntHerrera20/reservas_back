// 1. Cargar variables de entorno desde .env (DEBE SER LA PRIMERA LÍNEA)
require('dotenv').config();

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

// --- Importación de Servicios ---
// Asegúrate de tener los archivos paymentService.js y emailService.js en src/services/
const { processPayment } = require('./src/services/paymentService');
const { sendConfirmationEmail } = require('./src/services/emailService');

// Ajuste de rutas a src/data
const usuariosPath = path.join(__dirname, 'src', 'data', 'usuarios.json');
const geojsonPath = path.join(__dirname, 'src', 'data', 'map.geojson');
const reservasPath = path.join(__dirname, 'src', 'data', 'reservas.json');

// --- Funciones de Utilidad ---

function cargarUsuarios() {
  try {
    return JSON.parse(fs.readFileSync(usuariosPath, 'utf8'));
  } catch {
    return [];
  }
}

function guardarUsuarios(lista) {
  fs.writeFileSync(usuariosPath, JSON.stringify(lista, null, 2));
}

// Cargar GeoJSON
let geojsonData;
try {
  const jsonString = fs.readFileSync(geojsonPath, 'utf8');
  geojsonData = JSON.parse(jsonString);
} catch (err) {
  console.error('❌ Error leyendo archivo GeoJSON:', err);
  geojsonData = { type: "FeatureCollection", features: [] };
}

// Cargar reservas desde archivo
let reservas = [];
try {
  if (fs.existsSync(reservasPath)) {
    const reservasData = fs.readFileSync(reservasPath, 'utf8');
    reservas = JSON.parse(reservasData);
  }
} catch (err) {
  console.error('❌ Error leyendo archivo de reservas:', err);
  reservas = [];
}

// Función para guardar reservas en archivo
function guardarReservasEnArchivo() {
  fs.writeFile(reservasPath, JSON.stringify(reservas, null, 2), err => {
    if (err) {
      console.error('❌ Error guardando reservas:', err);
    }
  });
}

// --- Configuración de Express ---

const app = express();
app.use(cors());
app.use(express.json()); // NECESARIO para leer el body en POST

// --- Endpoints de Mapa y Reservas ---

// Endpoint: obtener GeoJSON con estados actualizados según reservas
app.get('/api/mapa', (req, res) => {
  const geojsonActualizado = JSON.parse(JSON.stringify(geojsonData));

  geojsonActualizado.features.forEach(feature => {
    const nombre = feature.properties.nombre;

    // Normalizar los estados a objeto si es necesario
    if (!feature.properties.estado || typeof feature.properties.estado !== 'object') {
      const estadoAnterior = feature.properties.estado;
      feature.properties.estado = {
        AM: estadoAnterior || 'disponible',
        PM: estadoAnterior || 'disponible',
        Completo: estadoAnterior || 'disponible'
      };
    }

    // Marcar como 'reservado' en el horario correspondiente
    reservas.forEach(r => {
      if (r.nombre === nombre && feature.properties.estado[r.horario]) {
        feature.properties.estado[r.horario] = 'reservado';
      }
    });
  });

  res.json(geojsonActualizado);
});

// Obtener todas las reservas
app.get('/api/reservas', (req, res) => {
  // Filtrar y mapear la lista de reservas
  const reservasConPrecio = reservas.map(r => ({
    nombre: r.nombre,
    horario: r.horario,
    usuario: r.usuario,
    precio: parseFloat(r.precio) || 0, // Asegura que el precio sea numérico
    fecha: r.fecha
  }));
  res.json(reservasConPrecio);
});

// Crear reserva (Asegura que el precio se guarda)
app.post('/api/reservas', (req, res) => {
  const { nombre, usuario, horario } = req.body;
  const precio = parseFloat(req.body.precio) || 0; // Se extrae el precio

  if (!nombre || !usuario || !horario) {
    return res.status(400).json({ error: "Faltan datos: nombre, usuario y horario son requeridos" });
  }

  const yaReservado = reservas.find(r => r.nombre === nombre && r.horario === horario);
  if (yaReservado) {
    return res.status(409).json({ error: `El espacio ya está reservado en horario ${horario}` });
  }

  const espacio = geojsonData.features.find(f => f.properties.nombre === nombre);
  if (!espacio) {
    return res.status(404).json({ error: "Espacio no encontrado" });
  }

  if (espacio.properties.estado && typeof espacio.properties.estado === 'object') {
    if (espacio.properties.estado[horario] === 'bloqueado') {
      return res.status(403).json({ error: "Espacio bloqueado en ese horario" });
    }
  } else if (espacio.properties.estado === 'bloqueado') {
    return res.status(403).json({ error: "Espacio bloqueado" });
  }

  const nuevaReserva = {
    nombre,
    usuario,
    horario,
    precio, // PRECIO AÑADIDO
    fecha: new Date().toISOString()
  };

  reservas.push(nuevaReserva);
  guardarReservasEnArchivo();

  res.status(201).json({ mensaje: `Reserva creada para ${nombre} (${horario})`, reserva: nuevaReserva });
});

// NUEVO ENDPOINT: PAGO REAL Y CONFIRMACIÓN POR CORREO (Async)
app.post('/api/reservas/pagar', async (req, res) => {
    const { nombre, horario, usuario, precio } = req.body;

    // Normalizar los valores clave a minúsculas para asegurar la coincidencia
    const nombreLower = nombre.toLowerCase();
    const horarioLower = horario.toLowerCase();
    const usuarioLower = usuario.toLowerCase();
    
    try {
        // 1. Procesa el pago (Simulación de PayPal)
        const paymentResult = await processPayment({ nombre, horario, usuario, precio });

        // 2. Envía el correo de confirmación (Simulación Nodemailer)
        // Nota: El campo usuario debe ser un correo electrónico válido para Nodemailer
        await sendConfirmationEmail(usuario, { 
            nombre, 
            horario, 
            precio, 
            paymentId: paymentResult.transactionId 
        });
    
        // 3. Eliminar la reserva de la lista local (ya que el pago está "confirmado")
        reservas = reservas.filter(r => !(
            r.nombre.toLowerCase() === nombreLower && 
            r.horario.toLowerCase() === horarioLower && 
            r.usuario.toLowerCase() === usuarioLower
        ));
        
        // 4. Guardar el cambio al archivo
        guardarReservasEnArchivo();

        res.json({ 
            message: 'Pago exitoso, la reserva ha sido confirmada y el correo de confirmación ha sido enviado.',
            transactionId: paymentResult.transactionId 
        });

    } catch (error) {
        console.error('❌ Error en el proceso de pago/confirmación:', error);
        // Responde con un error 500 si falla el pago o el envío de correo.
        // El error.message contendrá el mensaje de fallo de la simulación de PayPal si ocurre.
        return res.status(500).json({ 
            error: 'Error al procesar el pago o enviar la confirmación.', 
            details: error.message 
        });
    }
});


// Cancelar reserva
app.delete('/api/reservas/:nombre/:horario', (req, res) => {
  const { nombre, horario } = req.params;
  
  // Normalización
  const nombreLower = nombre.toLowerCase();
  const horarioLower = horario.toLowerCase();

  const index = reservas.findIndex(r => 
    r.nombre.toLowerCase() === nombreLower && r.horario.toLowerCase() === horarioLower
  );

  if (index === -1) {
    return res.status(404).json({ error: "Reserva no encontrada para ese horario" });
  }

  reservas.splice(index, 1);
  guardarReservasEnArchivo();

  res.json({ mensaje: `Reserva para ${nombre} (${horario}) cancelada` });
});

// --- Endpoints de Autenticación ---

// Registro
app.post('/api/register', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email y contraseña son requeridos' });

  const usuarios = cargarUsuarios();
  const yaExiste = usuarios.find(u => u.email === email);
  if (yaExiste) return res.status(409).json({ error: 'Ya existe un usuario con ese email' });

  const hashed = bcrypt.hashSync(password, 10);
  usuarios.push({ email, password: hashed });
  guardarUsuarios(usuarios);

  res.status(201).json({ mensaje: 'Usuario registrado correctamente' });
});

// Login
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  const usuarios = cargarUsuarios();
  const user = usuarios.find(u => u.email === email);

  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Credenciales inválidas' });
  }

  const token = jwt.sign({ email }, 'secreto_super_seguro', { expiresIn: '2h' });
  res.json({ token });
});

// --- Puerto de Escucha ---

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Backend corriendo en http://localhost:${PORT}`);
});
