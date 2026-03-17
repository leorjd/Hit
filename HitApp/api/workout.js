import { neon } from '@neondatabase/serverless';

// Rate limiting: 2 requests per minute per IP
const rateLimitMap = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const limit = 2;

  if (!rateLimitMap.has(ip)) {
    rateLimitMap.set(ip, { count: 1, start: now });
    return false;
  }

  const entry = rateLimitMap.get(ip);

  if (now - entry.start > windowMs) {
    rateLimitMap.set(ip, { count: 1, start: now });
    return false;
  }

  if (entry.count >= limit) return true;

  entry.count++;
  return false;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).json({});
  }

  const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown';

  // Rate limiting
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Demasiadas solicitudes. Espera un momento.' });
  }

  const sql = neon(process.env.DATABASE_URL);

  try {
    // GET: Obtener datos del usuario
    if (req.method === 'GET') {
      const { userId } = req.query;

      if (!userId) {
        return res.status(400).json({ error: 'Missing userId' });
      }

      const result = await sql`SELECT * FROM users WHERE id = ${userId}`;

      if (result.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      return res.status(200).json({
        ...result[0],
        history: result[0].history || []
      });
    }

    // POST: Generar workout O guardar/actualizar datos
    if (req.method === 'POST') {
      const body = req.body;

      // Si viene "action", es operación de base de datos
      if (body.action === 'saveUser') {
        return await saveUser(sql, body, res);
      }

      if (body.action === 'saveWorkout') {
        return await saveWorkout(sql, body, res);
      }

      // Si viene "prompt", es generación de workout
      if (body.prompt) {
        return await generateWorkout(body.prompt, res);
      }

      return res.status(400).json({ error: 'Invalid request' });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    console.error('Handler error:', error);
    return res.status(500).json({ error: 'Server error', detail: error.message });
  }
}

// Generar workout con Claude
async function generateWorkout(prompt, res) {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();
    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({ error: 'API error', detail: error.message });
  }
}

// Guardar o actualizar usuario
async function saveUser(sql, data, res) {
  const { userId, name, weight } = data;

  if (!userId || !name || !weight) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // Verificar si el usuario existe
    const existing = await sql`SELECT id FROM users WHERE id = ${userId}`;

    if (existing.length > 0) {
      // Actualizar
      await sql`
        UPDATE users 
        SET name = ${name}, weight = ${weight}, updatedAt = CURRENT_TIMESTAMP 
        WHERE id = ${userId}
      `;
    } else {
      // Crear
      await sql`
        INSERT INTO users (id, name, weight) 
        VALUES (${userId}, ${name}, ${weight})
      `;
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: 'Database error', detail: error.message });
  }
}

// Guardar workout completado
async function saveWorkout(sql, data, res) {
  const { userId, kcal, date, exercises } = data;

  if (!userId || !kcal || !date) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const userResult = await sql`SELECT * FROM users WHERE id = ${userId}`;

    if (userResult.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult[0];

    // Calcular nueva racha
    const today = new Date(date).toISOString().split('T')[0];
    const lastDate = user.lastworkoutdate ? new Date(user.lastworkoutdate).toISOString().split('T')[0] : null;
    let newStreak = user.streak || 0;

    if (!lastDate) {
      newStreak = 1;
    } else {
      const daysDiff = Math.floor((new Date(today) - new Date(lastDate)) / (1000 * 60 * 60 * 24));
      if (daysDiff === 1) {
        newStreak++;
      } else if (daysDiff > 1) {
        newStreak = 1;
      }
    }

    // Actualizar historial
    const history = user.history || [];
    history.push({ date, kcal, exercises: exercises || [] });

    await sql`
      UPDATE users SET 
        streak = ${newStreak}, 
        lastWorkoutDate = ${date}, 
        totalWorkouts = totalWorkouts + 1,
        totalKcal = totalKcal + ${kcal},
        history = ${JSON.stringify(history)}::jsonb,
        updatedAt = CURRENT_TIMESTAMP
      WHERE id = ${userId}
    `;

    return res.status(200).json({ success: true, streak: newStreak });
  } catch (error) {
    return res.status(500).json({ error: 'Database error', detail: error.message });
  }
}