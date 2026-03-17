import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../supabase-config.js";

const supabase = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
);

export default supabase;
