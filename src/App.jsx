import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Package, Search, ArrowLeftRight, History, Settings, Plus, Minus, X,
  AlertTriangle, Check, User, Download, Boxes, Shield, LogOut, Loader2,
} from "lucide-react";
import { api } from "./api";
import { supabase } from "./supabaseClient";

/* ====== テーマ ====== */
const C = {
  bg: "#EEF0F3", chrome: "#14181F", chrome2: "#1E242E", card: "#FFFFFF",
  ink: "#161A20", sub: "#6B7280", line: "#E3E6EB", accent: "#D72638", accentDk: "#A81B29",
  ok: "#15803D", okBg: "#E7F4EC", warn: "#B45309", warnBg: "#FBEFDC", zero: "#B91C1C", zeroBg: "#FBE7E7",
};
const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const fmtDate = (s) => (s ? String(s).replaceAll("-", "/").slice(5) : "—");
const toCSV = (items) => {
  const head = ["item_code", "name", "category", "total_qty", "stock", "location", "unit"];
  const esc = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [head.join(","), ...items.map((i) => head.map((h) => esc(i[h])).join(","))].join("\n");
};

export default function App() {
  const [session, setSession] = useState(null);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    api.session().then((s) => { setSession(s); setBooting(false); });
    const { data } = api.onAuth((s) => setSession(s));
    return () => data?.subscription?.unsubscribe?.();
  }, []);

  if (booting) return <Splash />;
  if (!session) return <Login />;
  return <Home key={session.user.id} />;
}

function Splash() {
  return <div style={{ ...sx.app, alignItems: "center", justifyContent: "center", color: C.sub }}>
    <Loader2 className="spin" size={26} /></div>;
}

