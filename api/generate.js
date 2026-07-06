// api/generate.js — Vercel serverless function using Google Gemini (free tier).
// Put this file at:  api/generate.js  (next to index.html)
// Your key lives here on the server via an env var — never in the browser.

const MODEL = 'gemini-2.5-flash'; // free-tier, stable

// Flatten the app's Anthropic-style messages into Gemini "contents".
function toGeminiContents(messages) {
  return messages
    .map(m => {
      let text = '';
      if (typeof m.content === 'string') text = m.content;
      else if (Array.isArray(m.content)) {
        const t = m.content.find(c => c.type === 'text');
        text = t ? t.text : '';
      }
      return { role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text }] };
    })
    .filter(c => c.parts[0].text);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: { message: 'Method not allowed' } });
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  // Deployment-detection probe from the app — answer 200 so it routes here.
  if (body.__probe) return res.status(200).json({ ok: true });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: { message: 'GEMINI_API_KEY is not set in Vercel env vars.' } });
  }

  const { messages, max_tokens } = body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: { message: 'messages is required' } });
  }

  try {
    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: toGeminiContents(messages),
          generationConfig: { maxOutputTokens: max_tokens || 4000, temperature: 0.7 },
        }),
      }
    );

    const g = await upstream.json();
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: { message: g?.error?.message || ('Gemini error ' + upstream.status) } });
    }

    const text = (g?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
    if (!text) {
      return res.status(502).json({ error: { message: 'Gemini returned no text (content may have been blocked, or the free-tier quota was hit).' } });
    }

    // Return in the shape the app expects: data.content[].text
    return res.status(200).json({ content: [{ text }] });
  } catch (err) {
    return res.status(502).json({ error: { message: 'Upstream request failed: ' + err.message } });
  }
}
