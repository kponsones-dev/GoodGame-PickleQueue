// Static GameType mapping for fast lookup fallback
const GAME_TYPE_MAP = {
  1: "Social Mix",
  2: "Skill Separated",
  3: "Winners/Losers",
  4: "Mixed Gender"
};

// Queue Page State
let allPlayers = [];
let sessionCourts = [];
let playerStatsMap = {}; // { playerId: { matches: 0, wins: 0, losses: 0 } }
let activeSessionId = null;
let activeSessionData = null;
let editPlayerModalInstance = null;
let clearRosterModalInstance = null;
let addCourtModalInstance = null;

document.addEventListener("DOMContentLoaded", async () => {
  // Initialize layout.js header & footer
  initPageLayout("Queue & Matchmaking");

  editPlayerModalInstance = new bootstrap.Modal(document.getElementById('editPlayerModal'));
  clearRosterModalInstance = new bootstrap.Modal(document.getElementById('clearRosterModal'));
  addCourtModalInstance = new bootstrap.Modal(document.getElementById('addCourtModal'));

  setupSearchAutocompleteListener();

  await checkDbConnection();
  await fetchActiveSession();
  await loadQueueData();
  await loadCourtsData();
});

// Fetch active session and matchmaking game type
async function fetchActiveSession() {
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const gameIdParam = urlParams.get('gameid');

    let query = db.from('game').select('*, gametype(gametypeid, name)').is('enddatetime', null);

    if (gameIdParam) {
      query = query.eq('gameid', gameIdParam);
    } else {
      query = query.order('startdatetime', { ascending: false }).limit(1);
    }

    const { data, error } = await query;

    if (error) throw error;
    if (data && data.length > 0) {
      activeSessionData = data[0];
      activeSessionId = activeSessionData.gameid;

      // Update session title
      const titleEl = document.getElementById('sessionTitleDisplay');
      if (titleEl) titleEl.textContent = activeSessionData.gamename || "Active Matchmaking Session";

      // Update matchmaking mode badge
      const badgeEl = document.getElementById('sessionTypeBadge');
      if (badgeEl) {
        let typeName = "Standard";
        if (activeSessionData.gametype && activeSessionData.gametype.name) {
          typeName = activeSessionData.gametype.name;
        } else if (activeSessionData.gametypeid && GAME_TYPE_MAP[activeSessionData.gametypeid]) {
          typeName = GAME_TYPE_MAP[activeSessionData.gametypeid];
        }
        badgeEl.innerHTML = `<i class="bi bi-controller me-1"></i> Mode: <strong>${escapeHtml(typeName)}</strong>`;
      }
    } else {
      const titleEl = document.getElementById('sessionTitleDisplay');
      if (titleEl) titleEl.textContent = "No Active Session Found";

      const badgeEl = document.getElementById('sessionTypeBadge');
      if (badgeEl) badgeEl.innerHTML = `<i class="bi bi-exclamation-triangle me-1"></i> No Active Session`;
    }
  } catch (err) {
    console.error("Error fetching active session:", err);
    showToast("Error fetching active session", "danger");
  }
}

// Fetch session courts
async function loadCourtsData() {
  const container = document.getElementById('courtsContainer');
  if (!container || !activeSessionId) return;

  try {
    const { data, error } = await db
      .from('courts')
      .select('*')
      .eq('gameid', activeSessionId)
      .order('courtid', { ascending: true });

    if (error) throw error;

    sessionCourts = data || [];
    renderCourtsUI();
  } catch (err) {
    console.warn("Could not load courts from DB (make sure courts table exists):", err.message);
    container.innerHTML = `<div class="col-12 text-center py-2 text-muted small"><i class="bi bi-info-circle me-1"></i>No courts configured yet. Click "Add Court" to set up courts.</div>`;
  }
}

