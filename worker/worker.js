// Cloudflare Worker: AI proxy + Firebase ID-token verification.
// Set secrets with: npx wrangler secret put AI_API_KEY
// Configure vars in Cloudflare dashboard: AI_BASE_URL, AI_MODEL, FIREBASE_PROJECT_ID, ALLOWED_ORIGIN
const corsHeaders = (origin, allowed) => ({
  "Access-Control-Allow-Origin": origin === allowed ? origin : allowed,
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin"
});
function json(data, status=200, headers={}) {
  return new Response(JSON.stringify(data), {status, headers:{"Content-Type":"application/json; charset=utf-8", ...headers}});
}
function b64urlDecode(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + "=".repeat((4 - s.length % 4) % 4));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}
async function verifyFirebaseToken(token, projectId) {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Token đăng nhập không hợp lệ.");
  const header = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[0])));
  const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1])));
  if (header.alg !== "RS256" || !header.kid) throw new Error("Kiểu token không hợp lệ.");
  const now = Math.floor(Date.now()/1000);
  if (payload.aud !== projectId || payload.iss !== `https://securetoken.google.com/${projectId}` ||
      !payload.sub || payload.exp <= now || payload.iat > now + 60 || payload.auth_time > now + 60) {
    throw new Error("Token hết hạn hoặc không thuộc Firebase project này.");
  }
  const keysResponse = await fetch("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com", {cf:{cacheTtl:3600}});
  if (!keysResponse.ok) throw new Error("Không xác minh được token.");
  const jwks = await keysResponse.json();
  const jwk = jwks.keys.find(k => k.kid === header.kid);
  if (!jwk) throw new Error("Không tìm thấy khóa xác minh token.");
  const key = await crypto.subtle.importKey("jwk", jwk, {name:"RSASSA-PKCS1-v1_5", hash:"SHA-256"}, false, ["verify"]);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlDecode(parts[2]), new TextEncoder().encode(parts[0]+"."+parts[1]));
  if (!valid) throw new Error("Chữ ký token không hợp lệ.");
  return payload;
}
export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = env.ALLOWED_ORIGIN || "*";
    const headers = corsHeaders(origin, allowed);
    if (request.method === "OPTIONS") return new Response(null, {status:204, headers});
    const url = new URL(request.url);
    if (url.pathname === "/api/health" && request.method === "GET") return json({ok:true,service:"LuaAI Studio Worker"},200,headers);
    if (url.pathname !== "/api/chat" || request.method !== "POST") return json({error:"Not found"},404,headers);
    if (allowed !== "*" && origin !== allowed) return json({error:"Origin không được phép."},403,headers);
    if (!env.AI_API_KEY || !env.FIREBASE_PROJECT_ID || !env.AI_BASE_URL || !env.AI_MODEL) {
      return json({error:"Worker chưa được cấu hình đủ AI_API_KEY, FIREBASE_PROJECT_ID, AI_BASE_URL, AI_MODEL."},500,headers);
    }
    const auth = request.headers.get("Authorization") || "";
    if (!auth.startsWith("Bearer ")) return json({error:"Cần đăng nhập Google."},401,headers);
    let user;
    try { user = await verifyFirebaseToken(auth.slice(7), env.FIREBASE_PROJECT_ID); }
    catch (e) { return json({error:"Xác thực thất bại: "+e.message},401,headers); }
    let body;
    try { body = await request.json(); } catch { return json({error:"JSON không hợp lệ."},400,headers); }
    if (!Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 40) return json({error:"Danh sách tin nhắn không hợp lệ."},400,headers);
    const messages = body.messages.filter(m => m && ["user","assistant"].includes(m.role) && typeof m.content === "string")
      .map(m => ({role:m.role,content:m.content.slice(0,16000)}));
    if (!messages.length || messages[messages.length-1].role !== "user") return json({error:"Tin nhắn cuối phải là user."},400,headers);
    try {
      const upstream = await fetch(env.AI_BASE_URL, {
        method:"POST",
        headers:{"Authorization":`Bearer ${env.AI_API_KEY}`,"Content-Type":"application/json"},
        body:JSON.stringify({model:env.AI_MODEL,messages:[
          {role:"system",content:"Bạn là LuaAI Studio, trợ lý hữu ích chuyên về Lua và Luau. Giải thích rõ ràng bằng tiếng Việt khi phù hợp. Đặt code trong fenced code block và không khẳng định code đã được kiểm thử nếu chưa chạy."},
          ...messages
        ],temperature:0.7, max_tokens:3000})
      });
      const result = await upstream.json().catch(()=>({}));
      if (!upstream.ok) return json({error:result.error?.message || `Nhà cung cấp AI trả về HTTP ${upstream.status}`},502,headers);
      const reply = result.choices?.[0]?.message?.content;
      if (typeof reply !== "string") return json({error:"Phản hồi AI không đúng định dạng OpenAI-compatible."},502,headers);
      return json({reply, uid:user.sub},200,headers);
    } catch (e) { return json({error:"Không thể kết nối nhà cung cấp AI: "+e.message},502,headers); }
  }
};
                                                                   
