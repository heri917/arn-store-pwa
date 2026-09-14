const SUPABASE_URL="https://bflyuzgxhqdovrahycgg.supabase.co";
const SUPABASE_KEY="sb_publishable_GDOsyPod6iJuKWT1AWfgUQ_nvS-Z68V";
const SESSION_KEY="arn_supabase_session_v1";
const REQUEST_TIMEOUT=30000;
const $=id=>document.getElementById(id);
const DB="arn-offline",STORE="queue";

function withTimeout(task,ms=REQUEST_TIMEOUT){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),ms);
  return Promise.resolve().then(()=>typeof task==="function"?task(controller.signal):task)
    .finally(()=>clearTimeout(timer))
    .catch(e=>{
      if(e?.name==="AbortError") throw new Error("TIMEOUT_SUPABASE");
      throw e;
    });
}

function setStatus(text,kind="online"){
  const el=$("status");
  if(!el)return;
  el.innerHTML=`<span class="status-dot"></span><span>${text}</span>`;
  const dot=el.querySelector(".status-dot");
  if(dot) dot.style.background=kind==="error"?"#d34b42":kind==="offline"?"#aaa":"#d8a12a";
}
function hideLoader(){
  const el=$("loader");
  if(el) el.classList.add("hide");
}
function escapeHtml(v){
  return String(v).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
}

function readSession(){
  try{
    const raw=localStorage.getItem(SESSION_KEY);
    return raw?JSON.parse(raw):null;
  }catch{return null;}
}
function saveSession(session){
  try{localStorage.setItem(SESSION_KEY,JSON.stringify(session));}catch{}
}
function clearSession(){
  try{localStorage.removeItem(SESSION_KEY);}catch{}
}
function sessionUsable(session){
  if(!session?.access_token)return false;
  const expiresAt=Number(session.expires_at||0)*1000;
  return !expiresAt || expiresAt>Date.now()+60000;
}

async function authRequest(path,options={}){
  return withTimeout(signal=>fetch(SUPABASE_URL+path,{
    ...options,
    signal,
    headers:{
      apikey:SUPABASE_KEY,
      "Content-Type":"application/json",
      ...(options.headers||{})
    }
  }));
}
async function readJson(response){
  let body=null;
  try{body=await response.json();}catch{}
  if(!response.ok){
    const msg=body?.msg||body?.message||body?.error_description||body?.error||`HTTP ${response.status}`;
    throw new Error(msg);
  }
  return body;
}

async function signInAnonymously(){
  const response=await authRequest("/auth/v1/signup",{
    method:"POST",
    body:JSON.stringify({data:{}})
  });
  const data=await readJson(response);
  if(!data?.access_token) throw new Error("Login anonim tidak menghasilkan sesi.");
  saveSession(data);
  return data;
}

async function refreshSession(session){
  if(!session?.refresh_token) return null;
  try{
    const response=await authRequest("/auth/v1/token?grant_type=refresh_token",{
      method:"POST",
      body:JSON.stringify({refresh_token:session.refresh_token})
    });
    const data=await readJson(response);
    if(!data?.access_token) return null;
    saveSession(data);
    return data;
  }catch(e){
    console.warn("SESSION REFRESH ERROR:",e);
    return null;
  }
}

async function auth(){
  let session=readSession();
  if(sessionUsable(session)) return true;
  if(session?.refresh_token){
    session=await refreshSession(session);
    if(sessionUsable(session)) return true;
  }
  clearSession();
  await signInAnonymously();
  return true;
}

async function dataRequest(path,options={}){
  await auth();
  let session=readSession();
  const run=async current=>{
    return withTimeout(signal=>fetch(SUPABASE_URL+path,{
      ...options,
      signal,
      headers:{
        apikey:SUPABASE_KEY,
        Authorization:`Bearer ${current.access_token}`,
        "Content-Type":"application/json",
        ...(options.headers||{})
      }
    }));
  };
  let response=await run(session);
  if(response.status===401){
    const refreshed=await refreshSession(session);
    if(!refreshed) throw new Error("Sesi login kedaluwarsa. Silakan muat ulang aplikasi.");
    response=await run(refreshed);
  }
  return response;
}

function idb(){
  return new Promise((ok,no)=>{
    let r=indexedDB.open(DB,1);
    r.onupgradeneeded=()=>r.result.createObjectStore(STORE,{keyPath:"id",autoIncrement:true});
    r.onsuccess=()=>ok(r.result);
    r.onerror=()=>no(r.error);
  });
}
async function addQ(x){
  let d=await idb();
  return new Promise((ok,no)=>{
    let t=d.transaction(STORE,"readwrite");
    t.objectStore(STORE).add({data:x});
    t.oncomplete=ok;
    t.onerror=()=>no(t.error);
  });
}
async function allQ(){
  let d=await idb();
  return new Promise((ok,no)=>{
    let r=d.transaction(STORE).objectStore(STORE).getAll();
    r.onsuccess=()=>ok(r.result||[]);
    r.onerror=()=>no(r.error);
  });
}
async function delQ(id){
  let d=await idb();
  return new Promise((ok,no)=>{
    let t=d.transaction(STORE,"readwrite");
    t.objectStore(STORE).delete(id);
    t.oncomplete=ok;
    t.onerror=()=>no(t.error);
  });
}

