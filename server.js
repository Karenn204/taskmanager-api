const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const net = require('net');
const fs = require('fs');

const app = express();
app.use(express.json());

// Inicialización de la BD SQLite
// Jest define NODE_ENV='test': las pruebas usan una BD en memoria y nunca tocan app.db
// En Docker se usa DB_PATH para guardar la BD en un volumen y no perder datos en cada despliegue
const DB_FILE = process.env.NODE_ENV === 'test' ? ':memory:' : (process.env.DB_PATH || 'app.db');
const db = new Database(DB_FILE);

// Configuración y estructura normalizada (1FN, 2FN, 3FN)
db.exec(`
  PRAGMA foreign_keys = ON;
  
  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    completed INTEGER DEFAULT 0 CHECK (completed IN (0, 1)),
    category_id INTEGER,
    FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE SET NULL
  );
`);

// Helper para estandarizar el JSON Schema solicitado: { statusCode: number, data: [] }
const formatResponse = (statusCode, data) => ({
  statusCode,
  data: Array.isArray(data) ? data : [data]
});

// ==========================================
// --- ENDPOINTS  ---

// DEMO DEL PIPELINE: cambia estos valores, haz git push y en menos de un minuto
// http://<IP_EC2>/api/health mostrará el nuevo texto.
const HEALTH_INFO = {
  autor: 'NayeFlores',
  mensaje: 'Probando cambios en el pipeline de CI/CD con GitHub Actions y Docker',
  version: '1.0.0'
};

// 0. GET - Health check (estado del servicio)
app.get('/api/health', (req, res) => {
  res.json(formatResponse(200, {
    status: 'ok',
    ...HEALTH_INFO,
    commit: process.env.GIT_SHA || 'local',
    timestamp: new Date().toISOString()
  }));
});

// GET / - Página de inicio con la lista de endpoints
app.get('/', (req, res) => {
  res.json(formatResponse(200, {
    api: 'TaskManager API',
    endpoints: [
      'GET /api/health',
      'GET /api/categories', 'GET /api/categories/:id', 'POST /api/categories',
      'PUT /api/categories/:id', 'DELETE /api/categories/:id',
      'GET /api/tasks', 'GET /api/tasks/:id', 'POST /api/tasks',
      'PUT /api/tasks/:id', 'PATCH /api/tasks/:id', 'DELETE /api/tasks/:id',
      'GET /api/db/backup', 'DELETE /api/db/clear'
    ]
  }));
});


// 1. GET - Obtener todas las categorías
app.get('/api/categories', (req, res) => {
  const rows = db.prepare('SELECT * FROM categories').all();
  res.json(formatResponse(200, rows));
});

// 2. GET - Obtener categoría por ID
app.get('/api/categories/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  res.json(formatResponse(200, row ? row : []));
});

// 3. POST - Crear categoría
app.post('/api/categories', (req, res) => {
  const { name } = req.body;
  if (!name) {
    return res.status(400).json(formatResponse(400, { error: "El campo 'name' es requerido" }));
  }
  try {
    const info = db.prepare('INSERT INTO categories (name) VALUES (?)').run(name);
    res.status(201).json(formatResponse(201, { id: info.lastInsertRowid, name }));
  } catch (err) {
    res.status(400).json(formatResponse(400, { error: "La categoría ya existe o es inválida" }));
  }
});

// PUT - Actualizar categoría por ID
app.put('/api/categories/:id', (req, res) => {
  const { name } = req.body;
  if (!name) {
    return res.status(400).json(formatResponse(400, { error: "El campo 'name' es requerido" }));
  }
  const info = db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(name, req.params.id);
  if (info.changes === 0) {
    return res.status(404).json(formatResponse(404, { error: 'Categoría no encontrada' }));
  }
  res.json(formatResponse(200, { id: Number(req.params.id), name }));
});

// 4. DELETE - Eliminar categoría por ID
app.delete('/api/categories/:id', (req, res) => {
  const info = db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  res.json(formatResponse(200, { message: 'Categoría eliminada', changes: info.changes }));
});

