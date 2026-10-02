// Players Page State
let allPlayers = [];
let activeSessionId = null; // Store active session if one exists
let playerModalInstance = null;
let historyModalInstance = null;
let deleteModalInstance = null;

document.addEventListener("DOMContentLoaded", async () => {
  initPageLayout("Manage Players");

  playerModalInstance = new bootstrap.Modal(document.getElementById('playerModal'));
  historyModalInstance = new bootstrap.Modal(document.getElementById('historyModal'));
  deleteModalInstance = new bootstrap.Modal(document.getElementById('deleteModal'));

  await checkDbConnection();
  await fetchActiveSession(); // Find the current active game session first
  await loadPlayers();
});

// Fetch current active session (where enddatetime is null)
async function fetchActiveSession() {
  try {
    const { data, error } = await db
      .from('game')
      .select('gameid')
      .is('enddatetime', null)
      .order('startdatetime', { ascending: false })
      .limit(1);

    if (error) throw error;
    if (data && data.length > 0) {
      activeSessionId = data[0].gameid;
    }
  } catch (err) {
    console.error("Error fetching active session:", err);
  }
}

// Toast Helper
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
  toastEl.addEventListener('hidden.bs.toast', () => toastEl.remove());
}

// Load Players from Database
async function loadPlayers() {
  const tbody = document.getElementById('playerTableBody');
  const subtitle = document.getElementById('playerCountSubtitle');

  try {
    const { data, error } = await db
      .from('players')
      .select('*')
      .order('name', { ascending: true });

    if (error) throw error;

    allPlayers = data || [];
    subtitle.textContent = `${allPlayers.length} total registered player(s)`;
    renderPlayerTable(allPlayers);
  } catch (err) {
    console.error("Failed to load players:", err);
    tbody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-danger"><i class="bi bi-exclamation-triangle me-1"></i>Error loading players: ${escapeHtml(err.message)}</td></tr>`;
  }
}

