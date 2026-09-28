// Index Page State
let currentRoster = [];
let activeSessionData = null;
let timerInterval = null;
let activeSessionModalInstance = null;
let clearRosterModalInstance = null;
let selectedSearchPlayer = null;

// -------------------------------------------------------------
// INITIALIZATION
// -------------------------------------------------------------
document.addEventListener("DOMContentLoaded", async () => {
  activeSessionModalInstance = new bootstrap.Modal(document.getElementById('activeSessionModal'));
  clearRosterModalInstance = new bootstrap.Modal(document.getElementById('clearRosterModal'));

  setupSearchAutocompleteListener();
  await checkDbConnection();
  await loadGameTypes();
  await checkForActiveGameSession();
});

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

// Load Game Types from Supabase
async function loadGameTypes() {
  const selectEl = document.getElementById('gameTypeSelect');
  selectEl.innerHTML = `<option value="" disabled selected>Loading options...</option>`;

  try {
    const { data, error } = await db.from('gametype').select('*').order('gametypeid', { ascending: true });
    
    if (error || !data || data.length === 0) throw new Error("Could not load gametype records");

    selectEl.innerHTML = `<option value="" disabled selected>Select game type...</option>`;
    data.forEach(gt => {
      const opt = document.createElement('option');
      opt.value = gt.gametypeid;
      opt.textContent = `${gt.gametypeid}. ${gt.name}`;
      selectEl.appendChild(opt);
    });
  } catch (err) {
    console.warn("Fallback to default game types:", err);
    selectEl.innerHTML = `
      <option value="" disabled selected>Select game type...</option>
      <option value="1">1. Social Mix</option>
      <option value="2">2. Skill Separated</option>
      <option value="3">3. Winners/Losers</option>
    `;
  }
}

// -------------------------------------------------------------
// ACTIVE SESSION CHECK
// -------------------------------------------------------------
async function checkForActiveGameSession() {
  try {
    const { data, error } = await db
      .from('game')
      .select('*')
      .is('enddatetime', null)
      .order('startdatetime', { ascending: false })
      .limit(1);

    if (error) throw error;

    if (data && data.length > 0) {
      activeSessionData = data[0];
      showActiveSessionModal(activeSessionData);
    }
  } catch (err) {
    console.error("Error checking active session:", err);
  }
}

function showActiveSessionModal(session) {
  document.getElementById('activeSessionName').textContent = session.gamename;
  const startTime = new Date(session.startdatetime);
  document.getElementById('activeSessionStartTime').textContent = startTime.toLocaleString();

  updateTimerDisplay(startTime);
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => updateTimerDisplay(startTime), 1000);

  activeSessionModalInstance.show();
}

function updateTimerDisplay(startTime) {
  const now = new Date();
  const diffMs = Math.max(0, now - startTime);
  
  const hours = Math.floor(diffMs / (1000 * 60 * 60)).toString().padStart(2, '0');
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60)).toString().padStart(2, '0');
  const seconds = Math.floor((diffMs % (1000 * 60)) / 1000).toString().padStart(2, '0');

  document.getElementById('activeSessionTimer').textContent = `${hours}:${minutes}:${seconds}`;
}

async function endActiveSession() {
  if (!activeSessionData) return;

  try {
    const endIso = new Date().toISOString();
    await db.from('game').update({ enddatetime: endIso }).eq('gameid', activeSessionData.gameid);
    await db.from('players').update({ currentgameid: null }).eq('currentgameid', activeSessionData.gameid);

    if (timerInterval) clearInterval(timerInterval);
    activeSessionModalInstance.hide();
    activeSessionData = null;

    alert("Session ended successfully.");
  } catch (err) {
    console.error("Failed to end session:", err);
    alert("Failed to end session on database: " + err.message);
  }
}

function resumeActiveSession() {
  if (timerInterval) clearInterval(timerInterval);
  activeSessionModalInstance.hide();
  alert(`Resuming session "${activeSessionData.gamename}". Redirecting to Queue page...`);
}

