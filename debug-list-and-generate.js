// Drop-in replacement for your controller
// No node-fetch import needed on Node 18+

async function listAvailableModels() {
  const urls = [
    `https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`,
    `https://generativelanguage.googleapis.com/v1/models?key=${process.env.GEMINI_API_KEY}`
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, { method: 'GET' });
      if (!res.ok) continue;
      const json = await res.json().catch(() => null);
      if (json && Array.isArray(json.models)) return json.models;
    } catch (e) {
      // ignore
    }
  }
  return null;
}

export const getSmartReplies = async (req, res) => {
  try {
    const { message, history = [] } = req.body;
    if (!message || message.trim() === "") {
      return res.status(400).json({ error: "Message text is required" });
    }

    const lastTurns = Array.isArray(history) ? history.slice(-4) : [];
    const historyText = lastTurns.map(m => `${m.role || "user"}: ${m.text}`).join("\n");

    const instruction = `
You generate quick chat replies.

Rules:
- Return ONLY a JSON array of 3 strings. Example: ["Sure!","Maybe later?","Not sure."]
- Each suggestion: <= 7 words, casual, natural, no emojis.
- Vary tone (positive / neutral / clarifying).
- No extra text, no explanations, no numbering.
Context:
${historyText ? historyText + "\n" : ""}Last message: "${message}"
`;

    // model WITHOUT leading "models/" to avoid double prefix
    let modelName = "gemini-2.5-flash";
    const makeUrl = (model) =>
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;

    async function callGenerate(modelToUse) {
      const url = makeUrl(modelToUse);
      return fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // keep same request shape you've been using
          contents: [{ role: "user", parts: [{ text: instruction }] }],
        }),
      });
    }

    // Attempt generate
    let response = await callGenerate(modelName);

    // If 404 => try discover & fallback
    if (!response.ok && response.status === 404) {
      console.warn(`Initial model ${modelName} returned 404. Trying model discovery...`);
      const models = await listAvailableModels();
      if (models && models.length) {
        const candidate = models.find(m => (m.supportedGenerationMethods || []).includes("generateContent")) || models[0];
        if (candidate) {
          const candidateName = (candidate.name || candidate).replace(/^models\//, '');
          if (candidateName !== modelName) {
            console.warn(`Falling back to model ${candidateName}`);
            modelName = candidateName;
            response = await callGenerate(modelName);
          }
        }
      }
    }

    // If still not OK -> log and return raw details to client for debugging
    if (!response.ok) {
      const text = await response.text().catch(() => "<no-body>");
      console.error('Gemini final response error:', { status: response.status, body: text });
      return res.status(502).json({
        error: 'Generate failed',
        status: response.status,
        body: text.slice ? text.slice(0, 2000) : text // limit size returned
      });
    }

    // Log the full successful response for debugging
    const rawJson = await response.json().catch(() => null);
    console.log('Gemini raw response:', JSON.stringify(rawJson, null, 2));

    // Try multiple possible extraction paths
    let textOut = "";

    // 1) canonical path you used earlier
    if (rawJson?.candidates?.[0]?.content?.parts?.[0]?.text) {
      textOut = rawJson.candidates[0].content.parts[0].text;
    }
    // 2) older/newer shapes: outputs / output / result / choices
    else if (rawJson?.outputs?.[0]?.content?.[0]?.text) {
      textOut = rawJson.outputs[0].content[0].text;
    } else if (rawJson?.output?.[0]?.content?.[0]?.text) {
      textOut = rawJson.output[0].content[0].text;
    } else if (rawJson?.candidates?.[0]?.output) {
      textOut = typeof rawJson.candidates[0].output === 'string'
        ? rawJson.candidates[0].output
        : JSON.stringify(rawJson.candidates[0].output);
    } else if (rawJson?.response) {
      textOut = typeof rawJson.response === 'string' ? rawJson.response : JSON.stringify(rawJson.response);
    } else {
      // fallback: stringify entire response (so you can see it in results)
      textOut = JSON.stringify(rawJson);
    }

    // Now extract suggestions (try JSON parse, then fallbacks)
    let suggestions;
    try {
      suggestions = JSON.parse(textOut);
    } catch {
      suggestions = textOut
        .split("\n")
        .map(line => line.replace(/^\s*[-*\d.]+\s*/, "").trim())
        .filter(Boolean);
    }

    // sanitize & enforce 3 short strings
    suggestions = (Array.isArray(suggestions) ? suggestions : [])
      .filter(s => typeof s === "string")
      .map(s => s.trim())
      .filter(Boolean);

    const seen = new Set();
    suggestions = suggestions
      .filter(s => {
        const key = s.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map(s => (s.split(/\s+/).length > 7 ? s.split(/\s+/).slice(0, 7).join(" ") : s))
      .slice(0, 3);

    const fallbacks = ["Sure!", "Can you clarify?", "Let me check."];
    while (suggestions.length < 3) {
      const next = fallbacks[suggestions.length];
      if (!suggestions.includes(next)) suggestions.push(next);
      else break;
    }

    return res.json({ suggestions });
  } catch (err) {
    console.error('Unexpected error in getSmartReplies:', err);
    return res.status(500).json({ error: 'Internal server error', detail: String(err) });
  }
};
