// Players Page State
let allPlayers = [];
let activeSessionId = null; // Store active session if one exists
let activeMatchPlayerIds = new Set(); // Store player IDs currently in an active match
let playerModalInstance = null;
let historyModalInstance = null;
let deleteModalInstance = null;

document.addEventListener("DOMContentLoaded", async () => {
  initPageLayout("Manage Players");

  playerModalInstance = new bootstrap.Modal(document.getElementById('playerModal'));
  historyModalInstance = new bootstrap.Modal(document.getElementById('historyModal'));
  deleteModalInstance = new bootstrap.Modal(document.getElementById('deleteModal'));

  setupStarRatingListeners();

  await checkDbConnection();
  await fetchActiveSession(); // Find current active session
  await fetchActiveMatches(); // Find players currently in an active match
  await loadPlayers();
});

// Setup Star Rating Click and Hover Listeners
function setupStarRatingListeners() {
  const container = document.getElementById('starRatingContainer');
  if (!container) return;

  const stars = container.querySelectorAll('.style-star');
  stars.forEach((star, index) => {
    const starValue = index + 1;

    star.addEventListener('click', () => {
      setStarRating(starValue);
    });

    star.addEventListener('mouseenter', () => {
      stars.forEach((s, i) => {
        if (i < starValue) {
          s.classList.remove('bi-star');
          s.classList.add('bi-star-fill');
        } else {
          s.classList.remove('bi-star-fill');
          s.classList.add('bi-star');
        }
      });
    });
  });

  container.addEventListener('mouseleave', () => {
    const currentRating = document.getElementById('modalRatingId').value;
    if (currentRating) {
      setStarRating(parseInt(currentRating, 10));
    } else {
      resetStarRating();
    }
  });
}

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

// Fetch player IDs who are currently in an active match (EndDateTime IS NULL)
async function fetchActiveMatches() {
  try {
    activeMatchPlayerIds.clear();
    const { data, error } = await db
      .from('match')
      .select('matchid, playermatch(playerid)')
      .is('enddatetime', null);

    if (error) throw error;

    if (data && data.length > 0) {
      data.forEach(m => {
        if (m.playermatch && Array.isArray(m.playermatch)) {
          m.playermatch.forEach(pm => {
            if (pm.playerid) {
              activeMatchPlayerIds.add(pm.playerid);
            }
          });
        }
      });
    }
  } catch (err) {
    console.error("Error fetching active match players:", err);
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
    
    updateMetricsAndFilter();
  } catch (err) {
    console.error("Failed to load players:", err);
    if (subtitle) subtitle.textContent = `Error loading players`;
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-danger"><i class="bi bi-exclamation-triangle me-1"></i>Error loading players: ${escapeHtml(err.message)}</td></tr>`;
    }
  }
}

/**
 * Determine Player Status Key based on business rules:
 * 1. Checked IN: currentGameId NOT NULL, is_checked_in is TRUE, NOT in an active match
 * 2. Checked Out: currentGameId NOT NULL, is_checked_in is FALSE
 * 3. Available: currentGameId is NULL, is_checked_in is FALSE
 * 4. IN-MATCH: currentGameId NOT NULL, is_checked_in is TRUE, AND IS CURRENTLY IN AN ACTIVE MATCH
 */
function getPlayerStatusKey(player) {
  const isCheckedIn = player.is_checked_in === true || player.ischeckedin === true;
  const currentGameId = player.currentgameid;
  const hasGame = currentGameId !== null && currentGameId !== undefined;
  const isInActiveMatch = activeMatchPlayerIds.has(player.playerid);

  // Requirement 3: Available if currentGameId NULL and IS_CHECKED_IN IS FALSE
  if (!hasGame && !isCheckedIn) {
    return 'available';
  }

  // Requirement 2: Checked Out if currentGameId NOT NULL and IS_CHECKED_IN IS FALSE
  if (hasGame && !isCheckedIn) {
    return 'checked_out';
  }

  // When currentGameId is NOT NULL and IS_CHECKED_IN is TRUE
  if (hasGame && isCheckedIn) {
    // Requirement 5: IN-MATCH if currently in an active match
    if (isInActiveMatch) {
      return 'in_match';
    }
    // Requirement 1: Checked IN if not in an active match
    return 'checked_in';
  }

  return 'available';
}

// Calculate Metrics, Update Cards, and Filter Table
function filterPlayerTable() {
  updateMetricsAndFilter();
}

