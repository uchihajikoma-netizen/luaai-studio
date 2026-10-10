
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  addDoc,
  getDocs,
  getDoc,
  query,
  orderBy,
  limit,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyA_HOYY1QQw0x3nvGa8ww63fdtjtX0rt_Y",
  authDomain: "luaai-studio.firebaseapp.com",
  projectId: "luaai-studio",
  storageBucket: "luaai-studio.firebasestorage.app",
  messagingSenderId: "476650134947",
  appId: "1:476650134947:web:6d2a1795eb134b32790e16"
};

const WORKER_URL = "https://luaai-mini-api.uchihajikoma.workers.dev";

const $ = id => document.getElementById(id);

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
const provider = new GoogleAuthProvider();

let currentUser = null;
let activeChatId = null;
let messages = [];
let chats = [];
let wallpapers = [];
let busy = false;

const scripts = [
  {
    id: "hello",
    title: "Hello World",
    tag: "Cơ bản",
    desc: "Bắt đầu với câu lệnh print trong Lua.",
    code: 'print("Hello, LuaAI Studio!")'
  },
  {
    id: "table",
    title: "Làm việc với table",
    tag: "Lua",
    desc: "Tạo bảng, thêm dữ liệu và duyệt phần tử.",
    code: 'local items = {"Lua", "Luau", "Studio"}\nfor index, value in ipairs(items) do\n    print(index, value)\nend'
  },
  {
    id: "function",
    title: "Hàm có tham số",
    tag: "Cơ bản",
    desc: "Tái sử dụng logic bằng function.",
    code: 'local function add(a, b)\n    return a + b\nend\nprint(add(2, 3))'
  },
  {
    id: "module",
    title: "ModuleScript mẫu",
    tag: "Roblox Luau",
    desc: "Tạo module dùng lại trong Roblox Studio.",
    code: 'local Example = {}\n\nfunction Example.greet(name)\n    return "Xin chào, " .. name\nend\n\nreturn Example'
  },
  {
    id: "pcall",
    title: "Xử lý lỗi an toàn",
    tag: "Lua",
    desc: "Dùng pcall để xử lý lỗi.",
    code: 'local ok, result = pcall(function()\n    return 10 / 2\nend)\nif ok then\n    print(result)\nelse\n    warn(result)\nend'
  },
  {
    id: "loop",
    title: "Vòng lặp while",
    tag: "Cơ bản",
    desc: "Lặp theo điều kiện.",
    code: 'local count = 1\nwhile count <= 5 do\n    print(count)\n    count += 1\nend'
  }
];

function toast(message) {
  const t = $("toast");

  if (!t) {
    console.log(message);
    return;
  }

  t.textContent = message;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 3000);
}

function esc(s = "") {
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[c]);
}

function showView(view) {
  ["chat", "scripts", "wallpapers"].forEach(v => {
    const el = $(`${v}View`);
    if (el) el.classList.toggle("hidden", v !== view);
  });

  document.querySelectorAll(".nav-item").forEach(b => {
    b.classList.toggle("active", b.dataset.view === view);
  });

  const title = $("viewTitle");

  if (title) {
    title.textContent = ({
      chat: "Trò chuyện AI",
      scripts: "Thư viện script",
      wallpapers: "Wallpaper"
    })[view] || "LuaAI Studio";
  }

  closeMenu();
}

function openMenu() {
  $("sidebar")?.classList.add("open");
  $("scrim")?.classList.add("show");
}

function closeMenu() {
  $("sidebar")?.classList.remove("open");
  $("scrim")?.classList.remove("show");
}

function resetChat() {
  activeChatId = null;
  messages = [];

  const root = $("messages");

  if (root) {
    root.innerHTML = "";
    root.append(welcomeNode());
  }

  if ($("promptInput")) $("promptInput").value = "";

  showView("chat");
}

