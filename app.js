// Ski Tag Board: gemeinsamer Teil für alle Seiten.
// Alle Daten liegen im privaten Repo und werden über die GitHub-API mit dem Token des Nutzers gelesen und geschrieben.
const CFG = {
  owner: "TobiasS3",
  repo: "ski-tag-plan",
  diary: 14,
  planFile: "Ski Tag Plan.html",
  costFile: "daten/kosten.json",
  testDay: new Date(2027, 1, 1),
  range: [new Date(2026, 9, 26), new Date(2027, 2, 1)],
};
const AREAS = { netzwerk: "Netzwerk", hardware: "Hardware", app: "App", kosten: "Kosten", plan: "Plan" };
const TOKEN_KEY = "skitag-token", SEEN_KEY = "skitag-seen";
const R = "/repos/" + CFG.owner + "/" + CFG.repo;

const SK = {
  token: null, me: null,
  data: { people: [], names: {}, milestones: [], issues: [], closers: {}, diary: [], questions: [], qa: null, repoId: null, activity: [] },
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
    try { const u = await api("/users/" + p.login); d.names[p.login] = u.name || p.login; } catch { d.names[p.login] = p.login; }
  }));
}
async function loadTasks() {
  const d = SK.data;
  const [ms, issues] = await Promise.all([all(R + "/milestones?state=all"), all(R + "/issues?state=all")]);
  d.milestones = ms.sort((a, b) => String(a.due_on).localeCompare(String(b.due_on)));
  d.issues = issues.filter(i => !i.pull_request && i.number !== CFG.diary);
  await Promise.all(d.issues.filter(i => i.state === "closed" && !d.closers[i.number]).map(async i => {
    try { d.closers[i.number] = (await api(R + "/issues/" + i.number)).closed_by; } catch {}
  }));
}
async function loadDiary() {
  SK.data.diary = (await all(R + "/issues/" + CFG.diary + "/comments")).reverse();
}
async function loadQuestions() {
  const res = await gql(`query($o:String!,$r:String!){repository(owner:$o,name:$r){id
    discussionCategories(first:20){nodes{id name slug}}
    discussions(first:60,orderBy:{field:CREATED_AT,direction:DESC}){nodes{
      id number title body url createdAt isAnswered category{slug}
      author{login avatarUrl}
      comments(first:40){nodes{id body createdAt isAnswer author{login avatarUrl}}}}}}}`, { o: CFG.owner, r: CFG.repo });
  const repo = res.repository, d = SK.data;
  d.repoId = repo.id;
  d.qa = repo.discussionCategories.nodes.find(c => c.slug === "q-a") || null;
  d.questions = repo.discussions.nodes.filter(x => x.category && x.category.slug === "q-a");
}
async function loadActivity() {
  const d = SK.data;
  const [events, comments, commits] = await Promise.all([
    api(R + "/issues/events?per_page=60"),
    api(R + "/issues/comments?sort=created&direction=desc&per_page=40"),
    api(R + "/commits?per_page=15"),
  ]);
  const out = [];
  const words = { closed: "hat abgehakt", reopened: "hat wieder geöffnet", assigned: "hat zugewiesen", milestoned: "hat einem Monat zugeordnet", renamed: "hat umbenannt" };
  for (const e of events) {
    if (!words[e.event] || !e.issue || e.issue.number === CFG.diary) continue;
    let text = words[e.event] + ": " + e.issue.title;
    if (e.event === "assigned" && e.assignee) text = "hat " + nameOf(e.assignee.login) + " zugewiesen: " + e.issue.title;
    if (e.event === "milestoned" && e.milestone) text = "hat „" + e.issue.title + "“ in " + e.milestone.title + " gelegt";
    out.push({ at: e.created_at, who: e.actor, text, href: "zeitplan.html" });
  }
  for (const i of d.issues) out.push({ at: i.created_at, who: i.user, text: "hat eine Aufgabe angelegt: " + i.title, href: "zeitplan.html" });
  for (const c of comments) {
    const num = Number((c.issue_url || "").split("/").pop());
    if (num === CFG.diary) out.push({ at: c.created_at, who: c.user, text: "hat ins Tagebuch geschrieben: " + parseEntry(c.body).text.slice(0, 90), href: "./" });
    else out.push({ at: c.created_at, who: c.user, text: "hat eine Aufgabe kommentiert", href: c.html_url });
  }
  for (const q of d.questions) {
    out.push({ at: q.createdAt, who: q.author, text: "hat gefragt: " + cleanTitle(q.title), href: "fragen.html#q" + q.number });
    for (const c of q.comments.nodes) out.push({ at: c.createdAt, who: c.author, text: "hat geantwortet auf: " + cleanTitle(q.title), href: "fragen.html#q" + q.number });
  }
  for (const c of commits) {
    const msg = (c.commit.message || "").split("\n")[0];
    out.push({ at: c.commit.author.date, who: c.author, text: "hat den Plan geändert: " + msg, href: "plan.html" });
  }
  d.activity = out.filter(x => x.at).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 40);
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
const openQuestionsFor = (login) => SK.data.questions.filter(q => !q.isAnswered && recipientOf(q) === login);

