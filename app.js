// ===== Auth =====
const authScreen = document.getElementById("authScreen");
const appEl = document.getElementById("app");
const authTitle = document.getElementById("authTitle");
const authSub = document.getElementById("authSub");
const authUser = document.getElementById("authUser");
const authPass = document.getElementById("authPass");
const authBtn = document.getElementById("authBtn");
const authErr = document.getElementById("authErr");
const authSwitchBtn = document.getElementById("authSwitchBtn");
const logoutBtn = document.getElementById("logoutBtn");

let me = "";
let isRegister = false;

function showAuth(register) {
  isRegister = register;
  authTitle.textContent = register ? "Create account" : "Welcome back";
  authSub.textContent = register ? "Join GhostChat" : "Log in to continue";
  authBtn.textContent = register ? "Register" : "Log in";
  authSwitchBtn.textContent = register ? "Log in" : "Register";
  authErr.textContent = "";
  authUser.value = ""; authPass.value = "";
  authScreen.style.display = "flex"; appEl.style.display = "none";
}

async function tryAuth() {
  const username = authUser.value.trim(), password = authPass.value.trim();
  if (!username) { authErr.textContent = "Please enter a username."; return; }
  if (!password) { authErr.textContent = "Please enter a password."; return; }
  if (isRegister && username.length < 3) { authErr.textContent = "Username must be at least 3 characters."; return; }
  if (isRegister && password.length < 6) { authErr.textContent = "Password must be at least 6 characters."; return; }
  authBtn.disabled = true; authBtn.textContent = isRegister ? "Registering..." : "Logging in..."; authErr.textContent = "";
  try {
    const res = await fetch(isRegister ? "/api/register" : "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
    const data = await res.json();
    if (!res.ok) { authErr.textContent = data.error || "Something went wrong."; authBtn.disabled = false; authBtn.textContent = isRegister ? "Register" : "Log in"; return; }
    me = data.username; startApp();
  } catch (e) { authErr.textContent = "Cannot reach the server."; authBtn.disabled = false; authBtn.textContent = isRegister ? "Register" : "Log in"; }
}
authBtn.addEventListener("click", tryAuth);
authPass.addEventListener("keydown", function (e) { if (e.key === "Enter") tryAuth(); });
authSwitchBtn.addEventListener("click", function () { showAuth(!isRegister); });
logoutBtn.addEventListener("click", async function () { try { await fetch("/api/logout", { method: "POST" }); } catch (e) {} me = ""; clearInterval(mainTimer); showAuth(false); });

async function checkSession() {
  try { const res = await fetch("/api/me"); if (res.ok) { const d = await res.json(); me = d.username; startApp(); } else showAuth(false); }
  catch (e) { showAuth(false); }
}

// ===== Helpers =====
const COLORS = ["#7c3aed","#e0245e","#0ea5a4","#f59e0b","#2563eb","#16a34a"];
function colorFor(n) { let h=0; for (const c of n) h=(h*31+c.codePointAt(0))%997; return COLORS[h%COLORS.length]; }
function initial(n) { return (Array.from(n)[0]||"?").toUpperCase(); }
function loadList(key) { try { return JSON.parse(localStorage.getItem(key))||[]; } catch(e) { return []; } }
function saveList(key,list) { try { localStorage.setItem(key,JSON.stringify(list)); } catch(e) {} }
function makeBtn(cls,text,fn) { const b=document.createElement("button"); b.className=cls; b.textContent=text; b.addEventListener("click",fn); return b; }
function fmt(ts) { return new Date(ts).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}); }
function timeAgo(iso) { const d=Date.now()-new Date(iso).getTime(),m=Math.floor(d/60000); if(m<1)return "now"; if(m<60)return m+"m"; const h=Math.floor(m/60); if(h<24)return h+"h"; return Math.floor(h/24)+"d"; }

// ===== Dark mode =====
function applyTheme(dark) { document.body.classList.toggle("dark",dark); document.body.classList.toggle("light",!dark); const tb=document.getElementById("themeBtn"); if(tb)tb.textContent=dark?"☀️":"🌙"; }
let savedDark=true; try { const v=localStorage.getItem("dark"); savedDark=v===null?true:v==="1"; } catch(e) {}
applyTheme(savedDark);
document.getElementById("themeBtn").addEventListener("click",function(){ const dark=!document.body.classList.contains("dark"); applyTheme(dark); try{localStorage.setItem("dark",dark?"1":"0");}catch(e){} });

// ===== API =====
async function api(url,method,body){ const res=await fetch(url,{method:method||"GET",headers:body?{"Content-Type":"application/json"}:{},body:body?JSON.stringify(body):undefined}); if(!res.ok){let msg="Something went wrong";try{msg=(await res.json()).error||msg;}catch(e){} throw new Error(msg);} return res.json(); }

// ===== State =====
let posts=[],lastJson="",currentPage="home",savedIds=[],myFollowingList=[],blockedUsers=[],mutedUsers=[];
const openReplies=new Set(); let focusReplyFor=null, mainTimer=null;

// ===== Block and mute =====
function isBlocked(u){return blockedUsers.includes(u);} function isMuted(u){return mutedUsers.includes(u);}
function blockUser(u){if(!blockedUsers.includes(u)){blockedUsers.push(u);saveList("blocked_"+me,blockedUsers);}renderFeed();alert(u+" blocked.");}
function unblockUser(u){blockedUsers=blockedUsers.filter(function(x){return x!==u;});saveList("blocked_"+me,blockedUsers);renderFeed();alert(u+" unblocked.");}
function muteUser(u){if(!mutedUsers.includes(u)){mutedUsers.push(u);saveList("muted_"+me,mutedUsers);}renderFeed();alert(u+" muted.");}
function unmuteUser(u){mutedUsers=mutedUsers.filter(function(x){return x!==u;});saveList("muted_"+me,mutedUsers);renderFeed();alert(u+" unmuted.");}

// ===== Bottom nav =====
const pages = {
  home: document.getElementById("homePage"),
  search: document.getElementById("searchSection"),
  notifs: document.getElementById("notifsSection"),
  messages: document.getElementById("messagesSection"),
  profile: document.getElementById("profileSection"),
  channels: document.getElementById("channelsSection")
};
const navBtns = {
  home: document.getElementById("navHome"),
  search: document.getElementById("navSearch"),
  notifs: document.getElementById("navNotifs"),
  messages: document.getElementById("navMessages"),
  profile: document.getElementById("navProfile"),
  channels: document.getElementById("navChannels")
};

function showPage(name) {
  currentPage = name;
  Object.keys(pages).forEach(function (k) { const p=pages[k]; if(p){p.style.display="none";p.classList.remove("active");} });
  Object.values(navBtns).forEach(function (b) { if(b)b.classList.remove("active"); });
  const fab = document.getElementById("composeFab");
  if (pages[name]) { pages[name].style.display="block"; pages[name].classList.add("active"); }
  if (navBtns[name]) navBtns[name].classList.add("active");
  if (fab) fab.style.display = name === "home" ? "flex" : "none";
  if (name === "notifs") loadNotifsPage();
  if (name === "messages") loadDmList();
  if (name === "profile") loadProfilePage();
  if (name === "channels") loadChannelsPage();
  if (name === "search") { const sp=document.getElementById("searchPageBox"); if(sp)sp.focus(); }
}
Object.keys(navBtns).forEach(function (k) { const b=navBtns[k]; if(b)b.addEventListener("click",function(){showPage(k);}); });

// ===== Compose modal =====
const composeModal = document.getElementById("composeModal");
const composeFab = document.getElementById("composeFab");
const composeClose = document.getElementById("composeClose");
if (composeFab) composeFab.addEventListener("click", function () { composeModal.classList.add("open"); const pt=document.getElementById("postText"); if(pt)pt.focus(); });
if (composeClose) composeClose.addEventListener("click", function () { composeModal.classList.remove("open"); });
composeModal.addEventListener("click", function (e) { if (e.target === composeModal) composeModal.classList.remove("open"); });

// ===== Counter and photo =====
const postText = document.getElementById("postText");
const postBtn = document.getElementById("postBtn");
const photoInput = document.getElementById("photoInput");
const fileName = document.getElementById("fileName");
const counter = document.getElementById("counter");
const emojiBtn = document.getElementById("emojiBtn");
const emojiPanel = document.getElementById("emojiPanel");

function updateCounter(){const left=280-(postText?postText.value.length:0);if(counter){counter.textContent=left;counter.className=left<=0?"limit":left<=20?"warn":"";}}
if(postText)postText.addEventListener("input",updateCounter);
if(photoInput)photoInput.addEventListener("change",function(){const files=Array.from(photoInput.files);if(fileName)fileName.textContent=files.length?files.length+" file"+(files.length>1?"s":"")+" selected":"";});
["😀","😂","😍","🥰","😎","🤔","😢","😡","👍","👏","🙏","🔥","❤️","🎉","💯","🙌"].forEach(function(e){
  const b=document.createElement("button"); b.type="button"; b.textContent=e;
  b.addEventListener("click",function(){if(postText&&postText.value.length<280){postText.value+=e;updateCounter();}if(postText)postText.focus();});
  if(emojiPanel)emojiPanel.appendChild(b);
});
if(emojiBtn)emojiBtn.addEventListener("click",function(){if(emojiPanel)emojiPanel.classList.toggle("open");});

// ===== Poll compose =====
const pollToggleBtn = document.getElementById("pollToggleBtn");
const pollCompose = document.getElementById("pollCompose");
const removePollBtn = document.getElementById("removePollBtn");
const addPollOptionBtn = document.getElementById("addPollOptionBtn");
const pollOptionsEl = document.getElementById("pollOptions");
let pollEnabled = false;

function updateRemoveButtons(){
  const opts = pollOptionsEl ? pollOptionsEl.querySelectorAll(".poll-compose-option") : [];
  opts.forEach(function(row){
    const btn = row.querySelector(".remove-opt");
    if(btn) btn.style.visibility = opts.length > 2 ? "visible" : "hidden";
  });
}

if(pollToggleBtn) pollToggleBtn.addEventListener("click", function(){
  pollEnabled = !pollEnabled;
  if(pollCompose) pollCompose.classList.toggle("open", pollEnabled);
  pollToggleBtn.classList.toggle("active", pollEnabled);
});