// Render Table
function renderPlayerTable(players) {
  const tbody = document.getElementById('playerTableBody');
  if (!tbody) return;

  if (players.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-muted">No players found in directory.</td></tr>`;
    return;
  }

  tbody.innerHTML = '';

  players.forEach(player => {
    const tr = document.createElement('tr');

    let ratingBadge = '<span class="text-muted small">Unassigned</span>';
    if (player.ratingid && RATING_MAP[player.ratingid]) {
      ratingBadge = `<span class="badge bg-warning bg-opacity-25 text-dark border border-warning"><i class="bi bi-star-fill text-warning me-1"></i>${RATING_MAP[player.ratingid].value} (${RATING_MAP[player.ratingid].label})</span>`;
    }

    let genderBadge = '<span class="text-muted small">--</span>';
    if (player.gender) {
      genderBadge = player.gender === 'F' ? '<span class="badge bg-info bg-opacity-10 text-info border border-info">Female (F)</span>' : '<span class="badge bg-primary bg-opacity-10 text-primary border border-primary">Male (M)</span>';
    }

    let statusBadge = '';
    if (player.currentgameid === null || player.currentgameid === undefined) {
      const hasHistoryInActiveSession = activeSessionId !== null;
      if (hasHistoryInActiveSession) {
        statusBadge = `<span class="badge bg-secondary bg-opacity-10 text-secondary border border-secondary">Checked Out</span>`;
      } else {
        statusBadge = `<span class="badge bg-success bg-opacity-10 text-success border border-success">Available</span>`;
      }
    } else {
      statusBadge = `<span class="badge bg-warning bg-opacity-10 text-dark border border-warning">Waiting</span>`;
    }

    const escapedName = escapeHtml(player.name).replace(/'/g, "\\'");
    const safeRating = player.ratingid !== null && player.ratingid !== undefined ? player.ratingid : '';
    const safeGender = player.gender ? player.gender : '';

    tr.innerHTML = `
      <td class="ps-3 fw-semibold text-dark">
        <i class="bi bi-person-circle text-primary me-2"></i>${escapeHtml(player.name)}
        <div class="text-muted" style="font-size: 0.7rem;">ID: ${player.playerid}</div>
      </td>
      <td>${ratingBadge}</td>
      <td>${genderBadge}</td>
      <td>${statusBadge}</td>
      <td class="text-end pe-3">
        <div class="btn-group btn-group-sm" role="group">
          <button type="button" class="btn btn-outline-secondary" title="View History" onclick="openHistoryModal(${player.playerid}, '${escapedName}')">
            <i class="bi bi-eye"></i>
          </button>
          <button type="button" class="btn btn-outline-primary" title="Edit Player" onclick="openEditPlayerModal(${player.playerid}, '${escapedName}', '${safeRating}', '${safeGender}')">
            <i class="bi bi-pencil"></i>
          </button>
          <button type="button" class="btn btn-outline-danger" title="Delete Player" onclick="openDeletePlayerModal(${player.playerid}, '${escapedName}')">
            <i class="bi bi-trash"></i>
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// Filter Table Search
function filterPlayerTable() {
  const query = document.getElementById('playerSearchInput').value.toLowerCase().trim();
  const filtered = allPlayers.filter(p => p.name.toLowerCase().includes(query));
  renderPlayerTable(filtered);
}

// Add/Edit Modal Handlers
function openAddPlayerModal() {
  const tabsContainer = document.getElementById('playerEntryTabsContainer');
  if (tabsContainer) tabsContainer.style.display = 'block';

  document.getElementById('playerModalTitle').innerHTML = `<i class="bi bi-person-plus text-primary me-2"></i>Add New Player`;
  document.getElementById('modalPlayerId').value = '';
  document.getElementById('modalPlayerName').value = '';
  document.getElementById('modalPlayerGender').value = '';
  
  const singleTab = document.getElementById('single-modal-tab');
  if (singleTab) {
    new bootstrap.Tab(singleTab).show();
  }
  clearMultiLineText();
  resetStarRating();
  
  playerModalInstance.show();
}

function openEditPlayerModal(playerId, name, ratingId, gender) {
  const tabsContainer = document.getElementById('playerEntryTabsContainer');
  if (tabsContainer) tabsContainer.style.display = 'none';

  document.getElementById('playerModalTitle').innerHTML = `<i class="bi bi-pencil-square text-primary me-2"></i>Edit Player`;
  document.getElementById('modalPlayerId').value = playerId;
  document.getElementById('modalPlayerName').value = name;
  document.getElementById('modalPlayerGender').value = gender;

  const singlePane = document.getElementById('single-modal-pane');
  const multiPane = document.getElementById('multi-modal-pane');
  if (singlePane && multiPane) {
    singlePane.classList.add('show', 'active');
    multiPane.classList.remove('show', 'active');
  }

  if (ratingId !== '') {
    setStarRating(parseInt(ratingId, 10));
  } else {
    resetStarRating();
  }

  playerModalInstance.show();
}

// BULK MULTI-LINE PLAYER IMPORT LOGIC
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
  const inputEl = document.getElementById('multiPlayerInput');
  if (inputEl) inputEl.value = '';
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

  const newNames = [];
  const duplicateNames = [];

  names.forEach(n => {
    const exists = allPlayers.some(p => p.name.trim().toLowerCase() === n.toLowerCase());
    if (exists) {
      duplicateNames.push(n);
    } else {
      newNames.push(n);
    }
  });

  if (duplicateNames.length > 0) {
    showToast(`Skipped ${duplicateNames.length} duplicate name(s) already in directory.`, "warning");
  }

  if (newNames.length === 0) return;

  btn.disabled = true;
  btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span>Processing...`;

  try {
    let addedCount = 0;

    for (let name of newNames) {
      const { error } = await db
        .from('players')
        .insert([{ name: name, ratingid: null, gender: null }]);

      if (!error) {
        addedCount++;
      }
    }

    showToast(`Successfully added ${addedCount} player(s) to directory!`, "success");
    clearMultiLineText();
    playerModalInstance.hide();
    await loadPlayers();

  } catch (err) {
    console.error("Failed bulk player insert:", err);
    showToast("Error saving bulk players: " + err.message, "danger");
  } finally {
    btn.disabled = false;
    btn.textContent = 'Add All To Directory';
  }
}

function resetStarRating() {
  const stars = document.querySelectorAll('#starRatingContainer .style-star');
  stars.forEach(s => {
    s.classList.remove('bi-star-fill');
    s.classList.add('bi-star');
  });
  document.getElementById('modalRatingId').value = '';
  document.getElementById('ratingValueBadge').textContent = 'Unassigned';
}

function setStarRating(starCount) {
  const stars = document.querySelectorAll('#starRatingContainer .style-star');
  stars.forEach((star, index) => {
    if (index < starCount) {
      star.classList.remove('bi-star');
      star.classList.add('bi-star-fill');
    } else {
      star.classList.remove('bi-star-fill');
      star.classList.add('bi-star');
    }
  });

  const ratingInfo = RATING_MAP[starCount] || { ratingid: null, label: "Unassigned" };
  document.getElementById('modalRatingId').value = ratingInfo.ratingid || '';
  document.getElementById('ratingValueBadge').textContent = ratingInfo.label;
}

async function savePlayerRecord() {
  const playerId = document.getElementById('modalPlayerId').value;
  const name = document.getElementById('modalPlayerName').value.trim();
  const rawRating = document.getElementById('modalRatingId').value;
  const gender = document.getElementById('modalPlayerGender').value || null;
  const ratingId = rawRating ? parseInt(rawRating, 10) : null;
  const saveBtn = document.getElementById('savePlayerBtn');

  if (!name) {
    showToast("Please enter a player name.", "warning");
    return;
  }

  saveBtn.disabled = true;
  saveBtn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span>Saving...`;

  try {
    if (playerId) {
      const { error } = await db
        .from('players')
        .update({ name, ratingid: ratingId, gender })
        .eq('playerid', playerId);

      if (error) throw error;
      showToast(`Successfully updated "${name}"!`, "success");
    } else {
      const { error } = await db
        .from('players')
        .insert([{ name, ratingid: ratingId, gender }]);

      if (error) throw error;
      showToast(`Successfully created "${name}"!`, "success");
    }

    playerModalInstance.hide();
    await loadPlayers();
  } catch (err) {
    console.error("Save error:", err);
    showToast("Failed to save player: " + err.message, "danger");
  } finally {
    saveBtn.disabled = false;
    saveBtn.innerHTML = `<i class="bi bi-check-circle me-1"></i>Save Player`;
  }
}

// Delete Handlers
function openDeletePlayerModal(playerId, name) {
  document.getElementById('deletePlayerId').value = playerId;
  document.getElementById('deletePlayerName').textContent = name;
  deleteModalInstance.show();
}

async function executeDeletePlayer() {
  const playerId = document.getElementById('deletePlayerId').value;

  try {
    const { error } = await db.from('players').delete().eq('playerid', playerId);
    if (error) throw error;

    deleteModalInstance.hide();
    showToast("Player deleted successfully.", "success");
    await loadPlayers();
  } catch (err) {
    console.error("Delete error:", err);
    showToast("Failed to delete player: " + err.message, "danger");
  }
}

// View History Handlers with Tabs & Match Participants Detail
async function openHistoryModal(playerId, playerName) {
  document.getElementById('historyPlayerName').textContent = playerName;
  
  const currentMatchContainer = document.getElementById('currentMatchContainer');
  const historicalMatchesContainer = document.getElementById('historicalMatchesContainer');
  const matchDetailTabItem = document.getElementById('matchDetailTabItem');

  // Hide the match detail tab initially when opening fresh
  if (matchDetailTabItem) matchDetailTabItem.style.display = 'none';

  currentMatchContainer.innerHTML = `<div class="text-center py-4 text-muted"><span class="spinner-border spinner-border-sm me-2"></span>Loading current match...</div>`;
  historicalMatchesContainer.innerHTML = `<div class="text-center py-4 text-muted"><span class="spinner-border spinner-border-sm me-2"></span>Loading historical matches...</div>`;
  
  // Default to opening the first tab (Current Match)
  const currentMatchTab = document.getElementById('current-match-tab');
  if (currentMatchTab) {
    new bootstrap.Tab(currentMatchTab).show();
  }

  historyModalInstance.show();

  try {
    const playerRecord = allPlayers.find(p => p.playerid === playerId);
    
    // 1. Load Current Match
    if (playerRecord && playerRecord.currentgameid) {
      const { data: gameData, error: gameError } = await db.from('game').select('*').eq('gameid', playerRecord.currentgameid).single();
      
      if (gameError) throw gameError;

      currentMatchContainer.innerHTML = `
        <div class="p-3 bg-light rounded border">
          <div class="d-flex justify-content-between align-items-center mb-2">
            <span class="fw-bold text-primary"><i class="bi bi-controller me-1"></i>${escapeHtml(gameData ? gameData.gamename : 'Active Session')}</span>
            <span class="badge bg-success bg-opacity-10 text-success border border-success">In Progress</span>
          </div>
          <div class="text-muted small">Game ID: ${playerRecord.currentgameid}</div>
          <div class="text-muted small">Started: ${gameData && gameData.startdatetime ? new Date(gameData.startdatetime).toLocaleString() : '--'}</div>
        </div>
      `;
    } else {
      currentMatchContainer.innerHTML = `
        <div class="text-center py-4 text-muted">
          <i class="bi bi-inbox fs-2 d-block mb-2"></i>
          Player is not currently assigned to an active match.
        </div>
      `;
    }

    // 2. Load Historical Matches
    const { data: historyData, error: historyError } = await db
      .from('queue')
      .select('*, game(gameid, gamename, startdatetime, enddatetime)')
      .eq('playerid', playerId)
      .order('queueid', { ascending: false });

    if (historyError) {
      historicalMatchesContainer.innerHTML = `
        <div class="text-center py-4 text-muted">
          <i class="bi bi-journal-x fs-2 d-block mb-2"></i>
          No historical match records found.
        </div>
      `;
    } else if (!historyData || historyData.length === 0) {
      historicalMatchesContainer.innerHTML = `
        <div class="text-center py-4 text-muted">
          <i class="bi bi-journal-check fs-2 d-block mb-2"></i>
          No past match records available for this player.
        </div>
      `;
    } else {
      let historyHtml = `
        <div class="table-responsive">
          <table class="table table-sm table-hover align-middle mb-0">
            <thead class="table-light text-uppercase fs-7 text-muted">
              <tr>
                <th class="ps-3">Game Name</th>
                <th>Status</th>
                <th class="text-end pe-3">Date / Time</th>
              </tr>
            </thead>
            <tbody>
      `;

      historyData.forEach(item => {
        const gameId = item.game && item.game.gameid ? item.game.gameid : item.gameid;
        const gameName = item.game && item.game.gamename ? item.game.gamename : 'Game #' + gameId;
        const dateTime = item.game && item.game.startdatetime ? new Date(item.game.startdatetime).toLocaleString() : '--';
        
        const escapedGameName = escapeHtml(gameName).replace(/'/g, "\\'");

        historyHtml += `
          <tr>
            <td class="ps-3 fw-medium">
              <a href="#" class="text-primary text-decoration-none fw-semibold" onclick="openMatchParticipants(${gameId}, '${escapedGameName}'); return false;">
                <i class="bi bi-link-45deg me-1"></i>${escapeHtml(gameName)}
              </a>
            </td>
            <td><span class="badge bg-secondary bg-opacity-10 text-secondary border border-secondary">Completed / Logged</span></td>
            <td class="text-end pe-3 text-muted small">${dateTime}</td>
          </tr>
        `;
      });

      historyHtml += `
            </tbody>
          </table>
        </div>
      `;
      historicalMatchesContainer.innerHTML = historyHtml;
    }

  } catch (err) {
    console.error("Error loading history:", err);
    currentMatchContainer.innerHTML = `<div class="text-danger small text-center py-3">Failed to load current match details.</div>`;
    historicalMatchesContainer.innerHTML = `<div class="text-danger small text-center py-3">Failed to load historical matches.</div>`;
  }
}

// Open Specific Match Participants Tab when a Historical Game is Clicked
async function openMatchParticipants(gameId, gameName) {
  const container = document.getElementById('matchParticipantsContainer');
  const tabItem = document.getElementById('matchDetailTabItem');
  const tabTitle = document.getElementById('matchDetailTabTitle');
  const matchTabBtn = document.getElementById('match-detail-tab');

  tabTitle.textContent = gameName;
  if (tabItem) tabItem.style.display = 'block';
  
  container.innerHTML = `<div class="text-center py-4 text-muted"><span class="spinner-border spinner-border-sm me-2"></span>Loading participants for ${escapeHtml(gameName)}...</div>`;

  if (matchTabBtn) {
    new bootstrap.Tab(matchTabBtn).show();
  }

  try {
    // Fetch all queue/match records associated with this specific gameid
    const { data: participants, error } = await db
      .from('queue')
      .select('*, players(playerid, name, ratingid, gender)')
      .eq('gameid', gameId);

    if (error) throw error;

    if (!participants || participants.length === 0) {
      container.innerHTML = `
        <div class="text-center py-4 text-muted">
          <i class="bi bi-people fs-2 d-block mb-2"></i>
          No participant history found for this game session.
        </div>
      `;
      return;
    }

    let html = `
      <div class="alert alert-light border mb-3 py-2 px-3 small text-muted">
        Showing all players associated with <strong>${escapeHtml(gameName)}</strong> (Game ID: ${gameId})
      </div>
      <div class="table-responsive">
        <table class="table table-sm table-hover align-middle mb-0">
          <thead class="table-light text-uppercase fs-7 text-muted">
            <tr>
              <th class="ps-3">Player Name</th>
              <th>Rating</th>
              <th class="text-end pe-3">Gender</th>
            </tr>
          </thead>
          <tbody>
    `;

    participants.forEach(p => {
      const pName = p.players && p.players.name ? p.players.name : 'Unknown Player';
      const pRatingId = p.players && p.players.ratingid ? p.players.ratingid : null;
      const pGender = p.players && p.players.gender ? p.players.gender : '';

      let ratingBadge = '<span class="text-muted small">Unassigned</span>';
      if (pRatingId && RATING_MAP[pRatingId]) {
        ratingBadge = `<span class="badge bg-warning bg-opacity-25 text-dark border border-warning">${RATING_MAP[pRatingId].value} (${RATING_MAP[pRatingId].label})</span>`;
      }

      let genderBadge = '<span class="text-muted small">--</span>';
      if (pGender) {
        genderBadge = pGender === 'F' ? '<span class="badge bg-info bg-opacity-10 text-info border">Female (F)</span>' : '<span class="badge bg-primary bg-opacity-10 text-primary border">Male (M)</span>';
      }

      html += `
        <tr>
          <td class="ps-3 fw-semibold text-dark"><i class="bi bi-person me-1 text-secondary"></i>${escapeHtml(pName)}</td>
          <td>${ratingBadge}</td>
          <td class="text-end pe-3">${genderBadge}</td>
        </tr>
      `;
    });

    html += `
          </tbody>
        </table>
      </div>
    `;
    container.innerHTML = html;

  } catch (err) {
    console.error("Error loading match participants:", err);
    container.innerHTML = `<div class="text-danger small text-center py-3">Failed to load game participants.</div>`;
  }
}

// Back button handler to return to historical matches list tab
function backToHistoricalMatches() {
  const historicalTab = document.getElementById('historical-matches-tab');
  if (historicalTab) {
    new bootstrap.Tab(historicalTab).show();
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