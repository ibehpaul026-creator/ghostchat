const ADMIN_B64 = btoa("admin:admin123");
let allPosts = [], allUsers = [], currentTab = "reported";

function adminLogin() {
  const user = document.getElementById("adminUser").value.trim();
  const pass = document.getElementById("adminPass").value.trim();
  if (btoa(user + ":" + pass) !== ADMIN_B64) { document.getElementById("loginErr").textContent = "Wrong username or password."; return; }
  document.getElementById("loginScreen").style.display = "none";
  document.getElementById("adminPanel").style.display = "block";
  loadAll();
}

function adminLogout() { document.getElementById("loginScreen").style.display = "flex"; document.getElementById("adminPanel").style.display = "none"; }

document.getElementById("adminPass").addEventListener("keydown", function (e) { if (e.key === "Enter") adminLogin(); });

async function adminFetch(path, method, body) {
  const res = await fetch(path, { method: method || "GET", headers: Object.assign({ "x-admin-token": ADMIN_B64 }, body ? { "Content-Type": "application/json" } : {}), body: body ? JSON.stringify(body) : undefined });
  return res.json();
}

async function loadAll() {
  allPosts = await adminFetch("/api/admin/posts");
  allUsers = await adminFetch("/api/admin/users");
  updateStats();
  renderTab(currentTab);
}

function updateStats() {
  document.getElementById("statPosts").textContent = allPosts.length;
  document.getElementById("statReported").textContent = allPosts.filter(function (p) { return p.reports && p.reports.length > 0; }).length;
  document.getElementById("statUsers").textContent = allUsers.length;
  document.getElementById("statBanned").textContent = allUsers.filter(function (u) { return u.banned; }).length;
}

function showTab(name) {
  currentTab = name;
  document.querySelectorAll(".tab-btn").forEach(function (b, i) { b.classList.toggle("active", ["reported","all","users"][i] === name); });
  document.getElementById("tabReported").style.display = name === "reported" ? "block" : "none";
  document.getElementById("tabAll").style.display = name === "all" ? "block" : "none";
  document.getElementById("tabUsers").style.display = name === "users" ? "block" : "none";
  renderTab(name);
}

function renderTab(name) {
  if (name === "reported") renderPosts(document.getElementById("tabReported"), allPosts.filter(function (p) { return p.reports && p.reports.length > 0; }), true);
  else if (name === "all") renderPosts(document.getElementById("tabAll"), allPosts.slice().reverse(), false);
  else if (name === "users") renderUsers(document.getElementById("tabUsers"));
}

function renderPosts(container, posts, reportedOnly) {
  container.textContent = "";
  if (!posts.length) { container.innerHTML = "<div class='empty'>" + (reportedOnly ? "No reported posts. 🎉" : "No posts yet.") + "</div>"; return; }
  posts.forEach(function (p) {
    const item = document.createElement("div"); item.className = "item";
    const info = document.createElement("div"); info.className = "item-info";
    info.innerHTML = "<div class='item-author'>@" + p.author + "</div><div class='item-text'>" + (p.text || "[no text]").slice(0, 200) + "</div><div class='item-time'>" + new Date(p.time).toLocaleString() + "</div>" + (p.reports && p.reports.length ? "<div class='item-reports'>⚑ " + p.reports.length + " report" + (p.reports.length > 1 ? "s" : "") + " — by: " + p.reports.join(", ") + "</div>" : "");
    const btns = document.createElement("div"); btns.className = "btn-group";
    if (p.reports && p.reports.length) {
      const clearBtn = document.createElement("button"); clearBtn.className = "btn btn-clear"; clearBtn.textContent = "Clear Reports";
      clearBtn.addEventListener("click", async function () { await adminFetch("/api/admin/posts/" + p.id + "/clear-reports", "POST"); loadAll(); });
      btns.appendChild(clearBtn);
    }
    const delBtn = document.createElement("button"); delBtn.className = "btn btn-delete"; delBtn.textContent = "Delete Post";
    delBtn.addEventListener("click", async function () { if (!confirm("Delete this post?")) return; await adminFetch("/api/admin/posts/" + p.id, "DELETE"); loadAll(); });
    btns.appendChild(delBtn);
    item.appendChild(info); item.appendChild(btns); container.appendChild(item);
  });
}

function renderUsers(container) {
  container.textContent = "";
  if (!allUsers.length) { container.innerHTML = "<div class='empty'>No users yet.</div>"; return; }
  allUsers.forEach(function (u) {
    const item = document.createElement("div"); item.className = "item";
    const info = document.createElement("div"); info.className = "item-info";
    info.innerHTML = "<div class='item-author'>@" + u.username + "</div><div class='item-time'>Joined: " + new Date(u.joined).toLocaleDateString() + "</div>" + (u.banned ? "<div class='item-banned'>🚫 BANNED</div>" : "");
    const btns = document.createElement("div"); btns.className = "btn-group";
    const userPosts = allPosts.filter(function (p) { return p.author === u.username; }).length;
    const countSpan = document.createElement("span"); countSpan.style.cssText = "font-size:13px;color:#5a5a7a;padding:7px 4px"; countSpan.textContent = userPosts + " posts";
    btns.appendChild(countSpan);
    if (u.banned) {
      const unbanBtn = document.createElement("button"); unbanBtn.className = "btn btn-unban"; unbanBtn.textContent = "✓ Unban";
      unbanBtn.addEventListener("click", async function () { await adminFetch("/api/admin/users/" + u.username + "/unban", "POST"); loadAll(); });
      btns.appendChild(unbanBtn);
    } else {
      const banBtn = document.createElement("button"); banBtn.className = "btn btn-ban"; banBtn.textContent = "🚫 Ban User";
      banBtn.addEventListener("click", async function () { if (!confirm("Ban @" + u.username + "? They will not be able to log in.")) return; await adminFetch("/api/admin/users/" + u.username + "/ban", "POST"); loadAll(); });
      btns.appendChild(banBtn);
    }
    item.appendChild(info); item.appendChild(btns); container.appendChild(item);
  });
  }