if(removePollBtn) removePollBtn.addEventListener("click", function(){
  pollEnabled = false;
  if(pollCompose) pollCompose.classList.remove("open");
  if(pollToggleBtn) pollToggleBtn.classList.remove("active");
});

if(addPollOptionBtn) addPollOptionBtn.addEventListener("click", function(){
  const opts = pollOptionsEl ? pollOptionsEl.querySelectorAll(".poll-compose-option") : [];
  if(opts.length >= 4) return;
  const row = document.createElement("div"); row.className = "poll-compose-option";
  const input = document.createElement("input"); input.type="text"; input.placeholder="Option "+(opts.length+1); input.maxLength=60; input.className="poll-option-input";
  const removeBtn = document.createElement("button"); removeBtn.className="remove-opt"; removeBtn.textContent="✕";
  removeBtn.addEventListener("click", function(){ row.remove(); updateRemoveButtons(); });
  row.appendChild(input); row.appendChild(removeBtn);
  if(pollOptionsEl) pollOptionsEl.appendChild(row);
  updateRemoveButtons();
});

function getPollData(){
  if(!pollEnabled || !pollOptionsEl) return null;
  const inputs = pollOptionsEl.querySelectorAll(".poll-option-input");
  const options = Array.from(inputs).map(function(i){return i.value.trim();}).filter(Boolean);
  if(options.length < 2) return null;
  return { options };
}

function resetPoll(){
  pollEnabled = false;
  if(pollCompose) pollCompose.classList.remove("open");
  if(pollToggleBtn) pollToggleBtn.classList.remove("active");
  if(pollOptionsEl){
    const inputs = pollOptionsEl.querySelectorAll(".poll-option-input");
    inputs.forEach(function(i){i.value="";});
    const extra = Array.from(pollOptionsEl.querySelectorAll(".poll-compose-option")).slice(2);
    extra.forEach(function(r){r.remove();});
  }
}

// ===== Post button =====
if(postBtn) postBtn.addEventListener("click", async function(){
  const text = postText ? postText.value.trim() : "";
  const files = photoInput ? Array.from(photoInput.files).slice(0,4) : [];
  const poll = getPollData();
  if(!text && !files.length && !poll){ alert("Write something, add a photo, or create a poll first"); return; }
  postBtn.disabled=true; postBtn.textContent="Posting...";
  try{
    const mediaList=[];
    for(const file of files){
      if(file.size>50*1024*1024) throw new Error("File too big (max 50 MB)");
      const up=await fetch("/api/upload",{method:"POST",headers:{"Content-Type":file.type||"application/octet-stream"},body:file});
      if(!up.ok){let msg="Upload failed";try{msg=(await up.json()).error||msg;}catch(e){}throw new Error(msg);}
      mediaList.push(await up.json());
    }
    await api("/api/posts","POST",{text,media:mediaList[0]||null,mediaList,poll});
    if(postText)postText.value=""; if(photoInput)photoInput.value=""; if(fileName)fileName.textContent=""; updateCounter(); resetPoll();
    composeModal.classList.remove("open"); await loadPosts(true);
  }catch(e){alert(e.message);}
  postBtn.disabled=false; postBtn.textContent="Post";
});

// ===== Text with tags and mentions =====
function addTextWithTags(el, text){
  text.split(/(#\w+|@\w+)/g).forEach(function(part){
    if(/^#\w+$/.test(part)){
      const tag=document.createElement("span"); tag.className="hashtag"; tag.textContent=part;
      tag.addEventListener("click",function(){showPage("search");const sp=document.getElementById("searchPageBox");if(sp){sp.value=part;sp.dispatchEvent(new Event("input"));}});
      el.appendChild(tag);
    } else if(/^@\w+$/.test(part)){
      const mention=document.createElement("span"); mention.className="mention"; mention.textContent=part;
      el.appendChild(mention);
    } else {
      el.appendChild(document.createTextNode(part));
    }
  });
}

// ===== Copy link =====
function showCopyToast(){
  const toast=document.getElementById("copyToast"); if(!toast)return;
  toast.classList.add("show"); setTimeout(function(){toast.classList.remove("show");},2000);
}
function copyPostLink(postId){
  const link = window.location.origin + "/?post=" + postId;
  navigator.clipboard.writeText(link).then(function(){showCopyToast();}).catch(function(){alert("Link: "+link);});
}

// ===== Quote repost =====
let quoteTargetPost = null;
const quoteModal = document.getElementById("quoteModal");
const quoteCancelBtn = document.getElementById("quoteCancelBtn");
const quoteSubmitBtn = document.getElementById("quoteSubmitBtn");
const quoteText = document.getElementById("quoteText");
const quotePreview = document.getElementById("quotePreview");

function openQuoteModal(post){
  quoteTargetPost = post;
  if(quotePreview){ quotePreview.innerHTML="<b>@"+post.author+"</b> "+((post.text||"").slice(0,100)); }
  if(quoteText) quoteText.value="";
  if(quoteModal) quoteModal.classList.add("open");
  if(quoteText) quoteText.focus();
}
if(quoteCancelBtn) quoteCancelBtn.addEventListener("click",function(){if(quoteModal)quoteModal.classList.remove("open");quoteTargetPost=null;});
if(quoteSubmitBtn) quoteSubmitBtn.addEventListener("click",async function(){
  if(!quoteTargetPost) return;
  const text = quoteText ? quoteText.value.trim() : "";
  if(!text){alert("Add a comment to your quote.");return;}
  quoteSubmitBtn.disabled=true; quoteSubmitBtn.textContent="Posting...";
  try{
    await api("/api/posts","POST",{text,quotedPostId:quoteTargetPost.id});
    if(quoteModal)quoteModal.classList.remove("open"); quoteTargetPost=null;
    await loadPosts(true);
  }catch(e){alert(e.message);}
  quoteSubmitBtn.disabled=false; quoteSubmitBtn.textContent="Post";
});

// ===== Welcome message =====
function showWelcomeMessage() {
  const feed = document.getElementById("feed"); if (!feed) return;
  if (feed.querySelector(".welcome-card")) return;
  const starters = [
    "👋 Introduce yourself to GhostChat!",
    "💭 What's on your mind today?",
    "🌍 Share something interesting you learned recently",
    "🎯 What are your goals for this week?",
    "🔥 What's the most exciting thing happening in your world?"
  ];
  const card = document.createElement("div"); card.className = "welcome-card";
  card.innerHTML = "<h2>👻 Welcome to GhostChat!</h2><p>You are one of the first people here. Start the conversation and make this place your own.</p>";
  const startersEl = document.createElement("div"); startersEl.className = "conversation-starters";
  starters.forEach(function (s) {
    const btn = document.createElement("button"); btn.className = "starter-btn"; btn.textContent = s;
    btn.addEventListener("click", function () {
      if(composeModal) composeModal.classList.add("open");
      if(postText) { postText.value = s + " "; postText.focus(); updateCounter(); }
    });
    startersEl.appendChild(btn);
  });
  card.appendChild(startersEl);
  feed.insertBefore(card, feed.firstChild);
}

