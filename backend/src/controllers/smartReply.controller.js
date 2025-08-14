// No node-fetch import needed (Node 18+ has global fetch)

export const getSmartReplies = async (req, res) => {
  try {
    const { message, history = [] } = req.body;

    if (!message || message.trim() === "") {
      return res.status(400).json({ error: "Message text is required" });
    }

    // Optional: include brief recent history for better context (last 4 turns)
    const lastTurns = Array.isArray(history) ? history.slice(-4) : [];
    const historyText = lastTurns
      .map((m) => `${m.role || "user"}: ${m.text}`)
      .join("\n");

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

    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/` +
      `gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: instruction }] }],
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Gemini API error ${response.status}: ${text}`);
    }

    const data = await response.json();
    const textOut = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    // Try to parse strict JSON first
    let suggestions;
    try {
      suggestions = JSON.parse(textOut);
    } catch {
      // Fallback: tolerate the model adding prose/numbering
      suggestions = textOut
        .split("\n")
        .map((line) => line.replace(/^\s*[-*\d.]+\s*/, "").trim())
        .filter(Boolean);
    }

    // Sanitize & enforce 3 short strings
    suggestions = (Array.isArray(suggestions) ? suggestions : [])
      .filter((s) => typeof s === "string")
      .map((s) => s.trim())
      .filter(Boolean);

    // Deduplicate and length-limit
    const seen = new Set();
    suggestions = suggestions
      .filter((s) => {
        const key = s.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((s) => (s.split(/\s+/).length > 7 ? s.split(/\s+/).slice(0, 7).join(" ") : s))
      .slice(0, 3);

    // Backfill if the model returned < 3
    const fallbacks = ["Sure!", "Can you clarify?", "Let me check."];
    while (suggestions.length < 3) {
      const next = fallbacks[suggestions.length];
      if (!suggestions.includes(next)) suggestions.push(next);
      else break;
    }

    return res.json({ suggestions });
  } catch (error) {
    console.error("Error in getSmartReplies:", error);
    return res.status(500).json({ error: "Failed to generate smart replies" });
  }
};