// Render courts UI
function renderCourtsUI() {
  const container = document.getElementById('courtsContainer');
  if (!container) return;

  if (sessionCourts.length === 0) {
    container.innerHTML = `
      <div class="col-12 text-center py-3 text-muted small">
        <i class="bi bi-bounding-box-circles fs-3 opacity-50 d-block mb-1"></i>
        No courts added to this session. Click <strong>"Add Court"</strong> above to create courts.
      </div>`;
    return;
  }

  container.innerHTML = '';

  sessionCourts.forEach(court => {
    const col = document.createElement('div');
    col.className = 'col-6 col-sm-4 col-md-3 col-lg-2';

    col.innerHTML = `
      <div class="card h-100 border text-center shadow-sm">
        <div class="card-body p-3 d-flex flex-column justify-content-between align-items-center">
          <div class="d-flex justify-content-between align-items-center w-100 mb-2">
            <span class="badge ${court.isactive ? 'bg-success bg-opacity-10 text-success border-success' : 'bg-secondary bg-opacity-10 text-secondary'} border" style="font-size:0.65rem;">
              ${court.isactive ? 'Active' : 'Inactive'}
            </span>
            <i class="bi bi-trash text-muted text-hover-danger" style="cursor:pointer;" onclick="deleteCourt(${court.courtid})" title="Delete Court"></i>
          </div>
          <i class="bi bi-bounding-box-circles fs-2 text-primary mb-1"></i>
          <h6 class="fw-bold mb-0 text-dark text-truncate w-100">${escapeHtml(court.courtname)}</h6>
        </div>
      </div>
    `;

    container.appendChild(col);
  });
}

// Add new court
async function handleAddCourt() {
  const input = document.getElementById('courtNameInput');
  const courtName = input.value.trim();
  const btn = document.getElementById('saveCourtBtn');

  if (!courtName || !activeSessionId) {
    showToast("Please enter a valid court name.", "warning");
    return;
  }

  btn.disabled = true;

  try {
    const { error } = await db
      .from('courts')
      .insert([{ gameid: activeSessionId, courtname: courtName, isactive: true }]);

    if (error) throw error;

    showToast(`Added "${courtName}" successfully!`, "success");
    input.value = '';
    addCourtModalInstance.hide();
    await loadCourtsData();
  } catch (err) {
    console.error("Failed to add court:", err);
    showToast("Failed to add court: " + err.message, "danger");
  } finally {
    btn.disabled = false;
  }
}

// Delete court
async function deleteCourt(courtId) {
  try {
    const { error } = await db
      .from('courts')
      .delete()
      .eq('courtid', courtId);

    if (error) throw error;

    showToast("Court deleted.", "info");
    await loadCourtsData();
  } catch (err) {
    console.error("Failed to delete court:", err);
    showToast("Failed to delete court: " + err.message, "danger");
  }
}

// Fetch and calculate matches, wins, losses per player for current session
async function fetchSessionPlayerStats() {
  playerStatsMap = {};
  if (!activeSessionId) return;

  try {
    const { data: matches, error } = await db
      .from('match')
      .select('*')
      .eq('gameid', activeSessionId);

    if (error || !matches) return;

    matches.forEach(m => {
      const team1 = m.team1_players || [];
      const team2 = m.team2_players || [];
      const winner = m.winning_team;

      const allMatchPlayers = [...team1, ...team2];

      allMatchPlayers.forEach(pId => {
        if (!playerStatsMap[pId]) {
          playerStatsMap[pId] = { matches: 0, wins: 0, losses: 0 };
        }
        playerStatsMap[pId].matches += 1;

        if (winner === 1 && team1.includes(pId)) {
          playerStatsMap[pId].wins += 1;
        } else if (winner === 2 && team2.includes(pId)) {
          playerStatsMap[pId].wins += 1;
        } else if (winner) {
          playerStatsMap[pId].losses += 1;
        }
      });
    });
  } catch (err) {
    console.warn("Could not calculate match stats:", err.message);
  }
}

// Load all players and session roster
async function loadQueueData() {
  try {
    const { data, error } = await db
      .from('players')
      .select('*')
      .order('name', { ascending: true });

    if (error) throw error;

    allPlayers = data || [];
    await fetchSessionPlayerStats();
    renderQueueUI();
  } catch (err) {
    console.error("Failed to load queue data:", err);
    showToast("Error loading players: " + err.message, "danger");
  }
}

// Render Session Players Pool & Checked Out List matching UI
function renderQueueUI() {
  renderActiveQueuePool();
  renderCheckedOutList();
}

