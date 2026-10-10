const corsHeaders = (origin = "*") => ({
"Access-Control-Allow-Origin": origin,
"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

function decodeBase64Url(value) {
const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
const binary = atob(padded);
return Uint8Array.from(binary, c => c.charCodeAt(0));
}

function decodeJwtPart(value) {
return JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));
}

async function verifyFirebaseToken(token, projectId) {
const parts = token.split(".");
if (parts.length !== 3) {
throw new Error("Token đăng nhập không hợp lệ.");
}

const header = decodeJwtPart(parts[0]);
const payload = decodeJwtPart(parts[1]);

if (
header.alg !== "RS256" ||
!header.kid ||
payload.aud !== projectId ||
payload.iss !== "https://securetoken.google.com/${projectId}" ||
typeof payload.sub !== "string" ||
!payload.sub ||
payload.sub.length > 128 ||
!Number.isFinite(payload.exp) ||
payload.exp <= Math.floor(Date.now() / 1000) ||
!Number.isFinite(payload.iat) ||
payload.iat > Math.floor(Date.now() / 1000) + 300
) {
throw new Error("Token Firebase hết hạn hoặc không hợp lệ.");
}

const response = await fetch(
"https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"
);

if (!response.ok) {
throw new Error("Không thể xác minh Firebase.");
}

const jwks = await response.json();
const jwk = jwks.keys.find(key => key.kid === header.kid);

if (!jwk) {
throw new Error("Không tìm thấy khóa xác minh Firebase.");
}

const publicKey = await crypto.subtle.importKey(
"jwk",
jwk,
{ name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
false,
["verify"]
);

const signedData = new TextEncoder().encode("${parts[0]}.${parts[1]}");
const signature = decodeBase64Url(parts[2]);

const valid = await crypto.subtle.verify(
"RSASSA-PKCS1-v1_5",
publicKey,
signature,
signedData
);

if (!valid) {
throw new Error("Chữ ký Firebase không hợp lệ.");
}

return payload;
}

export default {
async fetch(request, env) {
const origin = request.headers.get("Origin") || "*";
const headers = corsHeaders(origin);

if (request.method === "OPTIONS") {
  return new Response(null, { status: 204, headers });
}

const url = new URL(request.url);

if (url.pathname === "/api/health" && request.method === "GET") {
  return json({
    ok: true,
    service: "LuaAI Studio Worker",
    provider: "Groq",
    model: "openai/gpt-oss-120b"
  }, 200, headers);
}

if (url.pathname !== "/api/chat") {
  return json({ error: "Không tìm thấy endpoint." }, 404, headers);
}

if (request.method !== "POST") {
  return json({ error: "Chỉ hỗ trợ POST." }, 405, headers);
}

if (!env.GROQ_API_KEY || !env.FIREBASE_PROJECT_ID) {
  return json({
    error: "Thiếu GROQ_API_KEY hoặc FIREBASE_PROJECT_ID trong Cloudflare."
  }, 500, headers);
}

try {
  const authorization = request.headers.get("Authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    return json({ error: "Bạn cần đăng nhập Google." }, 401, headers);
  }

  const user = await verifyFirebaseToken(
    match[1],
    env.FIREBASE_PROJECT_ID
  );

  const body = await request.json();

  let messages = Array.isArray(body.messages)
    ? body.messages
    : [{
        role: "user",
        content: String(body.message ?? body.prompt ?? "")
      }];

  messages = messages
    .filter(m =>
      m &&
      ["system", "user", "assistant"].includes(m.role) &&
      typeof m.content === "string"
    )
    .slice(-30);

  if (!messages.length || !messages.some(m => m.role === "user" && m.content.trim())) {
    return json({ error: "Hãy nhập nội dung bạn muốn hỏi AI." }, 400, headers);
  }

  const systemPrompt = {
    role: "system",
    content:
      "Bạn là LuaAI Studio, trợ lý lập trình Roblox Luau. " +
      "Trả lời bằng tiếng Việt khi người dùng viết tiếng Việt. " +
      "Hỗ trợ viết, giải thích, sửa lỗi và tối ưu script Roblox hợp lệ. " +
      "Không hướng dẫn khai thác, gian lận hoặc phá hoại server. " +
      "Khi được yêu cầu viết code, hãy cung cấp code rõ ràng trong Markdown."
  };

  const groqResponse = await fetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "openai/gpt-oss-120b",
        messages: [systemPrompt, ...messages],
        temperature: 0.7,
        max_completion_tokens: 4096
      })
    }
  );

  const result = await groqResponse.json();

  if (!groqResponse.ok) {
    console.error("Groq API error:", JSON.stringify(result));

    return json({
      error: result.error?.message || "Groq API gặp lỗi.",
      provider: "Groq"
    }, 502, headers);
  }

  const reply = result.choices?.[0]?.message?.content;

  if (typeof reply !== "string" || !reply.trim()) {
    return json({ error: "AI chưa trả về nội dung. Hãy thử lại." }, 502, headers);
  }

  return json({
    reply,
    uid: user.sub
  }, 200, headers);

} catch (error) {
  console.error("Worker error:", error.message);

  return json({
    error: error.message || "Không thể kết nối AI."
  }, 500, headers);
}

}
};