async function load(){
  const q=($('search')?.value||'').toLowerCase().trim();
  if(!navigator.onLine){
    setStatus("Offline","offline");
    if($("inventory")) $("inventory").innerHTML='<div class="loading-row">Offline. Hubungkan internet untuk memuat stok.</div>';
    return;
  }
  setStatus("Memuat...");
  try{
    const response=await dataRequest(
      "/rest/v1/v_inventory_stock?select=item_code,item_name,stock_current,current_status&order=item_code",
      {method:"GET",headers:{Accept:"application/json"}}
    );
    const data=await readJson(response);
    const a=(data||[]).filter(x=>{
      const code=String(x.item_code??"").toLowerCase();
      const name=String(x.item_name??"").toLowerCase();
      return !q||code.includes(q)||name.includes(q);
    });
    $("inventory").innerHTML=a.map(x=>`
      <div class="item">
        <div class="top"><b>${escapeHtml(x.item_code??"-")}</b><b>${escapeHtml(x.stock_current??0)}</b></div>
        <div>${escapeHtml(x.item_name??"-")}</div>
        <small>${escapeHtml(x.current_status||"")}</small>
      </div>
    `).join("")||"Tidak ada barang.";
    setStatus("Online");
  }catch(e){
    console.error(e);
    if(e?.message==="TIMEOUT_SUPABASE"){
      setStatus("Koneksi lambat","error");
      $("inventory").innerHTML='<div class="item"><b>Koneksi ke server lambat</b><br><small>Stok belum selesai dimuat. Tekan Refresh saat koneksi lebih stabil.</small></div>';
      return;
    }
    setStatus("Error","error");
    $("inventory").innerHTML=`<div class="item"><b>Gagal memuat stok</b><br><small>${escapeHtml(e.message)}</small></div>`;
    throw e;
  }
}

async function insertMovement(data){
  const response=await dataRequest("/rest/v1/stock_movements",{
    method:"POST",
    headers:{Prefer:"return=minimal"},
    body:JSON.stringify(data)
  });
  await readJson(response);
}

async function sync(){
  if(!navigator.onLine) return;
  try{
    await withTimeout(()=>auth(),REQUEST_TIMEOUT);
    for(const x of await allQ()){
      try{
        await insertMovement(x.data);
        await delQ(x.id);
      }catch(e){
        console.error("SYNC ERROR:",e);
        break;
      }
    }
  }catch(e){
    console.error("SYNC/AUTH ERROR:",e);
  }
}

$("save").onclick=async()=>{
  const code=($("code")?.value||"").trim().toUpperCase();
  const qty=Number($("qty")?.value);
  if(!code||qty<1){
    $("msg").textContent="Isi kode dan jumlah.";
    return;
  }
  const data={
    movement_code:"ARN-"+Date.now(),
    movement_date:new Date().toISOString().slice(0,10),
    item_code:code,
    movement_type:$("type").value,
    quantity:qty,
    note:$("note").value||null
  };
  try{
    if(!navigator.onLine) throw new Error("OFFLINE");
    await withTimeout(()=>insertMovement(data),REQUEST_TIMEOUT);
    $("msg").textContent="Tersimpan ke Supabase.";
    $("code").value="";
    $("qty").value="1";
    $("note").value="";
    await load();
  }catch(e){
    if(e.message==="OFFLINE"){
      await addQ(data);
      $("msg").textContent="Offline: transaksi disimpan di HP dan akan disinkronkan saat online.";
      setStatus("Offline","offline");
    }else{
      console.error(e);
      $("msg").textContent=e.message==="TIMEOUT_SUPABASE"?"Koneksi ke server lambat. Transaksi belum dikirim.":"Gagal menyimpan: "+e.message;
    }
  }
};

$("search").oninput=()=>load().catch(()=>{});
window.addEventListener("online",async()=>{
  setStatus("Sinkronisasi...");
  await sync();
  try{await load();}catch{}
});
window.addEventListener("offline",()=>setStatus("Offline","offline"));

(async()=>{
  try{
    if(navigator.onLine){
      await withTimeout(()=>auth(),REQUEST_TIMEOUT);
      await withTimeout(()=>sync(),REQUEST_TIMEOUT);
      await withTimeout(()=>load(),REQUEST_TIMEOUT);
    }else{
      setStatus("Offline","offline");
      $("inventory").innerHTML='<div class="loading-row">Offline. Hubungkan internet untuk memuat stok.</div>';
    }
  }catch(e){
    console.error("START ERROR:",e);
    setStatus(e?.message==="TIMEOUT_SUPABASE"?"Koneksi lambat":"Gagal","error");
    $("inventory").innerHTML=e?.message==="TIMEOUT_SUPABASE"
      ?'<div class="item"><b>Koneksi ke server lambat</b><br><small>Stok belum selesai dimuat. Tekan Refresh saat koneksi lebih stabil.</small></div>'
      :`<div class="item"><b>Koneksi Supabase gagal</b><br><small>${escapeHtml(e.message)}</small></div>`;
  }finally{
    hideLoader();
  }
  if("serviceWorker" in navigator){
    try{await navigator.serviceWorker.register("sw.js");}
    catch(e){console.error("Service worker:",e);}
  }
})();
