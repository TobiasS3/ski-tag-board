// Ski Tag Board: gemeinsamer Teil für alle Seiten.
// Alle Daten liegen im privaten Repo und werden über die GitHub-API mit dem Token des Nutzers gelesen und geschrieben.
const CFG = {
  owner: "TobiasS3",
  repo: "ski-tag-plan",
  diary: 14,
  planFile: "Ski Tag Plan.html",
  costFile: "daten/kosten.json",
  testDay: new Date(2027, 1, 1),
  range: [new Date(2026, 9, 26), new Date(2028, 2, 1)],
  // Bereich, der bei neuen Aufgaben automatisch gesetzt wird
  areaOf: { "Ma-xi": "hardware", Lukcoderc: "netzwerk", TobiasS3: "wirtschaft" },
  // falls jemand bei GitHub keinen Namen eingetragen hat
  names: { "Ma-xi": "Maximilian Joszt", Lukcoderc: "Lukas Eder", TobiasS3: "Tobias Strobl" },
};
const AREAS = { hardware: "Hardware", netzwerk: "Netzwerk", wirtschaft: "Wirtschaft & Verkauf", app: "App", plan: "Plan" };
const TOKEN_KEY = "skitag-token", SEEN_KEY = "skitag-seen2"; // „2“: Stand einmal zurückgesetzt, damit die letzten 7 Tage als neu erscheinen
const R = "/repos/" + CFG.owner + "/" + CFG.repo;
const APP_VERSION = "1793360599"; // wird von bump.py gesetzt
const PUSH_KEY = "BDt9RkhaUrmGIJnyOg9suNNcrO5zHECtpFLbfVVyp8qQ6uzGEwVTHYhlB3SUzyqnHxOgY-tvPYC9PUWrwE3UEvQ", PUSH_DIR = "daten/push";

// Läuft schon eine neuere Version online? Dann einmal frisch laden, damit nicht alte und neue Teile gemischt werden.
async function checkVersion() {
  try {
    const r = await fetch("version.json?x=" + Date.now(), { cache: "no-store" });
    const { v } = await r.json();
    const here = new URLSearchParams(location.search).get("r");
    if (v && v !== APP_VERSION && here !== v) location.replace(location.pathname + "?r=" + v + location.hash);
  } catch {}
}

const SK = {
  token: null, me: null,
  data: { people: [], names: {}, milestones: [], issues: [], closers: {}, diary: [], questions: [], qa: null, repoId: null },
  prevSeen: 0,
};

// ---------- kleine Helfer ----------
const $ = (id) => document.getElementById(id);
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "checked") el.checked = !!v;
    else if (k === "value") el.value = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
  return el;
}
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const dayKey = (iso) => ymd(new Date(iso));
const timeOf = (iso) => new Date(iso).toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" });
const dateOf = (iso) => new Date(iso).toLocaleDateString("de-AT");
function dayLabel(key) {
  const t = new Date(), y = new Date(); y.setDate(y.getDate() - 1);
  if (key === ymd(t)) return "Heute";
  if (key === ymd(y)) return "Gestern";
  const [Y, M, D] = key.split("-").map(Number);
  return new Date(Y, M - 1, D).toLocaleDateString("de-AT", { weekday: "long", day: "numeric", month: "long" });
}
function ago(iso) {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 90) return "gerade eben";
  if (s < 3600) return "vor " + Math.round(s / 60) + " Min.";
  if (s < 86400) return "vor " + Math.round(s / 3600) + " Std.";
  if (s < 7 * 86400) { const d = Math.round(s / 86400); return d === 1 ? "vor 1 Tag" : "vor " + d + " Tagen"; }
  return dateOf(iso);
}
const chip = (area) => h("span", { class: "chip a-" + (AREAS[area] ? area : "plan") }, AREAS[area] || "Plan");
const av = (u) => u ? h("img", { class: "av", src: u.avatar_url || u.avatarUrl, alt: "" }) : h("span");
const nameOf = (login) => SK.data.names[login] || login || "Jemand";
const firstName = (login) => nameOf(login).split(" ")[0];
function store(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} }
function load(k) { try { return localStorage.getItem(k); } catch { return null; } }
const isNew = (iso) => !!SK.prevSeen && Date.parse(iso) > SK.prevSeen;
// Wann hat man eine Seite zuletzt angeschaut? Für die aktuelle Seite der Stand vom Sitzungsbeginn.
// Wer eine Seite noch nie besucht hat, bekommt die letzten 7 Tage als „neu“ angezeigt
const FIRST_VISIT = () => Date.now() - 7 * 86400000;
const seenOf = (page) => page === SK.page ? SK.prevSeen : (Number(load(SEEN_KEY + "-" + page) || 0) || FIRST_VISIT());
const newerThan = (iso, base) => !!base && Date.parse(iso) > base;