function updateMetricsAndFilter() {
  const query = document.getElementById('playerSearchInput').value.toLowerCase().trim();
  const statusFilter = document.getElementById('statusFilterSelect').value;
  const subtitle = document.getElementById('playerCountSubtitle');

  let counts = {
    total: allPlayers.length,
    available: 0,
    checked_in: 0,
    in_match: 0,
    checked_out: 0
  };

  allPlayers.forEach(p => {
    const key = getPlayerStatusKey(p);
    if (counts[key] !== undefined) {
      counts[key]++;
    }
  });

  // Update Metric Cards DOM
  const cntTotal = document.getElementById('cntTotal');
  const cntAvailable = document.getElementById('cntAvailable');
  const cntCheckedIn = document.getElementById('cntCheckedIn');
  const cntInMatch = document.getElementById('cntInGame') || document.getElementById('cntInMatch');
  const cntCheckedOut = document.getElementById('cntCheckedOut');

  if (cntTotal) cntTotal.textContent = counts.total;
  if (cntAvailable) cntAvailable.textContent = counts.available;
  if (cntCheckedIn) cntCheckedIn.textContent = counts.checked_in;
  if (cntInMatch) cntInMatch.textContent = counts.in_match;
  if (cntCheckedOut) cntCheckedOut.textContent = counts.checked_out;

  // Filter players based on search query and status dropdown
  const filtered = allPlayers.filter(p => {
    const matchesName = p.name.toLowerCase().includes(query);
    const key = getPlayerStatusKey(p);
    // Support legacy dropdown value 'in_game' mapped to 'in_match'
    const matchesStatus = (statusFilter === 'all' || key === statusFilter || (statusFilter === 'in_game' && key === 'in_match'));
    return matchesName && matchesStatus;
  });

  if (subtitle) {
    if (query || statusFilter !== 'all') {
      subtitle.textContent = `Showing ${filtered.length} of ${allPlayers.length} registered player(s)`;
    } else {
      subtitle.textContent = `${allPlayers.length} total registered player(s)`;
    }
  }

  renderPlayerTable(filtered);
}

