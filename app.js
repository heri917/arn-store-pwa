const URL="https://bflyuzgxhqdovrahycgg.supabase.co";
const KEY="sb_publishable_GDOsyPod6iJuKWT1AWfgUQ_nvS-Z68V";
const db=supabase.createClient(URL,KEY);
const $=id=>document.getElementById(id);

const DB="arn-offline",STORE="queue";

function setStatus(text, kind="online"){
  const el=$("status");
  if(!el)return;
  el.innerHTML=`<span class="status-dot"></span><span>${text}</span>`;
  const dot=el.querySelector(".status-dot");
  if(dot){
    dot.style.background=kind==="error"?"#d34b42":kind==="offline"?"#aaa":"#d8a12a";
  }
}
function hideLoader(){
  const el=$("loader");
  if(el) el.classList.add("hide");
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
async function auth(){
  let s=await db.auth.getSession();
  if(s.error) throw new Error("Gagal memeriksa sesi: "+s.error.message);
  if(s.data.session) return true;
  let r=await db.auth.signInAnonymously();
  if(r.error) throw new Error("Login anonim gagal: "+r.error.message);
  return !!r.data?.session;
}
async function load(){
  let q=($("search")?.value||"").toLowerCase().trim();
  if(!navigator.onLine){
    setStatus("Offline","offline");
    if($("inventory")) $("inventory").innerHTML='<div class="loading-row">Offline. Hubungkan internet untuk memuat stok.</div>';
    return;
  }
  setStatus("Memuat...");
  try{
    let r=await db.from("v_inventory_stock")
      .select("item_code,item_name,stock_current,current_status")
      .order("item_code");
    if(r.error) throw new Error(r.error.message);
    let a=(r.data||[]).filter(x=>{
      let code=String(x.item_code??"").toLowerCase();
      let name=String(x.item_name??"").toLowerCase();
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
    setStatus("Error","error");
    $("inventory").innerHTML=`<div class="item"><b>Gagal memuat stok</b><br><small>${escapeHtml(e.message)}</small></div>`;
    throw e;
  }
}
function escapeHtml(v){
  return String(v).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
}
async function sync(){
  if(!navigator.onLine) return;
  try{
    await auth();
    for(const x of await allQ()){
      let r=await db.from("stock_movements").insert(x.data);
      if(!r.error) await delQ(x.id);
      else console.error("SYNC ERROR:",r.error);
    }
  }catch(e){ console.error("SYNC/AUTH ERROR:",e); }
}
$("save").onclick=async()=>{
  let code=($("code")?.value||"").trim().toUpperCase();
  let qty=Number($("qty")?.value);
  if(!code||qty<1){
    $("msg").textContent="Isi kode dan jumlah.";
    return;
  }
  let data={
    movement_code:"ARN-"+Date.now(),
    movement_date:new Date().toISOString().slice(0,10),
    item_code:code,
    movement_type:$("type").value,
    quantity:qty,
    note:$("note").value||null
  };
  try{
    if(!navigator.onLine) throw new Error("OFFLINE");
    await auth();
    let r=await db.from("stock_movements").insert(data);
    if(r.error) throw r.error;
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
      $("msg").textContent="Gagal menyimpan: "+e.message;
    }
  }
};
$("search").oninput=()=>load().catch(()=>{});
window.addEventListener("online",async()=>{
  setStatus("Sinkronisasi...");
  await sync();
  try{await load();}catch{}
});
window.addEventListener("offline",()=>{
  setStatus("Offline","offline");
});
(async()=>{
  try{
    if(navigator.onLine){
      await auth();
      await sync();
      await load();
    }else{
      setStatus("Offline","offline");
      $("inventory").innerHTML='<div class="loading-row">Offline. Hubungkan internet untuk memuat stok.</div>';
    }
  }catch(e){
    console.error("START ERROR:",e);
    setStatus("Gagal","error");
    $("inventory").innerHTML=`<div class="item"><b>Koneksi Supabase gagal</b><br><small>${escapeHtml(e.message)}</small></div>`;
  }finally{
    setTimeout(hideLoader,180);
  }
  if("serviceWorker" in navigator){
    try{await navigator.serviceWorker.register("sw.js");}
    catch(e){console.error("Service worker:",e);}
  }
})();