function status(text, isErr) {
  const s = $("status"); if (!s) return;
  s.textContent = text || ""; s.hidden = !text; s.classList.toggle("err", !!isErr);
}

// ---------- GitHub-API ----------
async function api(path, opts = {}) {
  const r = await fetch("https://api.github.com" + path, {
    method: opts.method || "GET",
    cache: "no-store",
    headers: {
      Authorization: "Bearer " + SK.token,
      Accept: opts.accept || "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (r.status === 401) { logout("Der Token gilt nicht mehr. Bitte neu anmelden."); throw new Error("401"); }
  if (!r.ok) {
    let msg = String(r.status);
    try { msg = (await r.json()).message || msg; } catch {}
    const err = new Error(r.status === 404 && !opts.allow404 ? "Kein Zugriff aufs Repo. Hat dein Token das Häkchen bei „repo“, und hast du die Einladung angenommen?" : msg);
    err.status = r.status; throw err;
  }
  if (r.status === 204) return null;
  return opts.accept && opts.accept.includes("raw") ? r.text() : r.json();
}
async function gql(query, variables) {
  const res = await api("/graphql", { method: "POST", body: { query, variables } });
  if (res.errors && res.errors.length) throw new Error(res.errors[0].message);
  return res.data;
}
async function all(path, maxPages = 10) {
  const out = [];
  for (let page = 1; page <= maxPages; page++) {
    const batch = await api(path + (path.includes("?") ? "&" : "?") + "per_page=100&page=" + page);
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
}
const b64enc = (s) => btoa(unescape(encodeURIComponent(s)));
const b64dec = (s) => decodeURIComponent(escape(atob(s.replace(/\n/g, ""))));

// ---------- Daten laden ----------
async function loadPeople() {
  const d = SK.data;
  d.people = await all(R + "/collaborators");
  await Promise.all(d.people.map(async p => {
    if (d.names[p.login]) return;
    try { const u = await api("/users/" + p.login); d.names[p.login] = u.name || CFG.names[p.login] || p.login; } catch { d.names[p.login] = CFG.names[p.login] || p.login; }
  }));
}
async function loadTasks() {
  const d = SK.data;
  const [ms, issues] = await Promise.all([all(R + "/milestones?state=all"), all(R + "/issues?state=all")]);
  d.milestones = ms.sort((a, b) => String(a.due_on).localeCompare(String(b.due_on)));
  const real = issues.filter(i => !i.pull_request && i.number !== CFG.diary);
  d.issues = real.filter(i => i.state_reason !== "not_planned");
  d.deleted = real.filter(i => i.state_reason === "not_planned");
  await Promise.all(d.issues.filter(i => i.state === "closed" && !d.closers[i.number]).map(async i => {
    try { d.closers[i.number] = (await api(R + "/issues/" + i.number)).closed_by; } catch {}
  }));
}
async function loadDiary() {
  SK.data.diary = (await all(R + "/issues/" + CFG.diary + "/comments")).sort((a, b) => b.created_at.localeCompare(a.created_at));
}
async function loadQuestions() {
  const res = await gql(`query($o:String!,$r:String!){repository(owner:$o,name:$r){id
    discussionCategories(first:20){nodes{id name slug}}
    discussions(first:60,orderBy:{field:CREATED_AT,direction:DESC}){nodes{
      id number title body url createdAt lastEditedAt isAnswered closed closedAt category{slug}
      author{login avatarUrl}
      comments(first:40){nodes{id body createdAt lastEditedAt isAnswer author{login avatarUrl}}}}}}}`, { o: CFG.owner, r: CFG.repo });
  const repo = res.repository, d = SK.data;
  d.repoId = repo.id;
  d.qa = repo.discussionCategories.nodes.find(c => c.slug === "q-a") || null;
  d.questions = repo.discussions.nodes.filter(x => x.category && x.category.slug === "q-a");
}
// ---------- Inhalte deuten ----------
function areaOfIssue(i) { return (i.labels || []).map(x => x.name).find(n => AREAS[n]) || "plan"; }
function parseEntry(body) {
  const m = /^\*\*([^*:]+):\*\*\s*/.exec(body || "");
  if (!m) return { area: null, text: body || "" };
  const key = Object.keys(AREAS).find(k => AREAS[k].toLowerCase() === m[1].trim().toLowerCase());
  return { area: key || null, text: body.slice(m[0].length) };
}
const cleanTitle = (t) => (t || "").replace(/^\[[^\]]+\]\s*/, "");
function areaOfQuestion(q) {
  const tag = (/^\[([^\]]+)\]/.exec(q.title) || [])[1];
  return tag && Object.keys(AREAS).find(k => AREAS[k].toLowerCase() === tag.toLowerCase());
}
// „An: @login“ in der ersten Zeile = an diese Person, sonst an alle
function recipientOf(q) {
  const m = /^An:\s*@([A-Za-z0-9-]+)/m.exec(q.body || "");
  return m ? m[1] : null;
}
const bodyWithoutRecipient = (b) => (b || "").replace(/^An:\s*(@[A-Za-z0-9-]+|alle)\s*\n?/m, "").trim();
const openTasksOf = (login) => SK.data.issues.filter(i => i.state === "open" && (i.assignees || []).some(a => a.login === login));
// geklärt = geschlossen (oder auf GitHub eine Antwort als Lösung markiert)
const isSettled = (q) => q.closed || q.isAnswered;
// Fragen mit Neuem von anderen seit dem letzten Besuch der Fragen-Seite
function questionsToNotice() {
  const me = SK.me.login, base = seenOf("fragen");
  const byOther = (a, iso) => a && a.login !== me && newerThan(iso, base);
  return SK.data.questions.filter(q => byOther(q.author, q.createdAt) || (q.closed && byOther(q.author, q.closedAt)) || q.comments.nodes.some(c => byOther(c.author, c.createdAt)));
}
// Alles, was andere seit „base“ geschrieben haben – für die Seite „Neu“ und ihr Licht im Menü
function newItems(base) {
  const me = SK.me.login, out = [];
  const other = (u, iso) => u && u.login !== me && newerThan(iso, base);
  for (const c of SK.data.diary) if (other(c.user, c.created_at)) {
    const e = parseEntry(c.body);
    out.push({ id: "d" + c.id, at: c.created_at, who: c.user, kind: "Tagebuch", area: e.area, text: e.text, href: "tagebuch.html" });
  }
  for (const q of SK.data.questions) {
    const to = recipientOf(q);
    if (other(q.author, q.createdAt)) out.push({ id: "q" + q.id, at: q.createdAt, who: q.author, kind: to === me ? "Frage an dich" : "Neue Frage", text: cleanTitle(q.title), href: "fragen.html#q" + q.number });
    for (const c of q.comments.nodes) if (other(c.author, c.createdAt))
      out.push({ id: "c" + c.id, at: c.createdAt, who: c.author, kind: "Antwort", text: c.body, sub: "auf: " + cleanTitle(q.title), href: "fragen.html#q" + q.number });
    if (q.closed && other(q.author, q.closedAt)) out.push({ id: "s" + q.id + q.closedAt, at: q.closedAt, who: q.author, kind: "Frage geklärt", text: cleanTitle(q.title), sub: "steht jetzt unter „Geklärte Fragen“", href: "fragen.html#q" + q.number });
  }
  // jede neue Aufgabe sehen alle; gelöschte sind in SK.data.issues nicht mehr drin und verschwinden damit auch hier
  for (const i of SK.data.issues) if (i.state === "open" && other(i.user, i.created_at)) {
    const kind = isMine(i) ? "Neue Aufgabe für dich" : isFree(i) ? "Neue Aufgabe, noch niemand zuständig" : "Neue Aufgabe für " + ownerName(i);
    out.push({ id: "i" + i.number, at: i.created_at, who: i.user, kind, text: i.title, href: isMine(i) ? "./" : "zeitplan.html" });
  }
  const read = readIds();
  return out.filter(x => !read.has(x.id)).sort((a, b) => b.at.localeCompare(a.at));
}
// einzeln als gelesen markierte Einträge (nur in diesem Browser)
const READ_KEY = "skitag-read";
function readIds() { try { return new Set(JSON.parse(load(READ_KEY) || "[]")); } catch { return new Set(); } }
function setRead(id, on) {
  const r = readIds(); on ? r.add(id) : r.delete(id);
  store(READ_KEY, JSON.stringify([...r].slice(-500)));
}
const newDiaryCount = () => SK.data.diary.filter(c => c.user && c.user.login !== SK.me.login && newerThan(c.created_at, seenOf("tagebuch"))).length;
const openQuestionsFor = (login) => SK.data.questions.filter(q => !isSettled(q) && recipientOf(q) === login);

// Zeitraum einer Aufgabe: „Zeitraum: 2026-11-03 – 2026-11-20“ im Text, sonst der Monat des Milestones
const RANGE_RE = /^Zeitraum:\s*(\d{4}-\d{2}-\d{2})\s*[–-]+\s*(\d{4}-\d{2}-\d{2})\s*$/m;
function msBounds(m) {
  const r = RANGE_RE.exec(m.description || "");
  if (r) return [r[1], r[2]].map(s => { const [Y, M, D] = s.split("-").map(Number); return new Date(Y, M - 1, D); });
  const due = new Date(Date.parse(m.due_on) - 12 * 3600e3);
  const end = new Date(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
  return [new Date(end.getFullYear(), end.getMonth(), 1), end];
}
function taskRange(i) {
  const m = RANGE_RE.exec(i.body || "");
  if (m) { const [a, b] = [m[1], m[2]].map(s => { const [Y, M, D] = s.split("-").map(Number); return new Date(Y, M - 1, D); }); return { start: a, end: b < a ? a : b, explicit: true }; }
  if (i.milestone && i.milestone.due_on) { const [s, e] = msBounds(i.milestone); return { start: s, end: e, explicit: false }; }
  return null;
}
function setRangeInBody(body, start, end) {
  const line = "Zeitraum: " + start + " – " + end;
  body = body || "";
  return RANGE_RE.test(body) ? body.replace(RANGE_RE, line) : line + "\n\n" + body;
}

// ---------- Aktionen ----------
// Eine Aktion kann eine Funktion zurückgeben, die sie wieder rückgängig macht.
// Dann zeigt die Leiste unten ein paar Sekunden lang „Rückgängig“.
let busy = false, doneTimer = null;
function showDone(text, undo) {
  const s = $("status"); if (!s) return;
  clearTimeout(doneTimer);
  s.classList.remove("err"); s.hidden = !text;
  s.replaceChildren(h("span", {}, text || ""), undo ? h("button", { class: "btn ghost undo", type: "button", onclick: () => {
    clearTimeout(doneTimer);
    act(async () => { await undo(); await SK.refresh(); }, "Rückgängig gemacht.");
  } }, "Rückgängig") : "");
  doneTimer = setTimeout(() => { if (s.firstChild && s.firstChild.textContent === text) status(""); }, undo ? 12000 : 2500);
}
async function act(fn, okText) {
  if (busy) return; busy = true;
  const ctrls = [...document.querySelectorAll("main button, main input, main select, main textarea")].filter(el => !el.disabled);
  ctrls.forEach(el => el.disabled = true);
  clearTimeout(doneTimer);
  status("Speichere …");
  try {
    const undo = await fn();
    showDone(okText || "", typeof undo === "function" ? undo : null);
  } catch (e) { if (e.message !== "401") status("Hat nicht geklappt: " + e.message, true); }
  finally { busy = false; ctrls.forEach(el => el.disabled = false); }
}
// Rückgängig für neu angelegte Aufgaben: als „nicht geplant“ schließen, die Seite blendet die aus
const dropTask = (num) => api(R + "/issues/" + num, { method: "PATCH", body: { state: "closed", state_reason: "not_planned" } });
async function setTaskState(i, closed) {
  await api(R + "/issues/" + i.number, { method: "PATCH", body: { state: closed ? "closed" : "open" } });
  delete SK.data.closers[i.number];
}
async function postDiary(area, text) {
  return api(R + "/issues/" + CFG.diary + "/comments", { method: "POST", body: { body: "**" + AREAS[area] + ":** " + text } });
}
async function askQuestion(area, to, title, details) {
  const head = to ? "An: @" + to : "An: alle";
  return (await gql(`mutation($r:ID!,$c:ID!,$t:String!,$b:String!){createDiscussion(input:{repositoryId:$r,categoryId:$c,title:$t,body:$b}){discussion{id}}}`,
    { r: SK.data.repoId, c: SK.data.qa.id, t: (area ? "[" + AREAS[area] + "] " : "") + title, b: head + "\n\n" + (details || "") })).createDiscussion.discussion.id;
}
async function answerQuestion(q, text) {
  return (await gql(`mutation($d:ID!,$b:String!){addDiscussionComment(input:{discussionId:$d,body:$b}){comment{id}}}`, { d: q.id, b: text })).addDiscussionComment.comment.id;
}
const deleteQuestion = (id) => gql(`mutation($i:ID!){deleteDiscussion(input:{id:$i}){clientMutationId}}`, { i: id });
const editQuestion = (q, title) => gql(`mutation($i:ID!,$t:String!){updateDiscussion(input:{discussionId:$i,title:$t}){clientMutationId}}`, { i: q.id, t: title });
const editAnswer = (id, text) => gql(`mutation($i:ID!,$b:String!){updateDiscussionComment(input:{commentId:$i,body:$b}){clientMutationId}}`, { i: id, b: text });
const deleteAnswer = (id) => gql(`mutation($i:ID!){deleteDiscussionComment(input:{id:$i}){clientMutationId}}`, { i: id });
async function settleQuestion(q, done) {
  if (done) await gql(`mutation($id:ID!){closeDiscussion(input:{discussionId:$id,reason:RESOLVED}){clientMutationId}}`, { id: q.id });
  else await gql(`mutation($id:ID!){reopenDiscussion(input:{discussionId:$id}){clientMutationId}}`, { id: q.id });
}

// ---------- Erinnerung um 17 Uhr ----------
// Jedes Gerät legt sein Push-Abo im privaten Repo ab; der Workflow dort schickt daraus die Erinnerung.
const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isInstalled = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
async function pushFile(sub) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sub.endpoint));
  const hex = [...new Uint8Array(hash)].slice(0, 8).map(b => b.toString(16).padStart(2, "0")).join("");
  return PUSH_DIR + "/" + SK.me.login + "-" + hex + ".json";
}
async function pushSha(path) {
  try { return (await api(R + "/contents/" + path, { allow404: true })).sha; }
  catch (e) { if (e.status === 404) return null; throw e; }
}
async function savePush(sub) {
  const path = await pushFile(sub);
  if (await pushSha(path)) return;
  await api(R + "/contents/" + path, { method: "PUT", body: { message: "Erinnerung: Gerät von " + SK.me.login + " angemeldet", content: b64enc(JSON.stringify(sub)) } });
}
async function pushOn() {
  if (await Notification.requestPermission() !== "granted") throw new Error("Benachrichtigungen sind im Browser blockiert. Du kannst sie in den Einstellungen erlauben.");
  const reg = await navigator.serviceWorker.register("sw.js");
  await navigator.serviceWorker.ready;
  const key = Uint8Array.from(atob(PUSH_KEY.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
  await savePush(await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }));
  SK.push = "on";
}
async function pushOff() {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg && await reg.pushManager.getSubscription();
  if (sub) {
    const path = await pushFile(sub), sha = await pushSha(path);
    if (sha) await api(R + "/contents/" + path, { method: "DELETE", body: { message: "Erinnerung: Gerät von " + SK.me.login + " abgemeldet", sha } });
    await sub.unsubscribe();
  }
  SK.push = "off";
}
// Stand beim Start prüfen und einmal pro Sitzung sicherstellen, dass das Abo noch im Repo liegt
async function pushCheck() {
  SK.push = isIOS() && !isInstalled() ? "ios" : pushSupported() ? "off" : null;
  if (SK.push !== "off") return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg && await reg.pushManager.getSubscription();
  if (!sub) return;
  SK.push = "on";
  try { if (!sessionStorage.getItem("skitag-push")) { await savePush(sub); sessionStorage.setItem("skitag-push", "1"); } } catch {}
}
function pushButton() {
  if (!SK.push) return "";
  if (SK.push === "ios") return h("button", { class: "link", type: "button", onclick: () => status("Am iPhone: unten auf „Teilen“ tippen, dann „Zum Home-Bildschirm“. Die App dort öffnen, neu anmelden und die Erinnerung einschalten.") }, "Erinnerung einschalten");
  const on = SK.push === "on";
  return h("button", { class: "link", type: "button", onclick: () => act(async () => { await (on ? pushOff() : pushOn()); renderUserbox(); }, on ? "Erinnerung ausgeschaltet." : "Erinnerung ist an: jeden Tag um 17 Uhr.") }, on ? "Erinnerung ausschalten" : "Erinnerung einschalten");
}

