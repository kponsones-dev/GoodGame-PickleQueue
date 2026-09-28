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
  renderRoster(); // Initial render for empty roster state
  await checkDbConnection();
  await loadGameTypes();
  await checkForActiveGameSession();
});

// -------------------------------------------------------------
// TOAST NOTIFICATION PROMPT
// -------------------------------------------------------------
function showToast(message, type = 'danger') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toastId = 'toast-' + Date.now();
  
  const bgClass = type === 'success' ? 'bg-success text-white' :
                  type === 'warning' ? 'bg-warning text-dark' :
                  type === 'info' ? 'bg-info text-white' : 'bg-danger text-white';
  
  const icon = type === 'success' ? 'bi-check-circle-fill' :
               type === 'warning' ? 'bi-exclamation-triangle-fill' :
               type === 'info' ? 'bi-info-circle-fill' : 'bi-x-circle-fill';

  const toastHtml = `
    <div id="${toastId}" class="toast align-items-center ${bgClass} border-0 shadow" role="alert" aria-live="assertive" aria-atomic="true">
      <div class="d-flex">
        <div class="toast-body d-flex align-items-center gap-2">
          <i class="bi ${icon} fs-5"></i>
          <span>${escapeHtml(message)}</span>
        </div>
        <button type="button" class="btn-close ${type === 'warning' ? '' : 'btn-close-white'} me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
      </div>
    </div>
  `;

  container.insertAdjacentHTML('beforeend', toastHtml);
  const toastEl = document.getElementById(toastId);
  const bsToast = new bootstrap.Toast(toastEl, { delay: 3500 });
  bsToast.show();

  toastEl.addEventListener('hidden.bs.toast', () => {
    toastEl.remove();
  });
}

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

    showToast("Session ended successfully.", "success");
  } catch (err) {
    console.error("Failed to end session:", err);
    showToast("Failed to end session: " + err.message, "danger");
  }
}

function resumeActiveSession() {
  if (timerInterval) clearInterval(timerInterval);
  activeSessionModalInstance.hide();
  showToast(`Resuming session "${activeSessionData.gamename}". Redirecting...`, "info");
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
      item.innerHTML = `<i class="bi bi-info-circle me-1"></i>No existing player found. Click "Add New Player" to create.`;
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
  
  if (!name) {
    showToast("Please enter a player name.", "warning");
    return;
  }

  // 1. Pre-check if player is already in current roster list
  const isAlreadyInRoster = currentRoster.some(p => p.name.trim().toLowerCase() === name.toLowerCase());
  if (isAlreadyInRoster) {
    showToast(`"${name}" is already in the roster.`, "warning");
    input.value = '';
    selectedSearchPlayer = null;
    document.getElementById('autocompleteDropdown').classList.add('d-none');
    return;
  }

  // 2. User clicked directly from autocomplete dropdown list
  if (selectedSearchPlayer) {
    const added = addPlayerToRoster(selectedSearchPlayer.name, selectedSearchPlayer.playerid, true);
    if (added) {
      input.value = '';
    }
    selectedSearchPlayer = null;
    document.getElementById('autocompleteDropdown').classList.add('d-none');
    return;
  }

  // 3. User clicked "Add New Player" button or pressed Enter
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span>Checking...`;

  try {
    // Check if player ALREADY exists in database
    const { data: existingDbPlayers, error: searchErr } = await db
      .from('players')
      .select('*')
      .ilike('name', name);

    if (searchErr) throw searchErr;

    const exactMatch = existingDbPlayers ? existingDbPlayers.find(p => p.name.trim().toLowerCase() === name.toLowerCase()) : null;

    if (exactMatch) {
      // Player already exists in DB -> Add directly to roster
      addPlayerToRoster(exactMatch.name, exactMatch.playerid, false);
      showToast(`Found "${exactMatch.name}" in database and added to roster!`, "info");
      input.value = '';
    } else {
      // Player does NOT exist in DB -> Insert new record
      btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span>Saving...`;
      
      const { data: newData, error: insertErr } = await db
        .from('players')
        .insert([{ name: name }])
        .select();

      if (insertErr) throw insertErr;

      const newPlayer = newData[0];
      addPlayerToRoster(newPlayer.name, newPlayer.playerid, false);
      showToast(`Created new player "${newPlayer.name}" and added to roster!`, "success");
      input.value = '';
    }
  } catch (err) {
    console.error("Error adding player:", err);
    showToast("Error adding player: " + err.message, "danger");
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i class="bi bi-plus-lg me-1"></i> Add New Player`;
    document.getElementById('autocompleteDropdown').classList.add('d-none');
  }
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

  if (names.length === 0) {
    showToast("Please enter at least one player name.", "warning");
    return;
  }

  // Filter out duplicates already in current roster
  const newNames = [];
  const duplicateNames = [];

  names.forEach(n => {
    const exists = currentRoster.some(p => p.name.trim().toLowerCase() === n.toLowerCase());
    if (exists) {
      duplicateNames.push(n);
    } else {
      newNames.push(n);
    }
  });

  if (duplicateNames.length > 0) {
    showToast(`Skipped ${duplicateNames.length} duplicate name(s) already in roster.`, "warning");
  }

  if (newNames.length === 0) return;

  btn.disabled = true;
  btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span>Processing...`;

  try {
    let addedCount = 0;

    for (let name of newNames) {
      const { data: existingDbPlayers } = await db.from('players').select('*').ilike('name', name);
      const exactMatch = existingDbPlayers ? existingDbPlayers.find(p => p.name.trim().toLowerCase() === name.toLowerCase()) : null;

      if (exactMatch) {
        addPlayerToRoster(exactMatch.name, exactMatch.playerid, false);
        addedCount++;
      } else {
        const { data: newData } = await db.from('players').insert([{ name: name }]).select();
        if (newData && newData.length > 0) {
          addPlayerToRoster(newData[0].name, newData[0].playerid, false);
          addedCount++;
        }
      }
    }

    showToast(`Successfully added ${addedCount} player(s) to roster!`, "success");
    clearMultiLineText();

    const singleTab = new bootstrap.Tab(document.getElementById('single-tab'));
    singleTab.show();

  } catch (err) {
    console.error("Failed bulk player insert:", err);
    showToast("Error saving bulk players: " + err.message, "danger");
  } finally {
    btn.disabled = false;
    btn.textContent = 'Add All To Roster';
  }
}