// 5. GET - Obtener todas las tareas con relación (JOIN) a categoría
app.get('/api/tasks', (req, res) => {
  const rows = db.prepare(`
    SELECT t.id, t.title, t.description, t.completed, c.name as category 
    FROM tasks t LEFT JOIN categories c ON t.category_id = c.id
  `).all();
  res.json(formatResponse(200, rows));
});

// 6. GET - Obtener tarea por ID
app.get('/api/tasks/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  res.json(formatResponse(200, row ? row : []));
});

// 7. POST - Crear tarea
app.post('/api/tasks', (req, res) => {
  const { title, description, category_id } = req.body;
  if (!title) {
    return res.status(400).json(formatResponse(400, { error: "El campo 'title' es requerido" }));
  }
  const info = db.prepare('INSERT INTO tasks (title, description, category_id) VALUES (?, ?, ?)')
                 .run(title, description || null, category_id || null);
  res.status(201).json(formatResponse(201, { id: info.lastInsertRowid, title, description, category_id }));
});

// PUT - Actualizar tarea completa por ID
app.put('/api/tasks/:id', (req, res) => {
  const { title, description, category_id } = req.body;
  if (!title) {
    return res.status(400).json(formatResponse(400, { error: "El campo 'title' es requerido" }));
  }
  const info = db.prepare('UPDATE tasks SET title = ?, description = ?, category_id = ? WHERE id = ?')
                 .run(title, description || null, category_id || null, req.params.id);
  if (info.changes === 0) {
    return res.status(404).json(formatResponse(404, { error: 'Tarea no encontrada' }));
  }
  res.json(formatResponse(200, { id: Number(req.params.id), title, description, category_id }));
});

// PATCH (update) - Marcar tarea como completada o pendiente
app.patch('/api/tasks/:id', (req, res) => {
  const { completed } = req.body;
  if (completed !== 0 && completed !== 1) {
    return res.status(400).json(formatResponse(400, { error: "El campo 'completed' debe ser 0 o 1" }));
  }
  const info = db.prepare('UPDATE tasks SET completed = ? WHERE id = ?').run(completed, req.params.id);
  if (info.changes === 0) {
    return res.status(404).json(formatResponse(404, { error: 'Tarea no encontrada' }));
  }
  res.json(formatResponse(200, { id: Number(req.params.id), completed }));
});

// 8. DELETE - Eliminar tarea por ID
app.delete('/api/tasks/:id', (req, res) => {
  const info = db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
  res.json(formatResponse(200, { message: 'Tarea eliminada', changes: info.changes }));
});

// 9. GET - Realizar respaldo / Backup de la base de datos en un archivo descargable (LOCAL)
app.get('/api/db/backup', async (req, res) => {
  const backupFileName = `backup-${Date.now()}.db`;
  const backupPath = path.join(__dirname, backupFileName);

  try {
    // Generar el backup
    await db.backup(backupPath);

    // Descargar el archivo al cliente
    res.download(backupPath, backupFileName, (err) => {
      if (err) {
        console.error('Error al descargar el backup:', err);
      }

      // Eliminar el archivo temporal del servidor
      fs.unlink(backupPath, (unlinkErr) => {
        if (unlinkErr) {
          console.error('Error al eliminar el archivo temporal:', unlinkErr);
        }
      });
    });

  } catch (err) {
    console.error('Error al generar el backup:', err);

    res.status(500).json({
      error: 'Fallo al generar el backup de la BD'
    });
  }
});

// 10. DELETE - Vaciar la base de datos
app.delete('/api/db/clear', (req, res) => {
  try {
    // Uso de transacción para vaciar tablas y reiniciar contadores autoincrementables
    const clearAll = db.transaction(() => {
      db.prepare('DELETE FROM tasks').run();
      db.prepare('DELETE FROM categories').run();
      db.prepare("DELETE FROM sqlite_sequence WHERE name IN ('tasks', 'categories')").run();
    });
    
    clearAll();
    res.json(formatResponse(200, { message: 'Base de datos vaciada y contadores reiniciados con éxito' }));
  } catch (err) {
    res.status(500).json(formatResponse(500, { error: 'Error al vaciar la base de datos' }));
  }
});

