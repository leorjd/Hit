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

// GET: Obtener datos del usuario
export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const userId = url.searchParams.get('userId');

    if (!userId) {
      return new Response(JSON.stringify({ error: 'Missing userId' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    const result = await context.env.HIT_DB.prepare(
      'SELECT * FROM users WHERE id = ?'
    ).bind(userId).first();

    if (!result) {
      return new Response(JSON.stringify({ error: 'User not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    return new Response(JSON.stringify({
      ...result,
      history: JSON.parse(result.history || '[]')
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: 'Database error', detail: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }
}

// POST: Generar workout O guardar/actualizar datos
export async function onRequestPost(context) {
  const ip = context.request.headers.get('CF-Connecting-IP') || 'unknown';

  if (isRateLimited(ip)) {
    return new Response(JSON.stringify({ error: 'Demasiadas solicitudes. Espera un momento.' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }

  try {
    const body = await context.request.json();
    
    // Si viene "action", es operación de base de datos
    if (body.action === 'saveUser') {
      return await saveUser(context, body);
    }
    
    if (body.action === 'saveWorkout') {
      return await saveWorkout(context, body);
    }

    // Si viene "prompt", es generación de workout
    if (body.prompt) {
      return await generateWorkout(context, body.prompt);
    }

    return new Response(JSON.stringify({ error: 'Invalid request' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: 'Request error', detail: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }
}

// Generar workout con Claude
async function generateWorkout(context, prompt) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': context.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  const data = await response.json();
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders }
  });
}

// Guardar o actualizar usuario
async function saveUser(context, data) {
  const { userId, name, weight } = data;

  if (!userId || !name || !weight) {
    return new Response(JSON.stringify({ error: 'Missing required fields' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }

  // Verificar si el usuario existe
  const existing = await context.env.HIT_DB.prepare(
    'SELECT id FROM users WHERE id = ?'
  ).bind(userId).first();

  if (existing) {
    // Actualizar
    await context.env.HIT_DB.prepare(
      'UPDATE users SET name = ?, weight = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?'
    ).bind(name, weight, userId).run();
  } else {
    // Crear
    await context.env.HIT_DB.prepare(
      'INSERT INTO users (id, name, weight) VALUES (?, ?, ?)'
    ).bind(userId, name, weight).run();
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders }
  });
}

// Guardar workout completado
async function saveWorkout(context, data) {
  const { userId, kcal, date, exercises } = data;

  if (!userId || !kcal || !date) {
    return new Response(JSON.stringify({ error: 'Missing required fields' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }

  const user = await context.env.HIT_DB.prepare(
    'SELECT * FROM users WHERE id = ?'
  ).bind(userId).first();

  if (!user) {
    return new Response(JSON.stringify({ error: 'User not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }

  // Calcular nueva racha
  const today = new Date(date).toISOString().split('T')[0];
  const lastDate = user.lastWorkoutDate ? new Date(user.lastWorkoutDate).toISOString().split('T')[0] : null;
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
  const history = JSON.parse(user.history || '[]');
  history.push({ date, kcal, exercises: exercises || [] });

  await context.env.HIT_DB.prepare(
    `UPDATE users SET 
      streak = ?, 
      lastWorkoutDate = ?, 
      totalWorkouts = totalWorkouts + 1,
      totalKcal = totalKcal + ?,
      history = ?,
      updatedAt = CURRENT_TIMESTAMP
    WHERE id = ?`
  ).bind(newStreak, date, kcal, JSON.stringify(history), userId).run();

  return new Response(JSON.stringify({ 
    success: true, 
    streak: newStreak 
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders }
  });
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 200,
    headers: corsHeaders
  });
}
