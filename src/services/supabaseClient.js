import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

const sessionStorageAdapter = {
  getItem(key) {
    if (typeof window === "undefined") return null;
    return window.sessionStorage.getItem(key);
  },
  setItem(key, value) {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem(key, value);
  },
  removeItem(key) {
    if (typeof window === "undefined") return;
    window.sessionStorage.removeItem(key);
  }
};

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        storage: sessionStorageAdapter,
        userStorage: sessionStorageAdapter,
        storageKey: "sb-auth-tab-session",
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    })
  : null;
