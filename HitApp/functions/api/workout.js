export default async function handler(req, res) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (req.method === 'OPTIONS') {
    return res.status(200).json({});
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { mode } = req.body;

    if (!mode || (mode !== 'ligero' && mode !== 'intenso')) {
      return res.status(400).json({ error: 'Invalid mode' });
    }

    const exerciseCount = mode === 'ligero' ? 8 : 15;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4000,
        messages: [
          {
            role: 'user',
            content: `Genera un workout de ${exerciseCount} ejercicios en casa. Responde SOLO con JSON válido, sin texto extra, sin markdown:

{
  "exercises": [
    {
      "name": "nombre del ejercicio",
      "reps": "12-15 reps" o "30-45 seg",
      "rest": "15 seg" o "30 seg",
      "steps": ["paso 1", "paso 2", "paso 3"],
      "kcal": número entre 8-15
    }
  ]
}

Reglas:
- Exactamente ${exerciseCount} ejercicios
- Variedad: cardio, fuerza, core
- Sin equipo especial
- steps: máximo 3 pasos por ejercicio
- kcal: número entero entre 8-15`
          }
        ]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Anthropic API error:', errorText);
      return res.status(response.status).json({ 
        error: 'API request failed',
        details: errorText 
      });
    }

    const data = await response.json();
    const content = data.content[0].text;
    
    // Limpiar posibles markdown backticks
    const cleanContent = content.replace(/```json\n?|\n?```/g, '').trim();
    const workout = JSON.parse(cleanContent);

    return res.status(200).json(workout);

  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
}
