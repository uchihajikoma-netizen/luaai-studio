
const corsHeaders = (origin, allowed) => ({
  "Access-Control-Allow-Origin": allowed === "*" ? "*" : allowed,
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin"
});

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...headers
    }
  });
}

function b64urlDecode(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + "=".repeat((4 - s.length % 4) % 4));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

async function verifyFirebaseToken(token, projectId) {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Token không hợp lệ.");

  const header = JSON.parse(
    new TextDecoder().decode(b64urlDecode(parts[0]))
  );
  const payload = JSON.parse(
    new TextDecoder().decode(b64urlDecode(parts[1]))
  );

  if (header.alg !== "RS256" || !header.kid) {
    throw new Error("Kiểu token không hợp lệ.");
  }

  const now = Math.floor(Date.now() / 1000);

  if (
    payload.aud !== projectId ||
    payload.iss !== `https://securetoken.google.com/${projectId}` ||
    !payload.sub ||
    payload.exp <= now ||
    payload.iat > now + 60 ||
    payload.auth_time > now + 60
  ) {
    throw new Error("Token hết hạn hoặc sai Firebase project.");
  }

  const response = await fetch(
    "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com",
    { cf: { cacheTtl: 3600 } }
  );

  if (!response.ok) throw new Error("Không xác minh được token.");

  const jwks = await response.json();
  const jwk = jwks.keys.find(k => k.kid === header.kid);

  if (!jwk) throw new Error("Không tìm thấy khóa xác minh.");

  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );

  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    b64urlDecode(parts[2]),
    new TextEncoder().encode(parts[0] + "." + parts[1])
  );

  if (!valid) throw new Error("Chữ ký token không hợp lệ.");
  return payload;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = env.ALLOWED_ORIGIN || "*";
    const headers = corsHeaders(origin, allowed);
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    if (url.pathname === "/api/health" && request.method === "GET") {
      return json({ ok: true, service: "LuaAI Studio Worker" }, 200, headers);
    }

    if (url.pathname !== "/api/chat" || request.method !== "POST") {
      return json({ error: "Not found" }, 404, headers);
    }

    if (allowed !== "*" && origin !== allowed) {
      return json({ error: "Origin không được phép." }, 403, headers);
    }

    if (!env.AI_API_KEY || !env.FIREBASE_PROJECT_ID || !env.AI_MODEL) {
      return json({
        error: "Thiếu AI_API_KEY, FIREBASE_PROJECT_ID hoặc AI_MODEL."
      }, 500, headers);
    }

    const auth = request.headers.get("Authorization") || "";
    if (!auth.startsWith("Bearer ")) {
      return json({ error: "Bạn cần đăng nhập Google." }, 401, headers);
    }

    let user;
    try {
      user = await verifyFirebaseToken(
        auth.slice(7),
        env.FIREBASE_PROJECT_ID
      );
    } catch (e) {
      return json({ error: "Xác thực thất bại: " + e.message }, 401, headers);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "JSON không hợp lệ." }, 400, headers);
    }

    if (
      !Array.isArray(body.messages) ||
      body.messages.length < 1 ||
      body.messages.length > 40
    ) {
      return json({ error: "Danh sách tin nhắn không hợp lệ." }, 400, headers);
    }

    const messages = body.messages
      .filter(m =>
        m &&
        ["user", "assistant"].includes(m.role) &&
        typeof m.content === "string"
      )
      .map(m => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content.slice(0, 16000) }]
      }));

    if (!messages.length || messages[messages.length - 1].role !== "user") {
      return json({ error: "Tin nhắn cuối phải là user." }, 400, headers);
    }

    try {
      const endpoint =
        "https://generativelanguage.googleapis.com/v1beta/models/" +
        encodeURIComponent(env.AI_MODEL) +
        ":generateContent";

      const upstream = await fetch(endpoint, {
        method: "POST",
        headers: {
          "x-goog-api-key": env.AI_API_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{
              text: "Bạn là LuaAI Studio, trợ lý chuyên về Roblox Lua và Luau hợp lệ. Giải thích bằng tiếng Việt khi phù hợp. Đặt code trong fenced code block. Không hướng dẫn khai thác hoặc phá hoại server. Không khẳng định code đã được kiểm thử nếu chưa chạy."
            }]
          },
          contents: messages,
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 3000
          }
        })
      });

      const result = await upstream.json().catch(() => ({}));

      if (!upstream.ok) {
        return json({
          error: result.error?.message ||
            `Gemini trả về HTTP ${upstream.status}`
        }, 502, headers);
      }

      const reply = result.candidates?.[0]?.content?.parts
        ?.map(part => part.text || "")
        .join("");

      if (typeof reply !== "string" || !reply.trim()) {
        return json({
          error: "Gemini không trả về văn bản. Có thể yêu cầu bị chặn hoặc model không khả dụng."
        }, 502, headers);
      }

      return json({ reply, uid: user.sub }, 200, headers);
    } catch {
      return json({
        error: "Không thể kết nối Gemini. Hãy kiểm tra cấu hình và kết nối mạng."
      }, 502, headers);
    }
  }
};
        