function welcomeNode() {
  const d = document.createElement("div");
  d.className = "welcome";

  d.innerHTML = `
    <div class="welcome-logo">L</div>
    <h1>Chào mừng đến LuaAI Studio</h1>
    <p>Trợ lý AI dành cho Lua, Luau và ý tưởng sáng tạo của bạn.</p>
    <div class="suggestions">
      <button data-prompt="Giải thích sự khác nhau giữa Lua và Luau bằng ví dụ.">✦ Học Lua / Luau</button>
      <button data-prompt="Viết một module Lua có chú thích và ví dụ sử dụng.">⌘ Tạo module</button>
      <button data-prompt="Giúp tôi tìm lỗi trong đoạn code sau và giải thích cách sửa.">⚡ Gỡ lỗi code</button>
    </div>`;

  return d;
}

function renderMessages() {
  const root = $("messages");
  if (!root) return;

  root.innerHTML = "";

  if (!messages.length) {
    root.append(welcomeNode());
    return;
  }

  for (const m of messages) {
    const el = document.createElement("div");

    el.className =
      "message " + (m.role === "user" ? "user" : "assistant");

    const body = m.role === "assistant"
      ? renderMarkdownLite(m.content)
      : esc(m.content).replace(/\n/g, "<br>");

    el.innerHTML = `
      <div class="message-avatar">${m.role === "user" ? "Bạn" : "L"}</div>
      <div class="message-body">${body}</div>`;

    root.append(el);
  }

  root.querySelectorAll("[data-copy]").forEach(b => {
    b.addEventListener("click", () => {
      copyText(decodeURIComponent(b.dataset.copy));
    });
  });

  root.scrollTop = root.scrollHeight;
}

function renderMarkdownLite(text) {
  let s = esc(text);

  s = s.replace(
    /```(?:lua|luau|javascript|js|json|text)?\n([\s\S]*?)```/gi,
    (_, code) =>
      `<pre><code>${code.trim()}</code></pre>
       <div class="code-actions">
         <button class="small-btn" data-copy="${encodeURIComponent(code.trim())}">Sao chép code</button>
       </div>`
  );

  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");

  return s.split(/\n{2,}/)
    .map(p => `<p>${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

async function copyText(s) {
  try {
    await navigator.clipboard.writeText(s);
    toast("Đã sao chép");
  } catch {
    const ta = document.createElement("textarea");
    ta.value = s;
    document.body.append(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    toast("Đã sao chép");
  }
}

function renderScripts(filter = "") {
  const root = $("scriptGrid");
  if (!root) return;

  root.innerHTML = "";

  scripts
    .filter(s =>
      (s.title + " " + s.desc + " " + s.tag)
        .toLowerCase()
        .includes(filter.toLowerCase())
    )
    .forEach(s => {
      const card = document.createElement("article");
      card.className = "script-card";

      card.innerHTML = `
        <span class="tag">${esc(s.tag)}</span>
        <h3>${esc(s.title)}</h3>
        <p>${esc(s.desc)}</p>
        <pre><code>${esc(s.code)}</code></pre>
        <div class="script-actions">
          <button class="secondary" data-copy-script="${s.id}">Sao chép</button>
          <button class="primary" data-use-script="${s.id}">Hỏi AI</button>
        </div>`;

      root.append(card);
    });

  root.querySelectorAll("[data-copy-script]").forEach(b => {
    b.onclick = () => {
      const s = scripts.find(x => x.id === b.dataset.copyScript);
      if (s) copyText(s.code);
    };
  });

  root.querySelectorAll("[data-use-script]").forEach(b => {
    b.onclick = () => {
      const s = scripts.find(x => x.id === b.dataset.useScript);
      if (!s) return;

      showView("chat");

      $("promptInput").value =
        `Giải thích và cải thiện mẫu Lua này:\n\n\`\`\`lua\n${s.code}\n\`\`\``;

      $("promptInput").focus();
    };
  });
}

