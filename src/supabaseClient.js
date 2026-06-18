import { createClient } from "@supabase/supabase-js";
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
if (!url || !key) console.warn("VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY が未設定です（.env を確認）");
export const supabase = createClient(url, key);