// Zeitraum einer Aufgabe: „Zeitraum: 2026-11-03 – 2026-11-20“ im Text, sonst der Monat des Milestones
const RANGE_RE = /^Zeitraum:\s*(\d{4}-\d{2}-\d{2})\s*[–-]+\s*(\d{4}-\d{2}-\d{2})\s*$/m;
function msBounds(m) {
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
let busy = false;
async function act(fn, okText) {
  if (busy) return; busy = true;
  const ctrls = document.querySelectorAll("main button, main input, main select, main textarea");
  ctrls.forEach(el => el.disabled = true);
  status("Speichere …");
  try {
    await fn();
    status(okText || "");
    setTimeout(() => { if ($("status") && $("status").textContent === okText) status(""); }, 2500);
  } catch (e) { if (e.message !== "401") status("Hat nicht geklappt: " + e.message, true); }
  finally { busy = false; ctrls.forEach(el => el.disabled = false); }
}
async function setTaskState(i, closed) {
  await api(R + "/issues/" + i.number, { method: "PATCH", body: { state: closed ? "closed" : "open" } });
  delete SK.data.closers[i.number];
}
async function postDiary(area, text) {
  await api(R + "/issues/" + CFG.diary + "/comments", { method: "POST", body: { body: "**" + AREAS[area] + ":** " + text } });
}
async function askQuestion(area, to, title, details) {
  const head = to ? "An: @" + to : "An: alle";
  await gql(`mutation($r:ID!,$c:ID!,$t:String!,$b:String!){createDiscussion(input:{repositoryId:$r,categoryId:$c,title:$t,body:$b}){discussion{id}}}`,
    { r: SK.data.repoId, c: SK.data.qa.id, t: "[" + AREAS[area] + "] " + title, b: head + "\n\n" + (details || "") });
}
async function answerQuestion(q, text) {
  await gql(`mutation($d:ID!,$b:String!){addDiscussionComment(input:{discussionId:$d,body:$b}){clientMutationId}}`, { d: q.id, b: text });
}
async function markAnswer(commentId) {
  await gql(`mutation($id:ID!){markDiscussionCommentAsAnswer(input:{id:$id}){clientMutationId}}`, { id: commentId });
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
function taskRow(i, onOpen) {
  const closer = SK.data.closers[i.number], r = taskRange(i);
  return h("div", { class: "task" + (i.state === "closed" ? " done" : "") },
    h("input", { type: "checkbox", id: "t-" + i.number, checked: i.state === "closed", "aria-label": "Erledigt: " + i.title,
      onchange: (ev) => act(async () => { await setTaskState(i, ev.target.checked); await SK.refresh(); }, ev.target.checked ? "Abgehakt." : "Wieder offen.") }),
    h("div", {},
      h("span", { class: "t", role: onOpen ? "button" : null, tabindex: onOpen ? "0" : null, onclick: onOpen ? () => onOpen(i) : null,
        onkeydown: onOpen ? (e) => { if (e.key === "Enter") onOpen(i); } : null }, i.title),
      h("div", { class: "sub" }, chip(areaOfIssue(i)),
        (i.assignees || []).length ? h("span", { class: "who" }, ...i.assignees.map(a => h("img", { src: a.avatar_url, alt: nameOf(a.login), title: nameOf(a.login) }))) : h("span", {}, "niemand zuständig"),
        r ? h("span", {}, r.start.toLocaleDateString("de-AT", { day: "numeric", month: "short" }) + " – " + r.end.toLocaleDateString("de-AT", { day: "numeric", month: "short" })) : null,
        i.state === "closed" ? h("span", {}, "erledigt" + (closer ? " von " + firstName(closer.login) : "") + " am " + dateOf(i.closed_at)) : null)),
    h("a", { class: "small", href: i.html_url, target: "_blank", rel: "noopener", title: "Auf GitHub öffnen" }, "#" + i.number));
}

// ---------- Rahmen: Kopf, Menü, Anmeldung ----------
const PAGES = [["./", "start", "Start"], ["zeitplan.html", "zeitplan", "Zeitplan"], ["fragen.html", "fragen", "Fragen"], ["plan.html", "plan", "Businessplan"]];
function shell(page) {
  const wrap = $("wrap"), main = $("main");
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const days = Math.max(0, Math.round((CFG.testDay - now) / 86400000));
  const head = h("header", { class: "head" },
    h("div", {}, h("div", { class: "eyebrow" }, "Ski Tag · Team"), h("h1", {}, "Ski Tag Board"),
      h("p", {}, "Zeitplan, Aufgaben, Fragen und Businessplan an einem Ort.")),
    h("div", { class: "count" }, h("b", {}, days), h("span", {}, "Tage bis zum Test im Schnee (Feb 2027)")));
  const nav = h("div", { class: "navbar" },
    h("nav", { class: "tabs" }, ...PAGES.map(([href, key, label]) =>
      h("a", { href, "aria-current": key === page ? "page" : null }, label, key === "fragen" ? h("span", { class: "n", id: "nav-q", hidden: true }) : null))),
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
    h("button", { class: "link", type: "button", onclick: () => logout() }, "Abmelden"));
  const open = SK.data.questions.filter(q => !q.isAnswered).length, n = $("nav-q");
  if (n) { n.textContent = open; n.hidden = !open; }
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
  if (pageNeeds.includes("activity")) await loadActivity();
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
    let seen = 0;
    try { seen = Number(sessionStorage.getItem(SEEN_KEY) || 0); } catch {}
    if (!seen) seen = Number(load(SEEN_KEY) || 0);
    SK.prevSeen = seen;
    try { sessionStorage.setItem(SEEN_KEY, String(seen)); } catch {}
    await refresh();
    store(SEEN_KEY, String(Date.now()));
    status("");
  } catch (e) { if (e.message !== "401") status("Laden hat nicht geklappt: " + e.message, true); }
}

// Jede Seite ruft das auf: welche Daten sie braucht und wie sie sich zeichnet.
function startPage(page, needs, render) {
  pageNeeds = ["people", "questions", ...needs];
  pageRender = render;
  shell(page);
  SK.token = load(TOKEN_KEY);
  if (SK.token) boot(); else { $("main").hidden = true; $("login").hidden = false; }
  // Alle 60 Sekunden neu laden, damit man Änderungen der anderen sieht
  setInterval(() => {
    if (SK.token && SK.me && !busy && document.visibilityState === "visible" && !document.activeElement.matches("textarea, input[type=text], input[type=number], input[type=date], select"))
      refresh().catch(() => {});
  }, 60000);
}