function renderChatList() {
  const root = $("chatList");
  if (!root) return;

  root.innerHTML = "";

  if (!currentUser) {
    root.innerHTML =
      '<p class="muted small">Đăng nhập để đồng bộ lịch sử.</p>';
    return;
  }

  if (!chats.length) {
    root.innerHTML =
      '<p class="muted small">Chưa có cuộc trò chuyện.</p>';
    return;
  }

  chats.forEach(c => {
    const b = document.createElement("button");
    b.className = "history-item";
    b.textContent = c.title || "Cuộc trò chuyện mới";
    b.onclick = () => loadChat(c.id);
    root.append(b);
  });
}

async function loadChats() {
  if (!currentUser) return;

  try {
    const q = query(
      collection(db, "users", currentUser.uid, "chats"),
      orderBy("updatedAt", "desc"),
      limit(40)
    );

    const snap = await getDocs(q);

    chats = snap.docs.map(d => ({
      id: d.id,
      ...d.data()
    }));

    renderChatList();
  } catch (e) {
    console.error("Lỗi tải lịch sử:", e);
    toast("Không tải được lịch sử chat.");
  }
}

async function saveChat() {
  if (!currentUser || !activeChatId) return;

  await setDoc(
    doc(db, "users", currentUser.uid, "chats", activeChatId),
    {
      title: (
        messages.find(m => m.role === "user")?.content ||
        "Cuộc trò chuyện mới"
      ).slice(0, 70),
      messages,
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );

  await loadChats();
}

async function loadChat(id) {
  if (!currentUser) return;

  try {
    const snap = await getDoc(
      doc(db, "users", currentUser.uid, "chats", id)
    );

    if (!snap.exists()) return;

    activeChatId = id;
    messages = snap.data().messages || [];

    renderMessages();
    showView("chat");
  } catch (e) {
    console.error(e);
    toast("Không tải được chat.");
  }
}

// GỬI TIN NHẮN: LẤY TOKEN FIREBASE VÀ GỬI ĐẾN WORKER
async function askAI(prompt) {
  if (busy) return;

  const input = $("promptInput");
  const sendBtn = $("sendBtn");
  const cleanPrompt = String(prompt || "").trim();

  if (!cleanPrompt) {
    toast("Bạn hãy nhập tin nhắn trước nhé!");
    return;
  }

  busy = true;

  if (sendBtn) sendBtn.disabled = true;

  const userMessage = {
    role: "user",
    content: cleanPrompt
  };

  const thinkingMessage = {
    role: "assistant",
    content: "Đang suy nghĩ…"
  };

  messages.push(userMessage, thinkingMessage);

  if (input) input.value = "";

  renderMessages();

  try {
    // KIỂM TRA TÀI KHOẢN FIREBASE
    const user = auth.currentUser;

    if (!user) {
      throw new Error(
        "Firebase chưa xác nhận đăng nhập. Hãy tải lại trang và đăng nhập Google."
      );
    }

    // LẤY FIREBASE ID TOKEN
    const idToken = await user.getIdToken();

    // GỬI TOKEN ĐẾN CLOUDFLARE WORKER
    const response = await fetch(`${WORKER_URL}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${idToken}`
      },
      body: JSON.stringify({
        messages: messages
          .filter(m => m !== thinkingMessage)
          .map(m => ({
            role: m.role,
            content: m.content
          }))
      })
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        data.error || `API lỗi (${response.status})`
      );
    }

    if (
      typeof data.reply !== "string" ||
      !data.reply.trim()
    ) {
      throw new Error("AI chưa trả về nội dung.");
    }

    thinkingMessage.content = data.reply;
    renderMessages();

    // LƯU LỊCH SỬ CHAT NẾU CÓ TÀI KHOẢN
    if (currentUser) {
      try {
        if (!activeChatId) {
          const chatRef = await addDoc(
            collection(db, "users", currentUser.uid, "chats"),
            {
              title: cleanPrompt.slice(0, 70),
              messages: [],
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp()
            }
          );

          activeChatId = chatRef.id;
        }

        await saveChat();
      } catch (saveError) {
        console.error("Lỗi lưu lịch sử:", saveError);
        toast("AI đã trả lời nhưng chưa lưu được lịch sử.");
      }
    }
  } catch (error) {
    console.error("Lỗi gọi AI:", error);

    thinkingMessage.content =
      "Không thể kết nối AI: " +
      (error.message || "Lỗi không xác định") +
      "\n\nHãy kiểm tra Worker URL, xác thực Firebase, API key và cấu hình Gemini.";

    renderMessages();
  } finally {
    busy = false;

    if (sendBtn) sendBtn.disabled = false;
  }
}