// ---------- gemeinsame Bausteine ----------
function areaOptions(sel, prefix) {
  sel.replaceChildren(...Object.entries(AREAS).map(([k, l]) => h("option", { value: k }, (prefix || "") + l)));
}
function peopleOptions(sel, emptyLabel) {
  const keep = sel.value;
  sel.replaceChildren(h("option", { value: "" }, emptyLabel), ...SK.data.people.map(p => h("option", { value: p.login }, nameOf(p.login))));
  sel.value = keep;
}
function renderTeam(box) {
  const week = Date.now() - 7 * 86400000, d = SK.data;
  box.replaceChildren(...d.people.map(p => {
    const entries = d.diary.filter(c => c.user && c.user.login === p.login && Date.parse(c.created_at) >= week).length;
    const done = d.issues.filter(i => i.state === "closed" && Date.parse(i.closed_at) >= week && d.closers[i.number] && d.closers[i.number].login === p.login).length;
    return h("div", { class: "person" }, h("img", { src: p.avatar_url, alt: "" }),
      h("span", { class: "name" }, nameOf(p.login)),
      h("span", { class: "meta" }, `Woche: ${entries} Einträge · ${done} erledigt · ${openTasksOf(p.login).length} offen`));
  }));
}
// Aufgaben darf jeder im Team abhaken und ändern, auch die von anderen. Aufgaben ohne Zuständigen kann man übernehmen.
const isMine = (i) => (i.assignees || []).some(a => a.login === SK.me.login);
const isFree = (i) => !(i.assignees || []).length;
const ownerName = (i) => (i.assignees || []).map(a => firstName(a.login)).join(", ");
async function takeOver(i) {
  await api(R + "/issues/" + i.number, { method: "PATCH", body: { assignees: [SK.me.login] } });
}
// Gelöschte Aufgabe zurückholen: wieder offen, ohne Zuständigen
const restoreTask = (i) => api(R + "/issues/" + i.number, { method: "PATCH", body: { state: "open", assignees: [] } });
const giveBack = (i) => api(R + "/issues/" + i.number, { method: "PATCH", body: { assignees: [] } });
function tickBox(i) {
  return h("input", { type: "checkbox", id: "t-" + i.number, checked: i.state === "closed", "aria-label": "Erledigt: " + i.title,
    onchange: (ev) => { const on = ev.target.checked; act(async () => { await setTaskState(i, on); await SK.refresh(); return () => setTaskState(i, !on); }, on ? "Abgehakt." : "Wieder offen."); } });
}
// Abgeben oder löschen (mit Rückfrage). Beides lässt sich danach rückgängig machen.
function taskActions(i) {
  const box = h("div", { class: "task-actions" });
  const was = i.state, owners = (i.assignees || []).map(a => a.login);
  const normal = () => box.replaceChildren(
    i.state === "open" && owners.length ? h("button", { class: "link", type: "button", onclick: () => act(async () => {
      await giveBack(i); await SK.refresh();
      return () => api(R + "/issues/" + i.number, { method: "PATCH", body: { assignees: owners } });
    }, "Abgegeben. Jetzt kann sie jemand anders übernehmen.") }, isMine(i) ? "Abgeben" : "Von " + ownerName(i) + " wegnehmen") : "",
    h("button", { class: "link danger", type: "button", onclick: ask }, "Löschen"));
  const ask = () => box.replaceChildren(h("span", { class: "confirm-q" }, "Wirklich löschen?"),
    h("button", { class: "btn danger small", type: "button", onclick: () => act(async () => {
      await dropTask(i.number); await SK.refresh();
      return () => api(R + "/issues/" + i.number, { method: "PATCH", body: was === "open" ? { state: "open" } : { state: "closed", state_reason: "completed" } });
    }, "Gelöscht.") }, "Ja, löschen"),
    h("button", { class: "btn ghost small", type: "button", onclick: normal }, "Nein"));
  normal();
  return box;
}
function taskRow(i, onOpen) {
  const closer = SK.data.closers[i.number], r = taskRange(i), note = (i.body || "").replace(RANGE_RE, "").trim();
  return h("div", { class: "task" + (i.state === "closed" ? " done" : "") },
    tickBox(i),
    h("div", {},
      h("span", { class: "t", role: onOpen ? "button" : null, tabindex: onOpen ? "0" : null, onclick: onOpen ? () => onOpen(i) : null,
        onkeydown: onOpen ? (e) => { if (e.key === "Enter") onOpen(i); } : null }, i.title),
      h("div", { class: "sub" }, isNew(i.created_at) && i.user && i.user.login !== SK.me.login ? h("span", { class: "pill new" }, "neu") : null, chip(areaOfIssue(i)),
        (i.assignees || []).length ? h("span", { class: "who" }, ...i.assignees.map(a => h("img", { src: a.avatar_url, alt: nameOf(a.login), title: nameOf(a.login) }))) : h("span", {}, "niemand zuständig"),
        r ? h("span", {}, r.start.toLocaleDateString("de-AT", { day: "numeric", month: "short" }) + " – " + r.end.toLocaleDateString("de-AT", { day: "numeric", month: "short" })) : null,
        i.state === "closed" ? h("span", {}, "erledigt" + (closer ? " von " + firstName(closer.login) : "") + " am " + dateOf(i.closed_at)) : null,
        isFree(i) && i.state === "open" ? h("button", { class: "link", type: "button", onclick: () => act(async () => { await takeOver(i); await SK.refresh(); return () => giveBack(i); }, "Übernommen.") }, "Übernehmen") : null),
      note ? h("p", { class: "muted small", style: "margin:4px 0 0;white-space:pre-wrap;overflow-wrap:anywhere" }, note) : null),
    taskActions(i));
}