// Render active pool chips
function renderActiveQueuePool() {
  const container = document.getElementById('rosterContainer');
  const badge = document.getElementById('queuePlayerCountBadge');
  const clearBtn = document.getElementById('clearRosterBtn');

  if (!container) return;

  if (!activeSessionId) {
    container.innerHTML = `<span class="text-muted small italic w-100 text-center">No active session found.</span>`;
    if (badge) badge.textContent = "0 Players";
    return;
  }

  const sessionPlayers = allPlayers.filter(p => p.currentgameid === activeSessionId && p.is_checked_in !== false);

  if (badge) badge.textContent = `${sessionPlayers.length} Player${sessionPlayers.length === 1 ? '' : 's'}`;

  if (sessionPlayers.length === 0) {
    container.innerHTML = `<span class="text-muted small italic w-100 text-center">No active players in pool. Search above or check in players below.</span>`;
    if (clearBtn) clearBtn.classList.add('d-none');
    return;
  }

  if (clearBtn) clearBtn.classList.remove('d-none');
  container.innerHTML = '';

  sessionPlayers.forEach((player) => {
    const tag = document.createElement('div');
    tag.className = 'badge bg-white text-dark border shadow-sm player-tag d-flex align-items-center gap-2 p-2';
    
    const idBadge = player.playerid 
      ? `<span class="badge bg-secondary bg-opacity-10 text-secondary border ms-1" style="font-size:0.65rem;">ID: ${player.playerid}</span>` 
      : '';

    let ratingBadge = '';
    if (player.ratingid && typeof RATING_MAP !== 'undefined' && RATING_MAP[player.ratingid]) {
      const r = RATING_MAP[player.ratingid];
      const displayVal = r.value || r.label || player.ratingid;
      ratingBadge = `<span class="badge bg-warning bg-opacity-25 text-dark border border-warning" style="font-size:0.65rem;"><i class="bi bi-star-fill text-warning me-1"></i>${escapeHtml(displayVal)}</span>`;
    }

    let genderBadge = '';
    if (player.gender) {
      const genderText = player.gender === 'F' ? 'Female (F)' : 'Male (M)';
      genderBadge = `<span class="badge bg-info bg-opacity-10 text-info border border-info" style="font-size:0.65rem;">${genderText}</span>`;
    }

    tag.innerHTML = `
      <i class="bi bi-person-fill text-primary"></i>
      <span class="fw-semibold text-dark">${escapeHtml(player.name)}</span>
      ${ratingBadge}
      ${genderBadge}
      ${idBadge}
      <i class="bi bi-box-arrow-right text-warning ms-1" style="cursor:pointer;" onclick="checkOutPlayer(${player.playerid})" title="Check Out Player"></i>
      <i class="bi bi-pencil-fill text-muted text-hover-primary ms-1" style="cursor:pointer;" onclick="openEditPlayerModal(${player.playerid})" title="Edit Player"></i>
      <i class="bi bi-x-circle-fill text-muted text-hover-danger" style="cursor:pointer;" onclick="removePlayerFromSession(${player.playerid})" title="Remove from session"></i>
    `;
    container.appendChild(tag);
  });
}

// Render Checked Out Players list
function renderCheckedOutList() {
  const container = document.getElementById('checkedOutContainer');
  const badge = document.getElementById('checkedOutPlayerCountBadge');

  if (!container) return;

  const checkedOutPlayers = allPlayers.filter(p => p.currentgameid === activeSessionId && p.is_checked_in === false);

  if (badge) badge.textContent = `${checkedOutPlayers.length} Player${checkedOutPlayers.length === 1 ? '' : 's'}`;

  if (checkedOutPlayers.length === 0) {
    container.innerHTML = `<span class="text-muted small italic text-center py-3">No checked out players.</span>`;
    return;
  }

  container.innerHTML = '';

  checkedOutPlayers.forEach(player => {
    const stats = playerStatsMap[player.playerid] || { matches: 0, wins: 0, losses: 0 };

    const row = document.createElement('div');
    row.className = 'd-flex flex-column flex-sm-row justify-content-between align-items-sm-center bg-light border rounded p-2 px-3 gap-2';

    row.innerHTML = `
      <div class="d-flex align-items-center gap-2 flex-wrap">
        <span class="badge bg-secondary bg-opacity-10 text-secondary border border-secondary px-2 py-1">
          <i class="bi bi-person-dash me-1"></i>Checked Out
        </span>
        <span class="fw-bold text-dark fs-6">${escapeHtml(player.name)}</span>
      </div>

      <div class="d-flex align-items-center gap-3 flex-wrap justify-content-between justify-content-sm-end">
        <div class="d-flex align-items-center gap-1 small">
          <span class="badge bg-white text-dark border px-2 py-1" title="Total Matches Played">
            Matches: <strong>${stats.matches}</strong>
          </span>
          <span class="badge bg-success bg-opacity-10 text-success border border-success px-2 py-1" title="Wins">
            W: <strong>${stats.wins}</strong>
          </span>
          <span class="badge bg-danger bg-opacity-10 text-danger border border-danger px-2 py-1" title="Losses">
            L: <strong>${stats.losses}</strong>
          </span>
        </div>

        <button type="button" class="btn btn-sm btn-success d-flex align-items-center gap-1 fw-medium" onclick="checkInPlayer(${player.playerid})">
          <i class="bi bi-box-arrow-in-right"></i> Check In
        </button>
      </div>
    `;

    container.appendChild(row);
  });
}