async function signIn() {
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    if (
      [
        "auth/popup-blocked",
        "auth/operation-not-supported-in-this-environment"
      ].includes(e.code)
    ) {
      try {
        await signInWithRedirect(auth, provider);
      } catch (redirectError) {
        console.error(redirectError);
        toast("Đăng nhập lỗi: " + redirectError.message);
      }
    } else {
      console.error(e);
      toast("Đăng nhập lỗi: " + e.message);
    }
  }
}

async function uploadWallpaper(file) {
  if (!currentUser) {
    toast("Hãy đăng nhập Google trước.");
    return;
  }

  if (!file) return;

  if (
    !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
    file.size > 8 * 1024 * 1024
  ) {
    toast("Chọn PNG/JPG/WEBP nhỏ hơn 8 MB.");
    return;
  }

  const status = $("uploadStatus");

  if (status) status.textContent = "Đang tải ảnh lên…";

  try {
    const safeName = file.name.replace(
      /[^a-zA-Z0-9._-]/g,
      "_"
    );

    const path =
      `wallpapers/${currentUser.uid}/${Date.now()}_${safeName}`;

    const r = storageRef(storage, path);

    await uploadBytes(r, file, {
      contentType: file.type
    });

    const url = await getDownloadURL(r);

    await addDoc(
      collection(db, "users", currentUser.uid, "wallpapers"),
      {
        name: file.name,
        url,
        path,
        contentType: file.type,
        size: file.size,
        createdAt: serverTimestamp()
      }
    );

    if (status) {
      status.innerHTML =
        `Đã tải lên. <a href="${esc(url)}" target="_blank" rel="noopener">Mở URL ảnh</a>`;
    }

    toast("Tải wallpaper thành công");

    await loadWallpapers();
  } catch (e) {
    console.error(e);

    if (status) {
      status.textContent =
        "Tải lên thất bại: " + e.message +
        " — kiểm tra Firebase Storage.";
    }
  }
}

async function loadWallpapers() {
  if (!currentUser) return;

  try {
    const snap = await getDocs(
      query(
        collection(db, "users", currentUser.uid, "wallpapers"),
        orderBy("createdAt", "desc"),
        limit(60)
      )
    );

    wallpapers = snap.docs.map(d => ({
      id: d.id,
      ...d.data()
    }));

    const root = $("wallpaperGrid");
    if (!root) return;

    root.innerHTML = "";

    if (!wallpapers.length) {
      root.innerHTML =
        '<p class="muted">Chưa có ảnh nào được tải lên.</p>';
      return;
    }

    wallpapers.forEach(w => {
      const card = document.createElement("article");
      card.className = "wallpaper-card";

      card.innerHTML = `
        <img src="${esc(w.url)}" alt="${esc(w.name)}" loading="lazy">
        <div class="url">${esc(w.url)}</div>
        <div class="script-actions">
          <button class="secondary" data-wall-copy="${esc(w.id)}">Sao chép URL</button>
          <a class="primary" style="text-align:center;text-decoration:none;padding:8px;border-radius:9px;font-size:12px"
             href="${esc(w.url)}" target="_blank" rel="noopener">Mở ảnh</a>
        </div>`;

      root.append(card);
    });

    root.querySelectorAll("[data-wall-copy]").forEach(b => {
      b.onclick = () => {
        const w = wallpapers.find(
          x => x.id === b.dataset.wallCopy
        );

        if (w) copyText(w.url);
      };
    });
  } catch (e) {
    console.error(e);

    const root = $("wallpaperGrid");

    if (root) {
      root.innerHTML =
        '<p class="muted">Không tải được lịch sử ảnh. Kiểm tra Firestore Rules.</p>';
    }
  }
}