// ---------- Rahmen: Kopf, Menü, Anmeldung ----------
const PAGES = [["neu.html", "neu", "Neu"], ["./", "aufgaben", "Meine Aufgaben"], ["tagebuch.html", "tagebuch", "Mein Tagebuch"], ["zeitplan.html", "zeitplan", "Zeitplan"], ["fragen.html", "fragen", "Fragen"], ["plan.html", "plan", "Businessplan"]];
function shell(page) {
  const wrap = $("wrap"), main = $("main");
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const days = Math.max(0, Math.round((CFG.testDay - now) / 86400000));
  const head = h("header", { class: "head" },
    h("div", {}, h("div", { class: "eyebrow" }, "Ski Tag · Team"), h("h1", {}, "Ski Tag Board"),
      h("p", {}, "Wer macht was bis wann.")),
    h("div", { class: "count" }, h("b", {}, days), h("span", {}, "Tage bis zur Präsentation bei KitzSki (Feb 2027)")));
  const nav = h("div", { class: "navbar" },
    h("nav", { class: "tabs" }, ...PAGES.map(([href, key, label]) =>
      h("a", { href, "aria-current": key === page ? "page" : null }, label, ["neu", "fragen", "tagebuch"].includes(key) ? h("span", { class: "n", id: "nav-" + key, hidden: true }) : null))),
    h("div", { class: "userbox", id: "userbox" }));
  const login = h("section", { class: "panel login", id: "login", hidden: true },
    h("h2", {}, "Anmelden"),
    h("p", {}, "Die Seite arbeitet direkt mit eurem privaten GitHub-Repo. Dafür brauchst du einmal einen Zugangsschlüssel (Token):"),
    h("ol", {},
      h("li", {}, h("a", { href: "https://github.com/settings/tokens/new?scopes=repo&description=Ski%20Tag%20Board", target: "_blank", rel: "noopener" }, "Hier einen Token erstellen"), " (bei GitHub angemeldet sein)"),
      h("li", {}, "Bei „Expiration“ z. B. ", h("b", {}, "90 days"), " wählen. Das Häkchen bei ", h("b", {}, "repo"), " ist schon gesetzt."),
      h("li", {}, "Ganz unten ", h("b", {}, "Generate token"), " klicken und den Token kopieren (beginnt mit ", h("code", {}, "ghp_"), ")"),
      h("li", {}, "Hier einfügen:")),
    h("form", { class: "add", id: "f-login" },
      h("input", { type: "password", id: "token", placeholder: "ghp_…", autocomplete: "off", required: true, "aria-label": "GitHub-Token" }),
      h("div", { class: "row" }, h("button", { class: "btn", type: "submit" }, "Anmelden"))),
    h("p", { class: "muted small" }, "Der Token bleibt nur in diesem Browser gespeichert und geht nur an GitHub. Einmal anmelden reicht, auch für alle Unterseiten."));
  const st = h("div", { class: "notice", id: "status", hidden: true });
  wrap.prepend(head, nav, login, st);
  $("f-login").addEventListener("submit", (ev) => {
    ev.preventDefault(); const t = $("token").value.trim(); if (!t) return;
    SK.token = t; store(TOKEN_KEY, t); $("token").value = ""; boot();
  });
}
function renderUserbox() {
  const box = $("userbox"); if (!box || !SK.me) return;
  box.replaceChildren(h("img", { src: SK.me.avatar_url, alt: "" }), h("span", {}, firstName(SK.me.login)),
    h("button", { class: "link", type: "button", onclick: () => act(SK.refresh, "Aktualisiert.") }, "Aktualisieren"),
    pushButton(),
    h("button", { class: "link", type: "button", onclick: () => logout() }, "Abmelden"));
  const badge = (id, n) => { const el = $(id); if (el) { el.textContent = n; el.hidden = !n; } };
  badge("nav-fragen", SK.page === "fragen" ? 0 : questionsToNotice().length);
  badge("nav-tagebuch", SK.page === "tagebuch" ? 0 : newDiaryCount());
  badge("nav-neu", newItems(seenOf("neu")).length);
}
function logout(msg) {
  SK.token = null; SK.me = null; store(TOKEN_KEY, null);
  $("main").hidden = true; $("login").hidden = false; $("userbox").replaceChildren();
  if (msg) $("login").prepend(h("p", { class: "notice err" }, msg));
}