// Actions: Check In / Check Out
async function checkInPlayer(playerId) {
  try {
    const { error } = await db
      .from('players')
      .update({ is_checked_in: true })
      .eq('playerid', playerId);

    if (error) throw error;

    const player = allPlayers.find(p => p.playerid === playerId);
    if (player) player.is_checked_in = true;

    showToast("Player checked in!", "success");
    renderQueueUI();
  } catch (err) {
    console.error("Error checking in player:", err);
    const player = allPlayers.find(p => p.playerid === playerId);
    if (player) player.is_checked_in = true;
    renderQueueUI();
  }
}

async function checkOutPlayer(playerId) {
  try {
    const { error } = await db
      .from('players')
      .update({ is_checked_in: false })
      .eq('playerid', playerId);

    if (error) throw error;

    const player = allPlayers.find(p => p.playerid === playerId);
    if (player) player.is_checked_in = false;

    showToast("Player checked out.", "info");
    renderQueueUI();
  } catch (err) {
    console.error("Error checking out player:", err);
    const player = allPlayers.find(p => p.playerid === playerId);
    if (player) player.is_checked_in = false;
    renderQueueUI();
  }
}

// Live Search & Autocomplete Listener
function setupSearchAutocompleteListener() {
  const input = document.getElementById('singlePlayerInput');
  const dropdown = document.getElementById('autocompleteDropdown');
  let debounceTimer = null;

  if (!input) return;

  input.addEventListener('input', (e) => {
    const query = e.target.value.trim();

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

function searchPlayersInDb(query) {
  const dropdown = document.getElementById('autocompleteDropdown');

  db.from('players')
    .select('playerid, name, gender, ratingid, currentgameid')
    .ilike('name', `%${query}%`)
    .limit(5)
    .then(({ data, error }) => {
      if (error) throw error;

      dropdown.innerHTML = '';

      if (data && data.length > 0) {
        data.forEach(player => {
          if (player.currentgameid === activeSessionId) return;

          const item = document.createElement('div');
          item.className = 'autocomplete-item border-bottom d-flex justify-content-between align-items-center p-2 bg-white';
          item.style.cursor = 'pointer';

          const idBadge = `<span class="badge bg-secondary bg-opacity-10 text-secondary border ms-1" style="font-size:0.65rem;">ID: ${player.playerid}</span>`;
          
          let ratingBadge = '';
          if (player.ratingid && typeof RATING_MAP !== 'undefined' && RATING_MAP[player.ratingid]) {
            const r = RATING_MAP[player.ratingid];
            const displayVal = r.value || r.label || player.ratingid;
            ratingBadge = `<span class="badge bg-warning bg-opacity-25 text-dark border border-warning" style="font-size:0.65rem;"><i class="bi bi-star-fill text-warning me-1"></i>${escapeHtml(displayVal)}</span>`;
          }

          let genderBadge = '';
          if (player.gender) {
            const genderText = player.gender === 'F' ? 'Female (F)' : 'Male (M)';
            genderBadge = `<span class="badge bg-info bg-opacity-10 text-info border border-info" style="font-size:0.65rem;">${genderText}</span>`;
          }

          item.innerHTML = `
            <div class="d-flex align-items-center gap-2 flex-wrap">
              <i class="bi bi-person-fill text-primary"></i>
              <span class="fw-semibold text-dark">${escapeHtml(player.name)}</span>
              ${ratingBadge}
              ${genderBadge}
              ${idBadge}
            </div>
          `;
          
          item.onclick = () => addPlayerToSession(player.playerid);
          dropdown.appendChild(item);
        });
      } else {
        const item = document.createElement('div');
        item.className = 'autocomplete-item text-muted small p-2 bg-white';
        item.innerHTML = `<i class="bi bi-info-circle me-1"></i>No existing player found. Click "Add New Player" to create.`;
        dropdown.appendChild(item);
      }

      dropdown.classList.remove('d-none');
    })
    .catch(err => {
      console.error("Autocomplete search error:", err);
    });
}

async function addSinglePlayerFromInput() {
  const input = document.getElementById('singlePlayerInput');
  const btn = document.getElementById('addSinglePlayerBtn');
  const name = input.value.trim();

  if (!name) {
    showToast("Please enter a player name.", "warning");
    return;
  }

  btn.disabled = true;
  btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span>Processing...`;

  try {
    const { data: existingDbPlayers, error: searchErr } = await db
      .from('players')
      .select('playerid, name, currentgameid')
      .ilike('name', name);

    if (searchErr) throw searchErr;

    const exactMatch = existingDbPlayers ? existingDbPlayers.find(p => p.name.trim().toLowerCase() === name.toLowerCase()) : null;

    if (exactMatch) {
      await addPlayerToSession(exactMatch.playerid);
      input.value = '';
    } else {
      const { data: newData, error: insertErr } = await db
        .from('players')
        .insert([{ name: name, ratingid: null, gender: null, currentgameid: activeSessionId, is_checked_in: true }])
        .select();

      if (insertErr) throw insertErr;

      showToast(`Created new player "${name}" and added to session!`, "success");
      input.value = '';
      await loadQueueData();
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

async function addPlayerToSession(playerId) {
  if (!activeSessionId) {
    showToast("No active session found.", "warning");
    return;
  }

  try {
    const { error } = await db
      .from('players')
      .update({ currentgameid: activeSessionId, is_checked_in: true })
      .eq('playerid', playerId);

    if (error) throw error;

    document.getElementById("singlePlayerInput").value = '';
    document.getElementById("autocompleteDropdown").classList.add("d-none");
    showToast("Player added to session successfully!", "success");
    await loadQueueData();
  } catch (err) {
    console.error("Error adding player to session:", err);
    showToast("Failed to add player: " + err.message, "danger");
  }
}

async function removePlayerFromSession(playerId) {
  try {
    const { error } = await db
      .from('players')
      .update({ currentgameid: null, is_checked_in: null })
      .eq('playerid', playerId);

    if (error) throw error;

    showToast("Player removed from session.", "info");
    await loadQueueData();
  } catch (err) {
    console.error("Error removing player from session:", err);
    showToast("Failed to remove player: " + err.message, "danger");
  }
}

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

  btn.disabled = true;
  btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span>Processing...`;

  try {
    let addedCount = 0;

    for (let name of names) {
      const { data: existingDbPlayers } = await db.from('players').select('playerid, name').ilike('name', name);
      const exactMatch = existingDbPlayers ? existingDbPlayers.find(p => p.name.trim().toLowerCase() === name.toLowerCase()) : null;

      if (exactMatch) {
        await db.from('players').update({ currentgameid: activeSessionId, is_checked_in: true }).eq('playerid', exactMatch.playerid);
        addedCount++;
      } else {
        const { data: newData } = await db.from('players').insert([{ name: name, ratingid: null, gender: null, currentgameid: activeSessionId, is_checked_in: true }]).select();
        if (newData && newData.length > 0) {
          addedCount++;
        }
      }
    }

    showToast(`Successfully added ${addedCount} player(s) to session!`, "success");
    clearMultiLineText();
    await loadQueueData();

    const singleTab = new bootstrap.Tab(document.getElementById('single-tab'));
    singleTab.show();
  } catch (err) {
    console.error("Failed bulk player insert:", err);
    showToast("Error saving bulk players: " + err.message, "danger");
  } finally {
    btn.disabled = false;
    btn.textContent = 'Add All To Session';
  }
}

function confirmClearRoster() {
  const sessionPlayers = allPlayers.filter(p => p.currentgameid === activeSessionId);
  if (sessionPlayers.length > 0) {
    clearRosterModalInstance.show();
  }
}

async function executeClearRoster() {
  if (!activeSessionId) return;

  try {
    const { error } = await db
      .from('players')
      .update({ currentgameid: null, is_checked_in: null })
      .eq('currentgameid', activeSessionId);

    if (error) throw error;

    clearRosterModalInstance.hide();
    showToast("All players removed from session.", "info");
    await loadQueueData();
  } catch (err) {
    console.error("Error clearing session roster:", err);
    showToast("Failed to clear roster: " + err.message, "danger");
  }
}

function resetStarRating() {
  const stars = document.querySelectorAll('#starRatingContainer .style-star');
  stars.forEach(s => {
    s.classList.remove('bi-star-fill');
    s.classList.add('bi-star');
  });
  document.getElementById('editPlayerRatingId').value = '';
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

  const ratingInfo = (typeof RATING_MAP !== 'undefined' && RATING_MAP[starCount]) 
    ? RATING_MAP[starCount] 
    : { ratingid: starCount, label: "Unassigned" };
  
  document.getElementById('editPlayerRatingId').value = ratingInfo.ratingid !== undefined ? ratingInfo.ratingid : starCount;
  document.getElementById('ratingValueBadge').textContent = ratingInfo.label || ratingInfo.value || 'Unassigned';
}

function openEditPlayerModal(playerId) {
  const player = allPlayers.find(p => p.playerid === playerId);
  if (!player) return;

  document.getElementById('editPlayerIndex').value = player.playerid;
  document.getElementById('editPlayerName').value = player.name || '';
  document.getElementById('editPlayerGender').value = player.gender || '';

  if (player.ratingid && typeof RATING_MAP !== 'undefined') {
    const ratingKey = parseInt(player.ratingid, 10);
    setStarRating(ratingKey);
  } else {
    resetStarRating();
  }

  editPlayerModalInstance.show();
}

async function savePlayerEdit() {
  const playerId = document.getElementById('editPlayerIndex').value;
  const newName = document.getElementById('editPlayerName').value.trim();
  const rawRatingId = document.getElementById('editPlayerRatingId').value;
  const rawGender = document.getElementById('editPlayerGender').value;
  const saveBtn = document.getElementById('saveEditBtn');

  if (!newName) {
    showToast("Player name cannot be empty.", "warning");
    return;
  }

  const newRatingId = rawRatingId ? parseInt(rawRatingId, 10) : null;
  const newGender = rawGender ? rawGender : null;

  saveBtn.disabled = true;
  saveBtn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span>Saving...`;

  try {
    const { error } = await db
      .from('players')
      .update({
        name: newName,
        ratingid: newRatingId,
        gender: newGender
      })
      .eq('playerid', playerId);

    if (error) throw error;

    editPlayerModalInstance.hide();
    showToast(`Updated player "${newName}" successfully!`, "success");
    await loadQueueData();
  } catch (err) {
    console.error("Error updating player in database:", err);
    showToast("Database update failed: " + err.message, "danger");
  } finally {
    saveBtn.disabled = false;
    saveBtn.innerHTML = `<i class="bi bi-check-circle me-1"></i>Save Changes`;
  }
}

async function endCurrentSession() {
  if (!activeSessionId) return;
  if (!confirm("Are you sure you want to end the current session? All players will be unassigned from this session.")) return;

  try {
    await db
      .from('players')
      .update({ currentgameid: null, is_checked_in: null })
      .eq('currentgameid', activeSessionId);

    const { error } = await db
      .from('game')
      .update({ enddatetime: new Date().toISOString() })
      .eq('gameid', activeSessionId);

    if (error) throw error;

    showToast("Session ended successfully.", "success");
    setTimeout(() => {
      window.location.href = 'index.html';
    }, 1000);
  } catch (err) {
    console.error("Error ending session:", err);
    showToast("Failed to end session: " + err.message, "danger");
  }
}

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

function generateMatches() {
  showToast("Match generation feature is ready!", "info");
}