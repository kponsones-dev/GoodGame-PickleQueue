// Supabase Configuration & Client Initialization
const SUPABASE_URL = "https://wazlqssrnuvfcyhhupar.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_0hUwx3Kpc9xisz4_fswUoQ_qKQkSdMH";

// Initialize global database instance
const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);