let pageRender = null, pageNeeds = [];
async function refresh() {
  const jobs = { people: loadPeople, tasks: loadTasks, diary: loadDiary, questions: loadQuestions };
  await Promise.all(pageNeeds.filter(k => jobs[k]).map(k => jobs[k]()));
  renderUserbox();
  if (pageRender) await pageRender();
}
SK.refresh = refresh;

async function boot() {
  $("login").hidden = true; $("main").hidden = false;
  status("Lade Daten von GitHub …");
  try {
    SK.me = await api("/user");
    // „Neu“ = seit dem letzten Besuch; innerhalb einer Sitzung bleibt der Vergleichspunkt gleich
    const key = SEEN_KEY + "-" + SK.page;
    let seen = 0;
    try { seen = Number(sessionStorage.getItem(key) || 0); } catch {}
    if (!seen) seen = Number(load(key) || 0) || FIRST_VISIT();
    SK.prevSeen = seen;
    try { sessionStorage.setItem(key, String(seen)); } catch {}
    await pushCheck().catch(() => {});
    await refresh();
    if (SK.page !== "neu") store(key, String(Date.now()));
    status("");
  } catch (e) { if (e.message !== "401") status("Laden hat nicht geklappt: " + e.message, true); }
}

// Jede Seite ruft das auf: welche Daten sie braucht und wie sie sich zeichnet.
function startPage(page, needs, render) {
  checkVersion();
  SK.page = page;
  pageNeeds = ["people", "questions", "diary", "tasks", ...needs];
  pageRender = render;
  shell(page);
  SK.token = load(TOKEN_KEY);
  if (SK.token) boot(); else { $("main").hidden = true; $("login").hidden = false; }
  // Alle 30 Sekunden neu laden und sofort, wenn man zum Tab zurückkommt, damit man Änderungen der anderen gleich sieht
  const auto = () => {
    if (SK.token && SK.me && !busy && document.visibilityState === "visible" && !document.activeElement.matches("textarea, input[type=text], input[type=number], input[type=date], select"))
      refresh().catch(() => {});
  };
  setInterval(auto, 30000);
  document.addEventListener("visibilitychange", auto);
  window.addEventListener("focus", auto);
}