// =========================================================
// 2. SERVIDOR SOCKET TCP (PUERTO 6061)
// Usa la misma variable `db` (better-sqlite3, API síncrona) que los endpoints HTTP,
// así que TCP y HTTP leen y escriben la misma base app.db.
//
// Formatos aceptados:
//   {insert:{"title":"Mi tarea","description":"Texto","category_id":1}}
//   {get:{"id":1}}      -> una tarea por id
//   {get:{}}            -> todas las tareas
// =========================================================

function procesarComando(message) {
  // {insert:<element>}
  if (message.startsWith('{insert:') && message.endsWith('}')) {
    const elementStr = message.slice(8, -1); // extrae <element>
    let element;
    try {
      element = JSON.parse(elementStr);
    } catch (err) {
      return { status: 'ERROR', message: 'Estructura JSON inválida en insert' };
    }
    const { title, description, category_id } = element;
    if (!title) {
      return { status: 'ERROR', message: "El campo 'title' es requerido" };
    }
    let info;
    try {
      info = db
        .prepare('INSERT INTO tasks (title, description, category_id) VALUES (?, ?, ?)')
        .run(title, description || null, category_id || null);
    } catch (err) {
      if (err.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
        return { status: 'ERROR', message: `No existe la categoría con id ${category_id}` };
      }
      throw err;
    }
    const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(info.lastInsertRowid);
    return { status: 'OK', message: 'Elemento insertado correctamente', data: row };
  }

  // {get:<element>}
  if (message.startsWith('{get:') && message.endsWith('}')) {
    const elementStr = message.slice(5, -1); // extrae <element>
    let query;
    try {
      query = JSON.parse(elementStr);
    } catch (err) {
      return { status: 'ERROR', message: 'Estructura JSON inválida en get' };
    }
    const select = `
      SELECT t.id, t.title, t.description, t.completed, t.category_id, c.name AS category
      FROM tasks t LEFT JOIN categories c ON t.category_id = c.id`;
    if (query.id === undefined || query.id === null || query.id === '') {
      return { status: 'OK', data: db.prepare(select).all() };
    }
    const row = db.prepare(`${select} WHERE t.id = ?`).get(query.id);
    if (!row) {
      return { status: 'NOT_FOUND', message: `No existe la tarea con id ${query.id}` };
    }
    return { status: 'OK', data: row };
  }

  return {
    status: 'ERROR',
    message: 'Comando no reconocido. Formatos válidos: {insert:<element>} o {get:<element>}'
  };
}

const tcpServer = net.createServer((socket) => {
  console.log(`Cliente TCP conectado: ${socket.remoteAddress}`);
  let buffer = '';

  const responder = (message) => {
    console.log('Recibido por TCP:', message);
    let respuesta;
    try {
      respuesta = procesarComando(message);
    } catch (err) {
      respuesta = { status: 'ERROR', message: err.message };
    }
    socket.write(JSON.stringify(respuesta) + '\n');
  };

  socket.on('data', (data) => {
    buffer += data.toString();
    // Cada comando termina en salto de línea; si el cliente no lo manda,
    // se procesa en cuanto el texto recibido cierra con "}".
    let idx;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const message = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (message) responder(message);
    }
    const pendiente = buffer.trim();
    if (pendiente.endsWith('}')) {
      buffer = '';
      responder(pendiente);
    }
  });

  socket.on('end', () => console.log('Cliente TCP desconectado'));
  socket.on('error', (err) => console.error('Error TCP:', err.message));
});

// --- Iniciar Servidores ---
const PORT = process.env.PORT || 80;
const PORT_TCP = 6061;

// Solo se abren los puertos al ejecutar `node server.js`; en las pruebas no hace falta
let server = null;
if (require.main === module) {
  server = app.listen(PORT, () => {
    console.log(`Servidor activo en http://localhost:${PORT}`);
  });

  tcpServer.listen(PORT_TCP, '0.0.0.0', () => {
    console.log(`Servidor Socket TCP corriendo en puerto ${PORT_TCP}`);
  });
}

// Exportamos app, db, tcpServer y server para poder usarlos en las pruebas unitarias/integración
module.exports = { app, db, tcpServer, server, procesarComando };
