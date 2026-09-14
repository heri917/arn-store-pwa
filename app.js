(() => {
  "use strict";

  const SUPABASE_URL = "https://bflyuzgxhqdovrahycgg.supabase.co";
  const SUPABASE_KEY = "sb_publishable_GDOsyPod6iJuKWT1AWfgUQ_nvS-Z68V";
  const OFFLINE_DB = "arn-offline-v2";
  const QUEUE_STORE = "queue";

  const $ = (id) => document.getElementById(id);

  function setStatus(text) {
    const el = $("status");
    if (el) el.textContent = text;
  }

  function setMessage(text, kind = "") {
    const el = $("msg");
    if (!el) return;
    el.textContent = text;
    el.className = kind;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function localDate() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function createClient() {
    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      throw new Error("Library Supabase gagal dimuat. Periksa koneksi internet lalu refresh.");
    }
    return window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false
      }
    });
  }

  let db;
  try {
    db = createClient();
  } catch (e) {
    console.error(e);
    setStatus("Gagal");
    if ($("inventory")) $("inventory").innerHTML =
      `<div class="item"><b>Supabase tidak siap</b><br><small>${escapeHtml(e.message)}</small></div>`;
    return;
  }

  function idb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(OFFLINE_DB, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(QUEUE_STORE)) {
          req.result.createObjectStore(QUEUE_STORE, { keyPath: "id", autoIncrement: true });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("IndexedDB gagal dibuka."));
    });
  }

  async function addQueue(data) {
    const dbi = await idb();
    return new Promise((resolve, reject) => {
      const tx = dbi.transaction(QUEUE_STORE, "readwrite");
      tx.objectStore(QUEUE_STORE).add({ data, created_at: Date.now() });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error("Gagal menyimpan antrean offline."));
    });
  }

  async function getQueue() {
    const dbi = await idb();
    return new Promise((resolve, reject) => {
      const req = dbi.transaction(QUEUE_STORE, "readonly").objectStore(QUEUE_STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error || new Error("Gagal membaca antrean offline."));
    });
  }

  async function deleteQueue(id) {
    const dbi = await idb();
    return new Promise((resolve, reject) => {
      const tx = dbi.transaction(QUEUE_STORE, "readwrite");
      tx.objectStore(QUEUE_STORE).delete(id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error("Gagal menghapus antrean."));
    });
  }

  async function withTimeout(promise, ms, message) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function ensureAuth() {
    const sessionResult = await withTimeout(
      db.auth.getSession(),
      10000,
      "Pemeriksaan login terlalu lama. Coba refresh."
    );
    if (sessionResult.error) throw new Error("Gagal memeriksa login: " + sessionResult.error.message);
    if (sessionResult.data && sessionResult.data.session) return true;

    const loginResult = await withTimeout(
      db.auth.signInAnonymously(),
      10000,
      "Login otomatis terlalu lama. Pastikan Anonymous Sign-Ins aktif di Supabase."
    );
    if (loginResult.error) {
      throw new Error("Login otomatis gagal: " + loginResult.error.message);
    }
    if (!loginResult.data || !loginResult.data.session) {
      throw new Error("Login otomatis tidak menghasilkan sesi.");
    }
    return true;
  }

  async function loadInventory() {
    if (!navigator.onLine) {
      setStatus("Offline");
      if ($("inventory")) $("inventory").innerHTML =
        `<div class="empty">Offline. Transaksi baru akan disimpan di HP dan disinkronkan saat internet kembali.</div>`;
      return;
    }

    setStatus("Memuat stok…");

    try {
      await ensureAuth();

      const result = await withTimeout(
        db.from("v_inventory_stock")
          .select("item_code,item_name,stock_current,current_status")
          .order("item_code"),
        15000,
        "Memuat stok terlalu lama. Periksa koneksi atau database Supabase."
      );

      if (result.error) throw new Error(result.error.message);

      const q = ($("search")?.value || "").toLowerCase().trim();
      const rows = (result.data || []).filter((x) => {
        const code = String(x.item_code ?? "").toLowerCase();
        const name = String(x.item_name ?? "").toLowerCase();
        return !q || code.includes(q) || name.includes(q);
      });

      $("inventory").innerHTML = rows.length
        ? rows.map((x) => `
            <div class="item">
              <div class="top">
                <b>${escapeHtml(x.item_code ?? "-")}</b>
                <b class="stock">${escapeHtml(x.stock_current ?? 0)}</b>
              </div>
              <div>${escapeHtml(x.item_name ?? "-")}</div>
              <small>${escapeHtml(x.current_status || "")}</small>
            </div>
          `).join("")
        : `<div class="empty">Tidak ada barang yang cocok.</div>`;

      setStatus("Online");
    } catch (e) {
      console.error("LOAD ERROR:", e);
      setStatus("Gagal");
      $("inventory").innerHTML =
        `<div class="item"><b>Gagal memuat stok</b><br><small>${escapeHtml(e.message)}</small></div>`;
    }
  }

  async function syncQueue() {
    if (!navigator.onLine) return;

    try {
      await ensureAuth();
      const queue = await getQueue();

      for (const entry of queue) {
        try {
          const result = await withTimeout(
            db.from("stock_movements").insert(entry.data),
            15000,
            "Sinkronisasi terlalu lama."
          );
          if (!result.error) {
            await deleteQueue(entry.id);
          } else {
            console.error("SYNC ERROR:", result.error);
          }
        } catch (e) {
          console.error("SYNC ITEM ERROR:", e);
        }
      }
    } catch (e) {
      console.error("SYNC/AUTH ERROR:", e);
    }
  }

  async function saveTransaction() {
    const code = ($("code")?.value || "").trim().toUpperCase();
    const qty = Number($("qty")?.value);
    const type = $("type")?.value;
    const note = ($("note")?.value || "").trim();

    if (!code) {
      setMessage("Isi kode barang.", "error");
      return;
    }
    if (!Number.isInteger(qty) || qty < 1) {
      setMessage("Jumlah harus bilangan bulat minimal 1.", "error");
      return;
    }
    if (type !== "MASUK" && type !== "KELUAR") {
      setMessage("Jenis transaksi tidak valid.", "error");
      return;
    }

    const data = {
      movement_code: "ARN-" + Date.now(),
      movement_date: localDate(),
      item_code: code,
      movement_type: type,
      quantity: qty,
      note: note || null
    };

    const btn = $("save");
    btn.disabled = true;
    setMessage("Menyimpan…", "muted");

    try {
      if (!navigator.onLine) throw new Error("OFFLINE");

      await ensureAuth();

      const result = await withTimeout(
        db.from("stock_movements").insert(data),
        15000,
        "Penyimpanan terlalu lama. Periksa koneksi atau database."
      );

      if (result.error) throw new Error(result.error.message);

      setMessage("Tersimpan ke Supabase.", "ok");
      $("code").value = "";
      $("qty").value = "1";
      $("note").value = "";
      await loadInventory();
    } catch (e) {
      if (e.message === "OFFLINE") {
        try {
          await addQueue(data);
          setMessage("Offline: transaksi disimpan di HP dan akan disinkronkan saat internet kembali.", "warn");
        } catch (queueError) {
          console.error(queueError);
          setMessage("Gagal menyimpan transaksi offline: " + queueError.message, "error");
        }
      } else {
        console.error("SAVE ERROR:", e);
        setMessage("Gagal menyimpan: " + e.message, "error");
      }
    } finally {
      btn.disabled = false;
    }
  }

  $("save")?.addEventListener("click", saveTransaction);
  $("refresh")?.addEventListener("click", loadInventory);
  $("search")?.addEventListener("input", loadInventory);

  window.addEventListener("online", async () => {
    setStatus("Koneksi kembali…");
    await syncQueue();
    await loadInventory();
  });

  window.addEventListener("offline", () => {
    setStatus("Offline");
    setMessage("Internet terputus. Transaksi baru tetap bisa disimpan di HP.", "warn");
  });

  (async () => {
    setStatus(navigator.onLine ? "Menghubungkan…" : "Offline");

    if (!navigator.onLine) {
      $("inventory").innerHTML =
        `<div class="empty">Offline. Hubungkan internet untuk memuat stok.</div>`;
    } else {
      await syncQueue();
      await loadInventory();
    }

    if ("serviceWorker" in navigator) {
      try {
        await navigator.serviceWorker.register("./sw.js", { scope: "./" });
      } catch (e) {
        console.error("Service worker gagal:", e);
      }
    }
  })();
})();
