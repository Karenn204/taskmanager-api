const request = require('supertest');
const { app, db, procesarComando } = require('./server');

// Limpiamos la BD antes de cada test para evitar arrastrar registros previos en app.db
beforeEach(() => {
  db.exec("DELETE FROM tasks; DELETE FROM categories; DELETE FROM sqlite_sequence;");
});

// Al finalizar cerramos la BD (en pruebas no se abren puertos)
afterAll(() => {
  db.close();
});

describe('--- PRUEBAS UNITARIAS Y DE INTEGRACIÓN: TASKMANAGER API ---', () => {

  // ==========================================
  // PRUEBAS DE CATEGORÍAS
  // ==========================================
  describe('Endpoints /api/categories', () => {

    test('1. GET /api/categories -> Debe retornar un arreglo vacío al inicio', async () => {
      const res = await request(app).get('/api/categories');
      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty('statusCode', 200);
      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.data.length).toBe(0);
    });

    test('2. POST /api/categories -> Debe crear una categoría correctamente (Escenario Éxito)', async () => {
      const newCategory = { name: 'Trabajo' };
      const res = await request(app).post('/api/categories').send(newCategory);

      expect(res.statusCode).toBe(201);
      expect(res.body.statusCode).toBe(201);
      expect(res.body.data[0]).toHaveProperty('id');
      expect(res.body.data[0].name).toBe('Trabajo');
    });

    test('3. POST /api/categories -> Debe retornar 400 si falta el campo "name" (Escenario Fallo)', async () => {
      const res = await request(app).post('/api/categories').send({});

      expect(res.statusCode).toBe(400);
      expect(res.body.data[0]).toHaveProperty('error', "El campo 'name' es requerido");
    });

    test('4. POST /api/categories -> Debe retornar 400 al intentar duplicar categoría (Escenario Fallo)', async () => {
      // 1. Insertamos la primera categoría
      await request(app).post('/api/categories').send({ name: 'Trabajo' });

      // 2. Intentamos insertar exactamente el mismo nombre para forzar el error de restricción UNIQUE de SQLite
      const res = await request(app).post('/api/categories').send({ name: 'Trabajo' });

      expect(res.statusCode).toBe(400);
      expect(res.body.data[0]).toHaveProperty('error');
    });

    test('5. GET /api/categories/:id -> Debe obtener la categoría creada por ID', async () => {
      const catRes = await request(app).post('/api/categories').send({ name: 'Hogar' });
      const catId = catRes.body.data[0].id;

      const res = await request(app).get(`/api/categories/${catId}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data[0]).toHaveProperty('id', catId);
      expect(res.body.data[0].name).toBe('Hogar');
    });

    test('6. GET /api/categories/:id -> Debe devolver data vacía si el ID no existe', async () => {
      const res = await request(app).get('/api/categories/999');

      expect(res.statusCode).toBe(200);
      expect(res.body.data).toEqual([]);
    });

    test('7. DELETE /api/categories/:id -> Debe eliminar la categoría', async () => {
      const catRes = await request(app).post('/api/categories').send({ name: 'Temporal' });
      const catId = catRes.body.data[0].id;

      const res = await request(app).delete(`/api/categories/${catId}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data[0].changes).toBe(1);
    });
    test('15. PUT /api/categories/:id -> Debe actualizar el nombre de la categoría (Escenario Éxito)', async () => {
      const catRes = await request(app).post('/api/categories').send({ name: 'Viejo' });
      const catId = catRes.body.data[0].id;

      const res = await request(app).put(`/api/categories/${catId}`).send({ name: 'Nuevo' });

      expect(res.statusCode).toBe(200);
      expect(res.body.data[0].name).toBe('Nuevo');
    });
  });

  // ==========================================
  // PRUEBAS DE TAREAS
  // ==========================================
  describe('Endpoints /api/tasks', () => {

    test('8. POST /api/tasks -> Debe crear una tarea vinculada a una categoría (Escenario Éxito)', async () => {
      const catRes = await request(app).post('/api/categories').send({ name: 'Estudios' });
      const categoryId = catRes.body.data[0].id;

      const newTask = {
        title: 'Estudiar Pruebas con Jest',
        description: 'Repasar escenarios de prueba unitarias',
        category_id: categoryId
      };

      const res = await request(app).post('/api/tasks').send(newTask);

      expect(res.statusCode).toBe(201);
      expect(res.body.data[0]).toHaveProperty('id');
      expect(res.body.data[0].title).toBe(newTask.title);
    });

    test('9. POST /api/tasks -> Debe retornar 400 si no se proporciona el título (Escenario Fallo)', async () => {
      const res = await request(app).post('/api/tasks').send({ description: 'Sin título' });

      expect(res.statusCode).toBe(400);
      expect(res.body.data[0]).toHaveProperty('error', "El campo 'title' es requerido");
    });

    test('10. GET /api/tasks -> Debe retornar las tareas con la información de la categoría (JOIN)', async () => {
      const catRes = await request(app).post('/api/categories').send({ name: 'Universidad' });
      const categoryId = catRes.body.data[0].id;

      await request(app).post('/api/tasks').send({
        title: 'Entregar práctica',
        category_id: categoryId
      });

      const res = await request(app).get('/api/tasks');

      expect(res.statusCode).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.data[0]).toHaveProperty('category', 'Universidad');
    });

    test('11. GET /api/tasks/:id -> Debe obtener una tarea específica por ID', async () => {
      const taskRes = await request(app).post('/api/tasks').send({ title: 'Tarea individual' });
      const taskId = taskRes.body.data[0].id;

      const res = await request(app).get(`/api/tasks/${taskId}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data[0]).toHaveProperty('id', taskId);
    });

    test('12. DELETE /api/tasks/:id -> Debe eliminar la tarea por ID', async () => {
      const taskRes = await request(app).post('/api/tasks').send({ title: 'Tarea a borrar' });
      const taskId = taskRes.body.data[0].id;

      const res = await request(app).delete(`/api/tasks/${taskId}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data[0].changes).toBe(1);
    });
    test('16. PUT /api/tasks/:id -> Debe actualizar la tarea (Escenario Éxito)', async () => {
      const taskRes = await request(app).post('/api/tasks').send({ title: 'Original' });
      const taskId = taskRes.body.data[0].id;

      const res = await request(app).put(`/api/tasks/${taskId}`).send({ title: 'Editada' });

      expect(res.statusCode).toBe(200);
      expect(res.body.data[0].title).toBe('Editada');
    });

    test('17. PUT /api/tasks/:id -> Debe retornar 404 si la tarea no existe (Escenario Fallo)', async () => {
      const res = await request(app).put('/api/tasks/999').send({ title: 'No existe' });

      expect(res.statusCode).toBe(404);
      expect(res.body.data[0]).toHaveProperty('error', 'Tarea no encontrada');
    });

    test('18. PATCH /api/tasks/:id -> Debe marcar la tarea como completada (Escenario Éxito)', async () => {
      const taskRes = await request(app).post('/api/tasks').send({ title: 'Pendiente' });
      const taskId = taskRes.body.data[0].id;

      const res = await request(app).patch(`/api/tasks/${taskId}`).send({ completed: 1 });

      expect(res.statusCode).toBe(200);
      expect(res.body.data[0].completed).toBe(1);
    });

    test('19. PATCH /api/tasks/:id -> Debe retornar 400 si completed no es 0 o 1 (Escenario Fallo)', async () => {
      const taskRes = await request(app).post('/api/tasks').send({ title: 'Pendiente' });
      const taskId = taskRes.body.data[0].id;

      const res = await request(app).patch(`/api/tasks/${taskId}`).send({ completed: 'si' });

      expect(res.statusCode).toBe(400);
      expect(res.body.data[0]).toHaveProperty('error', "El campo 'completed' debe ser 0 o 1");
    });
  });

  // ==========================================
  // PRUEBAS DE MANTENIMIENTO DE BASE DE DATOS
  // ==========================================
  describe('Endpoints Mantenimiento de BD', () => {

    test('13. DELETE /api/db/clear -> Vaciar base de datos y reiniciar contadores', async () => {
      await request(app).post('/api/categories').send({ name: 'Prueba Clear' });

      const res = await request(app).delete('/api/db/clear');

      expect(res.statusCode).toBe(200);
      expect(res.body.data[0].message).toContain('Base de datos vaciada');

      const checkCategories = await request(app).get('/api/categories');
      expect(checkCategories.body.data.length).toBe(0);
    });

    test('14. GET /api/db/backup -> Debe descargar un respaldo de la base de datos', async () => {
      const res = await request(app).get('/api/db/backup');

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-disposition']).toContain('backup-');
    });
  });

  // ==========================================
  // PRUEBAS DE HEALTH CHECK E INICIO
  // ==========================================
  describe('Endpoints /api/health y /', () => {

    test('20. GET /api/health -> Debe indicar que el servicio está activo', async () => {
      const res = await request(app).get('/api/health');

      expect(res.statusCode).toBe(200);
      expect(res.body.data[0]).toHaveProperty('status', 'ok 2');
      expect(res.body.data[0]).toHaveProperty('autor');
      expect(res.body.data[0]).toHaveProperty('version');
    });

    test('21. GET / -> Debe listar los endpoints disponibles', async () => {
      const res = await request(app).get('/');

      expect(res.statusCode).toBe(200);
      expect(res.body.data[0].endpoints).toContain('GET /api/health');
    });
  });

  // ==========================================
  // PRUEBAS DEL PROTOCOLO SOCKET TCP
  // ==========================================
  describe('Comandos del servidor TCP', () => {

    test('22. {insert:...} -> Debe insertar una tarea', () => {
      const r = procesarComando('{insert:{"title":"Desde TCP"}}');

      expect(r.status).toBe('OK');
      expect(r.data.title).toBe('Desde TCP');
    });

    test('23. {insert:...} -> Debe rechazar JSON inválido o sin título', () => {
      expect(procesarComando('{insert:no-json}').status).toBe('ERROR');
      expect(procesarComando('{insert:{"description":"x"}}').message).toContain('title');
    });

    test('24. {insert:...} -> Debe rechazar una categoría inexistente', () => {
      const r = procesarComando('{insert:{"title":"X","category_id":999}}');

      expect(r.status).toBe('ERROR');
      expect(r.message).toContain('categoría');
    });

    test('25. {get:...} -> Debe obtener todas las tareas o una por id', () => {
      const { data } = procesarComando('{insert:{"title":"Buscar"}}');

      expect(procesarComando('{get:{}}').data.length).toBe(1);
      expect(procesarComando(`{get:{"id":${data.id}}}`).data.title).toBe('Buscar');
      expect(procesarComando('{get:{"id":999}}').status).toBe('NOT_FOUND');
      expect(procesarComando('{get:mal}').status).toBe('ERROR');
    });

    test('26. Comando desconocido -> Debe responder con error', () => {
      expect(procesarComando('hola').message).toContain('Comando no reconocido');
    });
  });
});
