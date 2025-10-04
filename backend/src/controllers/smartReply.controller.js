// No node-fetch import needed (Node 18+ has global fetch)
export const getSmartReplies = async (req, res) => {
  try {
    const { message, history = [] } = req.body;

    if (!message || message.trim() === "") {
      return res.status(400).json({ error: "Message text is required" });
    }

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

    // Use a model available to your key (no leading "models/" here)
    const modelName = "gemini-2.5-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${process.env.GEMINI_API_KEY}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: instruction }] }],
      }),
    });

    const rawBody = await response.text().catch(() => "");
    if (!response.ok) {
      console.error("Gemini failed:", response.status, rawBody.slice(0, 2000));
      return res.status(502).json({
        error: "Gemini generate failed",
        status: response.status,
        body: rawBody.slice ? rawBody.slice(0, 2000) : rawBody,
      });
    }

    // Parse JSON body
    let rawJson = null;
    try { rawJson = JSON.parse(rawBody); } catch { /* will handle below */ }

    // Try to extract generated text from common response shapes
    let textOut = "";
    if (rawJson?.candidates?.[0]?.content?.parts?.[0]?.text) {
      textOut = rawJson.candidates[0].content.parts[0].text;
    } else if (rawJson?.outputs?.[0]?.content?.[0]?.text) {
      textOut = rawJson.outputs[0].content[0].text;
    } else if (rawJson?.output?.[0]?.content?.[0]?.text) {
      textOut = rawJson.output[0].content[0].text;
    } else if (typeof rawBody === "string") {
      textOut = rawBody;
    } else {
      textOut = JSON.stringify(rawJson || "");
    }

    // Remove markdown code fences like ```json ... ``` if present
    textOut = textOut.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();

    // Now try strict parse; if fails, fallback to line-splitting and cleaning
    let suggestions;
    try {
      suggestions = JSON.parse(textOut);
    } catch {
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

    // Deduplicate and length-limit (<=7 words)
    const seen = new Set();
    suggestions = suggestions
      .filter((s) => {
        const key = s.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((s) =>
        s.split(/\s+/).length > 7 ? s.split(/\s+/).slice(0, 7).join(" ") : s
      )
      .slice(0, 3);

    // Backfill if fewer than 3
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
