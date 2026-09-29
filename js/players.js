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
  // Show tabs container for adding new players
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
  // Hide tabs container for editing single player records
  const tabsContainer = document.getElementById('playerEntryTabsContainer');
  if (tabsContainer) tabsContainer.style.display = 'none';

  document.getElementById('playerModalTitle').innerHTML = `<i class="bi bi-pencil-square text-primary me-2"></i>Edit Player`;
  document.getElementById('modalPlayerId').value = playerId;
  document.getElementById('modalPlayerName').value = name;
  document.getElementById('modalPlayerGender').value = gender;

  // Ensure single player pane is active and multi pane is inactive
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

// -------------------------------------------------------------
// BULK MULTI-LINE PLAYER IMPORT LOGIC
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

// View History Handlers
async function openHistoryModal(playerId, playerName) {
  document.getElementById('historyPlayerName').textContent = playerName;
  const container = document.getElementById('historyContentContainer');
  container.innerHTML = `<div class="text-center py-4 text-muted"><span class="spinner-border spinner-border-sm me-2"></span>Loading history...</div>`;
  
  historyModalInstance.show();

  try {
    const playerRecord = allPlayers.find(p => p.playerid === playerId);
    
    if (playerRecord && playerRecord.currentgameid) {
      const { data: gameData } = await db.from('game').select('*').eq('gameid', playerRecord.currentgameid).single();
      
      container.innerHTML = `
        <div class="alert alert-info mb-3">
          <i class="bi bi-info-circle-fill me-1"></i> Player is currently connected to an active game session.
        </div>
        <div class="p-3 bg-light rounded border">
          <div class="fw-bold text-primary">${escapeHtml(gameData ? gameData.gamename : 'Active Session')}</div>
          <div class="text-muted small mt-1">Game ID: ${playerRecord.currentgameid}</div>
          <div class="text-muted small">Started: ${gameData ? new Date(gameData.startdatetime).toLocaleString() : '--'}</div>
        </div>
      `;
    } else {
      container.innerHTML = `
        <div class="text-center py-4 text-muted">
          <i class="bi bi-inbox fs-2 d-block mb-2"></i>
          No active games currently recorded for this player. Match history logs will appear here.
        </div>
      `;
    }
  } catch (err) {
    console.error("Error loading history:", err);
    container.innerHTML = `<div class="text-danger small">Failed to load history details.</div>`;
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