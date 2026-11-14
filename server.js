const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const DATA_FILE = path.join(DATA_DIR, "posts.json");
const CHAT_FILE = path.join(DATA_DIR, "chats.json");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const NOTIF_FILE = path.join(DATA_DIR, "notifs.json");
const GROUPS_FILE = path.join(DATA_DIR, "groups.json");
const UPLOAD_DIR = path.join(ROOT, "uploads");
const MAX_UPLOAD = 50 * 1024 * 1024;

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

let posts = [], chats = {}, users = {}, notifs = {}, groups = {};
try { posts = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); } catch (e) { posts = []; }
try { chats = JSON.parse(fs.readFileSync(CHAT_FILE, "utf8")); } catch (e) { chats = {}; }
try { users = JSON.parse(fs.readFileSync(USERS_FILE, "utf8")); } catch (e) { users = {}; }
try { notifs = JSON.parse(fs.readFileSync(NOTIF_FILE, "utf8")); } catch (e) { notifs = {}; }
try { groups = JSON.parse(fs.readFileSync(GROUPS_FILE, "utf8")); } catch (e) { groups = {}; }

const callSignals = {};
const typingStatus = {};

function savePosts() { fs.writeFileSync(DATA_FILE, JSON.stringify(posts, null, 2)); }
function saveChats() { fs.writeFileSync(CHAT_FILE, JSON.stringify(chats, null, 2)); }
function saveUsers() { fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2)); }
function saveNotifs() { fs.writeFileSync(NOTIF_FILE, JSON.stringify(notifs, null, 2)); }
function saveGroups() { fs.writeFileSync(GROUPS_FILE, JSON.stringify(groups, null, 2)); }

const sessions = {};
const ADMIN_B64 = Buffer.from("admin:admin123").toString("base64");

function hashPassword(password, salt) {
  if (!salt) salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, "sha512").toString("hex");
  return { hash, salt };
}
function makeToken() { return crypto.randomBytes(32).toString("hex"); }
function chatKey(a, b) { return [a, b].sort().join("|"); }
function getFollowers(username) { return Object.values(users).filter(function (u) { return u.following && u.following.includes(username); }).map(function (u) { return u.username; }); }
function getFollowing(username) { const u = users[username.toLowerCase()]; return u && u.following ? u.following : []; }
function isPrivate(username) { const u = users[username.toLowerCase()]; return u && u.isPrivate === true; }
function hasPendingRequest(from, to) { const u = users[to.toLowerCase()]; return u && u.followRequests && u.followRequests.includes(from); }
function isBanned(username) { const u = users[username.toLowerCase()]; return u && u.banned === true; }

function addNotif(toUser, notif) {
  if (!notifs[toUser]) notifs[toUser] = [];
  notifs[toUser].unshift({ id: crypto.randomUUID(), ...notif, time: new Date().toISOString(), read: false });
  if (notifs[toUser].length > 100) notifs[toUser] = notifs[toUser].slice(0, 100);
  saveNotifs();
}

function detectMentions(text, author) {
  const mentions = text.match(/@([a-zA-Z0-9_]+)/g) || [];
  const mentioned = new Set();
  mentions.forEach(function (m) {
    const uname = m.slice(1);
    if (uname.toLowerCase() !== author.toLowerCase() && users[uname.toLowerCase()] && !mentioned.has(uname.toLowerCase())) {
      mentioned.add(uname.toLowerCase());
      const realUser = users[uname.toLowerCase()];
      addNotif(realUser.username, { from: author, type: "mention", text: "mentioned you in a post", preview: text.slice(0, 60) });
    }
  });
}

const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".jpg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp",
  ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime"
};
const EXT = { "image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif", "image/webp": ".webp", "video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov" };