// -------------------------------------------------------------
// LIVE SEARCH & AUTOCOMPLETE
// -------------------------------------------------------------
function setupSearchAutocompleteListener() {
  const input = document.getElementById('singlePlayerInput');
  const dropdown = document.getElementById('autocompleteDropdown');
  let debounceTimer = null;

  input.addEventListener('input', (e) => {
    const query = e.target.value.trim();
    selectedSearchPlayer = null;

    clearTimeout(debounceTimer);
    if (query.length < 1) {
      dropdown.classList.add('d-none');
      return;
    }

    debounceTimer = setTimeout(() => searchPlayersInDb(query), 250);
  });

  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.classList.add('d-none');
    }
  });
}

async function searchPlayersInDb(query) {
  const dropdown = document.getElementById('autocompleteDropdown');
  
  try {
    const { data, error } = await db
      .from('players')
      .select('*')
      .ilike('name', `%${query}%`)
      .limit(5);

    if (error) throw error;

    dropdown.innerHTML = '';

    if (data && data.length > 0) {
      data.forEach(player => {
        const item = document.createElement('div');
        item.className = 'autocomplete-item border-bottom d-flex justify-content-between align-items-center';
        item.innerHTML = `
          <div>
            <span class="fw-medium">${escapeHtml(player.name)}</span>
            <span class="badge bg-light text-dark border ms-2">ID: ${player.playerid}</span>
          </div>
          <span class="badge bg-success bg-opacity-10 text-success border border-success border-opacity-25 small">Existing Player</span>
        `;
        item.onclick = () => selectAutocompletePlayer(player);
        dropdown.appendChild(item);
      });
    } else {
      const item = document.createElement('div');
      item.className = 'autocomplete-item text-muted small';
      item.innerHTML = `<i class="bi bi-plus-circle me-1"></i>No player found. Click "Add Player" to save <strong>"${escapeHtml(query)}"</strong>`;
      dropdown.appendChild(item);
    }

    dropdown.classList.remove('d-none');
  } catch (err) {
    console.error("Autocomplete search error:", err);
  }
}

function selectAutocompletePlayer(player) {
  document.getElementById('singlePlayerInput').value = player.name;
  selectedSearchPlayer = player;
  document.getElementById('autocompleteDropdown').classList.add('d-none');
  addSinglePlayerFromInput();
}

async function addSinglePlayerFromInput() {
  const input = document.getElementById('singlePlayerInput');
  const btn = document.getElementById('addSinglePlayerBtn');
  const name = input.value.trim();
  
  if (!name) return;

  if (selectedSearchPlayer) {
    addPlayerToRoster(selectedSearchPlayer.name, selectedSearchPlayer.playerid, false);
    input.value = '';
    selectedSearchPlayer = null;
  } else {
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span>Saving...`;

    try {
      const { data, error } = await db
        .from('players')
        .insert([{ name: name }])
        .select();

      if (error) throw error;

      const newPlayer = data[0];
      addPlayerToRoster(newPlayer.name, newPlayer.playerid, false);
      input.value = '';
    } catch (err) {
      console.error("Error saving new player:", err);
      alert("Error saving player to database: " + err.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<i class="bi bi-plus-lg me-1"></i> Add Player`;
    }
  }

  document.getElementById('autocompleteDropdown').classList.add('d-none');
}

// -------------------------------------------------------------
// BULK MULTI-LINE PLAYER IMPORT
// -------------------------------------------------------------
function updateMultiLineCounter() {
  const rawText = document.getElementById('multiPlayerInput').value;
  const names = parseLinesToNames(rawText);
  document.getElementById('multiLineCounter').textContent = `${names.length} player name(s) detected`;
}

function parseLinesToNames(text) {
  if (!text) return [];
  return text
    .split('\n')
    .map(line => line.replace(/^[\d\s.\-*•)]+/, '').trim())
    .filter(line => line.length > 0);
}

function clearMultiLineText() {
  document.getElementById('multiPlayerInput').value = '';
  updateMultiLineCounter();
}