// THEO DÕI TRẠNG THÁI ĐĂNG NHẬP
onAuthStateChanged(auth, async user => {
  currentUser = user;

  if (user) {
    if ($("userName")) {
      $("userName").textContent =
        user.displayName || "Người dùng";
    }

    if ($("userEmail")) {
      $("userEmail").textContent =
        user.email || "Đã đăng nhập";
    }

    if ($("avatar")) {
      $("avatar").innerHTML = user.photoURL
        ? `<img src="${esc(user.photoURL)}" alt="">`
        : "L";
    }

    $("signInBtn")?.classList.add("hidden");
    $("signOutBtn")?.classList.remove("hidden");

    await Promise.allSettled([
      loadChats(),
      loadWallpapers()
    ]);
  } else {
    if ($("userName")) {
      $("userName").textContent = "Chưa đăng nhập";
    }

    if ($("userEmail")) {
      $("userEmail").textContent = "Lịch sử riêng tư";
    }

    if ($("avatar")) {
      $("avatar").textContent = "?";
    }

    $("signInBtn")?.classList.remove("hidden");
    $("signOutBtn")?.classList.add("hidden");

    chats = [];
    renderChatList();

    const grid = $("wallpaperGrid");

    if (grid) {
      grid.innerHTML =
        '<p class="muted">Đăng nhập để xem lịch sử ảnh.</p>';
    }
  }
});

// KẾT NỐI CÁC NÚT GIAO DIỆN
if ($("signInBtn")) {
  $("signInBtn").onclick = signIn;
}

if ($("signOutBtn")) {
  $("signOutBtn").onclick = () => signOut(auth);
}

if ($("newChat")) {
  $("newChat").onclick = resetChat;
}

if ($("topNewChat")) {
  $("topNewChat").onclick = resetChat;
}

if ($("menuBtn")) {
  $("menuBtn").onclick = openMenu;
}

if ($("closeSidebar")) {
  $("closeSidebar").onclick = closeMenu;
}

if ($("scrim")) {
  $("scrim").onclick = closeMenu;
}

document.querySelectorAll(".nav-item").forEach(b => {
  b.onclick = () => showView(b.dataset.view);
});

if ($("scriptSearch")) {
  $("scriptSearch").oninput = e => {
    renderScripts(e.target.value);
  };
}

if ($("wallpaperFile")) {
  $("wallpaperFile").onchange = e => {
    uploadWallpaper(e.target.files[0]);
  };
}

// XỬ LÝ FORM GỬI TIN NHẮN
const chatForm = $("chatForm");

if (chatForm) {
  chatForm.addEventListener("submit", e => {
    e.preventDefault();

    const prompt = $("promptInput")?.value?.trim();

    if (!prompt) {
      toast("Bạn hãy nhập tin nhắn trước nhé!");
      return;
    }

    askAI(prompt);
  });
} else {
  console.error(
    "Không tìm thấy phần tử #chatForm trong index.html"
  );
}

// ENTER ĐỂ GỬI, SHIFT + ENTER ĐỂ XUỐNG DÒNG
if ($("promptInput")) {
  $("promptInput").addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();

      if (
        chatForm &&
        typeof chatForm.requestSubmit === "function"
      ) {
        chatForm.requestSubmit();
      } else {
        const prompt = $("promptInput").value.trim();

        if (prompt) askAI(prompt);
      }
    }
  });
}

// CÁC CÂU HỎI GỢI Ý
document.addEventListener("click", e => {
  const b = e.target.closest("[data-prompt]");

  if (b && $("promptInput")) {
    $("promptInput").value = b.dataset.prompt;
    $("promptInput").focus();
  }
});

getRedirectResult(auth).catch(e => {
  console.error("Redirect login:", e);
});

renderScripts();
    