// Render Table
function renderPlayerTable(players) {
  const tbody = document.getElementById('playerTableBody');
  if (!tbody) return;

  if (players.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-muted">No players found matching criteria.</td></tr>`;
    return;
  }

  tbody.innerHTML = '';

  players.forEach(player => {
    const tr = document.createElement('tr');

    let ratingBadge = '<span class="text-muted small">Unassigned</span>';
    if (player.ratingid && typeof RATING_MAP !== 'undefined' && RATING_MAP[player.ratingid]) {
      ratingBadge = `<span class="badge bg-warning bg-opacity-25 text-dark border border-warning"><i class="bi bi-star-fill text-warning me-1"></i>${RATING_MAP[player.ratingid].value} (${RATING_MAP[player.ratingid].label})</span>`;
    }

    let genderBadge = '<span class="text-muted small">--</span>';
    if (player.gender) {
      genderBadge = player.gender === 'F' ? '<span class="badge bg-info bg-opacity-10 text-info border border-info">Female (F)</span>' : '<span class="badge bg-primary bg-opacity-10 text-primary border border-primary">Male (M)</span>';
    }

    const statusKey = getPlayerStatusKey(player);
    let statusBadge = '';
    if (statusKey === 'available') {
      statusBadge = `<span class="badge bg-success bg-opacity-10 text-success border border-success">Available</span>`;
    } else if (statusKey === 'checked_out') {
      statusBadge = `<span class="badge bg-secondary bg-opacity-10 text-secondary border border-secondary">Checked Out</span>`;
    } else if (statusKey === 'in_match') {
      statusBadge = `<span class="badge bg-primary bg-opacity-10 text-primary border border-primary">IN-MATCH</span>`;
    } else {
      statusBadge = `<span class="badge bg-warning bg-opacity-10 text-dark border border-warning">Checked In</span>`;
    }

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
          <button type="button" class="btn btn-outline-secondary" title="View History" onclick="openHistoryModal(${player.playerid})">
            <i class="bi bi-eye"></i>
          </button>
          <button type="button" class="btn btn-outline-primary" title="Edit Player" onclick="openEditPlayerModal(${player.playerid})">
            <i class="bi bi-pencil"></i>
          </button>
          <button type="button" class="btn btn-outline-danger" title="Delete Player" onclick="openDeletePlayerModal(${player.playerid})">
            <i class="bi bi-trash"></i>
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
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
  const singlePane = document.getElementById('single-modal-pane');
  const multiTab = document.getElementById('multi-modal-tab');
  const multiPane = document.getElementById('multi-modal-pane');

  if (singleTab) singleTab.classList.add('active');
  if (singlePane) singlePane.classList.add('show', 'active');
  if (multiTab) multiTab.classList.remove('active');
  if (multiPane) multiPane.classList.remove('show', 'active');

  const playerForm = document.getElementById('playerForm');
  if (playerForm) playerForm.classList.remove('d-none');

  clearMultiLineText();
  resetStarRating();
  
  playerModalInstance.show();
}

function openEditPlayerModal(playerId) {
  const player = allPlayers.find(p => p.playerid === playerId);
  if (!player) return;

  const tabsContainer = document.getElementById('playerEntryTabsContainer');
  if (tabsContainer) tabsContainer.style.display = 'none';

  document.getElementById('playerModalTitle').innerHTML = `<i class="bi bi-pencil-square text-primary me-2"></i>Edit Player`;
  document.getElementById('modalPlayerId').value = player.playerid;
  document.getElementById('modalPlayerName').value = player.name || '';
  document.getElementById('modalPlayerGender').value = player.gender || '';

  const singlePane = document.getElementById('single-modal-pane');
  const multiPane = document.getElementById('multi-modal-pane');
  if (singlePane && multiPane) {
    singlePane.classList.add('show', 'active');
    multiPane.classList.remove('show', 'active');
  }

  const playerForm = document.getElementById('playerForm');
  if (playerForm) playerForm.classList.remove('d-none');

  if (player.ratingid) {
    setStarRating(parseInt(player.ratingid, 10));
  } else {
    resetStarRating();
  }

  playerModalInstance.show();
}

// BULK MULTI-LINE PLAYER IMPORT LOGIC
function updateMultiLineCounter() {
  const rawText = document.getElementById('multiPlayerInput').value;
  const names = parseLinesToNames(rawText);
  const counterEl = document.getElementById('multiLineCounter');
  if (counterEl) counterEl.textContent = `${names.length} player name(s) detected`;
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
    const payload = newNames.map(name => ({
      name: name,
      ratingid: null,
      gender: null
    }));

    const { error } = await db.from('players').insert(payload);
    if (error) throw error;

    showToast(`Successfully added ${newNames.length} player(s) to directory!`, "success");
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
  const badge = document.getElementById('ratingValueBadge');
  if (badge) badge.textContent = 'Unassigned';
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

  const ratingInfo = (typeof RATING_MAP !== 'undefined' && RATING_MAP[starCount]) ? RATING_MAP[starCount] : { ratingid: starCount, label: `Level ${starCount}` };
  document.getElementById('modalRatingId').value = ratingInfo.ratingid || starCount;
  const badge = document.getElementById('ratingValueBadge');
  if (badge) badge.textContent = ratingInfo.label;
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
function openDeletePlayerModal(playerId) {
  const player = allPlayers.find(p => p.playerid === playerId);
  if (!player) return;

  document.getElementById('deletePlayerId').value = player.playerid;
  document.getElementById('deletePlayerName').textContent = player.name;
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
async function openHistoryModal(playerId) {
  const playerRecord = allPlayers.find(p => p.playerid === playerId);
  const playerName = playerRecord ? playerRecord.name : 'Unknown Player';

  document.getElementById('historyPlayerName').textContent = playerName;
  
  const currentMatchContainer = document.getElementById('currentMatchContainer');
  const historicalMatchesContainer = document.getElementById('historicalMatchesContainer');
  const matchDetailTabItem = document.getElementById('matchDetailTabItem');

  if (matchDetailTabItem) matchDetailTabItem.style.display = 'none';

  if (currentMatchContainer) {
    currentMatchContainer.innerHTML = `<div class="text-center py-4 text-muted"><span class="spinner-border spinner-border-sm me-2"></span>Loading current match...</div>`;
  }
  if (historicalMatchesContainer) {
    historicalMatchesContainer.innerHTML = `<div class="text-center py-4 text-muted"><span class="spinner-border spinner-border-sm me-2"></span>Loading historical matches...</div>`;
  }
  
  const currentMatchTab = document.getElementById('current-match-tab');
  const currentMatchPane = document.getElementById('current-match-pane');
  const historicalMatchesTab = document.getElementById('historical-matches-tab');
  const historicalMatchesPane = document.getElementById('historical-matches-pane');
  const matchDetailTab = document.getElementById('match-detail-tab');
  const matchDetailPane = document.getElementById('match-detail-pane');

  if (currentMatchTab) currentMatchTab.classList.add('active');
  if (currentMatchPane) currentMatchPane.classList.add('show', 'active');
  if (historicalMatchesTab) historicalMatchesTab.classList.remove('active');
  if (historicalMatchesPane) historicalMatchesPane.classList.remove('show', 'active');
  if (matchDetailTab) matchDetailTab.classList.remove('active');
  if (matchDetailPane) matchDetailPane.classList.remove('show', 'active');

  historyModalInstance.show();

  try {
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
          Player is not currently assigned to an active session.
        </div>
      `;
    }

    const { data: historyData, error: historyError } = await db
      .from('playermatch')
      .select('*, match(*, game(gameid, gamename, startdatetime))')
      .eq('playerid', playerId);

    if (historyError || !historyData || historyData.length === 0) {
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
                <th class="ps-3">Game / Match</th>
                <th>Status</th>
                <th class="text-end pe-3">Date / Time</th>
              </tr>
            </thead>
            <tbody>
      `;

      historyData.forEach(item => {
        const matchObj = item.match || {};
        const gameObj = matchObj.game || {};
        const gameId = gameObj.gameid || matchObj.gameid || '--';
        const gameName = gameObj.gamename || ('Match #' + (matchObj.matchid || item.matchid));
        const dateTime = matchObj.startdatetime ? new Date(matchObj.startdatetime).toLocaleString() : '--';
        const escapedGameName = escapeHtml(gameName).replace(/'/g, "\\&#39;").replace(/"/g, "&quot;");

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
    if (currentMatchContainer) currentMatchContainer.innerHTML = `<div class="text-danger small text-center py-3">Failed to load current match details.</div>`;
    if (historicalMatchesContainer) historicalMatchesContainer.innerHTML = `<div class="text-danger small text-center py-3">Failed to load historical matches.</div>`;
  }
}

// Open Specific Match Participants Tab when a Historical Game is Clicked
async function openMatchParticipants(gameId, gameName) {
  const container = document.getElementById('matchParticipantsContainer');
  const tabItem = document.getElementById('matchDetailTabItem');
  const tabTitle = document.getElementById('matchDetailTabTitle');

  if (tabTitle) tabTitle.textContent = gameName;
  if (tabItem) tabItem.style.display = 'block';
  
  if (container) {
    container.innerHTML = `<div class="text-center py-4 text-muted"><span class="spinner-border spinner-border-sm me-2"></span>Loading participants for ${escapeHtml(gameName)}...</div>`;
  }

  const matchDetailTab = document.getElementById('match-detail-tab');
  const matchDetailPane = document.getElementById('match-detail-pane');
  const currentMatchTab = document.getElementById('current-match-tab');
  const currentMatchPane = document.getElementById('current-match-pane');
  const historicalMatchesTab = document.getElementById('historical-matches-tab');
  const historicalMatchesPane = document.getElementById('historical-matches-pane');

  if (currentMatchTab) currentMatchTab.classList.remove('active');
  if (currentMatchPane) currentMatchPane.classList.remove('show', 'active');
  if (historicalMatchesTab) historicalMatchesTab.classList.remove('active');
  if (historicalMatchesPane) historicalMatchesPane.classList.remove('show', 'active');
  if (matchDetailTab) matchDetailTab.classList.add('active');
  if (matchDetailPane) matchDetailPane.classList.add('show', 'active');

  try {
    const { data: participants, error } = await db
      .from('playermatch')
      .select('*, match!inner(*), players(playerid, name, ratingid, gender)')
      .eq('match.gameid', gameId);

    if (error) throw error;

    if (!participants || participants.length === 0) {
      if (container) {
        container.innerHTML = `
          <div class="text-center py-4 text-muted">
            <i class="bi bi-people fs-2 d-block mb-2"></i>
            No participant history found for this game session.
          </div>
        `;
      }
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
      if (pRatingId && typeof RATING_MAP !== 'undefined' && RATING_MAP[pRatingId]) {
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
    if (container) container.innerHTML = html;

  } catch (err) {
    console.error("Error loading match participants:", err);
    if (container) container.innerHTML = `<div class="text-danger small text-center py-3">Failed to load game participants.</div>`;
  }
}

// Back button handler to return to historical matches list tab
function backToHistoricalMatches() {
  const historicalTab = document.getElementById('historical-matches-tab');
  const historicalPane = document.getElementById('historical-matches-pane');
  const matchDetailTab = document.getElementById('match-detail-tab');
  const matchDetailPane = document.getElementById('match-detail-pane');

  if (matchDetailTab) matchDetailTab.classList.remove('active');
  if (matchDetailPane) matchDetailPane.classList.remove('show', 'active');
  if (historicalTab) historicalTab.classList.add('active');
  if (historicalPane) historicalPane.classList.add('show', 'active');
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