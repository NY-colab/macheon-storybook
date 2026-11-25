"use strict";
const el = id => document.getElementById(id);
const pageNames = ["1", "2", "3", "4"];
let wordBank = [];
const groups = new Map();
let active = null;
let demo = null;
let aiAvailable = true;
let reader = null;
let polling = false;
let readerTrigger = null;

function show(element, visible) {
  element.hidden = !visible;
}
function make(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== null) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function getDraft(data) {
  return {
    words: Array.isArray(data.words) ? [...data.words] : [],
    idea: data.idea || "",
    title: data.title || "",
    pages: Array.from({length: 4}, (_, i) => data.pages?.[i]?.text || "")
  };
}
function createGroup(data) {
  return {data, draft: getDraft(data), dirty: false, count: 0, timer: null, saving: null,
    error: "", conflict: false, pending: false, panel: data.pages.some(p => p.text) ? "story" : "ideas", paste: ""};
}
function busy(group) {
  return group.pending || group.data.job?.status === "running";
}
function pagesReady(group) {
  return group.draft.pages.every(text => text.trim());
}
async function api(path, payload) {
  return onlineShelf.request(path, payload);
}
function notifyConnection(text) {
  if (el("connection").textContent !== text) el("connection").textContent = text;
  show(el("connection"), Boolean(text));
}
function summaryFor(group) {
  const {data,draft} = group;
  if (busy(group)) return data.job?.type === "art" ? "삽화 만드는 중" : "동화 만드는 중";
  if (group.error || data.job?.status === "error") return "확인할 내용이 있어요";
  if (draft.pages.some(Boolean)) return draft.title || "동화 원고";
  return draft.words.length || draft.idea ? "이야기 재료 작성 중" : "이야기 시작하기";
}
function renderDesks() {
  for (const [id,group] of groups) {
    let button = el("desk-" + id);
    if (!button) {
      button = make("button", null, "desk");
      button.id = "desk-" + id;
      button.type = "button";
      const cover = make("i", null, "closed-book");
      cover.setAttribute("aria-hidden","true");
      const labels = make("span");
      labels.append(make("strong", id + "모둠"), make("small"));
      const arrow = make("span", "›", "chevron");
      arrow.setAttribute("aria-hidden","true");
      button.append(cover, labels, arrow);
      button.addEventListener("click", () => openGroup(id));
      el("desk-list").append(button);
    }
    const label = summaryFor(group);
    if (button.querySelector("small").textContent !== label) button.querySelector("small").textContent = label;
  }
}
function updateValue(node, value) {
  if (node.value !== value) node.value = value;
}
function toggleWord(word) {
  const group = groups.get(active);
  if (!group || busy(group)) return;
  const selected = group.draft.words;
  if (selected.includes(word)) group.draft.words = selected.filter(item => item !== word);
  else if (selected.length < 5) group.draft.words = [...selected,word];
  else return;
  changed();
}
function updateWordBoard(group, locked) {
  const selected = group.draft.words;
  const countText = selected.length + " / 5개 선택";
  const wordsText = selected.join(" · ");
  if (el("word-count").textContent !== countText) el("word-count").textContent = countText;
  if (el("selected-words").textContent !== wordsText) el("selected-words").textContent = wordsText;
  for (const button of el("word-board").children) {
    const pressed = selected.includes(button.textContent);
    button.setAttribute("aria-pressed",String(pressed));
    button.disabled = locked || (!pressed && selected.length >= 5);
  }
}
function renderWordBank(words) {
  if (!Array.isArray(words) || !words.length) throw new Error("단어판을 열 수 없어요.");
  if (words.length === wordBank.length && words.every((w,i) => w === wordBank[i])) return;
  wordBank = [...words];
  const tiles = document.createDocumentFragment();
  for (const word of words) {
    const button = make("button",word,"word-tile");
    button.type = "button";
    button.setAttribute("aria-label",word);
    button.setAttribute("aria-pressed","false");
    button.addEventListener("click",()=>toggleWord(word));
    tiles.append(button);
  }
  el("word-board").replaceChildren(tiles);
}
function usePanel(name, focus = false) {
  if (!active) return;
  const group = groups.get(active);
  group.panel = name;
  const ideas = name === "ideas";
  show(el("ideas-panel"),ideas);
  show(el("story-panel"),!ideas);
  el("ideas-tab").setAttribute("aria-pressed", String(ideas));
  el("story-tab").setAttribute("aria-pressed", String(!ideas));
  if (focus) el(ideas ? "ideas-tab" : "story-tab").focus();
}
function fillEditor() {
  if (!active) return;
  const group = groups.get(active);
  updateValue(el("group-idea"),group.draft.idea);
  group.draft.pages.forEach((p,i) => updateValue(el("page-" + i), p));
  updateValue(el("book-title"),group.draft.title);
  updateValue(el("paste-input"),group.paste);
  usePanel(group.panel);
  updateEditorState();
}
function updateEditorState() {
  if (!active) return;
  const group = groups.get(active);
  const locked = busy(group);
  updateWordBoard(group,locked);
  const hasStory = pagesReady(group);
  const illustrated = hasStory && group.draft.pages.every((text,i) => {
    const saved = group.data.pages[i];
    return saved?.image && text.trim() === saved.text;
  });
  const job = group.data.job;
  let msg = "";
  if (illustrated) msg = "삽화 네 장이 완성됐어요. ‘책 펼치기’를 눌러 함께 읽어 보세요.";
  if (!aiAvailable) msg = "AI 연결 전에도 원고를 직접 넣고 책을 펼칠 수 있어요.";
  if (job?.message && (job.status === "running" || job.status === "error")) {
    msg = job.message;
    if (job.status === "error") msg += job.type === "story" ? " 이야기 재료에서 ‘AI로 동화 쓰기’를 다시 누를 수 있어요." : " 원고에서 ‘삽화 만들기’를 다시 누르거나 글부터 읽어 보세요.";
  } else if (locked) msg = "AI가 작업 중이에요. 이 탭을 열어 두세요.";
  if (el("jobs").textContent !== msg) el("jobs").textContent = msg;
  show(el("jobs"),Boolean(msg));
  let status = "이 브라우저에 자동 저장";
  if (group.saving) status = "저장 중…";
  else if (group.dirty) status = "입력한 내용 저장 대기 중";
  if (group.error) status = group.error;
  if (el("save-state").textContent !== status) el("save-state").textContent = status;
  show(el("retry-save"), Boolean(group.error && group.dirty && !locked));
  show(el("reload-group"), Boolean(group.conflict && !locked));
  el("retry-save").textContent = group.conflict ? "내 입력으로 저장" : "다시 저장";
  document.querySelectorAll("#editor input, #editor textarea").forEach(n => n.disabled = locked);
  el("paste-btn").disabled = locked;
  el("write-btn").disabled = locked || !aiAvailable || group.conflict || group.draft.words.length !== 5;
  el("art-btn").disabled = locked || !aiAvailable || group.conflict || illustrated;
  el("read-btn").disabled = !hasStory;
  for (let i=0; i<4; i++) {
    const p = group.data.pages?.[i];
    const note = p?.image && p.text === group.draft.pages[i].trim() ? " · 삽화 있음" : "";
    const label = pageNames[i] + note;
    if (el("page-label-" + i).textContent !== label) el("page-label-" + i).textContent = label;
  }
}
function setViews(view) {
  show(el("home"), view === "home");
  show(el("editor"), view === "editor");
  show(el("home-btn"), view === "editor");
  show(el("mast-note"), view === "home");
}
function openGroup(id) {
  if (active && active !== id) void flush(groups.get(active));
  active = id;
  el("group-select").value = String(id);
  el("group-title").textContent = id + "모둠의 그림동화";
  el("paste-box").open = false;
  el("paste-info").textContent = "";
  el("paste-input").removeAttribute("aria-invalid");
  show(el("paste-result"),false);
  setViews("editor");
  fillEditor();
  window.scrollTo(0,0);
  el("group-title").focus({preventScroll:true});
}
function home() {
  const previous = active;
  if (active) void flush(groups.get(active));
  active = null;
  setViews("home");
  renderDesks();
  window.scrollTo(0,0);
  if (previous) el("desk-" + previous)?.focus({preventScroll:true});
}
function changed() {
  const group = groups.get(active);
  if (!group || busy(group)) return;
  group.draft.idea = el("group-idea").value;
  group.draft.pages = Array.from({length:4},(_,i) => el("page-" + i).value);
  group.draft.title = el("book-title").value;
  group.dirty = true;
  group.count++;
  if (!group.conflict) group.error = "";
  clearTimeout(group.timer);
  group.timer = setTimeout(() => void flush(group),700);
  updateEditorState();
}
async function flush(group) {
  if (!group) return false;
  clearTimeout(group.timer);
  if (group.saving) await group.saving;
  if (!group.dirty) return true;
  if (group.conflict || busy(group)) return false;
  const serial = group.count;
  const pages = group.draft.pages.some(s => s.length) ? group.draft.pages.slice() : [];
  const payload = {words:[...group.draft.words],idea:group.draft.idea,title:group.draft.title,pages,revision:group.data.revision};
  group.saving = (async () => {
    try {
      const result = await api("/api/groups/" + group.data.id + "/draft",payload);
      if (result.revision >= group.data.revision) group.data = result;
      group.dirty = serial !== group.count;
      group.error = "";
      return true;
    } catch (error) {
      group.conflict = error.status === 409;
      group.error = group.conflict ? "다른 창에서 바뀐 내용이 있어요. 저장할 내용을 골라 주세요." : "저장하지 못했어요. " + error.message;
      return false;
    }
  })();
  updateEditorState();
  const ok = await group.saving;
  group.saving = null;
  updateEditorState();
  if (ok && group.dirty) return flush(group);
  return ok;
}
function merge(data) {
  const id = Number(data.id);
  if (!groups.has(id)) { groups.set(id,createGroup(data)); return; }
  const group = groups.get(id);
  if (data.revision < group.data.revision || group.saving || group.pending) return;
  const before = group.data;
  if (group.dirty && before.revision !== data.revision) {
    group.conflict = true;
    group.error = "다른 창에서 바뀐 내용이 있어요. 저장할 내용을 골라 주세요.";
  }
  group.data = data;
  if (!group.dirty && data.revision !== before.revision) {
    group.draft = getDraft(data);
    if (before.job?.status === "running" && before.job.type === "story" && !data.job && data.pages.length === 4) group.panel = "story";
  }
  if (active === id) fillEditor();
}
async function refresh() {
  if (polling) return;
  polling = true;
  try {
    const state = await api("/api/state");
    renderWordBank(state.wordBank);
    for (const group of state.groups) merge(group);
    demo = state.demo;
    aiAvailable = Boolean(state.aiAvailable);
    el("demo-btn").disabled = !demo?.pages?.length;
    if (demo?.pages?.[0]?.image) {
      if (el("cover-img").getAttribute("src") !== demo.pages[0].image) el("cover-img").src = demo.pages[0].image;
    }
    renderDesks();
    updateEditorState();
    if (reader && reader.source !== "demo") paintReader();
    notifyConnection("");
  } catch {
    notifyConnection("책방에 연결할 수 없어요. ‘수업 시작’ 창이 열려 있는지 확인해 주세요. 잠시 뒤 다시 연결합니다.");
  } finally { polling = false; }
}
function firstMissing(nodes, message) {
  const node = nodes.find(n => !n.value.trim());
  if (!node) return false;
  node.setCustomValidity(message);
  node.reportValidity();
  node.focus();
  return true;
}
async function startJob(type) {
  const group = groups.get(active);
  if (!group || busy(group)) return;
  if (type === "story") {
    if (group.draft.words.length !== 5) return;
    if (group.draft.pages.some(Boolean) && !window.confirm("현재 원고를 새 AI 동화로 바꿀까요?")) return;
  } else {
    if (firstMissing(Array.from({length:4},(_,i)=>el("page-"+i)), "이 쪽의 동화 내용을 넣어 주세요.")) return;
    if (!group.draft.title.trim()) {
      el("book-title").value = active + "모둠의 그림동화";
      changed();
    }
  }
  if (!await flush(group) || busy(group)) return;
  group.pending = true;
  updateEditorState();
  const payload = type === "story" ? {words:[...group.draft.words], idea:group.draft.idea} : {title:group.draft.title, pages:group.draft.pages};
  try {
    const result = await api("/api/groups/" + group.data.id + "/" + type,{...payload,revision:group.data.revision});
    group.pending = false;
    merge(result);
    if (type === "story" && !result.job && result.pages.length) group.panel = "story";
    if (group.data.id === active) fillEditor();
  } catch (error) {
    group.error = "요청을 보내지 못했어요. " + error.message;
  } finally {
    group.pending = false;
    updateEditorState();
    renderDesks();
    void refresh();
  }
}
function splitBook(text) {
  const tooLong = "한 쪽에 900자까지 담을 수 있어요. 빈 줄로 네 장면을 구분하고 긴 쪽의 분량을 조절해 주세요.";
  const paragraphs = text.split(/\n[\t ]*\n+/).map(s => s.trim()).filter(Boolean);
  if (paragraphs.length === 4) {
    return paragraphs.some(s => s.length > 900) ? {error:tooLong} : {pages:paragraphs, note:"네 문단을 원래 순서대로 담았어요."};
  }
  if (text.replace(/\s/g,"").length > 3600) return {error:tooLong};
  // Keep source offsets intact. A line wrap within a sentence is not a page break.
  const scan = text.replace(/[\r\n]/g," ");
  if (typeof Intl.Segmenter !== "function") return {error:"이 브라우저에서는 빈 줄로 네 장면을 구분해 주세요."};
  const sentences = [];
  for (const {index, segment} of new Intl.Segmenter("ko",{granularity:"sentence"}).segment(scan)) {
    if (segment.trim()) sentences.push({
      start:index + segment.length - segment.trimStart().length,
      end:index + segment.trimEnd().length
    });
  }
  const count = sentences.length;
  if (count < 4) return {error:"자동으로 나누려면 네 문장 이상이 필요해요. 짧은 글은 원하는 네 장면 사이에 빈 줄을 넣어 주세요."};
  // Among valid sentence boundaries, choose the four most even page lengths.
  const layers = [new Map([[0,{cost:0}]])];
  const target = Math.min(text.length / 4,900);
  for (let page=1; page<=4; page++) {
    const next = new Map();
    for (const [start,prior] of layers[page-1]) {
      const maxEnd = count - (4-page);
      for (let end=page === 4 ? count : start+1; end<=maxEnd; end++) {
        const length = sentences[end-1].end - sentences[start].start;
        if (length > 900) break;
        const cost = prior.cost + (length-target)**2;
        if (!next.has(end) || cost < next.get(end).cost) next.set(end,{cost,start});
      }
    }
    layers.push(next);
  }
  if (!layers[4].has(count)) return {error:tooLong};
  const pages = [];
  let end = count;
  for (let page=4; page>0; page--) {
    const {start} = layers[page].get(end);
    pages.unshift(text.slice(sentences[start].start, sentences[end-1].end));
    end = start;
  }
  return {pages, note:"문장 순서를 살려 네 쪽에 나눴어요."};
}
function applyPaste() {
  const input = el("paste-input");
  const {pages:chunks,note,error} = splitBook(input.value.trim());
  if (error) {
    el("paste-info").textContent = error;
    input.setAttribute("aria-invalid","true");
    input.focus();
    return;
  }
  const group = groups.get(active);
  if (group.draft.pages.some(Boolean) && !window.confirm("네 쪽의 원고를 붙여넣은 글로 바꿀까요?")) return;
  chunks.forEach((text,i) => {
    const element = el("page-" + i);
    updateValue(element,text);
    element.setCustomValidity("");
  });
  group.paste = "";
  el("paste-input").value = "";
  el("paste-input").removeAttribute("aria-invalid");
  el("paste-info").textContent = "";
  el("paste-box").open = false;
  changed();
  const result = el("paste-result");
  result.textContent = note + " 1쪽부터 확인해 주세요.";
  show(result,true);
  result.focus();
}
function currentBook() {
  if (reader.source === "demo") return demo;
  const group = groups.get(reader.source);
  const pages = group.draft.pages.map((text,i) => ({
    text,
    image: group.data.pages?.[i]?.text === text.trim() ? group.data.pages[i].image : ""
  }));
  return {title:group.draft.title || reader.source + "모둠의 그림동화",pages};
}
function paintReader(direction) {
  const book = currentBook();
  if (!book?.pages?.length) return;
  const number = reader.pageNumber;
  const isCover = number === 0;
  const page = isCover ? book.pages[0] : book.pages[number - 1];
  const spread = el("spread");
  spread.classList.toggle("is-cover",isCover);
  show(el("front-cover"),isCover);
  show(el("story-leaf"),!isCover);
  show(el("folio"),!isCover);
  const image = el("reader-image");
  if (page.image) {
    if (image.getAttribute("src") !== page.image) {
      reader.failedImage = "";
      image.src = page.image;
    }
    image.alt = isCover ? "표지 삽화" : number + "쪽 장면 삽화";
  } else { image.removeAttribute("src"); image.alt = ""; }
  const failed = page.image && reader.failedImage === page.image;
  el("art-message").textContent = failed ? "삽화를 불러오지 못했어요." : "아직 삽화가 없어요.";
  spread.classList.toggle("without-art",!page.image || failed);
  el("reader-owner").textContent = reader.source === "demo" ? "예시 책" : reader.source + "모둠";
  el("reader-title").textContent = book.title;
  el("reader-title").title = book.title;
  if (isCover) {
    const title = el("cover-title");
    if (title.textContent !== book.title) title.textContent = book.title;
    if (direction) title.scrollTop = 0;
    el("cover-author").textContent = reader.source === "demo" ? "예시 그림동화" : reader.source + "모둠 지음";
  } else {
    el("reader-stage").textContent = String(number);
    const text = el("reader-text");
    if (text.textContent !== page.text) text.textContent = page.text;
    if (direction) text.scrollTop = 0;
    el("folio").textContent = String(number);
  }
  const count = isCover ? "표지" : number + " / " + book.pages.length;
  if (el("page-count").textContent !== count) el("page-count").textContent = count;
  el("prev-page").disabled = isCover;
  el("next-page").disabled = number === book.pages.length;
  if (direction) {
    spread.classList.toggle("unfold-cover",direction === 1 && number === 1);
    spread.classList.remove("turn-next","turn-prev");
    void spread.offsetWidth;
    spread.classList.add(direction > 0 ? "turn-next" : "turn-prev");
  }
}
function openReader(source) {
  if (source !== "demo" && !pagesReady(groups.get(source))) return;
  readerTrigger = document.activeElement;
  reader = {source,pageNumber:0,failedImage:"",scroll:window.scrollY};
  el("spread").classList.remove("turn-next","turn-prev","unfold-cover");
  document.body.classList.add("reading");
  show(el("reader"),true);
  paintReader();
  el("cover-title").scrollTop = 0;
  window.scrollTo(0,0);
  el("close-reader").focus({preventScroll:true});
}
async function closeReader() {
  if (document.fullscreenElement) {
    try { await document.exitFullscreen(); } catch { /* The browser may already have left full screen. */ }
  }
  const previousY = reader?.scroll || 0;
  show(el("reader"),false);
  document.body.classList.remove("reading");
  reader = null;
  window.scrollTo(0,previousY);
  readerTrigger?.focus({preventScroll:true});
}
function turn(direction) {
  if (!reader) return;
  const count = currentBook().pages.length;
  const next = Math.min(Math.max(reader.pageNumber + direction,0),count);
  if (reader.pageNumber === next) return;
  reader.pageNumber = next;
  paintReader(direction);
  if (document.fullscreenElement) el("reader").scrollTop = 0;
  else window.scrollTo(0,0);
}
async function fullScreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await el("reader").requestFullscreen();
  } catch { el("fullscreen").textContent = "브라우저 전체 화면(F11)"; }
}
for (const [i,pageName] of pageNames.entries()) {
  const label = make("label", null, "page-field");
  const heading = make("span", pageName);
  heading.id = "page-label-" + i;
  const area = make("textarea");
  area.id = "page-" + i;
  area.rows = 2;
  area.maxLength = 900;
  label.append(heading,area);
  el("page-inputs").append(label);
}
el("editor").addEventListener("input",event => {
  if (event.target.id === "paste-input") {
    groups.get(active).paste = event.target.value;
    el("paste-info").textContent = "";
    event.target.removeAttribute("aria-invalid");
    show(el("paste-result"),false);
  } else if (event.target.matches("input,textarea")) {
    event.target.setCustomValidity("");
    changed();
  }
});
el("brand").addEventListener("click",home);
el("home-btn").addEventListener("click",home);
el("group-select").addEventListener("change",e=>openGroup(Number(e.target.value)));
el("demo-btn").addEventListener("click",()=>openReader("demo"));
el("read-btn").addEventListener("click",()=>openReader(active));
el("ideas-tab").addEventListener("click",()=>usePanel("ideas"));
el("story-tab").addEventListener("click",()=>usePanel("story"));
el("to-story").addEventListener("click",()=>{
  usePanel("story");
  el("paste-box").open = true;
  el("paste-input").focus();
});
el("write-btn").addEventListener("click",()=>void startJob("story"));
el("art-btn").addEventListener("click",()=>void startJob("art"));
el("paste-btn").addEventListener("click",applyPaste);
el("retry-save").addEventListener("click",async () => {
  const group = groups.get(active);
  if (group.conflict) {
    if (!confirm("이 창에 입력한 내용으로 저장할까요?")) return;
    try {
      const fresh = await api("/api/state");
      group.data = fresh.groups.find(g => g.id === group.data.id);
      group.conflict = false;
    } catch { return; }
  }
  await flush(group);
});
el("reload-group").addEventListener("click",async () => {
  const group = groups.get(active);
  if (!confirm("이 창의 미저장 입력을 닫고 저장된 내용을 불러올까요?")) return;
  try {
    const state = await api("/api/state");
    const data = state.groups.find(g => g.id === group.data.id);
    groups.set(data.id,createGroup(data));
    if (active === data.id) fillEditor();
  } catch { group.error = "연결할 수 없어요. 수업 시작 창을 확인해 주세요."; updateEditorState(); }
});
el("prev-page").addEventListener("click",()=>turn(-1));
el("next-page").addEventListener("click",()=>turn(1));
el("close-reader").addEventListener("click",()=>void closeReader());
el("fullscreen").addEventListener("click",()=>void fullScreen());
el("reader-image").addEventListener("error",()=>{
  if (!reader || !el("reader-image").getAttribute("src")) return;
  reader.failedImage = el("reader-image").getAttribute("src");
  el("art-message").textContent = "삽화를 불러오지 못했어요.";
  el("spread").classList.add("without-art");
});
document.addEventListener("fullscreenchange",()=>{el("fullscreen").textContent = document.fullscreenElement ? "전체 화면 해제" : "전체 화면";});
document.addEventListener("keydown",e=>{
  if (!reader || e.altKey || e.metaKey || e.ctrlKey) return;
  if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); turn(e.key === "ArrowRight" ? 1 : -1); }
  if (e.key === "Escape" && !document.fullscreenElement) { e.preventDefault(); void closeReader(); }
});
window.addEventListener("beforeunload",e=>{
  if ([...groups.values()].some(g => g.dirty || g.saving || g.pending)) { e.preventDefault(); e.returnValue = ""; }
});
void refresh();
setInterval(()=>void refresh(),2000);