// ===== Build one post =====
function buildPost(p){
  const wrap = document.createElement("div"); wrap.className="post-card";
  if(p.reports.includes(me)){const n=document.createElement("div");n.className="reported-notice";n.textContent="You reported this. ";n.appendChild(makeBtn("link-btn","Undo",function(){toggle(p.id,"reports");}));wrap.appendChild(n);return wrap;}
  const mine=p.author===me;
  if(!mine&&(isBlocked(p.author)||isMuted(p.author))){const n=document.createElement("div");n.className="reported-notice";n.textContent=(isBlocked(p.author)?"Blocked: ":"Muted: ")+p.author+" ";n.appendChild(makeBtn("link-btn",isBlocked(p.author)?"Unblock":"Unmute",function(){if(isBlocked(p.author))unblockUser(p.author);else unmuteUser(p.author);}));wrap.appendChild(n);return wrap;}

  const top=document.createElement("div"); top.className="post-top";
  const av=document.createElement("div"); av.className="post-avatar"; av.style.background=colorFor(p.author); av.textContent=initial(p.author);
  const meta=document.createElement("div"); meta.className="post-meta";
  const auth=document.createElement("div"); auth.className="post-author"; auth.textContent=p.author;
  const handle=document.createElement("div"); handle.className="post-handle"; handle.textContent="@"+p.author.toLowerCase()+" · "+timeAgo(p.time);
  meta.appendChild(auth); meta.appendChild(handle); top.appendChild(av); top.appendChild(meta);

  if(!mine){
    const isF=myFollowingList.includes(p.author);
    const fBtn=document.createElement("button"); fBtn.className="post-follow-btn"+(isF?" following":""); fBtn.textContent=isF?"Following":"Follow";
    fBtn.addEventListener("click",async function(){
      try{const r=await api("/api/follow","POST",{username:p.author});if(r.following){if(!myFollowingList.includes(p.author))myFollowingList.push(p.author);fBtn.textContent="Following";fBtn.classList.add("following");}else{myFollowingList=myFollowingList.filter(function(x){return x!==p.author;});fBtn.textContent="Follow";fBtn.classList.remove("following");}}catch(e){alert(e.message);}
    });
    const menu=document.createElement("div"); menu.className="post-menu";
    const menuBtn=document.createElement("button"); menuBtn.className="post-menu-btn"; menuBtn.textContent="···";
    const dropdown=document.createElement("div"); dropdown.className="post-menu-dropdown";
    const muteItem=document.createElement("button"); muteItem.className="post-menu-item"; muteItem.textContent=isMuted(p.author)?"Unmute @"+p.author:"Mute @"+p.author;
    muteItem.addEventListener("click",function(){dropdown.classList.remove("open");if(isMuted(p.author))unmuteUser(p.author);else muteUser(p.author);});
    const blockItem=document.createElement("button"); blockItem.className="post-menu-item danger"; blockItem.textContent=isBlocked(p.author)?"Unblock @"+p.author:"Block @"+p.author;
    blockItem.addEventListener("click",function(){dropdown.classList.remove("open");if(isBlocked(p.author))unblockUser(p.author);else blockUser(p.author);});
    dropdown.appendChild(muteItem); dropdown.appendChild(blockItem);
    menuBtn.addEventListener("click",function(e){e.stopPropagation();dropdown.classList.toggle("open");});
    document.addEventListener("click",function(){dropdown.classList.remove("open");},{once:true});
    menu.appendChild(menuBtn); menu.appendChild(dropdown);
    top.appendChild(fBtn); top.appendChild(menu);
  }
  wrap.appendChild(top);

  const body=document.createElement("div"); body.className="post-body";
  const textEl=document.createElement("div"); textEl.className="post-text"; addTextWithTags(textEl,p.text||""); body.appendChild(textEl);

  if(p.quotedPost){
    const qw=document.createElement("div"); qw.className="quote-post";
    const qa=document.createElement("div"); qa.className="quote-author"; qa.textContent="@"+p.quotedPost.author;
    const qt=document.createElement("div"); qt.className="quote-text"; qt.textContent=(p.quotedPost.text||"").slice(0,120);
    qw.appendChild(qa); qw.appendChild(qt); body.appendChild(qw);
  }

  const mediaItems=p.mediaList&&p.mediaList.length?p.mediaList:(p.media?[p.media]:[]);
  if(mediaItems.length){
    const grid=document.createElement("div"); grid.className="media-grid count-"+mediaItems.length;
    mediaItems.forEach(function(m){const wrap2=document.createElement("div");wrap2.className="media-item"+(mediaItems.length===1?" count-1":"");const isV=m.type==="video";const el=document.createElement(isV?"video":"img");if(isV){el.controls=true;el.preload="metadata";}el.src=m.url;wrap2.appendChild(el);grid.appendChild(wrap2);});
    body.appendChild(grid);
  }

  if(p.poll && p.poll.options){
    const totalVotes=p.poll.options.reduce(function(s,o){return s+(o.votes?o.votes.length:0);},0);
    const userVotedIdx=p.poll.options.findIndex(function(o){return o.votes&&o.votes.includes(me);});
    const hasVoted=userVotedIdx>=0;
    const pollWrap=document.createElement("div"); pollWrap.className="poll-wrap";
    p.poll.options.forEach(function(opt,idx){
      const pct=totalVotes>0?Math.round((opt.votes?opt.votes.length:0)/totalVotes*100):0;
      const optEl=document.createElement("div"); optEl.className="poll-option"+(hasVoted?" voted":"");
      const bar=document.createElement("div"); bar.className="poll-bar"; bar.style.width=hasVoted?pct+"%":"0%";
      const optText=document.createElement("span"); optText.className="poll-option-text"; optText.textContent=opt.text+(hasVoted&&idx===userVotedIdx?" ✓":"");
      const optPct=document.createElement("span"); optPct.className="poll-option-pct"; optPct.textContent=hasVoted?pct+"%":"";
      optEl.appendChild(bar); optEl.appendChild(optText); optEl.appendChild(optPct);
      if(!hasVoted){optEl.addEventListener("click",async function(){try{await api("/api/posts/"+p.id+"/vote","POST",{optionIndex:idx});await loadPosts(true);}catch(e){alert(e.message);}});}
      pollWrap.appendChild(optEl);
    });
    const total=document.createElement("div"); total.className="poll-total"; total.textContent=totalVotes+(totalVotes===1?" vote":" votes");
    pollWrap.appendChild(total); body.appendChild(pollWrap);
  }

  wrap.appendChild(body);

  const actions=document.createElement("div"); actions.className="post-actions";
  const liked=p.likes.includes(me);
  const likeBtn=document.createElement("button"); likeBtn.className="post-action-btn like-action"+(liked?" liked":"");
  likeBtn.innerHTML="<span class='icon'>"+(liked?"♥":"♡")+"</span><span>"+(p.likes.length||"")+"</span>";
  likeBtn.addEventListener("click",function(){toggle(p.id,"likes");});

  const replyBtnEl=document.createElement("button"); replyBtnEl.className="post-action-btn reply-action";
  replyBtnEl.innerHTML="<span class='icon'>💬</span><span>"+(p.replies.length||"")+"</span>";
  replyBtnEl.addEventListener("click",function(){if(openReplies.has(p.id))openReplies.delete(p.id);else{openReplies.add(p.id);focusReplyFor=p.id;}renderFeed();});

  const reposted=p.reposts.includes(me);
  const repostBtn=document.createElement("button"); repostBtn.className="post-action-btn repost-action"+(reposted?" reposted":"");
  repostBtn.innerHTML="<span class='icon'>🔁</span><span>"+(p.reposts.length||"")+"</span>";
  repostBtn.addEventListener("click",function(e){
    e.stopPropagation();
    const menu2=document.createElement("div"); menu2.style.cssText="position:fixed;background:var(--card2);border:1px solid var(--border);border-radius:16px;padding:8px;z-index:1000;min-width:180px;box-shadow:0 8px 32px rgba(0,0,0,0.5)";
    const rect=repostBtn.getBoundingClientRect(); menu2.style.top=(rect.bottom+8)+"px"; menu2.style.left=rect.left+"px";
    const repostItem=document.createElement("button"); repostItem.style.cssText="display:block;width:100%;background:none;border:none;padding:12px 16px;text-align:left;color:var(--text);font-size:14px;cursor:pointer;border-radius:10px;font-family:Inter,sans-serif";
    repostItem.textContent=reposted?"✕ Undo Repost":"🔁 Repost";
    repostItem.addEventListener("click",function(){document.body.removeChild(menu2);toggle(p.id,"reposts");});
    const quoteItem=document.createElement("button"); quoteItem.style.cssText="display:block;width:100%;background:none;border:none;padding:12px 16px;text-align:left;color:var(--text);font-size:14px;cursor:pointer;border-radius:10px;font-family:Inter,sans-serif";
    quoteItem.textContent="✍️ Quote Repost";
    quoteItem.addEventListener("click",function(){document.body.removeChild(menu2);openQuoteModal(p);});
    menu2.appendChild(repostItem); menu2.appendChild(quoteItem); document.body.appendChild(menu2);
    setTimeout(function(){document.addEventListener("click",function rm(){document.body.contains(menu2)&&document.body.removeChild(menu2);document.removeEventListener("click",rm);},{once:true});},10);
  });

  const isSaved=savedIds.includes(p.id);
  const saveBtn=document.createElement("button"); saveBtn.className="post-action-btn save-action"+(isSaved?" saved":"");
  saveBtn.innerHTML="<span class='icon'>🔖</span>";
  saveBtn.addEventListener("click",function(){if(savedIds.includes(p.id))savedIds=savedIds.filter(function(x){return x!==p.id;});else savedIds.push(p.id);saveList("savedIds_"+me,savedIds);renderFeed();});

  const copyBtn=document.createElement("button"); copyBtn.className="post-action-btn";
  copyBtn.innerHTML="<span class='icon'>🔗</span>";
  copyBtn.addEventListener("click",function(){copyPostLink(p.id);});

  actions.appendChild(likeBtn); actions.appendChild(replyBtnEl); actions.appendChild(repostBtn); actions.appendChild(saveBtn); actions.appendChild(copyBtn);

  if(mine){
    const editBtn=document.createElement("button"); editBtn.className="post-action-btn"; editBtn.innerHTML="<span class='icon'>✏️</span>";
    editBtn.addEventListener("click",function(){
      if(wrap.querySelector(".edit-box"))return;
      const box=document.createElement("textarea"); box.className="edit-box"; box.maxLength=280; box.value=p.text||"";
      const saveBtn2=makeBtn("full-btn","Save",async function(){try{await api("/api/posts/"+p.id,"PUT",{text:box.value});await loadPosts(true);}catch(e){alert(e.message);}});
      saveBtn2.style.cssText="margin-top:8px;padding:8px;font-size:14px";
      textEl.style.display="none"; textEl.after(box); box.after(saveBtn2); box.focus();
    });
    const delBtn=document.createElement("button"); delBtn.className="post-action-btn"; delBtn.innerHTML="<span class='icon'>🗑</span>";
    delBtn.addEventListener("click",async function(){if(!confirm("Delete this post?"))return;try{await api("/api/posts/"+p.id,"DELETE");await loadPosts(true);}catch(e){alert(e.message);}});
    actions.appendChild(editBtn); actions.appendChild(delBtn);
  }

  const reportBtn=document.createElement("button"); reportBtn.className="post-action-btn"; reportBtn.innerHTML="<span class='icon'>⚑</span>";
  reportBtn.addEventListener("click",function(){if(confirm("Report this post?"))toggle(p.id,"reports");});
  actions.appendChild(reportBtn);
  wrap.appendChild(actions);

  const replyBox=document.createElement("div"); replyBox.className="reply-box"+(openReplies.has(p.id)?" open":"");
  const replyInput=document.createElement("input"); replyInput.type="text"; replyInput.maxLength=280; replyInput.placeholder="Reply...";
  async function sendReply(){const t=replyInput.value.trim();if(!t)return;try{await api("/api/posts/"+p.id+"/reply","POST",{text:t});focusReplyFor=p.id;await loadPosts(true);}catch(e){alert(e.message);}}
  replyInput.addEventListener("keydown",function(e){if(e.key==="Enter")sendReply();});
  replyBox.appendChild(replyInput); replyBox.appendChild(makeBtn("","Send",sendReply)); wrap.appendChild(replyBox);
  if(focusReplyFor===p.id){focusReplyFor=null;setTimeout(function(){replyInput.focus();},0);}

  if(p.replies&&p.replies.length){
    p.replies.forEach(function(r,idx){
      const row=document.createElement("div"); row.className="reply";
      const b=document.createElement("b"); b.textContent=r.author;
      const txt=document.createTextNode(" "+r.text);
      row.appendChild(b); row.appendChild(txt);
      const replyActions=document.createElement("div"); replyActions.className="reply-actions";
      const rLikes=r.likes?r.likes:[]; const rLiked=rLikes.includes(me);
      const rLikeBtn=document.createElement("button"); rLikeBtn.className="reply-like-btn"+(rLiked?" liked":"");
      rLikeBtn.innerHTML=(rLiked?"♥":"♡")+(rLikes.length?" "+rLikes.length:"");
      rLikeBtn.addEventListener("click",async function(){try{await api("/api/posts/"+p.id+"/reply-like","POST",{replyIndex:idx});await loadPosts(true);}catch(e){alert(e.message);}});
      replyActions.appendChild(rLikeBtn); row.appendChild(replyActions);
      wrap.appendChild(row);
    });
  }
  return wrap;
}

// ===== Toggle =====
async function toggle(id,kind){try{await api("/api/posts/"+id+"/toggle","POST",{kind});await loadPosts(true);}catch(e){alert(e.message);}}

