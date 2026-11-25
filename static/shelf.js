"use strict";
const onlineShelf = (() => {
  const empty = id => ({id, revision:0, words:[], idea:"", title:"", pages:[], job:null});
  let database, catalog, connected = false;
  function openShelf() {
    if (!database) database = new Promise((resolve,reject) => {
      const req = indexedDB.open("macheon-storybook-v1",1);
      req.onupgradeneeded = () => req.result.createObjectStore("groups",{keyPath:"id"});
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { database = null; reject(req.error); };
    });
    return database;
  }
  async function getGroups() {
    const db = await openShelf();
    return new Promise((resolve,reject) => {
      const req = db.transaction("groups").objectStore("groups").getAll();
      req.onsuccess = () => resolve([1,2,3].map(id => req.result.find(g => g.id === id) || empty(id)));
      req.onerror = () => reject(req.error);
    });
  }
  async function save(id, revision, edit) {
    const db = await openShelf();
    return new Promise((resolve,reject) => {
      const tx = db.transaction("groups","readwrite");
      const store = tx.objectStore("groups");
      const req = store.get(id);
      let result, conflict;
      req.onsuccess = () => {
        result = req.result || empty(id);
        if (result.revision !== revision) {
          conflict = Object.assign(new Error("다른 창에서 원고가 바뀌었어요."),{status:409});
          tx.abort();
          return;
        }
        edit(result);
        result.revision++;
        store.put(result);
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(conflict || tx.error || new Error("브라우저 저장 공간을 확인해 주세요."));
    });
  }
  function pages(texts, old) {
    return texts.map((s,i) => {
      const text = s.trim();
      return {text, image:old[i]?.text === text ? old[i].image : ""};
    });
  }
  async function writeBook(id,payload) {
    const prompt = "어르신 모둠이 고른 다섯 단어를 모두 담아 자유로운 한국어 그림동화를 창작해 주세요. 모둠이 준 아이디어와 대사를 살리고, 기·승·전·결 네 장면으로 구성하세요. 한 쪽에 짧고 낭독하기 쉬운 두 문장씩 쓰세요. JSON 객체 하나만 반환하세요. title은 80자 이하 제목, pages는 한국어 문자열 네 개의 배열입니다. 이야기 재료 " + JSON.stringify({words:payload.words,idea:payload.idea});
    const reply = await puter.ai.chat(prompt,{model:"gemini-3.1-flash-lite",reasoning_effort:"minimal",max_tokens:1200});
    const content = reply.message?.content;
    const raw = Array.isArray(content) ? content.map(p=>p.text || "").join("") : String(content || reply);
    let book;
    try { book = JSON.parse(raw.replace(/^\s*```(?:json)?\s*|\s*```\s*$/gi,"")); } catch {}
    if (!book || typeof book.title !== "string" || !book.title.trim() || book.title.length>80 ||
        !Array.isArray(book.pages) || book.pages.length!==4 || !book.pages.every(p=>typeof p==="string" && p.trim() && p.length<=900))
      throw new Error("네 쪽 원고를 받지 못했어요. 다시 시도해 주세요.");
    return save(id,payload.revision,g=>{
      g.title=book.title.trim(); g.pages=pages(book.pages,[]); delete g.characterSheet;
    });
  }
  async function renderImage(prompt,reference) {
    const options = {model:"gemini-3.1-flash-image",quality:"1K",ratio:{w:4,h:3}};
    if (reference) options.input_images = [reference];
    let img = await puter.ai.txt2img(prompt,options);
    if (/^https?:/.test(img.src) && new URL(img.src).origin !== location.origin) {
      const source = img.src;
      img = new Image();
      img.crossOrigin = "anonymous";
      img.src = source;
    }
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width=1440; canvas.height=1080;
    const scale=Math.max(canvas.width/img.naturalWidth,canvas.height/img.naturalHeight);
    const width=img.naturalWidth*scale, height=img.naturalHeight*scale;
    canvas.getContext("2d").drawImage(img,(1440-width)/2,(1080-height)/2,width,height);
    return canvas.toDataURL("image/jpeg",0.87);
  }
  async function illustrate(id,payload,onProgress) {
    let group = (await getGroups()).find(g=>g.id===id);
    if (group.revision !== payload.revision) throw new Error("원고가 바뀌었어요. 다시 열어 주세요.");
    const missing = group.pages.map((p,i)=>p.image ? null : i).filter(i=>i!==null);
    if (!missing.length) return group;
    const texts = group.pages.map(p=>p.text);
    let sheet = group.characterSheet;
    if (!sheet?.image || sheet.story !== JSON.stringify(texts)) {
      const previousPage = group.pages.find(p=>p.image);
      const reference = previousPage && (sheet?.image || previousPage.image);
      const prompt = "Create a watercolor character model sheet for this Korean picture book. Read all four pages, identify each actual character (including animals or personified objects). Show each distinct character separately in a neutral full-body pose, with clear faces, silhouettes, relative sizes, markings, clothing and signature colors. Keep key details inside the middle 80% on a plain background. No labels or lettering. For a story without characters show the recurring visual subjects. Retain established character designs from the attached reference if provided, incorporating explicit changes in the manuscript. Story material: " + JSON.stringify({title:group.title,pages:texts});
      sheet = {story:JSON.stringify(texts),image:await renderImage(prompt,reference)};
      group = await save(id,group.revision,g=>{g.characterSheet=sheet;});
      onProgress?.(group);
    }
    let writes = Promise.resolve();
    let failure;
    async function worker() {
      while (missing.length && !failure) {
        const i = missing.shift();
        try {
          const prompt = "Paint one full-bleed 4:3 landscape watercolor illustration for a Korean storybook. Use the attached character model sheet as the visual identity reference: match faces, proportions, markings and outfits, except for explicit story changes. Show only characters present in this scene, in new natural poses and a real setting. No lineup, borders or lettering. Keep essential details near center. Story: " + JSON.stringify(texts) + ". Illustrate only scene " + (i+1) + ": " + texts[i];
          const url = await renderImage(prompt,sheet.image);
          // Commit in completion order so both workers use the latest saved revision.
          writes = writes.then(async () => {
            group = await save(id,group.revision,g=>{g.pages[i].image=url;});
            onProgress?.(group);
          });
          await writes;
        } catch (error) { failure = error || new Error("삽화를 완성하지 못했어요."); }
      }
    }
    await Promise.all([worker(),worker()]);
    if (failure) throw failure;
    return group;
  }
  const button = document.getElementById("connect-ai"), info = document.getElementById("ai-info");
  button.addEventListener("click",async () => {
    button.disabled = true;
    try {
      if (!window.puter) {
        await new Promise((resolve,reject) => {
          const script=document.createElement("script");
          script.src="https://js.puter.com/v2/";
          script.onload=resolve;
          script.onerror=()=>{script.remove();reject(new Error("AI 서비스에 연결할 수 없어요."));};
          document.head.append(script);
        });
        if (!puter.auth.isSignedIn()) {
          button.textContent="Puter 로그인";
          info.textContent="로그인 버튼을 눌러 AI 사용을 승인해 주세요.";
          return;
        }
      }
      if (!puter.auth.isSignedIn()) await puter.auth.signIn();
      connected=puter.auth.isSignedIn();
      if (!connected) throw new Error("로그인을 완료해 주세요.");
      button.hidden=true;
      info.textContent="AI 연결됨 · 생성할 때 이 계정의 이용 한도가 적용돼요.";
      await refresh();
    } catch (e) { info.textContent=e.message || "AI 연결을 다시 시도해 주세요."; }
    finally { button.disabled=false; }
  });
  async function request(path,payload,onProgress) {
    if (path==="/api/state") {
      if (!catalog) {
        const response=await fetch("./static/catalog.json");
        if (!response.ok) throw new Error("예시 책을 열 수 없어요.");
        catalog=await response.json();
      }
      return {...catalog,groups:await getGroups(),aiAvailable:connected};
    }
    const [,idText,action]=path.match(/^\/api\/groups\/([1-3])\/(draft|story|art)$/);
    const id=Number(idText);
    if (action==="draft") return save(id,payload.revision,g=>{
      g.words=payload.words; g.idea=payload.idea; g.title=payload.title; g.pages=pages(payload.pages,g.pages);
    });
    if (!connected) throw new Error("AI를 먼저 연결해 주세요.");
    try {
      return action==="story" ? await writeBook(id,payload) : await illustrate(id,payload,onProgress);
    } catch (e) {
      throw new Error(e?.message || e?.error?.message || "AI 계정의 이용 한도와 인터넷 연결을 확인해 주세요.");
    }
  }
  return {request};
})();