function sendJson(res, code, obj) { if (res.headersSent) return; res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify(obj)); }
function clean(s, max) { return typeof s === "string" ? s.trim().slice(0, max) : ""; }
function readJson(req) {
  return new Promise(function (resolve, reject) {
    let data = "";
    req.on("data", function (c) { data += c; if (data.length > 100000) { const e = new Error("Too big"); e.statusCode = 400; reject(e); req.destroy(); } });
    req.on("end", function () { try { resolve(JSON.parse(data || "{}")); } catch (e) { e.statusCode = 400; reject(e); } });
    req.on("error", reject);
  });
}
function getToken(req) { const cookie = req.headers.cookie || ""; const m = cookie.match(/(?:^|;\s*)token=([^;]+)/); return m ? m[1] : null; }
function getUser(req) { const token = getToken(req); return token ? sessions[token] : null; }
function setCookie(res, token) { res.setHeader("Set-Cookie", "token=" + token + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800"); }
function clearCookie(res) { res.setHeader("Set-Cookie", "token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"); }

function sendFile(req, res, file) {
  fs.stat(file, function (err, stat) {
    if (err || !stat.isFile()) { res.writeHead(404); return res.end("Not found"); }
    const type = TYPES[path.extname(file).toLowerCase()] || "application/octet-stream";
    const isUpload = file.startsWith(UPLOAD_DIR);
    const headers = { "Content-Type": type, "Accept-Ranges": "bytes", "X-Content-Type-Options": "nosniff", "Cache-Control": isUpload ? "public, max-age=86400" : "no-cache" };
    const range = req.headers.range;
    const m = range && /^bytes=(\d*)-(\d*)$/.exec(range);
    let stream;
    if (m && (m[1] || m[2])) {
      let start, end;
      if (m[1]) { start = parseInt(m[1], 10); end = m[2] ? Math.min(parseInt(m[2], 10), stat.size - 1) : stat.size - 1; }
      else { start = Math.max(stat.size - parseInt(m[2], 10), 0); end = stat.size - 1; }
      if (start > end || start >= stat.size) { res.writeHead(416, { "Content-Range": "bytes */" + stat.size }); return res.end(); }
      headers["Content-Range"] = "bytes " + start + "-" + end + "/" + stat.size;
      headers["Content-Length"] = end - start + 1;
      res.writeHead(206, headers);
      stream = fs.createReadStream(file, { start, end });
    } else {
      headers["Content-Length"] = stat.size;
      res.writeHead(200, headers);
      stream = fs.createReadStream(file);
    }
    stream.on("error", function () { res.end(); });
    stream.pipe(res);
  });
}

function serveStatic(req, res, pathname) {
  if (pathname === "/" || pathname === "/login" || pathname === "/register") pathname = "/index.html";
  const allowed = ["/index.html", "/style.css", "/app.js", "/admin.html", "/admin.js", "/terms.html", "/privacy.html"];
  let file = null;
  if (allowed.includes(pathname)) file = path.join(ROOT, pathname);
  else if (pathname.startsWith("/uploads/")) file = path.join(UPLOAD_DIR, path.basename(pathname));
  if (!file) { res.writeHead(404); return res.end("Not found"); }
  sendFile(req, res, file);
}

async function handleApi(req, res, url, pathname) {
  const parts = pathname.split("/").filter(Boolean);

  // ----- Admin -----
  if (pathname.startsWith("/api/admin/")) {
    const adminToken = req.headers["x-admin-token"] || "";
    if (adminToken !== ADMIN_B64) return sendJson(res, 401, { error: "Not authorised" });
    if (pathname === "/api/admin/posts" && req.method === "GET") return sendJson(res, 200, posts);
    if (pathname === "/api/admin/users" && req.method === "GET") return sendJson(res, 200, Object.values(users).map(function (u) { return { username: u.username, joined: u.joined, banned: !!u.banned }; }));
    if (parts[2] === "posts" && parts[3] && !parts[4] && req.method === "DELETE") {
      const post = posts.find(function (p) { return p.id === parts[3]; });
      if (!post) return sendJson(res, 404, { error: "Post not found" });
      posts = posts.filter(function (p) { return p.id !== parts[3]; });
      if (post.media) fs.unlink(path.join(UPLOAD_DIR, path.basename(post.media.url)), function () {});
      savePosts(); return sendJson(res, 200, { ok: true });
    }
    if (parts[2] === "posts" && parts[3] && parts[4] === "clear-reports" && req.method === "POST") {
      const post = posts.find(function (p) { return p.id === parts[3]; });
      if (!post) return sendJson(res, 404, { error: "Post not found" });
      post.reports = []; savePosts(); return sendJson(res, 200, post);
    }
    if (parts[2] === "users" && parts[3] && parts[4] === "ban" && req.method === "POST") {
      const record = users[parts[3].toLowerCase()];
      if (!record) return sendJson(res, 404, { error: "User not found" });
      record.banned = true; saveUsers();
      Object.keys(sessions).forEach(function (token) { if (sessions[token] === record.username) delete sessions[token]; });
      return sendJson(res, 200, { ok: true });
    }
    if (parts[2] === "users" && parts[3] && parts[4] === "unban" && req.method === "POST") {
      const record = users[parts[3].toLowerCase()];
      if (!record) return sendJson(res, 404, { error: "User not found" });
      record.banned = false; saveUsers(); return sendJson(res, 200, { ok: true });
    }
    return sendJson(res, 404, { error: "Not found" });
  }

  // ----- Password reset (public — no auth needed) -----
  if (pathname === "/api/auth/security-question" && req.method === "GET") {
    const username = clean(url.searchParams.get("username") || "", 30);
    const record = users[username.toLowerCase()];
    if (!record || !record.securityQuestion) return sendJson(res, 404, { error: "No security question set for this account" });
    return sendJson(res, 200, { question: record.securityQuestion });
  }
  if (pathname === "/api/auth/reset-password" && req.method === "POST") {
    const b = await readJson(req);
    const username = clean(b.username, 30); const answer = clean(b.answer, 100); const newPassword = clean(b.newPassword, 100);
    const record = users[username.toLowerCase()];
    if (!record) return sendJson(res, 404, { error: "User not found" });
    if (!record.securityAnswer) return sendJson(res, 400, { error: "No security question set for this account" });
    const { hash } = hashPassword(answer.toLowerCase(), record.securitySalt);
    if (hash !== record.securityAnswer) return sendJson(res, 401, { error: "Wrong answer" });
    if (newPassword.length < 6) return sendJson(res, 400, { error: "New password must be at least 6 characters" });
    const { hash: newHash, salt: newSalt } = hashPassword(newPassword);
    record.hash = newHash; record.salt = newSalt; saveUsers();
    return sendJson(res, 200, { ok: true });
  }

  // ----- Register -----
  if (pathname === "/api/register" && req.method === "POST") {
    const b = await readJson(req);
    const username = clean(b.username, 30).replace(/[^a-zA-Z0-9_]/g, "");
    const password = clean(b.password, 100);
    if (username.length < 3) return sendJson(res, 400, { error: "Username must be at least 3 characters" });
    if (password.length < 6) return sendJson(res, 400, { error: "Password must be at least 6 characters" });
    if (users[username.toLowerCase()]) return sendJson(res, 400, { error: "That username is already taken" });
    const { hash, salt } = hashPassword(password);
    users[username.toLowerCase()] = { username, hash, salt, bio: "", joined: new Date().toISOString(), following: [], isPrivate: false, followRequests: [], banned: false, settings: { likes: true, replies: true, follows: true, messages: true } };
    saveUsers();
    const token = makeToken(); sessions[token] = username; setCookie(res, token);
    return sendJson(res, 201, { username });
  }

  // ----- Login -----
  if (pathname === "/api/login" && req.method === "POST") {
    const b = await readJson(req);
    const username = clean(b.username, 30); const password = clean(b.password, 100);
    const record = users[username.toLowerCase()];
    if (!record) return sendJson(res, 401, { error: "Wrong username or password" });
    if (record.banned) return sendJson(res, 403, { error: "This account has been banned" });
    const { hash } = hashPassword(password, record.salt);
    if (hash !== record.hash) return sendJson(res, 401, { error: "Wrong username or password" });
    const token = makeToken(); sessions[token] = record.username; setCookie(res, token);
    return sendJson(res, 200, { username: record.username });
  }

  // ----- Logout -----
  if (pathname === "/api/logout" && req.method === "POST") {
    const token = getToken(req); if (token) delete sessions[token]; clearCookie(res);
    return sendJson(res, 200, { ok: true });
  }

  // ----- Who am I -----
  if (pathname === "/api/me" && req.method === "GET") {
    const username = getUser(req); if (!username) return sendJson(res, 401, { error: "Not logged in" });
    const record = users[username.toLowerCase()];
    const following = getFollowing(username); const followers = getFollowers(username);
    return sendJson(res, 200, { username, displayName: record ? (record.displayName || username) : username, bio: record ? record.bio : "", website: record ? (record.website || "") : "", banner: record ? (record.banner || "") : "", following: following.length, followers: followers.length, followingList: following, isPrivate: record ? !!record.isPrivate : false, followRequests: record ? (record.followRequests || []) : [], settings: record ? (record.settings || {}) : {}, hasSecurityQuestion: record ? !!record.securityQuestion : false });
  }

  // ----- Delete account -----
  if (pathname === "/api/me" && req.method === "DELETE") {
    const username = getUser(req); if (!username) return sendJson(res, 401, { error: "Not logged in" });
    const b = await readJson(req); const record = users[username.toLowerCase()];
    if (!record) return sendJson(res, 404, { error: "User not found" });
    const { hash } = hashPassword(clean(b.password, 100), record.salt);
    if (hash !== record.hash) return sendJson(res, 401, { error: "Wrong password" });
    posts = posts.filter(function (p) { return p.author !== username; }); savePosts();
    delete notifs[username]; saveNotifs();
    delete users[username.toLowerCase()]; saveUsers();
    const token = getToken(req); if (token) delete sessions[token]; clearCookie(res);
    return sendJson(res, 200, { ok: true });
  }

  // ----- Update profile -----
  if (pathname === "/api/me/profile" && req.method === "PUT") {
    const username = getUser(req); if (!username) return sendJson(res, 401, { error: "Not logged in" });
    const b = await readJson(req); const record = users[username.toLowerCase()];
    if (!record) return sendJson(res, 404, { error: "User not found" });
    if (b.bio !== undefined) record.bio = clean(b.bio, 160);
    if (b.website !== undefined) record.website = clean(b.website, 100);
    if (b.displayName !== undefined) record.displayName = clean(b.displayName, 50);
    if (b.banner !== undefined && (b.banner === "" || /^\/uploads\/[\w.-]+$/.test(b.banner))) record.banner = b.banner;
    saveUsers(); return sendJson(res, 200, { ok: true });
  }

  // ----- Update bio (legacy) -----
  if (pathname === "/api/me/bio" && req.method === "POST") {
    const username = getUser(req); if (!username) return sendJson(res, 401, { error: "Not logged in" });
    const b = await readJson(req); const bio = clean(b.bio, 160);
    const record = users[username.toLowerCase()]; if (record) { record.bio = bio; saveUsers(); }
    return sendJson(res, 200, { bio });
  }

  // ----- Change password -----
  if (pathname === "/api/me/password" && req.method === "POST") {
    const username = getUser(req); if (!username) return sendJson(res, 401, { error: "Not logged in" });
    const b = await readJson(req); const record = users[username.toLowerCase()];
    if (!record) return sendJson(res, 404, { error: "User not found" });
    const { hash } = hashPassword(clean(b.oldPassword, 100), record.salt);
    if (hash !== record.hash) return sendJson(res, 401, { error: "Current password is wrong" });
    const newPwd = clean(b.newPassword, 100);
    if (newPwd.length < 6) return sendJson(res, 400, { error: "New password must be at least 6 characters" });
    const { hash: newHash, salt: newSalt } = hashPassword(newPwd);
    record.hash = newHash; record.salt = newSalt; saveUsers();
    return sendJson(res, 200, { ok: true });
  }

  // ----- Set security question -----
  if (pathname === "/api/me/security-question" && req.method === "POST") {
    const username = getUser(req); if (!username) return sendJson(res, 401, { error: "Not logged in" });
    const b = await readJson(req);
    const question = clean(b.question, 200); const answer = clean(b.answer, 100);
    if (!question || !answer) return sendJson(res, 400, { error: "Question and answer are required" });
    const record = users[username.toLowerCase()];
    if (!record) return sendJson(res, 404, { error: "User not found" });
    const { hash: aHash, salt: aSalt } = hashPassword(answer.toLowerCase());
    record.securityQuestion = question; record.securityAnswer = aHash; record.securitySalt = aSalt;
    saveUsers(); return sendJson(res, 200, { ok: true });
  }

  // ----- Update privacy -----
  if (pathname === "/api/me/privacy" && req.method === "POST") {
    const username = getUser(req); if (!username) return sendJson(res, 401, { error: "Not logged in" });
    const b = await readJson(req); const record = users[username.toLowerCase()];
    if (record) { record.isPrivate = !!b.isPrivate; saveUsers(); }
    return sendJson(res, 200, { isPrivate: record ? record.isPrivate : false });
  }

  // ----- Notification settings -----
  if (pathname === "/api/me/settings" && req.method === "GET") {
    const username = getUser(req); if (!username) return sendJson(res, 401, { error: "Not logged in" });
    const record = users[username.toLowerCase()]; return sendJson(res, 200, record ? (record.settings || {}) : {});
  }
  if (pathname === "/api/me/settings" && req.method === "POST") {
    const username = getUser(req); if (!username) return sendJson(res, 401, { error: "Not logged in" });
    const b = await readJson(req); const record = users[username.toLowerCase()];
    if (record) { record.settings = { ...(record.settings || {}), ...b }; saveUsers(); }
    return sendJson(res, 200, { ok: true });
  }

  // ----- Follow requests -----
  if (pathname === "/api/me/follow-requests" && req.method === "POST") {
    const username = getUser(req); if (!username) return sendJson(res, 401, { error: "Not logged in" });
    const b = await readJson(req); const from = clean(b.from, 30); const action = b.action;
    const record = users[username.toLowerCase()];
    if (!record || !record.followRequests) return sendJson(res, 400, { error: "Bad request" });
    record.followRequests = record.followRequests.filter(function (r) { return r !== from; });
    if (action === "accept") {
      const fromRecord = users[from.toLowerCase()];
      if (fromRecord) { if (!fromRecord.following) fromRecord.following = []; if (!fromRecord.following.includes(username)) fromRecord.following.push(username); }
      addNotif(from, { from: username, type: "follow", text: "accepted your follow request", preview: "" });
    }
    saveUsers(); return sendJson(res, 200, { ok: true });
  }

  // ----- All users -----
  if (pathname === "/api/users/all" && req.method === "GET") {
    const me = getUser(req); if (!me) return sendJson(res, 401, { error: "Not logged in" });
    const myFollowing = getFollowing(me);
    return sendJson(res, 200, Object.values(users).filter(function (u) { return u.username !== me && !u.banned; }).map(function (u) {
      return { username: u.username, displayName: u.displayName || u.username, bio: u.bio || "", followers: getFollowers(u.username).length, isFollowing: myFollowing.includes(u.username), isPrivate: !!u.isPrivate, hasPending: hasPendingRequest(me, u.username) };
    }));
  }

  // ----- Follow -----
  if (pathname === "/api/follow" && req.method === "POST") {
    const me = getUser(req); if (!me) return sendJson(res, 401, { error: "Not logged in" });
    const b = await readJson(req); const target = clean(b.username, 30);
    if (!target || target === me) return sendJson(res, 400, { error: "Bad request" });
    const targetRecord = users[target.toLowerCase()];
    if (!targetRecord) return sendJson(res, 404, { error: "User not found" });
    const myRecord = users[me.toLowerCase()];
    if (!myRecord.following) myRecord.following = [];
    const alreadyFollowing = myRecord.following.includes(target);
    if (alreadyFollowing) { myRecord.following = myRecord.following.filter(function (u) { return u !== target; }); saveUsers(); return sendJson(res, 200, { following: false, pending: false, followers: getFollowers(target).length }); }
    if (targetRecord.isPrivate) {
      if (!targetRecord.followRequests) targetRecord.followRequests = [];
      if (!targetRecord.followRequests.includes(me)) { targetRecord.followRequests.push(me); addNotif(target, { from: me, type: "follow_request", text: "sent you a follow request", preview: "" }); }
      saveUsers(); return sendJson(res, 200, { following: false, pending: true, followers: getFollowers(target).length });
    }
    myRecord.following.push(target);
    addNotif(target, { from: me, type: "follow", text: "started following you", preview: "" });
    saveUsers(); return sendJson(res, 200, { following: true, pending: false, followers: getFollowers(target).length });
  }

  // ----- Posts -----
  if (pathname === "/api/posts" && req.method === "GET") {
    const me = getUser(req); if (!me) return sendJson(res, 401, { error: "Not logged in" });
    const myFollowing = getFollowing(me);
    const feed = url.searchParams.get("feed") || "all";
    let visible = posts.filter(function (p) {
      if (isBanned(p.author)) return false;
      if (p.author === me) return true;
      if (!isPrivate(p.author)) return true;
      return myFollowing.includes(p.author);
    });
    if (feed === "following") { visible = visible.filter(function (p) { return p.author === me || myFollowing.includes(p.author); }); }
    else if (feed === "foryou") { visible = visible.slice().sort(function (a, b) { const sa=(a.likes.length*2)+(a.replies.length*1.5)+(a.reposts.length); const sb=(b.likes.length*2)+(b.replies.length*1.5)+(b.reposts.length); return sb-sa; }); return sendJson(res, 200, visible.slice(0, 50)); }
    return sendJson(res, 200, visible.slice().reverse());
  }
  if (pathname === "/api/posts" && req.method === "POST") {
    const author = getUser(req); if (!author) return sendJson(res, 401, { error: "Not logged in" });
    const b = await readJson(req); const text = clean(b.text, 280);
    let media = null;
    if (b.media && typeof b.media.url === "string" && /^\/uploads\/[\w.-]+$/.test(b.media.url) && (b.media.type === "image" || b.media.type === "video")) media = { url: b.media.url, type: b.media.type };
    let mediaList = [];
    if (Array.isArray(b.mediaList) && b.mediaList.length) mediaList = b.mediaList.filter(function (m) { return m && typeof m.url === "string" && /^\/uploads\/[\w.-]+$/.test(m.url) && (m.type === "image" || m.type === "video"); }).slice(0, 4);
    let quotedPost = null;
    if (b.quotedPostId) { const qp = posts.find(function (p) { return p.id === b.quotedPostId; }); if (qp) quotedPost = { id: qp.id, author: qp.author, text: (qp.text || "").slice(0, 150), media: qp.media || null }; }
    let poll = null;
    if (b.poll && Array.isArray(b.poll.options) && b.poll.options.length >= 2) { poll = { options: b.poll.options.slice(0, 4).map(function (opt) { return { text: clean(String(opt), 60), votes: [] }; }) }; }
    if (!text && !media && !mediaList.length && !poll && !quotedPost) return sendJson(res, 400, { error: "Write something or add a photo first" });
    const post = { id: crypto.randomUUID(), author, text, media: mediaList.length ? mediaList[0] : media, mediaList: mediaList.length ? mediaList : (media ? [media] : []), time: new Date().toISOString(), likes: [], reposts: [], reports: [], replies: [], quotedPost: quotedPost || null, poll: poll || null };
    posts.push(post); savePosts();
    if (text) detectMentions(text, author);
    return sendJson(res, 201, post);
  }

  // ----- Upload -----
  if (pathname === "/api/upload" && req.method === "POST") {
    if (!getUser(req)) return sendJson(res, 401, { error: "Not logged in" });
    const type = (req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
    const ext = EXT[type]; if (!ext) { req.resume(); return sendJson(res, 400, { error: "Only JPG PNG GIF WEBP MP4 WEBM MOV allowed" }); }
    const name = crypto.randomBytes(12).toString("hex") + ext; const dest = path.join(UPLOAD_DIR, name);
    return await new Promise(function (resolve) {
      const out = fs.createWriteStream(dest); let size = 0, tooBig = false;
      req.on("data", function (c) { size += c.length; if (size <= MAX_UPLOAD) out.write(c); else tooBig = true; });
      req.on("end", function () { out.end(function () { if (tooBig || size === 0) { fs.unlink(dest, function () {}); sendJson(res, tooBig ? 413 : 400, { error: tooBig ? "File too big" : "Empty file" }); } else sendJson(res, 201, { url: "/uploads/" + name, type: type.startsWith("video/") ? "video" : "image" }); resolve(); }); });
      req.on("error", function () { out.destroy(); fs.unlink(dest, function () {}); resolve(); });
    });
  }

  // ----- Post actions -----
  if (parts[1] === "posts" && parts[2]) {
    const post = posts.find(function (p) { return p.id === parts[2]; });
    if (!post) return sendJson(res, 404, { error: "Post not found" });
    const action = parts[3];
    if (req.method === "POST" && action === "vote") {
      const user = getUser(req); if (!user) return sendJson(res, 401, { error: "Not logged in" });
      const b = await readJson(req);
      if (!post.poll) return sendJson(res, 400, { error: "No poll" });
      const idx = parseInt(b.optionIndex, 10);
      if (isNaN(idx) || idx < 0 || idx >= post.poll.options.length) return sendJson(res, 400, { error: "Invalid option" });
      post.poll.options.forEach(function (opt) { opt.votes = opt.votes.filter(function (v) { return v !== user; }); });
      post.poll.options[idx].votes.push(user);
      savePosts(); return sendJson(res, 200, post);
    }
    if (req.method === "POST" && action === "reply-like") {
      const user = getUser(req); if (!user) return sendJson(res, 401, { error: "Not logged in" });
      const b = await readJson(req); const idx = parseInt(b.replyIndex, 10);
      if (isNaN(idx) || idx < 0 || idx >= post.replies.length) return sendJson(res, 400, { error: "Invalid reply" });
      if (!post.replies[idx].likes) post.replies[idx].likes = [];
      const li = post.replies[idx].likes.indexOf(user);
      if (li === -1) post.replies[idx].likes.push(user); else post.replies[idx].likes.splice(li, 1);
      savePosts(); return sendJson(res, 200, post);
    }
    if (req.method === "POST" && action === "toggle") {
      const user = getUser(req); if (!user) return sendJson(res, 401, { error: "Not logged in" });
      const b = await readJson(req);
      if (!["likes","reposts","reports"].includes(b.kind)) return sendJson(res, 400, { error: "Bad request" });
      const list = post[b.kind]; const i = list.indexOf(user); const adding = i === -1;
      if (adding) list.push(user); else list.splice(i, 1);
      savePosts();
      if (adding && user !== post.author) { const ar = users[post.author.toLowerCase()]; const settings = ar ? (ar.settings || {}) : {}; const preview = (post.text || "").slice(0, 60); const msgs = { likes: "liked your post", reposts: "reposted your post", reports: null }; if (msgs[b.kind] && settings.likes !== false) addNotif(post.author, { from: user, type: b.kind, text: msgs[b.kind], preview }); }
      return sendJson(res, 200, post);
    }
    if (req.method === "POST" && action === "reply") {
      const author = getUser(req); if (!author) return sendJson(res, 401, { error: "Not logged in" });
      const b = await readJson(req); const text = clean(b.text, 280);
      if (!text) return sendJson(res, 400, { error: "Write a reply first" });
      post.replies.push({ author, text, time: new Date().toISOString(), likes: [] });
      savePosts();
      if (author !== post.author) { const ar = users[post.author.toLowerCase()]; const settings = ar ? (ar.settings || {}) : {}; if (settings.replies !== false) addNotif(post.author, { from: author, type: "reply", text: "replied to your post", preview: (post.text||"").slice(0,60) }); }
      if (text) detectMentions(text, author);
      return sendJson(res, 201, post);
    }
    if (req.method === "PUT" && !action) {
      const user = getUser(req); if (!user) return sendJson(res, 401, { error: "Not logged in" });
      if (user !== post.author) return sendJson(res, 403, { error: "You can only edit your own posts" });
      const b = await readJson(req); const text = clean(b.text, 280);
      if (!text && !post.media) return sendJson(res, 400, { error: "A post needs some text" });
      post.text = text; savePosts(); return sendJson(res, 200, post);
    }
    if (req.method === "DELETE" && !action) {
      const user = getUser(req); if (!user) return sendJson(res, 401, { error: "Not logged in" });
      if (user !== post.author) return sendJson(res, 403, { error: "You can only delete your own posts" });
      posts = posts.filter(function (p) { return p.id !== post.id; });
      if (post.media) fs.unlink(path.join(UPLOAD_DIR, path.basename(post.media.url)), function () {});
      savePosts(); return sendJson(res, 200, { ok: true });
    }
  }

  // ----- Notifications -----
  if (pathname === "/api/notifs" && req.method === "GET") { const user = getUser(req); if (!user) return sendJson(res, 401, { error: "Not logged in" }); return sendJson(res, 200, notifs[user] || []); }
  if (pathname === "/api/notifs/read" && req.method === "POST") { const user = getUser(req); if (!user) return sendJson(res, 401, { error: "Not logged in" }); if (notifs[user]) { notifs[user].forEach(function (n) { n.read = true; }); saveNotifs(); } return sendJson(res, 200, { ok: true }); }

  // ----- Private chat -----
  if (pathname === "/api/chat" && req.method === "GET") {
    const user = getUser(req); if (!user) return sendJson(res, 401, { error: "Not logged in" });
    const other = clean(url.searchParams.get("with") || "", 30); const since = parseInt(url.searchParams.get("since") || "0", 10) || 0;
    if (!other) return sendJson(res, 400, { error: "Missing with" });
    const key = chatKey(user, other);
    const msgs = (chats[key] || []).filter(function (m) { return m.ts > since; });
    let changed = false;
    (chats[key] || []).forEach(function (m) { if (m.from === other && !m.read) { m.read = true; changed = true; } });
    if (changed) saveChats();
    return sendJson(res, 200, msgs);
  }
  if (pathname === "/api/chat" && req.method === "POST") {
    const from = getUser(req); if (!from) return sendJson(res, 401, { error: "Not logged in" });
    const b = await readJson(req); const to = clean(b.to, 30); const text = clean(b.text, 1000);
    if (!to || !text) return sendJson(res, 400, { error: "Missing fields" });
    if (from === to) return sendJson(res, 400, { error: "Cannot chat with yourself" });
    const key = chatKey(from, to); if (!chats[key]) chats[key] = [];
    const msg = { from, text, ts: Date.now(), read: false };
    chats[key].push(msg);
    if (chats[key].length > 500) chats[key] = chats[key].slice(-500);
    saveChats();
    const tr = users[to.toLowerCase()]; const ts = tr ? (tr.settings || {}) : {};
    if (ts.messages !== false) addNotif(to, { from, type: "chat", text: "sent you a message", preview: text.slice(0, 80) });
    return sendJson(res, 201, msg);
  }
  if (pathname === "/api/chat/typing" && req.method === "POST") {
    const from = getUser(req); if (!from) return sendJson(res, 401, { error: "Not logged in" });
    const b = await readJson(req); const to = clean(b.to, 30); if (!to) return sendJson(res, 400, { error: "Missing to" });
    const key = chatKey(from, to); typingStatus[key] = { from, ts: Date.now() };
    return sendJson(res, 200, { ok: true });
  }
  if (pathname === "/api/chat/typing" && req.method === "GET") {
    const me = getUser(req); if (!me) return sendJson(res, 401, { error: "Not logged in" });
    const other = clean(url.searchParams.get("with") || "", 30); if (!other) return sendJson(res, 400, { error: "Missing with" });
    const key = chatKey(me, other); const status = typingStatus[key];
    const isTyping = status && status.from !== me && (Date.now() - status.ts) < 4000;
    return sendJson(res, 200, { typing: isTyping, who: isTyping ? other : null });
  }

  // ----- Group chats -----
  if (pathname === "/api/groups" && req.method === "GET") { const me = getUser(req); if (!me) return sendJson(res, 401, { error: "Not logged in" }); return sendJson(res, 200, Object.values(groups).filter(function (g) { return g.members.includes(me); })); }
  if (pathname === "/api/groups" && req.method === "POST") {
    const me = getUser(req); if (!me) return sendJson(res, 401, { error: "Not logged in" });
    const b = await readJson(req); const name = clean(b.name, 50); if (!name) return sendJson(res, 400, { error: "Group needs a name" });
    const members = [me]; if (Array.isArray(b.members)) b.members.forEach(function (m) { const u = clean(m, 30); if (u && u !== me && users[u.toLowerCase()] && !members.includes(u)) members.push(u); });
    const group = { id: crypto.randomUUID(), name, creator: me, members, messages: [], created: new Date().toISOString() };
    groups[group.id] = group; saveGroups();
    members.forEach(function (m) { if (m !== me) addNotif(m, { from: me, type: "group", text: "added you to group: "+name, preview: "" }); });
    return sendJson(res, 201, group);
  }
  if (parts[1] === "groups" && parts[2] && !parts[3] && req.method === "GET") {
    const me = getUser(req); if (!me) return sendJson(res, 401, { error: "Not logged in" });
    const group = groups[parts[2]]; if (!group) return sendJson(res, 404, { error: "Group not found" });
    if (!group.members.includes(me)) return sendJson(res, 403, { error: "Not a member" });
    const since = parseInt(url.searchParams.get("since") || "0", 10) || 0;
    return sendJson(res, 200, group.messages.filter(function (m) { return m.ts > since; }));
  }
  if (parts[1] === "groups" && parts[2] && parts[3] === "messages" && req.method === "POST") {
    const me = getUser(req); if (!me) return sendJson(res, 401, { error: "Not logged in" });
    const group = groups[parts[2]]; if (!group) return sendJson(res, 404, { error: "Group not found" });
    if (!group.members.includes(me)) return sendJson(res, 403, { error: "Not a member" });
    const b = await readJson(req); const text = clean(b.text, 1000); if (!text) return sendJson(res, 400, { error: "Write something" });
    const msg = { from: me, text, ts: Date.now() }; group.messages.push(msg);
    if (group.messages.length > 500) group.messages = group.messages.slice(-500);
    saveGroups(); group.members.forEach(function (m) { if (m !== me) addNotif(m, { from: me, type: "group", text: "sent a message in "+group.name, preview: text.slice(0,80) }); });
    return sendJson(res, 201, msg);
  }

  // ----- Stories -----
  if (pathname === "/api/stories" && req.method === "GET") {
    if (!getUser(req)) return sendJson(res, 401, { error: "Not logged in" });
    const SF = path.join(DATA_DIR, "stories.json"); let stories = []; try { stories = JSON.parse(fs.readFileSync(SF, "utf8")); } catch (e) {}
    const cutoff = new Date(Date.now() - 24*60*60*1000).toISOString(); stories = stories.filter(function (s) { return s.time > cutoff && !isBanned(s.author); });
    fs.writeFileSync(SF, JSON.stringify(stories, null, 2)); return sendJson(res, 200, stories.slice().reverse());
  }
  if (pathname === "/api/stories" && req.method === "POST") {
    const author = getUser(req); if (!author) return sendJson(res, 401, { error: "Not logged in" });
    const b = await readJson(req); const text = clean(b.text, 280);
    let media = null; if (b.media && typeof b.media.url === "string" && /^\/uploads\/[\w.-]+$/.test(b.media.url)) media = b.media;
    if (!text && !media) return sendJson(res, 400, { error: "Add a photo or text" });
    const SF = path.join(DATA_DIR, "stories.json"); let stories = []; try { stories = JSON.parse(fs.readFileSync(SF, "utf8")); } catch (e) {}
    const story = { id: crypto.randomUUID(), author, text, media, time: new Date().toISOString(), views: [] };
    stories.push(story); fs.writeFileSync(SF, JSON.stringify(stories, null, 2)); return sendJson(res, 201, story);
  }
  if (parts[1] === "stories" && parts[2] && parts[3] === "view" && req.method === "POST") {
    const me = getUser(req); if (!me) return sendJson(res, 401, { error: "Not logged in" });
    const SF = path.join(DATA_DIR, "stories.json"); let stories = []; try { stories = JSON.parse(fs.readFileSync(SF, "utf8")); } catch (e) {}
    const story = stories.find(function (s) { return s.id === parts[2]; });
    if (story && !story.views.includes(me)) { story.views.push(me); fs.writeFileSync(SF, JSON.stringify(stories, null, 2)); }
    return sendJson(res, 200, { ok: true, views: story ? story.views : [] });
  }
  if (parts[1] === "stories" && parts[2] && parts[3] === "views" && req.method === "GET") {
    const me = getUser(req); if (!me) return sendJson(res, 401, { error: "Not logged in" });
    const SF = path.join(DATA_DIR, "stories.json"); let stories = []; try { stories = JSON.parse(fs.readFileSync(SF, "utf8")); } catch (e) {}
    const story = stories.find(function (s) { return s.id === parts[2]; });
    if (!story) return sendJson(res, 404, { error: "Story not found" });
    if (story.author !== me) return sendJson(res, 403, { error: "Not your story" });
    return sendJson(res, 200, { views: story.views || [], count: (story.views || []).length });
  }

  // ----- Call signaling -----
  if (pathname === "/api/signal" && req.method === "POST") {
    const from = getUser(req); if (!from) return sendJson(res, 401, { error: "Not logged in" });
    const b = await readJson(req); const to = clean(b.to, 30); if (!to) return sendJson(res, 400, { error: "Missing to" });
    if (!callSignals[to]) callSignals[to] = [];
    callSignals[to].push({ from, type: b.type, data: b.data, ts: Date.now() });
    if (callSignals[to].length > 20) callSignals[to] = callSignals[to].slice(-20);
    return sendJson(res, 200, { ok: true });
  }
  if (pathname === "/api/signal" && req.method === "GET") {
    const me = getUser(req); if (!me) return sendJson(res, 401, { error: "Not logged in" });
    const signals = callSignals[me] || []; callSignals[me] = []; return sendJson(res, 200, signals);
  }

  // ----- Active users -----
  if (pathname === "/api/users" && req.method === "GET") {
    if (!getUser(req)) return sendJson(res, 401, { error: "Not logged in" });
    const cutoff = Date.now() - 10 * 60 * 1000; const seen = new Set();
    posts.forEach(function (p) { if (new Date(p.time).getTime() > cutoff && !isBanned(p.author)) seen.add(p.author); });
    return sendJson(res, 200, Array.from(seen));
  }

  sendJson(res, 404, { error: "Not found" });
}

const server = http.createServer(async function (req, res) {
  try {
    const url = new URL(req.url, "http://localhost");
    const pathname = decodeURIComponent(url.pathname);
    if (pathname.startsWith("/api/")) return await handleApi(req, res, url, pathname);
    serveStatic(req, res, pathname);
  } catch (e) { sendJson(res, e.statusCode || 500, { error: e.statusCode ? "Bad request" : "Server error" }); }
});

server.listen(PORT, function () {
  console.log("GhostChat is running at http://localhost:" + PORT);
  console.log("Press Ctrl + C to stop it.");
});