// ===== Render feed =====
function renderFeed(){
  const feed=document.getElementById("feed"); if(!feed)return;
  feed.textContent="";
  posts.forEach(function(p){feed.appendChild(buildPost(p));});
  if(!feed.children.length){
    const e=document.createElement("div");e.className="empty";e.innerHTML="<div class='empty-icon'>✦</div><div>No posts yet. Be the first!</div>";
    feed.appendChild(e);
    showWelcomeMessage();
  }
  const pc=document.getElementById("postCount"); if(pc)pc.textContent=posts.filter(function(p){return p.author===me;}).length;
}

// ===== Load posts =====
let currentFeed = "foryou";
async function loadPosts(force){
  try{const data=await api("/api/posts?feed="+currentFeed);const json=JSON.stringify(data);if(!force&&json===lastJson)return;lastJson=json;posts=data;renderFeed();}catch(e){}
}

// ===== Feed tabs =====
const feedTabForYou = document.getElementById("feedTabForYou");
const feedTabFollowing = document.getElementById("feedTabFollowing");
if(feedTabForYou) feedTabForYou.addEventListener("click",function(){currentFeed="foryou";feedTabForYou.classList.add("active");if(feedTabFollowing)feedTabFollowing.classList.remove("active");loadPosts(true);});
if(feedTabFollowing) feedTabFollowing.addEventListener("click",function(){currentFeed="following";feedTabFollowing.classList.add("active");if(feedTabForYou)feedTabForYou.classList.remove("active");loadPosts(true);});