async function addMultiLinePlayers() {
  const rawText = document.getElementById('multiPlayerInput').value;
  const names = parseLinesToNames(rawText);
  const btn = document.getElementById('addMultiPlayerBtn');

  if (names.length === 0) return;

  btn.disabled = true;
  btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span>Saving...`;

  try {
    const insertPayload = names.map(n => ({ name: n }));
    const { data, error } = await db
      .from('players')
      .insert(insertPayload)
      .select();

    if (error) throw error;

    data.forEach(p => addPlayerToRoster(p.name, p.playerid, false));

    clearMultiLineText();
    const singleTab = new bootstrap.Tab(document.getElementById('single-tab'));
    singleTab.show();

  } catch (err) {
    console.error("Failed bulk player insert:", err);
    alert("Error saving bulk players to database: " + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Add All To Roster';
  }
}

// -------------------------------------------------------------
// ROSTER MANAGEMENT
// -------------------------------------------------------------
function addPlayerToRoster(name, playerId, isNew = false) {
  const exists = currentRoster.some(p => p.playerid === playerId || p.name.toLowerCase() === name.toLowerCase());
  if (exists) return;

  currentRoster.push({
    playerid: playerId,
    name: name,
    isNew: isNew
  });

  renderRoster();
}

function removePlayerFromRoster(index) {
  currentRoster.splice(index, 1);
  renderRoster();
}

function confirmClearRoster() {
  if (currentRoster.length > 0) {
    clearRosterModalInstance.show();
  }
}

function executeClearRoster() {
  currentRoster = [];
  renderRoster();
  clearRosterModalInstance.hide();
}

function renderRoster() {
  const container = document.getElementById('rosterContainer');
  const emptyText = document.getElementById('emptyRosterText');
  const badge = document.getElementById('rosterCountBadge');
  const clearBtn = document.getElementById('clearRosterBtn');

  badge.textContent = `${currentRoster.length} Player${currentRoster.length === 1 ? '' : 's'} in Roster`;

  if (currentRoster.length === 0) {
    container.innerHTML = '';
    container.appendChild(emptyText);
    emptyText.classList.remove('d-none');
    clearBtn.classList.add('d-none');
    return;
  }

  emptyText.classList.add('d-none');
  clearBtn.classList.remove('d-none');
  container.innerHTML = '';

  currentRoster.forEach((player, idx) => {
    const tag = document.createElement('div');
    tag.className = 'badge bg-white text-dark border shadow-sm player-tag d-flex align-items-center gap-2';
    
    const sourceBadge = `<span class="badge bg-success bg-opacity-10 text-success border border-success border-opacity-25" style="font-size:0.65rem;">ID: ${player.playerid}</span>`;

    tag.innerHTML = `
      <i class="bi bi-person-fill text-secondary"></i>
      <span>${escapeHtml(player.name)}</span>
      ${sourceBadge}
      <i class="bi bi-x-circle-fill text-muted text-hover-danger ms-1" style="cursor:pointer;" onclick="removePlayerFromRoster(${idx})" title="Remove"></i>
    `;
    container.appendChild(tag);
  });
}

// -------------------------------------------------------------
// START NEW SESSION
// -------------------------------------------------------------
async function startNewSession() {
  const gameName = document.getElementById('gameNameInput').value.trim();
  const gameTypeId = parseInt(document.getElementById('gameTypeSelect').value, 10);
  const startBtn = document.getElementById('startSessionBtn');

  if (!gameName || !gameTypeId) {
    alert("Please complete all session details.");
    return;
  }

  if (currentRoster.length === 0) {
    alert("Please add at least one player to the roster before starting.");
    return;
  }

  startBtn.disabled = true;
  startBtn.innerHTML = `<span class="spinner-border spinner-border-sm me-2" role="status"></span>Starting Session...`;

  try {
    const startTime = new Date().toISOString();

    const { data: gameData, error: gameError } = await db
      .from('game')
      .insert([{ gamename: gameName, gametypeid: gameTypeId, startdatetime: startTime }])
      .select();

    if (gameError) throw gameError;
    
    const newGameId = gameData[0].gameid;

    for (let player of currentRoster) {
      if (player.playerid) {
        await db.from('players')
          .update({ currentgameid: newGameId })
          .eq('playerid', player.playerid);
      }
    }

    alert(`Session "${gameName}" started successfully! Game ID: ${newGameId}`);
    
    currentRoster = [];
    renderRoster();
    document.getElementById('sessionForm').reset();

  } catch (err) {
    console.error("Error starting session:", err);
    alert("Failed to start session: " + err.message);
  } finally {
    startBtn.disabled = false;
    startBtn.innerHTML = `<i class="bi bi-play-circle-fill me-2"></i>Start Matchmaking Session`;
  }
}

// Utility
function escapeHtml(str) {
  return str.replace(/[&<>"']/g, function(m) {
    return {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    }[m];
  });
}