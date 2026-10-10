const corsHeaders = {
"Access-Control-Allow-Origin": "*",
"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
"Access-Control-Allow-Headers": "Content-Type, Authorization",
"Access-Control-Max-Age": "86400",
"Vary": "Origin"
};

function json(data, status = 200) {
return new Response(JSON.stringify(data), {
status: status,
headers: {
...corsHeaders,
"Content-Type": "application/json; charset=utf-8"
}
});
}

function decodePart(part) {
const normalized = part.replace(/-/g, "+").replace(/_/g, "/");
const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
const binary = atob(padded);
const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
return JSON.parse(new TextDecoder().decode(bytes));
}

async function verifyToken(token, projectId) {
const parts = token.split(".");
if (parts.length !== 3) {
throw new Error("Firebase token không hợp lệ.");
}

const header = decodePart(parts[0]);
const payload = decodePart(parts[1]);
const now = Math.floor(Date.now() / 1000);

if (
header.alg !== "RS256" ||
!header.kid ||
payload.aud !== projectId ||
payload.iss !== "https://securetoken.google.com/" + projectId ||
typeof payload.sub !== "string" ||
!payload.sub ||
!Number.isFinite(payload.exp) ||
payload.exp <= now ||
!Number.isFinite(payload.iat) ||
payload.iat > now + 300
) {
throw new Error("Token Firebase hết hạn hoặc không hợp lệ.");
}

const response = await fetch(
"https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"
);

if (!response.ok) {
throw new Error("Không tải được khóa xác minh Firebase.");
}

const keyData = await response.json();
const jwk = keyData.keys.find(key => key.kid === header.kid);

if (!jwk) {
throw new Error("Không tìm thấy khóa Firebase.");
}

const publicKey = await crypto.subtle.importKey(
"jwk",
jwk,
{
name: "RSASSA-PKCS1-v1_5",
hash: "SHA-256"
},
false,
["verify"]
);

const signedData = new TextEncoder().encode(parts[0] + "." + parts[1]);
const signatureText = parts[2].replace(/-/g, "+").replace(/_/g, "/");
const paddedSignature = signatureText + "=".repeat((4 - signatureText.length % 4) % 4);
const signatureBinary = atob(paddedSignature);
const signature = Uint8Array.from(signatureBinary, c => c.charCodeAt(0));

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
if (request.method === "OPTIONS") {
return new Response(null, {
status: 204,
headers: corsHeaders
});
}

const url = new URL(request.url);

if (url.pathname === "/api/health" && request.method === "GET") {
  return json({
    ok: true,
    service: "LuaAI Studio Worker",
    provider: "Groq",
    model: "openai/gpt-oss-120b"
  });
}

if (url.pathname !== "/api/chat") {
  return json({ error: "Không tìm thấy endpoint." }, 404);
}

if (request.method !== "POST") {
  return json({ error: "Chỉ hỗ trợ POST." }, 405);
}

if (!env.GROQ_API_KEY || !env.FIREBASE_PROJECT_ID) {
  return json({
    error: "Thiếu GROQ_API_KEY hoặc FIREBASE_PROJECT_ID."
  }, 500);
}

try {
  const authorization = request.headers.get("Authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    return json({ error: "Bạn cần đăng nhập Google." }, 401);
  }

  const user = await verifyToken(
    match[1],
    env.FIREBASE_PROJECT_ID
  );

  const body = await request.json();
  let messages = [];

  if (Array.isArray(body.messages)) {
    messages = body.messages;
  } else {
    const message = String(body.message || body.prompt || "");
    if (message.trim()) {
      messages = [{
        role: "user",
        content: message
      }];
    }
  }

  messages = messages
    .filter(item =>
      item &&
      ["user", "assistant"].includes(item.role) &&
      typeof item.content === "string"
    )
    .slice(-30);

  if (!messages.some(item =>
    item.role === "user" && item.content.trim()
  )) {
    return json({ error: "Bạn chưa nhập tin nhắn." }, 400);
  }

  const systemMessage = {
    role: "system",
    content:
      "Bạn là LuaAI Studio, trợ lý lập trình Roblox Luau. " +
      "Trả lời bằng tiếng Việt khi người dùng dùng tiếng Việt. " +
      "Hỗ trợ viết, giải thích, sửa lỗi và tối ưu script Roblox hợp lệ. " +
      "Không hỗ trợ khai thác hoặc phá hoại server. " +
      "Khi viết code, hãy định dạng rõ ràng bằng Markdown."
  };

  const response = await fetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + env.GROQ_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "openai/gpt-oss-120b",
        messages: [systemMessage, ...messages],
        max_completion_tokens: 4096,
        temperature: 0.7
      })
    }
  );

  const result = await response.json();

  if (!response.ok) {
    console.error("Groq API error:", JSON.stringify(result));
    return json({
      error: result.error?.message || "Groq API gặp lỗi."
    }, 502);
  }

  const reply = result.choices?.[0]?.message?.content;

  if (typeof reply !== "string" || !reply.trim()) {
    return json({
      error: "AI chưa trả về nội dung."
    }, 502);
  }

  return json({
    reply: reply,
    uid: user.sub
  });

} catch (error) {
  console.error("Worker error:", error.message);

  return json({
    error: error.message || "Không thể kết nối AI."
  }, 500);
}

}
};