// -------------------------------------------------------------
// ROSTER MANAGEMENT
// -------------------------------------------------------------
function addPlayerToRoster(name, playerId, showNotification = true) {
  const cleanName = name.trim();

  // Check if player is already in roster
  const exists = currentRoster.some(p => {
    const sameId = playerId && p.playerid && String(p.playerid) === String(playerId);
    const sameName = p.name.trim().toLowerCase() === cleanName.toLowerCase();
    return sameId || sameName;
  });

  if (exists) {
    showToast(`"${cleanName}" is already added to the roster!`, "warning");
    return false;
  }

  currentRoster.push({
    playerid: playerId,
    name: cleanName
  });

  renderRoster();

  if (showNotification) {
    showToast(`Added "${cleanName}" to roster.`, "success");
  }

  return true;
}

function removePlayerFromRoster(index) {
  const removedPlayer = currentRoster[index];
  currentRoster.splice(index, 1);
  renderRoster();
  showToast(`Removed "${removedPlayer.name}" from roster.`, "info");
}

function confirmClearRoster() {
  if (currentRoster.length > 0) {
    const modalEl = document.getElementById('clearRosterModal');
    const modalInstance = bootstrap.Modal.getInstance(modalEl) || clearRosterModalInstance;
    if (modalInstance) {
      modalInstance.show();
    }
  }
}

function executeClearRoster() {
  currentRoster = [];
  renderRoster();

  // Close modal reliably
  const modalEl = document.getElementById('clearRosterModal');
  const modalInstance = bootstrap.Modal.getInstance(modalEl) || clearRosterModalInstance;
  if (modalInstance) {
    modalInstance.hide();
  }

  showToast("Roster cleared.", "info");
}

// ROSTER RENDERING - Safe DOM Construction
function renderRoster() {
  const container = document.getElementById('rosterContainer');
  const badge = document.getElementById('rosterCountBadge');
  const clearBtn = document.getElementById('clearRosterBtn');

  if (!container) return;

  badge.textContent = `${currentRoster.length} Player${currentRoster.length === 1 ? '' : 's'} in Roster`;

  if (currentRoster.length === 0) {
    container.innerHTML = `<span class="text-muted small italic w-100 text-center" id="emptyRosterText">No players added to the roster yet.</span>`;
    if (clearBtn) clearBtn.classList.add('d-none');
    return;
  }

  if (clearBtn) clearBtn.classList.remove('d-none');
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
    showToast("Please enter a session name and choose a game type.", "warning");
    return;
  }

  if (currentRoster.length === 0) {
    showToast("Please add at least one player to the roster before starting.", "warning");
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

    showToast(`Session "${gameName}" started! Game ID: ${newGameId}`, "success");
    
    currentRoster = [];
    renderRoster();
    document.getElementById('sessionForm').reset();

  } catch (err) {
    console.error("Error starting session:", err);
    showToast("Failed to start session: " + err.message, "danger");
  } finally {
    startBtn.disabled = false;
    startBtn.innerHTML = `<i class="bi bi-play-circle-fill me-2"></i>Start Matchmaking Session`;
  }
}

// Utility
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, function(m) {
    return {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    }[m];
  });
}