/* ====== ログイン ====== */
function Login() {
  const [mode, setMode] = useState("in");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit() {
    setErr(""); setBusy(true);
    try {
      if (mode === "in") await api.signIn(email, pw);
      else { await api.signUp(email, pw, name); setDone(true); }
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <div style={{ ...sx.app, justifyContent: "center", padding: "0 22px" }}>
      <style>{css}</style>
      <div style={{ textAlign: "center", marginBottom: 26 }}>
        <Boxes size={40} color={C.accent} />
        <div style={{ fontWeight: 800, fontSize: 22, marginTop: 10 }}>倉庫 貸出・返却</div>
        <div style={{ fontSize: 12, color: C.sub, marginTop: 4, letterSpacing: ".08em" }}>WAREHOUSE TERMINAL</div>
      </div>
      {done ? (
        <div style={{ ...sx.card, display: "block", textAlign: "center", lineHeight: 1.7 }}>
          確認メールを送信しました。メール内のリンクで認証してからログインしてください。
          <button style={{ ...sx.outline, marginTop: 14, width: "100%", justifyContent: "center" }} onClick={() => { setMode("in"); setDone(false); }}>ログインへ</button>
        </div>
      ) : (
        <div style={{ ...sx.card, display: "block" }}>
          {mode === "up" && (<><label style={sx.label}>氏名</label>
            <input style={sx.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="山田 太郎" /></>)}
          <label style={sx.label}>メールアドレス</label>
          <input style={sx.input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@denso.co.jp" />
          <label style={sx.label}>パスワード</label>
          <input style={sx.input} type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="6文字以上" />
          {err && <div style={{ color: C.accent, fontSize: 12.5, marginTop: 10 }}>{err}</div>}
          <button style={{ ...sx.primary, width: "100%", justifyContent: "center", display: "flex", alignItems: "center", gap: 7, marginTop: 16, padding: 13 }}
            onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="spin" size={16} /> : null}{mode === "in" ? "ログイン" : "アカウント作成"}
          </button>
          <div style={{ textAlign: "center", marginTop: 14, fontSize: 13, color: C.sub }}>
            {mode === "in" ? "アカウントが無い方は" : "アカウントをお持ちの方は"}{" "}
            <span style={{ color: C.accent, fontWeight: 700, cursor: "pointer" }} onClick={() => { setErr(""); setMode(mode === "in" ? "up" : "in"); }}>
              {mode === "in" ? "新規作成" : "ログイン"}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ====== メイン ====== */
function Home() {
  const [me, setMe] = useState(null);
  const [items, setItems] = useState([]);
  const [loans, setLoans] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("inv");
  const [q, setQ] = useState(""); const [cat, setCat] = useState("すべて");
  const [sheet, setSheet] = useState(null);
  const [toast, setToast] = useState(null);
  const [allView, setAllView] = useState(false);

  const flash = useCallback((m, kind = "ok") => { setToast({ m, kind }); setTimeout(() => setToast(null), 2200); }, []);

  const reload = useCallback(async () => {
    try {
      const [pf, it, ln] = await Promise.all([api.myProfile(), api.items(), api.loans()]);
      setMe(pf); setItems(it); setLoans(ln);
      if (pf?.role === "admin") setProfiles(await api.profiles());
    } catch (e) { flash(e.message, "err"); } finally { setLoading(false); }
  }, [flash]);

  useEffect(() => { reload(); const off = api.subscribe(() => reload()); return off; }, [reload]);

  const isAdmin = me?.role === "admin";
  const td = today();
  const nameOf = (id) => profiles.find((p) => p.id === id)?.name || (id === me?.id ? me?.name : "他のユーザー");

  const categories = useMemo(() => ["すべて", ...Array.from(new Set(items.map((i) => i.category).filter(Boolean)))], [items]);
  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return items.filter((i) => (cat === "すべて" || i.category === cat) &&
      (!kw || `${i.name}${i.item_code}${i.location}`.toLowerCase().includes(kw)));
  }, [items, q, cat]);

  const visibleLoans = useMemo(() =>
    isAdmin && allView ? loans : loans.filter((l) => l.user_id === me?.id), [loans, isAdmin, allView, me]);
  const activeLoans = useMemo(() => visibleLoans.filter((l) => !l.is_closed)
    .sort((a, b) => (b.is_overdue - a.is_overdue) || String(a.due_date).localeCompare(String(b.due_date))), [visibleLoans]);
  const overdueCount = useMemo(() => loans.filter((l) => l.is_overdue).length, [loans]);

  async function doLend({ itemId, qty, dueDate, note }) {
    try { await api.lend(itemId, qty, dueDate, note); setSheet(null); flash("貸出を登録しました"); reload(); }
    catch (e) { flash(e.message, "err"); }
  }
  async function doReturn({ loanId, qty }) {
    try { await api.ret(loanId, qty); setSheet(null); flash("返却を登録しました"); reload(); }
    catch (e) { flash(e.message, "err"); }
  }
  async function saveItem(form) {
    try {
      await api.upsertItem(form);
      if (form.id) await api.setItemTotal(form.id, form.total_qty);
      setSheet(null); flash("物品を保存しました"); reload();
    } catch (e) { flash(e.message, "err"); }
  }
  async function deleteItem(id) {
    try { await api.deleteItem(id); setSheet(null); flash("物品を削除しました"); reload(); }
    catch (e) { flash("削除できません（貸出中の可能性）", "err"); }
  }
  function exportCSV() {
    const blob = new Blob(["\uFEFF" + toCSV(items)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = `warehouse_items_${td}.csv`; a.click(); URL.revokeObjectURL(url);
  }

  if (loading) return <Splash />;

  return (
    <div style={sx.app}>
      <style>{css}</style>
      <header style={sx.top}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Boxes size={20} color={C.accent} />
          <div><div style={{ fontWeight: 800, fontSize: 15 }}>倉庫 貸出・返却</div>
            <div style={{ fontSize: 10.5, color: "#9AA3B0", marginTop: 1 }}>WAREHOUSE TERMINAL</div></div>
        </div>
        <button style={sx.meBtn} onClick={() => setSheet({ type: "me" })}>
          {isAdmin ? <Shield size={13} color="#FFD7DC" /> : <User size={13} color="#C7CDD6" />}
          <span style={{ maxWidth: 92, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{me?.name || "ユーザー"}</span>
        </button>
      </header>

      <main style={sx.main}>
        {tab === "inv" && <Inventory {...{ filtered, categories, cat, setCat, q, setQ, setSheet }} />}
        {tab === "loans" && <ActiveLoans {...{ activeLoans, items, nameOf, isAdmin, allView, setAllView, setSheet }} />}
        {tab === "hist" && <HistoryView {...{ visibleLoans, items, nameOf, isAdmin, allView, setAllView }} />}
        {tab === "admin" && isAdmin && <Admin {...{ items, setSheet, exportCSV }} />}
        {tab === "admin" && !isAdmin && <Empty icon={<Shield size={30} />} title="管理者専用" body="この画面は管理者のみ利用できます。" />}
      </main>

      <nav style={sx.nav}>
        <NavBtn active={tab === "inv"} onClick={() => setTab("inv")} icon={<Package size={20} />} label="在庫" />
        <NavBtn active={tab === "loans"} onClick={() => setTab("loans")} icon={<ArrowLeftRight size={20} />} label="貸出中" badge={isAdmin ? overdueCount : null} />
        <NavBtn active={tab === "hist"} onClick={() => setTab("hist")} icon={<History size={20} />} label="履歴" />
        <NavBtn active={tab === "admin"} onClick={() => setTab("admin")} icon={<Settings size={20} />} label="管理" />
      </nav>

      {sheet?.type === "lend" && <LendSheet item={sheet.item} onClose={() => setSheet(null)} onSubmit={doLend} />}
      {sheet?.type === "return" && <ReturnSheet loan={sheet.loan} item={items.find((i) => i.id === sheet.loan.item_id)} onClose={() => setSheet(null)} onSubmit={doReturn} />}
      {sheet?.type === "item" && <ItemSheet item={sheet.item} onClose={() => setSheet(null)} onSave={saveItem} onDelete={deleteItem} />}
      {sheet?.type === "me" && <MeSheet me={me} onClose={() => setSheet(null)} onSignOut={() => api.signOut()} />}

      {toast && <div style={{ ...sx.toast, background: toast.kind === "err" ? C.accent : "#14181F" }}>
        {toast.kind === "err" ? <AlertTriangle size={15} /> : <Check size={15} />} {toast.m}</div>}
    </div>
  );
}

/* ====== 画面 ====== */
function Inventory({ filtered, categories, cat, setCat, q, setQ, setSheet }) {
  return (<>
    <div style={sx.searchWrap}>
      <Search size={17} color={C.sub} />
      <input style={sx.search} placeholder="品名・品番・場所で検索" value={q} onChange={(e) => setQ(e.target.value)} />
      {q && <X size={16} color={C.sub} onClick={() => setQ("")} style={{ cursor: "pointer" }} />}
    </div>
    <div className="chips" style={sx.chips}>
      {categories.map((c) => <button key={c} onClick={() => setCat(c)} style={{ ...sx.chip, ...(cat === c ? sx.chipOn : {}) }}>{c}</button>)}
    </div>
    {filtered.length === 0 && <Empty icon={<Package size={30} />} title="該当なし" body="条件を変えて検索してください。" />}
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {filtered.map((i) => {
        const zero = i.stock <= 0;
        return (<div key={i.id} style={sx.card}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span style={sx.code}>{i.item_code}</span>{i.category && <span style={sx.tag}>{i.category}</span>}
            </div>
            <div style={{ fontWeight: 700, fontSize: 15.5, margin: "5px 0 2px" }}>{i.name}</div>
            <div style={{ fontSize: 12, color: C.sub }}>保管: {i.location || "—"}・全{i.total_qty}{i.unit}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
            <div style={{ ...sx.pill, ...(zero ? sx.pillZero : sx.pillOk) }}>
              <span style={{ fontSize: 18 }}>{i.stock}</span><span style={{ fontSize: 10.5, opacity: .8 }}>{i.unit}</span></div>
            <button disabled={zero} onClick={() => setSheet({ type: "lend", item: i })}
              style={{ ...sx.primary, ...(zero ? sx.disabled : {}), padding: "8px 14px", fontSize: 13 }}>{zero ? "在庫なし" : "貸出"}</button>
          </div>
        </div>);
      })}
    </div>
  </>);
}
function ScopeToggle({ isAdmin, allView, setAllView }) {
  if (!isAdmin) return null;
  return (<div style={sx.toggle}>
    <button onClick={() => setAllView(false)} style={{ ...sx.toggleBtn, ...(!allView ? sx.toggleOn : {}) }}>自分</button>
    <button onClick={() => setAllView(true)} style={{ ...sx.toggleBtn, ...(allView ? sx.toggleOn : {}) }}>全員</button>
  </div>);
}
function ActiveLoans({ activeLoans, items, nameOf, isAdmin, allView, setAllView, setSheet }) {
  return (<>
    <div style={sx.rowHead}>
      <h2 style={sx.h2}>貸出中 {activeLoans.length > 0 && <span style={{ color: C.sub, fontWeight: 600 }}>({activeLoans.length})</span>}</h2>
      <ScopeToggle {...{ isAdmin, allView, setAllView }} /></div>
    {activeLoans.length === 0 && <Empty icon={<Check size={30} />} title="貸出中なし" body="返却待ちの物品はありません。" />}
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {activeLoans.map((l) => {
        const item = items.find((i) => i.id === l.item_id); const rem = l.qty - l.returned_qty;
        return (<div key={l.id} style={{ ...sx.card, borderLeft: `4px solid ${l.is_overdue ? C.accent : C.line}` }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
              <span style={{ fontWeight: 700, fontSize: 15 }}>{item?.name || "—"}</span>
              {l.is_overdue && <span style={sx.badgeOver}><AlertTriangle size={11} /> 延滞</span>}</div>
            <div style={{ fontSize: 12, color: C.sub, marginTop: 4 }}>借用: {nameOf(l.user_id)}・未返却 <b style={{ color: C.ink }}>{rem}</b>/{l.qty}{item?.unit}</div>
            <div style={{ fontSize: 12, color: l.is_overdue ? C.accent : C.sub, marginTop: 2, fontWeight: l.is_overdue ? 700 : 400 }}>返却期限: {fmtDate(l.due_date)}</div>
          </div>
          <button onClick={() => setSheet({ type: "return", loan: l })} style={{ ...sx.outline, padding: "9px 14px", fontSize: 13 }}>返却</button>
        </div>);
      })}
    </div>
  </>);
}
function HistoryView({ visibleLoans, items, nameOf, isAdmin, allView, setAllView }) {
  const map = { active: ["貸出中", C.warnBg, C.warn], overdue: ["延滞", C.zeroBg, C.zero], returned: ["返却済", C.okBg, C.ok] };
  return (<>
    <div style={sx.rowHead}><h2 style={sx.h2}>履歴</h2><ScopeToggle {...{ isAdmin, allView, setAllView }} /></div>
    {visibleLoans.length === 0 && <Empty icon={<History size={30} />} title="履歴なし" body="貸出・返却の記録がここに表示されます。" />}
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {visibleLoans.map((l) => {
        const item = items.find((i) => i.id === l.item_id); const [label, bg, col] = map[l.status] || map.active;
        return (<div key={l.id} style={{ ...sx.card, padding: "12px 14px" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14.5 }}>{item?.name || "—"}</div>
            <div style={{ fontSize: 11.5, color: C.sub, marginTop: 3 }}>{nameOf(l.user_id)}・{l.qty}{item?.unit}・期限 {fmtDate(l.due_date)}</div></div>
          <span style={{ ...sx.statusTag, background: bg, color: col }}>{label}</span>
        </div>);
      })}
    </div>
  </>);
}
function Admin({ items, setSheet, exportCSV }) {
  return (<>
    <div style={sx.rowHead}><h2 style={sx.h2}>物品マスタ管理</h2></div>
    <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
      <button onClick={() => setSheet({ type: "item", item: null })} style={{ ...sx.primary, flex: 1, justifyContent: "center", display: "flex", alignItems: "center", gap: 6 }}><Plus size={16} /> 物品を追加</button>
      <button onClick={exportCSV} style={{ ...sx.outline, display: "flex", alignItems: "center", gap: 6 }}><Download size={16} /> CSV出力</button>
    </div>
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {items.map((i) => (<div key={i.id} style={{ ...sx.card, padding: "12px 14px" }} onClick={() => setSheet({ type: "item", item: i })}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", gap: 7, alignItems: "center" }}><span style={sx.code}>{i.item_code}</span><span style={{ fontWeight: 700, fontSize: 14.5 }}>{i.name}</span></div>
          <div style={{ fontSize: 11.5, color: C.sub, marginTop: 3 }}>{i.category || "—"}・{i.location || "—"}</div></div>
        <div style={{ textAlign: "right", fontSize: 12, color: C.sub }}>在庫 <b style={{ color: C.ink, fontSize: 15 }}>{i.stock}</b>/{i.total_qty}{i.unit}</div>
      </div>))}
    </div>
  </>);
}

/* ====== シート ====== */
function Sheet({ title, onClose, children, foot }) {
  return (<div style={sx.overlay} onClick={onClose}>
    <div className="sheet" style={sx.sheet} onClick={(e) => e.stopPropagation()}>
      <div style={sx.sheetHead}><span>{title}</span><X size={20} color={C.sub} onClick={onClose} style={{ cursor: "pointer" }} /></div>
      <div style={{ padding: "4px 18px 6px" }}>{children}</div>
      {foot && <div style={sx.sheetFoot}>{foot}</div>}
    </div>
  </div>);
}
function Stepper({ value, setValue, min = 1, max }) {
  return (<div style={{ display: "flex", alignItems: "center", gap: 14, justifyContent: "center", margin: "6px 0 2px" }}>
    <button style={sx.step} onClick={() => setValue(Math.max(min, value - 1))} disabled={value <= min}><Minus size={20} /></button>
    <div style={{ fontSize: 34, fontWeight: 800, minWidth: 70, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{value}</div>
    <button style={sx.step} onClick={() => setValue(Math.min(max, value + 1))} disabled={value >= max}><Plus size={20} /></button>
  </div>);
}
function LendSheet({ item, onClose, onSubmit }) {
  const [qty, setQty] = useState(1); const [due, setDue] = useState(plusDays(7)); const [note, setNote] = useState(""); const [busy, setBusy] = useState(false);
  return (<Sheet title="貸出登録" onClose={onClose}
    foot={<button style={{ ...sx.primary, width: "100%", justifyContent: "center", display: "flex", alignItems: "center", gap: 6, padding: 14, fontSize: 15 }}
      disabled={busy} onClick={async () => { setBusy(true); await onSubmit({ itemId: item.id, qty, dueDate: due, note }); setBusy(false); }}>
      {busy ? <Loader2 className="spin" size={16} /> : <ArrowLeftRight size={17} />} 貸し出す</button>}>
    <div style={{ textAlign: "center", marginBottom: 4 }}>
      <div style={{ fontWeight: 800, fontSize: 17 }}>{item.name}</div>
      <div style={{ fontSize: 12.5, color: C.sub, marginTop: 2 }}>{item.item_code}・在庫 {item.stock}{item.unit}</div></div>
    <label style={sx.label}>貸出数量（最大 {item.stock}）</label><Stepper value={qty} setValue={setQty} max={item.stock} />
    <label style={sx.label}>返却予定日</label><input type="date" value={due} onChange={(e) => setDue(e.target.value)} style={sx.input} />
    <label style={sx.label}>備考（任意）</label><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="用途など" style={sx.input} />
  </Sheet>);
}
function ReturnSheet({ loan, item, onClose, onSubmit }) {
  const rem = loan.qty - loan.returned_qty; const [qty, setQty] = useState(rem); const [busy, setBusy] = useState(false);
  return (<Sheet title="返却登録" onClose={onClose}
    foot={<button style={{ ...sx.primary, width: "100%", justifyContent: "center", display: "flex", alignItems: "center", gap: 6, padding: 14, fontSize: 15 }}
      disabled={busy} onClick={async () => { setBusy(true); await onSubmit({ loanId: loan.id, qty }); setBusy(false); }}>
      {busy ? <Loader2 className="spin" size={16} /> : <Check size={17} />} 返却する</button>}>
    <div style={{ textAlign: "center", marginBottom: 4 }}>
      <div style={{ fontWeight: 800, fontSize: 17 }}>{item?.name}</div>
      <div style={{ fontSize: 12.5, color: C.sub, marginTop: 2 }}>未返却 {rem}{item?.unit}</div></div>
    <label style={sx.label}>返却数量（最大 {rem}）</label><Stepper value={qty} setValue={setQty} max={rem} />
  </Sheet>);
}
function ItemSheet({ item, onClose, onSave, onDelete }) {
  const [f, setF] = useState(item || { item_code: "", name: "", category: "", total_qty: 1, location: "", unit: "個" });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (<Sheet title={item ? "物品を編集" : "物品を追加"} onClose={onClose}
    foot={<div style={{ display: "flex", gap: 8 }}>
      {item && <button style={{ ...sx.outline, color: C.accent, borderColor: C.accent, padding: 14 }} onClick={() => { if (confirm("削除しますか？")) onDelete(item.id); }}>削除</button>}
      <button style={{ ...sx.primary, flex: 1, justifyContent: "center", display: "flex", padding: 14, fontSize: 15 }} onClick={() => onSave(f)}>保存</button></div>}>
    {[["item_code", "品番"], ["name", "品名"], ["category", "カテゴリ"], ["location", "保管場所"]].map(([k, lab]) => (
      <React.Fragment key={k}><label style={sx.label}>{lab}</label><input value={f[k] || ""} onChange={set(k)} style={sx.input} /></React.Fragment>))}
    <div style={{ display: "flex", gap: 10 }}>
      <div style={{ flex: 1 }}><label style={sx.label}>総数{item ? "（在庫は自動調整）" : ""}</label><input type="number" value={f.total_qty} onChange={set("total_qty")} style={sx.input} /></div>
      <div style={{ width: 90 }}><label style={sx.label}>単位</label><input value={f.unit || ""} onChange={set("unit")} style={sx.input} /></div></div>
  </Sheet>);
}
function MeSheet({ me, onClose, onSignOut }) {
  return (<Sheet title="アカウント" onClose={onClose}>
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0 16px" }}>
      {me?.role === "admin" ? <Shield size={26} color={C.accent} /> : <User size={26} color={C.sub} />}
      <div><div style={{ fontWeight: 800, fontSize: 16 }}>{me?.name}</div>
        <div style={{ fontSize: 12.5, color: C.sub }}>{me?.department || "—"}・{me?.role === "admin" ? "管理者" : "一般ユーザー"}</div></div>
    </div>
    <button style={{ ...sx.outline, width: "100%", justifyContent: "center", display: "flex", alignItems: "center", gap: 7, color: C.accent, borderColor: C.accent }}
      onClick={onSignOut}><LogOut size={16} /> ログアウト</button>
  </Sheet>);
}

/* ====== 部品 ====== */
function NavBtn({ active, onClick, icon, label, badge }) {
  return (<button onClick={onClick} style={{ ...sx.navBtn, color: active ? C.accent : "#8A93A0" }}>
    <div style={{ position: "relative" }}>{icon}{badge ? <span style={sx.navBadge}>{badge}</span> : null}</div>
    <span style={{ fontSize: 10.5, fontWeight: active ? 700 : 500 }}>{label}</span></button>);
}
function Empty({ icon, title, body }) {
  return (<div style={{ textAlign: "center", padding: "48px 24px", color: C.sub }}>
    <div style={{ opacity: .35, display: "flex", justifyContent: "center", marginBottom: 12 }}>{icon}</div>
    <div style={{ fontWeight: 700, color: C.ink, marginBottom: 4 }}>{title}</div>
    <div style={{ fontSize: 13, lineHeight: 1.6 }}>{body}</div></div>);
}

/* ====== スタイル ====== */
const sx = {
  app: { maxWidth: 460, margin: "0 auto", minHeight: "100vh", background: C.bg, display: "flex", flexDirection: "column",
    fontFamily: '-apple-system, BlinkMacSystemFont, "Hiragino Kaku Gothic ProN", "Yu Gothic", Meiryo, sans-serif', color: C.ink, position: "relative" },
  top: { position: "sticky", top: 0, zIndex: 20, background: C.chrome, color: "#fff", padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" },
  meBtn: { display: "flex", alignItems: "center", gap: 6, background: C.chrome2, color: "#E6E9EE", border: "1px solid #2C333E", borderRadius: 999, padding: "7px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" },
  main: { flex: 1, padding: "16px 16px 92px", overflowY: "auto" },
  nav: { position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 460, background: "#fff", borderTop: `1px solid ${C.line}`, display: "flex", padding: "8px 0 max(8px, env(safe-area-inset-bottom))", zIndex: 20 },
  navBtn: { flex: 1, background: "none", border: "none", display: "flex", flexDirection: "column", alignItems: "center", gap: 3, cursor: "pointer" },
  navBadge: { position: "absolute", top: -6, right: -10, background: C.accent, color: "#fff", fontSize: 9.5, fontWeight: 700, minWidth: 16, height: 16, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px" },
  searchWrap: { display: "flex", alignItems: "center", gap: 8, background: "#fff", border: `1px solid ${C.line}`, borderRadius: 12, padding: "10px 12px", marginBottom: 12 },
  search: { flex: 1, border: "none", outline: "none", fontSize: 14.5, background: "transparent", color: C.ink },
  chips: { display: "flex", gap: 7, overflowX: "auto", paddingBottom: 12, marginBottom: 4 },
  chip: { flexShrink: 0, background: "#fff", border: `1px solid ${C.line}`, color: C.sub, borderRadius: 999, padding: "6px 13px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" },
  chipOn: { background: C.chrome, color: "#fff", borderColor: C.chrome },
  card: { background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: "13px 15px", display: "flex", alignItems: "center", gap: 12 },
  code: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 11.5, color: C.sub },
  tag: { fontSize: 10.5, background: "#EFF1F4", color: "#56606E", borderRadius: 5, padding: "2px 7px", fontWeight: 600 },
  pill: { display: "flex", alignItems: "baseline", gap: 3, borderRadius: 10, padding: "5px 11px", fontWeight: 800, fontVariantNumeric: "tabular-nums" },
  pillOk: { background: C.okBg, color: C.ok }, pillZero: { background: C.zeroBg, color: C.zero },
  primary: { background: C.accent, color: "#fff", border: "none", borderRadius: 10, padding: "10px 16px", fontSize: 14, fontWeight: 700, cursor: "pointer" },
  outline: { background: "#fff", color: C.ink, border: `1px solid ${C.line}`, borderRadius: 10, padding: "10px 16px", fontSize: 14, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 },
  disabled: { background: "#E5E7EB", color: "#9CA3AF", cursor: "not-allowed" },
  h2: { fontSize: 17, fontWeight: 800, margin: 0 },
  rowHead: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  badgeOver: { display: "inline-flex", alignItems: "center", gap: 3, background: C.accent, color: "#fff", fontSize: 10.5, fontWeight: 700, borderRadius: 6, padding: "2px 7px" },
  statusTag: { fontSize: 11.5, fontWeight: 700, borderRadius: 7, padding: "4px 10px", whiteSpace: "nowrap" },
  toggle: { display: "flex", background: "#E4E7EB", borderRadius: 9, padding: 3 },
  toggleBtn: { border: "none", background: "none", color: C.sub, fontSize: 12.5, fontWeight: 700, padding: "5px 14px", borderRadius: 7, cursor: "pointer" },
  toggleOn: { background: "#fff", color: C.ink, boxShadow: "0 1px 2px rgba(0,0,0,.08)" },
  overlay: { position: "fixed", inset: 0, background: "rgba(15,18,23,.45)", zIndex: 40, display: "flex", alignItems: "flex-end", justifyContent: "center" },
  sheet: { width: "100%", maxWidth: 460, background: "#fff", borderRadius: "20px 20px 0 0", paddingBottom: "max(16px, env(safe-area-inset-bottom))", maxHeight: "88vh", overflowY: "auto" },
  sheetHead: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 18px 10px", fontWeight: 800, fontSize: 16, position: "sticky", top: 0, background: "#fff" },
  sheetFoot: { padding: "10px 18px 6px", position: "sticky", bottom: 0, background: "#fff" },
  label: { display: "block", fontSize: 12, fontWeight: 600, color: C.sub, margin: "12px 0 5px" },
  input: { width: "100%", boxSizing: "border-box", border: `1px solid ${C.line}`, borderRadius: 10, padding: "11px 12px", fontSize: 15, outline: "none", color: C.ink, background: "#fff" },
  step: { width: 48, height: 48, borderRadius: 14, border: `1px solid ${C.line}`, background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: C.ink },
  toast: { position: "fixed", bottom: 84, left: "50%", transform: "translateX(-50%)", color: "#fff", padding: "11px 18px", borderRadius: 12, fontSize: 13.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 7, zIndex: 60, boxShadow: "0 6px 20px rgba(0,0,0,.25)", maxWidth: "90%" },
};
const css = `
* { -webkit-tap-highlight-color: transparent; }
.chips::-webkit-scrollbar { display: none; }
.sheet { animation: slideUp .22s ease-out; }
@keyframes slideUp { from { transform: translateY(100%);} to { transform: translateY(0);} }
.spin { animation: spin 1s linear infinite; } @keyframes spin { to { transform: rotate(360deg);} }
button:active:not(:disabled) { transform: scale(.97); }
button:focus-visible, input:focus-visible, textarea:focus-visible { outline: 2px solid ${C.accent}; outline-offset: 1px; }
@media (prefers-reduced-motion: reduce){ .sheet,.spin{animation:none} button:active{transform:none} }
input[type=date]{ -webkit-appearance:none; }
`;