// ===== Trending =====
function updateTrending(){
  const trendList=document.getElementById("trendList"); if(!trendList)return;
  const counts={};
  posts.forEach(function(p){(p.text.match(/#\w+/g)||[]).forEach(function(tag){const k=tag.toLowerCase();counts[k]=(counts[k]||0)+1;});});
  const list=Object.keys(counts).sort(function(a,b){return counts[b]-counts[a];}).slice(0,5);
  trendList.textContent="";
  if(!list.length){trendList.textContent="No hashtags yet";return;}
  list.forEach(function(k){
    const row=document.createElement("div");row.className="trend-item";
    const tag=document.createElement("span");tag.className="hashtag";tag.textContent=k;
    tag.addEventListener("click",function(){showPage("search");const sp=document.getElementById("searchPageBox");if(sp){sp.value=k;sp.dispatchEvent(new Event("input"));}});
    const c=document.createElement("span");c.className="trend-count";c.textContent=counts[k]+(counts[k]===1?" post":" posts");
    row.appendChild(tag);row.appendChild(c);trendList.appendChild(row);
  });
}

// ===== Who to follow =====
async function loadWhoToFollow(){
  const whoList=document.getElementById("whoList"); if(!whoList)return;
  try{
    const users=await api("/api/users/all"); whoList.textContent="";
    const toShow=users.filter(function(u){return !myFollowingList.includes(u.username);}).slice(0,5);
    if(!toShow.length){whoList.innerHTML="<p style='color:var(--muted);font-size:14px'>Following everyone!</p>";return;}
    toShow.forEach(function(u){
      const row=document.createElement("div");row.className="person";
      const av=document.createElement("div");av.className="avatar";av.style.background=colorFor(u.username);av.textContent=initial(u.username);
      const info=document.createElement("div");info.className="info";
      const nm=document.createElement("div");nm.className="name";nm.textContent=u.displayName||u.username;
      const hd=document.createElement("div");hd.className="handle";hd.textContent="@"+u.username.toLowerCase();
      info.appendChild(nm);info.appendChild(hd);
      const btn=makeBtn("follow-btn","Follow",async function(){try{const r=await api("/api/follow","POST",{username:u.username});if(r.following){myFollowingList.push(u.username);row.remove();}}catch(e){alert(e.message);}});
      row.appendChild(av);row.appendChild(info);row.appendChild(btn);whoList.appendChild(row);
    });
  }catch(e){}
}

// ===== Notifications page =====
async function loadNotifsPage(){
  const container=document.getElementById("notifListPage"); if(!container)return;
  container.textContent="";
  try{
    const list=await api("/api/notifs");
    const nb=document.getElementById("notifBadge");
    const unread=list.filter(function(n){return !n.read;}).length;
    if(nb){if(unread>0){nb.style.display="inline-block";nb.textContent=unread>99?"99+":unread;}else nb.style.display="none";}
    if(!list.length){const e=document.createElement("div");e.className="notif-empty";e.textContent="No notifications yet.";container.appendChild(e);return;}
    const icons={likes:"♥",reposts:"🔁",reply:"💬",chat:"💬",reports:"⚑",follow:"👤",follow_request:"👤",group:"👥",mention:"@"};
    list.forEach(function(n){
      const item=document.createElement("div");item.className="notif-item"+(n.read?"":" unread");
      const time=document.createElement("span");time.className="notif-time";time.textContent=timeAgo(n.time);item.appendChild(time);
      const txt=document.createElement("span");txt.innerHTML="<b>"+n.from+"</b> "+(icons[n.type]||"")+" "+n.text;item.appendChild(txt);
      if(n.preview){const p=document.createElement("div");p.className="notif-preview";p.textContent=n.preview;item.appendChild(p);}
      container.appendChild(item);
    });
    try{await api("/api/notifs/read","POST");}catch(e){}
    if(nb)nb.style.display="none";
  }catch(e){}
}

// ===== Messages =====
let chatPartner=null, chatLastTs=0, chatPollTimer=null, typingPollTimer=null;

async function loadDmList(){
  const dmList=document.getElementById("dmList"); if(!dmList)return;
  dmList.textContent="";
  try{
    const users=await api("/api/users");
    if(!users.length){dmList.innerHTML="<p style='color:var(--muted);padding:20px;text-align:center;font-size:15px'>No recent contacts yet.</p>";return;}
    users.forEach(function(u){
      const item=document.createElement("div");item.className="conv-item";
      const av=document.createElement("div");av.className="conv-avatar";av.style.background=colorFor(u);av.textContent=initial(u);
      const info=document.createElement("div");info.className="conv-info";
      const nm=document.createElement("div");nm.className="conv-name";nm.textContent=u;
      const prev=document.createElement("div");prev.className="conv-preview";prev.textContent="Tap to chat";
      info.appendChild(nm);info.appendChild(prev);item.appendChild(av);item.appendChild(info);
      item.addEventListener("click",function(){openChatView(u);});
      dmList.appendChild(item);
    });
  }catch(e){}
}

function openChatView(partner){
  chatPartner=partner; chatLastTs=0;
  const cv=document.getElementById("chatView"); if(!cv)return;
  const cvn=document.getElementById("chatViewName"); if(cvn)cvn.textContent=partner;
  const cm=document.getElementById("chatMessages"); if(cm)cm.textContent="";
  cv.classList.add("open");
  loadChatMessages(true);
  clearInterval(chatPollTimer); clearInterval(typingPollTimer);
  chatPollTimer=setInterval(function(){loadChatMessages(false);},3000);
  typingPollTimer=setInterval(checkTyping,2000);
}

async function loadChatMessages(force){
  if(!chatPartner)return;
  const cv=document.getElementById("chatView"); if(!cv||!cv.classList.contains("open"))return;
  try{
    const msgs=await api("/api/chat?with="+encodeURIComponent(chatPartner)+"&since="+chatLastTs);
    if(!msgs.length&&!force)return;
    const cm=document.getElementById("chatMessages"); if(!cm)return;
    if(force)cm.textContent="";
    msgs.forEach(function(m){
      const row=document.createElement("div"); row.className="chat-msg "+(m.from===me?"mine":"theirs");
      const txt=document.createElement("div"); txt.textContent=m.text;
      const t=document.createElement("div"); t.className="chat-time"; t.textContent=fmt(m.ts);
      if(m.from===me&&m.read){const rr=document.createElement("div");rr.className="read-receipt";rr.textContent="✓✓ Seen";t.appendChild(rr);}
      row.appendChild(txt); row.appendChild(t); cm.appendChild(row);
      chatLastTs=Math.max(chatLastTs,m.ts);
    });
    const cm2=document.getElementById("chatMessages"); if(cm2)cm2.scrollTop=cm2.scrollHeight;
  }catch(e){}
}

async function checkTyping(){
  if(!chatPartner)return;
  try{
    const data=await api("/api/chat/typing?with="+encodeURIComponent(chatPartner));
    const ti=document.getElementById("typingIndicator");
    if(ti)ti.style.display=data.typing?"flex":"none";
  }catch(e){}
}

let typingSendTimer=null;
async function sendChatMsg(){
  const cb=document.getElementById("chatViewBox"); if(!cb||!chatPartner)return;
  const text=cb.value.trim(); if(!text)return; cb.value="";
  try{await api("/api/chat","POST",{to:chatPartner,text});await loadChatMessages(false);}catch(e){alert(e.message);}
}

const chatViewBack=document.getElementById("chatViewBack");
const chatViewSend=document.getElementById("chatViewSend");
const chatViewBox=document.getElementById("chatViewBox");
if(chatViewBack)chatViewBack.addEventListener("click",function(){const cv=document.getElementById("chatView");if(cv)cv.classList.remove("open");clearInterval(chatPollTimer);clearInterval(typingPollTimer);});
if(chatViewSend)chatViewSend.addEventListener("click",sendChatMsg);
if(chatViewBox){
  chatViewBox.addEventListener("keydown",function(e){if(e.key==="Enter")sendChatMsg();});
  chatViewBox.addEventListener("input",function(){
    if(!chatPartner)return;
    clearTimeout(typingSendTimer);
    typingSendTimer=setTimeout(function(){try{api("/api/chat/typing","POST",{to:chatPartner});}catch(e){}},300);
  });
}

const msgTabDm=document.getElementById("msgTabDm");
const msgTabGroups=document.getElementById("msgTabGroups");
if(msgTabDm)msgTabDm.addEventListener("click",function(){msgTabDm.classList.add("active");if(msgTabGroups)msgTabGroups.classList.remove("active");const dl=document.getElementById("dmList");const gl=document.getElementById("groupListPage");if(dl)dl.style.display="block";if(gl)gl.style.display="none";loadDmList();});
if(msgTabGroups)msgTabGroups.addEventListener("click",function(){msgTabGroups.classList.add("active");if(msgTabDm)msgTabDm.classList.remove("active");const dl=document.getElementById("dmList");const gl=document.getElementById("groupListPage");if(dl)dl.style.display="none";if(gl)gl.style.display="block";loadGroupListPage();});

async function loadGroupListPage(){
  const container=document.getElementById("groupListInner"); if(!container)return; container.textContent="";
  try{
    const myGroups=await api("/api/groups");
    if(!myGroups.length){container.innerHTML="<p style='color:var(--muted);padding:16px;font-size:14px'>No groups yet.</p>";return;}
    myGroups.forEach(function(g){
      const item=document.createElement("div");item.className="conv-item";
      const av=document.createElement("div");av.className="conv-avatar";av.style.background=colorFor(g.name);av.textContent=initial(g.name);
      const info=document.createElement("div");info.className="conv-info";
      const nm=document.createElement("div");nm.className="conv-name";nm.textContent=g.name;
      const mb=document.createElement("div");mb.className="conv-preview";mb.textContent=g.members.join(", ");
      info.appendChild(nm);info.appendChild(mb);item.appendChild(av);item.appendChild(info);
      item.addEventListener("click",function(){openGroupPanel(g);});
      container.appendChild(item);
    });
  }catch(e){}
}

const groupCreateBtn=document.getElementById("groupCreateBtn");
if(groupCreateBtn)groupCreateBtn.addEventListener("click",async function(){
  const ni=document.getElementById("groupNameInput");const mi=document.getElementById("groupMembersInput");
  const name=ni?ni.value.trim():""; if(!name){alert("Enter a group name");return;}
  const members=(mi&&mi.value.trim())?mi.value.trim().split(",").map(function(m){return m.trim();}).filter(Boolean):[];
  try{await api("/api/groups","POST",{name,members});if(ni)ni.value="";if(mi)mi.value="";loadGroupListPage();}catch(e){alert(e.message);}
});

const groupPanel=document.getElementById("groupPanel");
const groupClose=document.getElementById("groupClose");
const groupPanelTitle=document.getElementById("groupPanelTitle");
const groupMessages=document.getElementById("groupMessages");
const groupCreate=document.getElementById("groupCreate");
const groupInput=document.getElementById("groupInput");
const groupMsgBox=document.getElementById("groupMsgBox");
const groupMsgSend=document.getElementById("groupMsgSend");
let currentGroup=null,groupLastTs=0,groupTimer=null;

function openGroupPanel(g){
  currentGroup=g;groupLastTs=0;
  if(groupPanelTitle)groupPanelTitle.textContent=g.name;
  if(groupCreate)groupCreate.style.display="none";
  if(groupMessages)groupMessages.style.display="flex";
  if(groupInput)groupInput.style.display="flex";
  if(groupPanel)groupPanel.classList.add("open");
  loadGroupMessages(true);
  clearInterval(groupTimer);
  groupTimer=setInterval(function(){loadGroupMessages(false);},3000);
}
async function loadGroupMessages(force){
  if(!currentGroup||!groupMessages)return;
  try{
    const msgs=await api("/api/groups/"+currentGroup.id+"?since="+groupLastTs);
    if(!msgs.length&&!force)return; if(force)groupMessages.textContent="";
    msgs.forEach(function(m){
      const row=document.createElement("div");row.className="chat-msg "+(m.from===me?"mine":"theirs");
      if(m.from!==me){const auth=document.createElement("div");auth.style.cssText="font-size:12px;font-weight:bold;color:var(--accent);margin-bottom:2px";auth.textContent=m.from;row.appendChild(auth);}
      const txt=document.createElement("div");txt.textContent=m.text;
      const t=document.createElement("div");t.className="chat-time";t.textContent=fmt(m.ts);
      row.appendChild(txt);row.appendChild(t);groupMessages.appendChild(row);groupLastTs=Math.max(groupLastTs,m.ts);
    });
    if(groupMessages)groupMessages.scrollTop=groupMessages.scrollHeight;
  }catch(e){}
}
async function sendGroupMsg(){if(!groupMsgBox||!currentGroup)return;const text=groupMsgBox.value.trim();if(!text)return;groupMsgBox.value="";try{await api("/api/groups/"+currentGroup.id+"/messages","POST",{text});await loadGroupMessages(false);}catch(e){alert(e.message);}}
if(groupMsgSend)groupMsgSend.addEventListener("click",sendGroupMsg);
if(groupMsgBox)groupMsgBox.addEventListener("keydown",function(e){if(e.key==="Enter")sendGroupMsg();});
if(groupClose)groupClose.addEventListener("click",function(){if(groupPanel)groupPanel.classList.remove("open");clearInterval(groupTimer);currentGroup=null;});

// ===== Stories =====
let storyTimer=null;
async function loadStories(){
  const storiesRow=document.getElementById("storiesRow"); if(!storiesRow)return;
  try{
    const all=await api("/api/stories"); storiesRow.textContent="";
    const addBtn=document.createElement("button");addBtn.className="story-add";
    addBtn.innerHTML="<div class='story-add-ring'>+</div><span class='story-add-name'>Story</span>";
    const sfi=document.getElementById("storyFileInput");
    addBtn.addEventListener("click",function(){if(sfi)sfi.click();}); storiesRow.appendChild(addBtn);
    const byAuthor={};
    all.forEach(function(s){if(!byAuthor[s.author]||s.time>byAuthor[s.author].time)byAuthor[s.author]=s;});
    Object.values(byAuthor).forEach(function(s){
      const seen=loadList("seenStories_"+me).includes(s.id);
      const bubble=document.createElement("div");bubble.className="story-bubble";
      const ring=document.createElement("div");ring.className="story-ring"+(seen?" seen":"");
      const inner=document.createElement("div");inner.className="story-inner";inner.style.background=colorFor(s.author);inner.textContent=initial(s.author);
      ring.appendChild(inner);
      const name=document.createElement("div");name.className="story-name";name.textContent=s.author;
      bubble.appendChild(ring);bubble.appendChild(name);bubble.addEventListener("click",function(){openStory(s);});storiesRow.appendChild(bubble);
    });
  }catch(e){}
}

async function openStory(s){
  const sv=document.getElementById("storyViewer"); if(!sv)return;
  sv.classList.add("open");
  const sa=document.getElementById("storyAuthor");if(sa)sa.textContent=s.author;
  const st=document.getElementById("storyTime");if(st)st.textContent=timeAgo(s.time);
  const sc=document.getElementById("storyContent");if(sc)sc.textContent="";
  const sp=document.getElementById("storyProgress");if(sp){sp.style.transition="none";sp.style.width="0%";}
  if(sc&&s.media){const isV=s.media.type==="video";const el=document.createElement(isV?"video":"img");if(isV){el.controls=true;el.autoplay=true;}el.src=s.media.url;sc.appendChild(el);}
  if(sc&&s.text){const t=document.createElement("div");t.id="storyText";t.textContent=s.text;sc.appendChild(t);}
  const seen=loadList("seenStories_"+me);if(!seen.includes(s.id)){seen.push(s.id);saveList("seenStories_"+me,seen);}
  clearTimeout(storyTimer);
  setTimeout(function(){if(sp){sp.style.transition="width 5s linear";sp.style.width="100%";}},50);
  storyTimer=setTimeout(function(){closeStory();},5100);
  try{const viewData=await api("/api/stories/"+s.id+"/view","POST",{});if(s.author===me){const vc=document.getElementById("storyViewCount");const vl=document.getElementById("storyViewList");if(vc){vc.textContent="👁 "+(viewData.views?viewData.views.length:0)+" views";vc.style.display="block";}if(vl&&viewData.views&&viewData.views.length){vl.textContent=viewData.views.slice(0,5).join(", ")+(viewData.views.length>5?" +more":"");vl.style.display="block";}}}catch(e){}
}
function closeStory(){const sv=document.getElementById("storyViewer");if(sv)sv.classList.remove("open");const sc=document.getElementById("storyContent");if(sc)sc.textContent="";const vc=document.getElementById("storyViewCount");if(vc)vc.style.display="none";const vl=document.getElementById("storyViewList");if(vl)vl.style.display="none";clearTimeout(storyTimer);loadStories();}
const storyCloseBtn=document.getElementById("storyClose");if(storyCloseBtn)storyCloseBtn.addEventListener("click",closeStory);
const storyFileInput=document.getElementById("storyFileInput");
if(storyFileInput)storyFileInput.addEventListener("change",async function(){
  const file=this.files[0];if(!file)return;
  try{const up=await fetch("/api/upload",{method:"POST",headers:{"Content-Type":file.type},body:file});if(!up.ok){alert("Upload failed");return;}const media=await up.json();await api("/api/stories","POST",{text:"",media});this.value="";loadStories();}catch(e){alert(e.message);}
});

// ===== Search page =====
const searchPageBox=document.getElementById("searchPageBox");
if(searchPageBox){
  let searchTimer=null;
  searchPageBox.addEventListener("input",function(){
    clearTimeout(searchTimer);
    const q=searchPageBox.value.trim();
    const container=document.getElementById("searchPageResults");if(!container)return;
    if(!q){container.textContent="";return;}
    searchTimer=setTimeout(async function(){
      container.textContent="";
      const postMatches=posts.filter(function(p){return (p.text||"").toLowerCase().includes(q.toLowerCase());});
      if(postMatches.length){const title=document.createElement("div");title.className="section-title";title.textContent="Posts";container.appendChild(title);postMatches.slice(0,10).forEach(function(p){container.appendChild(buildPost(p));});}
      try{
        const users=await api("/api/users/all");
        const matches=users.filter(function(u){return u.username.toLowerCase().includes(q.toLowerCase())||(u.displayName||"").toLowerCase().includes(q.toLowerCase());}).slice(0,8);
        if(matches.length){
          const title2=document.createElement("div");title2.className="section-title";title2.textContent="People";container.appendChild(title2);
          matches.forEach(function(u){
            const row=document.createElement("div");row.className="user-result";
            const av=document.createElement("div");av.className="avatar";av.style.background=colorFor(u.username);av.textContent=initial(u.username);
            const info=document.createElement("div");info.className="info";
            const nm=document.createElement("div");nm.className="name";nm.textContent=u.displayName||u.username;
            const hd=document.createElement("div");hd.className="handle";hd.textContent="@"+u.username.toLowerCase();
            const fc=document.createElement("div");fc.className="followers";fc.textContent=u.followers+" followers";
            info.appendChild(nm);info.appendChild(hd);info.appendChild(fc);
            const isF=myFollowingList.includes(u.username);
            const btn=makeBtn("follow-btn"+(isF?" following":""),isF?"Following":"Follow",async function(){
              try{const r=await api("/api/follow","POST",{username:u.username});if(r.following){if(!myFollowingList.includes(u.username))myFollowingList.push(u.username);btn.textContent="Following";btn.classList.add("following");}else{myFollowingList=myFollowingList.filter(function(x){return x!==u.username;});btn.textContent="Follow";btn.classList.remove("following");};}catch(e){alert(e.message);}
            });
            row.appendChild(av);row.appendChild(info);row.appendChild(btn);container.appendChild(row);
          });
        }
      }catch(e){}
    },300);
  });
}

// ===== Profile page =====
async function loadProfilePage(){
  try{
    const meData=await api("/api/me");
    const mn=document.getElementById("myName");if(mn)mn.textContent=meData.displayName||me;
    const mh=document.getElementById("myHandle");if(mh)mh.textContent="@"+me.toLowerCase();
    const mb=document.getElementById("bio");if(mb)mb.textContent=meData.bio||"Add a bio";
    const mw=document.getElementById("myWebsite");if(mw){if(meData.website){mw.textContent=meData.website.replace(/^https?:\/\//,"");mw.href=meData.website.startsWith("http")?meData.website:"https://"+meData.website;mw.style.display="block";}else mw.style.display="none";}
    const banner=document.getElementById("myBanner");if(banner&&meData.banner)banner.style.backgroundImage="url("+meData.banner+")";
    const mf=document.getElementById("myFollowers");if(mf)mf.textContent=meData.followers||0;
    const mfg=document.getElementById("myFollowing");if(mfg)mfg.textContent=(meData.followingList||[]).length;
    myFollowingList=meData.followingList||[];
    const pc=document.getElementById("privateCheck");if(pc)pc.checked=!!meData.isPrivate;
    if(meData.followRequests&&meData.followRequests.length)showFollowRequests(meData.followRequests);
  }catch(e){}
  const pf=document.getElementById("profileFeed");if(!pf)return;pf.textContent="";
  const myPosts=posts.filter(function(p){return p.author===me;});
  const pc2=document.getElementById("postCount");if(pc2)pc2.textContent=myPosts.length;
  myPosts.forEach(function(p){pf.appendChild(buildPost(p));});
  if(!myPosts.length){const e=document.createElement("div");e.className="empty";e.innerHTML="<div class='empty-icon'>✦</div><div>No posts yet</div>";pf.appendChild(e);}
}

// ===== Profile avatar =====
const bigAvatar=document.getElementById("myAvatar");
const avatarInput=document.createElement("input");avatarInput.type="file";avatarInput.accept="image/*";avatarInput.style.display="none";document.body.appendChild(avatarInput);
if(bigAvatar){bigAvatar.title="Click to change picture";bigAvatar.addEventListener("click",function(){avatarInput.click();});}
avatarInput.addEventListener("change",function(){const f=this.files[0];if(!f)return;const url=URL.createObjectURL(f);if(bigAvatar){bigAvatar.textContent="";bigAvatar.style.backgroundImage="url("+url+")";}});

// ===== Edit Profile =====
const editProfileBtn=document.getElementById("editProfileBtn");
const editProfileOverlay=document.getElementById("editProfileOverlay");
const editProfileClose=document.getElementById("editProfileClose");
const saveProfileBtn=document.getElementById("saveProfileBtn");
if(editProfileBtn)editProfileBtn.addEventListener("click",openEditProfile);
if(editProfileClose)editProfileClose.addEventListener("click",function(){if(editProfileOverlay)editProfileOverlay.classList.remove("open");});
if(saveProfileBtn)saveProfileBtn.addEventListener("click",saveProfile);

async function openEditProfile(){
  try{
    const meData=await api("/api/me");
    const dn=document.getElementById("editDisplayName");if(dn)dn.value=meData.displayName||me;
    const bf=document.getElementById("editBioField");if(bf)bf.value=meData.bio||"";
    const ws=document.getElementById("editWebsite");if(ws)ws.value=meData.website||"";
    const bp=document.getElementById("editBannerPreview");if(bp&&meData.banner)bp.style.backgroundImage="url("+meData.banner+")";
    const ep=document.getElementById("editProfileAvatar");if(ep){ep.textContent=initial(me);ep.style.backgroundImage=bigAvatar?bigAvatar.style.backgroundImage:"";}
  }catch(e){}
  if(editProfileOverlay)editProfileOverlay.classList.add("open");
}
async function saveProfile(){
  const dn=document.getElementById("editDisplayName");const bf=document.getElementById("editBioField");const ws=document.getElementById("editWebsite");
  const displayName=dn?dn.value.trim():"";const bioVal=bf?bf.value.trim():"";const website=ws?ws.value.trim():"";
  try{
    await api("/api/me/profile","PUT",{displayName,bio:bioVal,website});
    const mn=document.getElementById("myName");if(mn)mn.textContent=displayName||me;
    const mb=document.getElementById("bio");if(mb)mb.textContent=bioVal||"Add a bio";
    const mw=document.getElementById("myWebsite");if(mw){if(website){mw.textContent=website.replace(/^https?:\/\//,"");mw.href=website.startsWith("http")?website:"https://"+website;mw.style.display="block";}else mw.style.display="none";}
    if(editProfileOverlay)editProfileOverlay.classList.remove("open");
  }catch(e){alert(e.message);}
}

const bannerFileInput=document.getElementById("bannerFileInput");
if(bannerFileInput)bannerFileInput.addEventListener("change",async function(){
  const file=this.files[0];if(!file)return;
  try{const up=await fetch("/api/upload",{method:"POST",headers:{"Content-Type":file.type},body:file});if(!up.ok){alert("Upload failed");return;}const data=await up.json();const bp=document.getElementById("editBannerPreview");if(bp)bp.style.backgroundImage="url("+data.url+")";const banner=document.getElementById("myBanner");if(banner)banner.style.backgroundImage="url("+data.url+")";await api("/api/me/profile","PUT",{banner:data.url});}catch(e){alert(e.message);}
});
const editAvatarFileInput=document.getElementById("editAvatarFileInput");
if(editAvatarFileInput)editAvatarFileInput.addEventListener("change",function(){const file=this.files[0];if(!file)return;const url=URL.createObjectURL(file);if(bigAvatar){bigAvatar.textContent="";bigAvatar.style.backgroundImage="url("+url+")";}const ep=document.getElementById("editProfileAvatar");if(ep){ep.textContent="";ep.style.backgroundImage="url("+url+")";}});

// ===== Settings =====
const settingsBtn=document.getElementById("settingsBtn");
const settingsOverlay=document.getElementById("settingsOverlay");
const settingsClose=document.getElementById("settingsClose");
if(settingsBtn)settingsBtn.addEventListener("click",openSettings);
if(settingsClose)settingsClose.addEventListener("click",function(){if(settingsOverlay)settingsOverlay.classList.remove("open");saveNotifSettings();});

async function openSettings(){
  try{
    const meData=await api("/api/me");
    const spc=document.getElementById("settingsPrivateCheck");if(spc)spc.checked=!!meData.isPrivate;
    const s=meData.settings||{};
    const ln=document.getElementById("settingsNotifLikes");if(ln)ln.checked=s.likes!==false;
    const rn=document.getElementById("settingsNotifReplies");if(rn)rn.checked=s.replies!==false;
    const fn=document.getElementById("settingsNotifFollows");if(fn)fn.checked=s.follows!==false;
    const mn=document.getElementById("settingsNotifMessages");if(mn)mn.checked=s.messages!==false;
  }catch(e){}
  if(settingsOverlay)settingsOverlay.classList.add("open");
}
const settingsPrivateCheck=document.getElementById("settingsPrivateCheck");
if(settingsPrivateCheck)settingsPrivateCheck.addEventListener("change",async function(){try{await api("/api/me/privacy","POST",{isPrivate:this.checked});const pc=document.getElementById("privateCheck");if(pc)pc.checked=this.checked;}catch(e){this.checked=!this.checked;alert(e.message);}});
async function saveNotifSettings(){try{const ln=document.getElementById("settingsNotifLikes");const rn=document.getElementById("settingsNotifReplies");const fn=document.getElementById("settingsNotifFollows");const mn=document.getElementById("settingsNotifMessages");await api("/api/me/settings","POST",{likes:ln?ln.checked:true,replies:rn?rn.checked:true,follows:fn?fn.checked:true,messages:mn?mn.checked:true});}catch(e){}}

// ===== Change Password =====
const changePwdOverlay=document.getElementById("changePwdOverlay");
const changePwdClose=document.getElementById("changePwdClose");
const changePasswordItem=document.getElementById("changePasswordItem");
const savePwdBtn=document.getElementById("savePwdBtn");
if(changePasswordItem)changePasswordItem.addEventListener("click",function(){if(settingsOverlay)settingsOverlay.classList.remove("open");const ci=document.getElementById("currentPwdInput");const ni=document.getElementById("newPwdInput");const co=document.getElementById("confirmPwdInput");const pe=document.getElementById("pwdError");if(ci)ci.value="";if(ni)ni.value="";if(co)co.value="";if(pe)pe.textContent="";if(changePwdOverlay)changePwdOverlay.classList.add("open");});
if(changePwdClose)changePwdClose.addEventListener("click",function(){if(changePwdOverlay)changePwdOverlay.classList.remove("open");});
if(savePwdBtn)savePwdBtn.addEventListener("click",async function(){
  const current=document.getElementById("currentPwdInput").value;const newPwd=document.getElementById("newPwdInput").value;const confirm=document.getElementById("confirmPwdInput").value;const errEl=document.getElementById("pwdError");errEl.textContent="";
  if(!current||!newPwd||!confirm){errEl.textContent="Please fill in all fields.";return;}if(newPwd!==confirm){errEl.textContent="Passwords do not match.";return;}if(newPwd.length<6){errEl.textContent="At least 6 characters.";return;}
  try{await api("/api/me/password","POST",{oldPassword:current,newPassword:newPwd});if(changePwdOverlay)changePwdOverlay.classList.remove("open");alert("Password changed!");}catch(e){errEl.textContent=e.message;}
});

// ===== Security question =====
const securityQuestionItem=document.getElementById("securityQuestionItem");
const securityQuestionOverlay=document.getElementById("securityQuestionOverlay");
const securityQuestionClose=document.getElementById("securityQuestionClose");
const saveSecurityQuestionBtn=document.getElementById("saveSecurityQuestionBtn");
if(securityQuestionItem)securityQuestionItem.addEventListener("click",function(){if(settingsOverlay)settingsOverlay.classList.remove("open");const err=document.getElementById("securityQuestionErr");if(err)err.textContent="";const suc=document.getElementById("securityQuestionSuccess");if(suc)suc.textContent="";const ai=document.getElementById("securityAnswerInput");if(ai)ai.value="";if(securityQuestionOverlay)securityQuestionOverlay.classList.add("open");});
if(securityQuestionClose)securityQuestionClose.addEventListener("click",function(){if(securityQuestionOverlay)securityQuestionOverlay.classList.remove("open");});
if(saveSecurityQuestionBtn)saveSecurityQuestionBtn.addEventListener("click",async function(){
  const question=document.getElementById("securityQuestionSelect").value;const answer=document.getElementById("securityAnswerInput").value.trim();const err=document.getElementById("securityQuestionErr");const suc=document.getElementById("securityQuestionSuccess");err.textContent="";suc.textContent="";
  if(!answer){err.textContent="Please enter your answer.";return;}if(answer.length<2){err.textContent="Answer is too short.";return;}
  saveSecurityQuestionBtn.disabled=true;saveSecurityQuestionBtn.textContent="Saving...";
  try{await api("/api/me/security-question","POST",{question,answer});suc.textContent="✅ Security question saved!";setTimeout(function(){if(securityQuestionOverlay)securityQuestionOverlay.classList.remove("open");},1500);}catch(e){err.textContent=e.message;}
  saveSecurityQuestionBtn.disabled=false;saveSecurityQuestionBtn.textContent="Save Security Question";
});

// ===== Delete Account =====
const deleteAccountItem=document.getElementById("deleteAccountItem");
if(deleteAccountItem)deleteAccountItem.addEventListener("click",async function(){
  const pwd=prompt("Enter your password to permanently delete your account:");if(!pwd)return;
  if(!confirm("This will permanently delete everything. Cannot be undone."))return;
  try{const res=await fetch("/api/me",{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:pwd})});if(!res.ok){const d=await res.json();alert(d.error||"Could not delete.");return;}clearInterval(mainTimer);me="";showAuth(false);}catch(e){alert("Could not delete account.");}
});

// ===== Private account =====
const privateCheck=document.getElementById("privateCheck");
if(privateCheck)privateCheck.addEventListener("change",async function(){try{await api("/api/me/privacy","POST",{isPrivate:this.checked});}catch(e){alert(e.message);this.checked=!this.checked;}});

function showFollowRequests(requests){
  if(!requests||!requests.length)return;
  const existing=document.getElementById("followRequestsCard");if(existing)existing.remove();
  const card=document.createElement("div");card.id="followRequestsCard";card.style.cssText="background:var(--card);border:1px solid var(--border);border-radius:20px;padding:16px;margin:16px";
  card.innerHTML="<h3 style='margin:0 0 12px;font-size:16px;font-weight:700'>👥 Follow Requests ("+requests.length+")</h3>";
  requests.forEach(function(from){
    const row=document.createElement("div");row.style.cssText="display:flex;align-items:center;gap:10px;margin-bottom:10px";
    const av=document.createElement("div");av.className="avatar";av.style.background=colorFor(from);av.textContent=initial(from);
    const name=document.createElement("div");name.style.flex="1";name.style.fontWeight="bold";name.textContent=from;
    const acceptBtn=makeBtn("follow-btn","Accept",async function(){try{await api("/api/me/follow-requests","POST",{from,action:"accept"});row.remove();loadProfilePage();}catch(e){alert(e.message);}});
    const declineBtn=makeBtn("link-btn","Decline",async function(){try{await api("/api/me/follow-requests","POST",{from,action:"decline"});row.remove();}catch(e){alert(e.message);}});
    declineBtn.style.marginLeft="8px";
    row.appendChild(av);row.appendChild(name);row.appendChild(acceptBtn);row.appendChild(declineBtn);card.appendChild(row);
  });
  const profileSection=document.getElementById("profileSection");if(profileSection)profileSection.insertBefore(card,profileSection.firstChild);
}

// ===== Password reset =====
const resetScreen=document.getElementById("resetScreen");
const forgotPwdBtn=document.getElementById("forgotPwdBtn");
const resetBackBtn=document.getElementById("resetBackBtn");
const resetNext1Btn=document.getElementById("resetNext1Btn");
const resetSubmitBtn=document.getElementById("resetSubmitBtn");
const resetDoneBtn=document.getElementById("resetDoneBtn");

function showResetStep(n){document.querySelectorAll(".reset-step").forEach(function(el){el.classList.remove("active");});const step=document.getElementById("resetStep"+n);if(step)step.classList.add("active");}
if(forgotPwdBtn)forgotPwdBtn.addEventListener("click",function(){if(resetScreen)resetScreen.classList.add("open");showResetStep(1);const ru=document.getElementById("resetUsername");if(ru)ru.value="";const re1=document.getElementById("resetErr1");if(re1)re1.textContent="";});
if(resetBackBtn)resetBackBtn.addEventListener("click",function(){if(resetScreen)resetScreen.classList.remove("open");});
if(resetNext1Btn)resetNext1Btn.addEventListener("click",async function(){
  const username=document.getElementById("resetUsername").value.trim();const err=document.getElementById("resetErr1");
  if(!username){err.textContent="Please enter your username.";return;}
  resetNext1Btn.disabled=true;resetNext1Btn.textContent="Looking up...";
  try{const data=await fetch("/api/auth/security-question?username="+encodeURIComponent(username));const json=await data.json();if(!data.ok){err.textContent=json.error||"Account not found.";resetNext1Btn.disabled=false;resetNext1Btn.textContent="Continue";return;}const qt=document.getElementById("resetQuestionText");if(qt)qt.textContent=json.question;const ra=document.getElementById("resetAnswer");if(ra)ra.value="";const rnp=document.getElementById("resetNewPwd");if(rnp)rnp.value="";const rcp=document.getElementById("resetConfirmPwd");if(rcp)rcp.value="";const re2=document.getElementById("resetErr2");if(re2)re2.textContent="";showResetStep(2);}catch(e){err.textContent="Could not connect.";}
  resetNext1Btn.disabled=false;resetNext1Btn.textContent="Continue";
});
if(resetSubmitBtn)resetSubmitBtn.addEventListener("click",async function(){
  const username=document.getElementById("resetUsername").value.trim();const answer=document.getElementById("resetAnswer").value.trim();const newPwd=document.getElementById("resetNewPwd").value;const confirmPwd=document.getElementById("resetConfirmPwd").value;const err=document.getElementById("resetErr2");err.textContent="";
  if(!answer){err.textContent="Please enter your answer.";return;}if(!newPwd){err.textContent="Please enter a new password.";return;}if(newPwd.length<6){err.textContent="Password must be at least 6 characters.";return;}if(newPwd!==confirmPwd){err.textContent="Passwords do not match.";return;}
  resetSubmitBtn.disabled=true;resetSubmitBtn.textContent="Resetting...";
  try{const res=await fetch("/api/auth/reset-password",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username,answer,newPassword:newPwd})});const json=await res.json();if(!res.ok){err.textContent=json.error||"Wrong answer.";resetSubmitBtn.disabled=false;resetSubmitBtn.textContent="Reset Password";return;}showResetStep(3);}catch(e){err.textContent="Could not connect.";}
  resetSubmitBtn.disabled=false;resetSubmitBtn.textContent="Reset Password";
});
if(resetDoneBtn)resetDoneBtn.addEventListener("click",function(){if(resetScreen)resetScreen.classList.remove("open");showAuth(false);});

// ===== Channels / Knowledge & Updates =====
let currentChannel = "tech";

async function loadChannelsPage(){
  const tabsEl=document.getElementById("channelTabs");
  const feedEl=document.getElementById("channelFeed");
  if(!tabsEl||!feedEl)return;
  if(!tabsEl.children.length){
    try{
      const channels=await api("/api/channels");
      channels.forEach(function(ch,idx){
        const btn=document.createElement("button");btn.className="channel-tab"+(idx===0?" active":"");
        btn.textContent=ch.emoji+" "+ch.name;btn.dataset.id=ch.id;
        btn.addEventListener("click",function(){
          document.querySelectorAll(".channel-tab").forEach(function(b){b.classList.remove("active");});
          btn.classList.add("active");currentChannel=ch.id;loadChannelFeed(ch.id);
        });
        tabsEl.appendChild(btn);
      });
    }catch(e){}
  }
  loadChannelFeed(currentChannel);
}

async function loadChannelFeed(channelId){
  const feedEl=document.getElementById("channelFeed");if(!feedEl)return;
  feedEl.innerHTML="<div class='channel-loading'>⏳ Loading latest updates...</div>";
  try{
    const items=await api("/api/channels/"+channelId);
    feedEl.textContent="";
    if(!items.length){feedEl.innerHTML="<div class='channel-empty'><div class='icon'>📡</div><div>No updates available right now. Check back soon.</div></div>";return;}
    items.forEach(function(item){
      const card=document.createElement("div");
      card.className="news-card"+(channelId==="alerts"?" alert-card":"");
      const isAlert=channelId==="alerts";
      card.innerHTML=(isAlert?"<div class='alert-badge'>🚨 ALERT</div>":"")+
        "<div class='news-source'>"+item.source+"</div>"+
        "<div class='news-title'><a href='"+item.link+"' target='_blank' rel='noopener'>"+item.title+"</a></div>"+
        (item.summary?"<div class='news-summary'>"+item.summary.slice(0,180)+(item.summary.length>180?"...":"")+"</div>":"")+
        "<div class='news-meta'><span>"+timeAgo(item.time)+"</span><a href='"+item.link+"' target='_blank' rel='noopener' class='news-link'>Read full article →</a></div>";
      const actions=document.createElement("div");actions.className="news-actions";
      const commentBtn=document.createElement("button");commentBtn.className="news-comment-btn";commentBtn.innerHTML="💬 Discuss";
      const commentsEl=document.createElement("div");commentsEl.className="news-comments";
      commentBtn.addEventListener("click",async function(){
        commentsEl.classList.toggle("open");
        if(commentsEl.classList.contains("open")&&!commentsEl.dataset.loaded){commentsEl.dataset.loaded="1";loadNewsComments(channelId,item.id,commentsEl);}
      });
      const inputRow=document.createElement("div");inputRow.className="news-comment-input";
      const input=document.createElement("input");input.type="text";input.maxLength=280;input.placeholder="Share your thoughts...";
      const sendBtn=document.createElement("button");sendBtn.textContent="Post";
      sendBtn.addEventListener("click",async function(){const text=input.value.trim();if(!text)return;try{await api("/api/channels/"+channelId+"/comments","POST",{newsId:item.id,text});input.value="";loadNewsComments(channelId,item.id,commentsEl);}catch(e){alert(e.message);}});
      input.addEventListener("keydown",function(e){if(e.key==="Enter")sendBtn.click();});
      inputRow.appendChild(input);inputRow.appendChild(sendBtn);
      commentsEl.appendChild(inputRow);
      const commentsList=document.createElement("div");commentsList.className="news-comments-list";commentsEl.appendChild(commentsList);
      actions.appendChild(commentBtn);card.appendChild(actions);card.appendChild(commentsEl);
      feedEl.appendChild(card);
    });
  }catch(e){feedEl.innerHTML="<div class='channel-empty'><div class='icon'>⚠️</div><div>Could not load updates. Please try again.</div></div>";}
}

async function loadNewsComments(channelId,newsId,container){
  const list=container.querySelector(".news-comments-list");if(!list)return;
  try{
    const comments=await api("/api/channels/"+channelId+"/comments?newsId="+newsId);
    list.textContent="";
    if(!comments.length){list.innerHTML="<p style='color:var(--muted);font-size:13px;padding:8px 0'>No comments yet. Be the first!</p>";return;}
    comments.forEach(function(c){const item=document.createElement("div");item.className="news-comment-item";item.innerHTML="<b>"+c.author+"</b> "+c.text+"<span style='color:var(--muted);font-size:11px;margin-left:8px'>"+timeAgo(c.time)+"</span>";list.appendChild(item);});
  }catch(e){}
}

// ===== Voice and Video Calls =====
const callScreen=document.getElementById("callScreen");
const callStatus=document.getElementById("callStatus");
const callPartnerEl=document.getElementById("callPartner");
const callRemoteVideo=document.getElementById("callRemoteVideo");
const callLocalVideo=document.getElementById("callLocalVideo");
const callMuteBtn=document.getElementById("callMuteBtn");
const callCamBtn=document.getElementById("callCamBtn");
const callEndBtn=document.getElementById("callEndBtn");
const callIncoming=document.getElementById("callIncoming");
const callIncomingText=document.getElementById("callIncomingText");
const callAcceptBtn=document.getElementById("callAcceptBtn");
const callDeclineBtn=document.getElementById("callDeclineBtn");
const chatViewCallBtn=document.getElementById("chatViewCallBtn");
let pc=null,localStream=null,callWith=null,signalTimer=null,mutedAudio=false,mutedCam=false;
const ICE_SERVERS={iceServers:[{urls:"stun:stun.l.google.com:19302"}]};
async function getMedia(video){try{return await navigator.mediaDevices.getUserMedia({audio:true,video});}catch(e){return await navigator.mediaDevices.getUserMedia({audio:true,video:false});}}
async function sendSignal(to,type,data){try{await api("/api/signal","POST",{to,type,data});}catch(e){}}
async function pollSignals(){
  try{
    const signals=await api("/api/signal");
    for(const sig of signals){
      if(sig.type==="offer"){callWith=sig.from;if(callIncomingText)callIncomingText.textContent=sig.from+" is calling...";if(callIncoming)callIncoming.classList.add("show");if(callIncoming)callIncoming._offer=sig.data;}
      else if(sig.type==="answer"&&pc){await pc.setRemoteDescription(new RTCSessionDescription(sig.data));}
      else if(sig.type==="ice"&&pc){try{await pc.addIceCandidate(new RTCIceCandidate(sig.data));}catch(e){}}
      else if(sig.type==="end"){endCall(false);}
      else if(sig.type==="decline"){if(callStatus)callStatus.textContent="Call declined";setTimeout(function(){endCall(false);},1500);}
    }
  }catch(e){}
}
function openCallScreen(partner){if(callPartnerEl)callPartnerEl.textContent=partner;if(callScreen)callScreen.classList.add("open");clearInterval(signalTimer);signalTimer=setInterval(pollSignals,1000);}
async function startCall(partner,withVideo){callWith=partner;if(callStatus)callStatus.textContent="Calling "+partner+"...";openCallScreen(partner);localStream=await getMedia(withVideo);if(callLocalVideo)callLocalVideo.srcObject=localStream;pc=new RTCPeerConnection(ICE_SERVERS);localStream.getTracks().forEach(function(t){pc.addTrack(t,localStream);});pc.ontrack=function(e){if(callRemoteVideo)callRemoteVideo.srcObject=e.streams[0];if(callStatus)callStatus.textContent="Connected";};pc.onicecandidate=function(e){if(e.candidate)sendSignal(partner,"ice",e.candidate);};const offer=await pc.createOffer();await pc.setLocalDescription(offer);sendSignal(partner,"offer",offer);}
async function acceptCall(){if(callIncoming)callIncoming.classList.remove("show");const offer=callIncoming?callIncoming._offer:null;if(callStatus)callStatus.textContent="Connecting...";openCallScreen(callWith);localStream=await getMedia(true);if(callLocalVideo)callLocalVideo.srcObject=localStream;pc=new RTCPeerConnection(ICE_SERVERS);localStream.getTracks().forEach(function(t){pc.addTrack(t,localStream);});pc.ontrack=function(e){if(callRemoteVideo)callRemoteVideo.srcObject=e.streams[0];if(callStatus)callStatus.textContent="Connected";};pc.onicecandidate=function(e){if(e.candidate)sendSignal(callWith,"ice",e.candidate);};if(offer){await pc.setRemoteDescription(new RTCSessionDescription(offer));const answer=await pc.createAnswer();await pc.setLocalDescription(answer);sendSignal(callWith,"answer",answer);}}
function endCall(notify){if(notify&&callWith)sendSignal(callWith,"end",{});if(pc){pc.close();pc=null;}if(localStream){localStream.getTracks().forEach(function(t){t.stop();});localStream=null;}if(callRemoteVideo)callRemoteVideo.srcObject=null;if(callLocalVideo)callLocalVideo.srcObject=null;if(callScreen)callScreen.classList.remove("open");if(callIncoming)callIncoming.classList.remove("show");clearInterval(signalTimer);callWith=null;}
if(callAcceptBtn)callAcceptBtn.addEventListener("click",acceptCall);
if(callDeclineBtn)callDeclineBtn.addEventListener("click",function(){sendSignal(callWith,"decline",{});if(callIncoming)callIncoming.classList.remove("show");callWith=null;});
if(callEndBtn)callEndBtn.addEventListener("click",function(){endCall(true);});
if(callMuteBtn)callMuteBtn.addEventListener("click",function(){if(!localStream)return;mutedAudio=!mutedAudio;localStream.getAudioTracks().forEach(function(t){t.enabled=!mutedAudio;});callMuteBtn.textContent=mutedAudio?"🔇":"🎤";});
if(callCamBtn)callCamBtn.addEventListener("click",function(){if(!localStream)return;mutedCam=!mutedCam;localStream.getVideoTracks().forEach(function(t){t.enabled=!mutedCam;});callCamBtn.textContent=mutedCam?"📷":"🎥";});
if(chatViewCallBtn)chatViewCallBtn.addEventListener("click",function(){if(!chatPartner){alert("Open a chat first.");return;}startCall(chatPartner,true);});
setInterval(pollSignals,3000);

// ===== Start the app =====
async function startApp(){
  authScreen.style.display="none"; appEl.style.display="block";
  savedIds=loadList("savedIds_"+me);
  blockedUsers=loadList("blocked_"+me);
  mutedUsers=loadList("muted_"+me);
  const ca=document.getElementById("composeAvatar"); if(ca)ca.textContent=initial(me);
  Object.values(pages).forEach(function(p){if(p)p.style.display="none";});
  if(pages.home)pages.home.style.display="block";
  if(composeFab)composeFab.style.display="flex";
  try{
    const meData=await api("/api/me");
    myFollowingList=meData.followingList||[];
    if(bigAvatar){bigAvatar.textContent=initial(me);bigAvatar.style.backgroundImage="";}
    const mn=document.getElementById("myName");if(mn)mn.textContent=meData.displayName||me;
    const mh=document.getElementById("myHandle");if(mh)mh.textContent="@"+me.toLowerCase();
    const mb=document.getElementById("bio");if(mb)mb.textContent=meData.bio||"Add a bio";
    const mf=document.getElementById("myFollowers");if(mf)mf.textContent=meData.followers||0;
    const mfg=document.getElementById("myFollowing");if(mfg)mfg.textContent=(meData.followingList||[]).length;
    const banner=document.getElementById("myBanner");if(banner&&meData.banner)banner.style.backgroundImage="url("+meData.banner+")";
    const pchk=document.getElementById("privateCheck");if(pchk)pchk.checked=!!meData.isPrivate;
    if(meData.followRequests&&meData.followRequests.length)showFollowRequests(meData.followRequests);
  }catch(e){}
  clearInterval(mainTimer);
  await loadPosts(true); loadStories(); loadWhoToFollow(); updateTrending();
  try{const list=await api("/api/notifs");const unread=list.filter(function(n){return !n.read;}).length;const nb=document.getElementById("notifBadge");if(nb){if(unread>0){nb.style.display="inline-block";nb.textContent=unread>99?"99+":unread;}else nb.style.display="none";}}catch(e){}
  mainTimer=setInterval(async function(){
    await loadPosts(false);
    try{const list=await api("/api/notifs");const unread=list.filter(function(n){return !n.read;}).length;const nb=document.getElementById("notifBadge");if(nb){if(unread>0){nb.style.display="inline-block";nb.textContent=unread>99?"99+":unread;}else nb.style.display="none";}}catch(e){}
  },5000);
}

// ===== Boot =====
checkSession();