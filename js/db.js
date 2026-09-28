// Check Supabase Connection
async function checkDbConnection() {
  const statusBadge = document.getElementById('dbConnectionStatus');
  try {
    const { data, error } = await db.from('gametype').select('count', { count: 'exact', head: true });
    if (error) throw error;
    
    statusBadge.className = "badge bg-success db-badge px-2 py-1";
    statusBadge.innerHTML = '<i class="bi bi-check-circle-fill me-1"></i>Supabase Connected';
  } catch (err) {
    console.warn("Database connection issue:", err);
    statusBadge.className = "badge bg-warning text-dark db-badge px-2 py-1";
    statusBadge.innerHTML = '<i class="bi bi-exclamation-triangle-fill me-1"></i>Offline / Limited';
  }
}

// Supabase Configuration & Client Initialization
const SUPABASE_URL = "https://wazlqssrnuvfcyhhupar.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_0hUwx3Kpc9xisz4_fswUoQ_qKQkSdMH";

// Initialize global database instance
const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);