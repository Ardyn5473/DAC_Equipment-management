import { supabase } from "./supabaseClient";

// RPC等のエラーメッセージはDB側で日本語化済み。そのまま表示。
const msg = (e) => e?.message || "エラーが発生しました";

export const api = {
  async session() {
    const { data } = await supabase.auth.getSession();
    return data.session;
  },
  onAuth(cb) {
    return supabase.auth.onAuthStateChange((_e, session) => cb(session));
  },
  async signIn(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(msg(error));
  },
  async signUp(email, password, name) {
    const { error } = await supabase.auth.signUp({ email, password, options: { data: { name } } });
    if (error) throw new Error(msg(error));
  },
  async signOut() { await supabase.auth.signOut(); },

  async myProfile() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data, error } = await supabase.from("profiles").select("*").eq("id", user.id).single();
    if (error) throw new Error(msg(error));
    return data;
  },
  async profiles() {
    const { data, error } = await supabase.from("profiles").select("id,name,department,role");
    if (error) throw new Error(msg(error));
    return data || [];
  },
  async items() {
    const { data, error } = await supabase.from("items").select("*").order("item_code");
    if (error) throw new Error(msg(error));
    return data || [];
  },
  // status / is_overdue 付きビューを利用（RLSにより一般は自分の行、管理者は全件）
  async loans() {
    const { data, error } = await supabase.from("loans_view").select("*").order("lent_at", { ascending: false });
    if (error) throw new Error(msg(error));
    return data || [];
  },

  // ★原子的な貸出・返却（DB関数）
  async lend(itemId, qty, dueDate, note) {
    const { data, error } = await supabase.rpc("lend_item", {
      p_item_id: itemId, p_qty: qty, p_due_date: dueDate || null, p_note: note || "",
    });
    if (error) throw new Error(msg(error));
    return data;
  },
  async ret(loanId, qty) {
    const { data, error } = await supabase.rpc("return_loan", { p_loan_id: loanId, p_qty: qty });
    if (error) throw new Error(msg(error));
    return data;
  },

  // 物品マスタ（管理者のみ：RLSで保護）
  async upsertItem(item) {
    const row = { item_code: item.item_code, name: item.name, category: item.category,
      total_qty: Number(item.total_qty), location: item.location, unit: item.unit };
    if (item.id) {
      const { error } = await supabase.from("items").update(row).eq("id", item.id);
      if (error) throw new Error(msg(error));
    } else {
      const { error } = await supabase.from("items").insert({ ...row, stock: Number(item.total_qty) });
      if (error) throw new Error(msg(error));
    }
  },
  async setItemTotal(itemId, total) {
    const { error } = await supabase.rpc("set_item_total", { p_item_id: itemId, p_total: Number(total) });
    if (error) throw new Error(msg(error));
  },
  async deleteItem(id) {
    const { error } = await supabase.from("items").delete().eq("id", id);
    if (error) throw new Error(msg(error));
  },

  // 物品・貸出の変更をリアルタイム購読
  subscribe(onChange) {
    const ch = supabase.channel("wh")
      .on("postgres_changes", { event: "*", schema: "public", table: "items" }, onChange)
      .on("postgres_changes", { event: "*", schema: "public", table: "loans" }, onChange)
      .subscribe();
    return () => supabase.removeChannel(ch);
  },
};
