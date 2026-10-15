// Players Page State
let allPlayers = [];
let playerStatsMap = {}; // { playerId: { matches: 0, wins: 0, losses: 0 } }
let playerMatchesMap = {}; // { playerId: [matchDetails...] }
let activeSessionsMap = {}; // { gameid: gamename }

let addPlayerModalInstance = null;
let playerHistoryModalInstance = null;
let deletePlayerModalInstance = null;

document.addEventListener("DOMContentLoaded", async () => {
  // Initialize layout.js header & footer
  initPageLayout("Manage Players");

  addPlayerModalInstance = new bootstrap.Modal(document.getElementById('addPlayerModal'));
  playerHistoryModalInstance = new bootstrap.Modal(document.getElementById('playerHistoryModal'));
  deletePlayerModalInstance = new bootstrap.Modal(document.getElementById('deletePlayerModal'));

  await checkDbConnection();
  await loadActiveSessions();
  await loadPlayersPageData();
});

async function loadActiveSessions() {
  try {
    const { data, error } = await db.from('game').select('gameid, gamename');
    if (error) throw error;
    activeSessionsMap = {};
    (data || []).forEach(g => {
      activeSessionsMap[g.gameid] = g.gamename || `Session #${g.gameid}`;
    });
  } catch (err) {
    console.warn("Could not load sessions map:", err.message);
  }
}

async function loadPlayersPageData() {
  try {
    // Fetch all players
    const { data: playersData, error: playerErr } = await db
      .from('players')
      .select('*')
      .order('name', { ascending: true });

    if (playerErr) throw playerErr;
    allPlayers = playersData || [];

    // Fetch match and player-match links to calculate stats & history
    const { data: matchData, error: matchErr } = await db
      .from('match')
      .select('*, playermatch(*, players(*)), courts(courtname)');

    if (matchErr) throw matchErr;

    playerStatsMap = {};
    playerMatchesMap = {};

    (matchData || []).forEach(m => {
      const pmList = m.playermatch || [];
      const winner = m.winning_team;

      pmList.forEach(pm => {
        const pId = pm.playerid;
        if (!pId) return;

        // Stats accumulation (Only count completed matches for W/L record)
        if (!playerStatsMap[pId]) {
          playerStatsMap[pId] = { matches: 0, wins: 0, losses: 0 };
        }
        
        const isCompleted = m.enddatetime !== null;
        if (isCompleted) {
          playerStatsMap[pId].matches += 1;
          if (winner !== null && winner !== undefined) {
            if (pm.teamid === winner) {
              playerStatsMap[pId].wins += 1;
            } else {
              playerStatsMap[pId].losses += 1;
            }
          }
        }

        // Match history collection
        if (!playerMatchesMap[pId]) {
          playerMatchesMap[pId] = [];
        }
        playerMatchesMap[pId].push({
          match: m,
          teamid: pm.teamid,
          teammates: pmList.filter(x => x.teamid === pm.teamid && x.playerid !== pId).map(x => x.players ? x.players.name : 'Unknown'),
          opponents: pmList.filter(x => x.teamid !== pm.teamid).map(x => x.players ? x.players.name : 'Unknown')
        });
      });
    });

    renderPlayersUI();
  } catch (err) {
    console.error("Failed to load players directory data:", err);
    showToast("Error loading players: " + err.message, "danger");
  }
}

function renderPlayersUI() {
  renderStatsCards();
  filterPlayersTable();
}

function renderStatsCards() {
  const total = allPlayers.length;
  const checkedIn = allPlayers.filter(p => p.currentgameid && p.is_checked_in !== false).length;
  const checkedOut = allPlayers.filter(p => p.currentgameid && p.is_checked_in === false).length;
  const available = total - checkedIn - checkedOut;

  document.getElementById('statTotalPlayers').textContent = total;
  document.getElementById('statAvailablePlayers').textContent = available;
  document.getElementById('statCheckedInPlayers').textContent = checkedIn;
  document.getElementById('statCheckedOutPlayers').textContent = checkedOut;

  document.getElementById('totalPlayerCountSubtext').textContent = `${total} total registered player(s) in database.`;
}

function filterPlayersTable() {
  const searchVal = document.getElementById('playerSearchInput').value.trim().toLowerCase();
  const statusFilter = document.getElementById('playerStatusFilter').value;

  const filtered = allPlayers.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(searchVal);
    
    let matchesStatus = true;
    if (statusFilter === 'CHECKED_IN') {
      matchesStatus = p.currentgameid !== null && p.is_checked_in !== false;
    } else if (statusFilter === 'CHECKED_OUT') {
      matchesStatus = p.currentgameid !== null && p.is_checked_in === false;
    } else if (statusFilter === 'UNASSIGNED') {
      matchesStatus = p.currentgameid === null;
    }

    return matchesSearch && matchesStatus;
  });

  document.getElementById('tableFilterCountBadge').textContent = `Showing ${filtered.length} player(s)`;
  renderPlayersTableBody(filtered);
}

function renderPlayersTableBody(playersList) {
  const tbody = document.getElementById('playersTableBody');
  if (!tbody) return;

  if (playersList.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="text-center py-4 text-muted">
          <i class="bi bi-search fs-3 d-block mb-1 opacity-50"></i>
          No players found matching your filter criteria.
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = '';

  playersList.forEach(player => {
    const stats = playerStatsMap[player.playerid] || { matches: 0, wins: 0, losses: 0 };
    
    // Rating Badge
    let ratingBadge = '<span class="text-muted small">Unassigned</span>';
    if (player.ratingid && typeof RATING_MAP !== 'undefined' && RATING_MAP[player.ratingid]) {
      const r = RATING_MAP[player.ratingid];
      const displayVal = r.label || r.value || player.ratingid;
      ratingBadge = `<span class="badge bg-warning bg-opacity-25 text-dark border border-warning px-2 py-1"><i class="bi bi-star-fill text-warning me-1"></i>${escapeHtml(displayVal)}</span>`;
    }

    // Gender Badge
    let genderBadge = '<span class="text-muted small">-</span>';
    if (player.gender) {
      const gText = player.gender === 'F' ? 'Female (F)' : 'Male (M)';
      genderBadge = `<span class="badge bg-info bg-opacity-10 text-info border border-info px-2 py-1">${gText}</span>`;
    }

    // Status Badge
    let statusBadge = '<span class="badge bg-secondary bg-opacity-10 text-secondary border px-2 py-1">Unassigned</span>';
    if (player.currentgameid) {
      if (player.is_checked_in !== false) {
        statusBadge = `<span class="badge bg-success bg-opacity-10 text-success border border-success px-2 py-1"><i class="bi bi-check-circle-fill me-1"></i>Checked In</span>`;
      } else {
        statusBadge = `<span class="badge bg-secondary bg-opacity-25 text-dark border px-2 py-1"><i class="bi bi-dash-circle me-1"></i>Checked Out</span>`;
      }
    }

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="ps-4">
        <div class="fw-bold text-dark">${escapeHtml(player.name)}</div>
        <small class="text-muted">ID: ${player.playerid}</small>
      </td>
      <td>${ratingBadge}</td>
      <td>${genderBadge}</td>
      <td>${statusBadge}</td>
      <td>
        <div class="d-flex align-items-center gap-2">
          <span class="badge bg-light text-dark border">${stats.matches} matches</span>
          <span class="small text-muted fw-semibold">(${stats.wins}W - ${stats.losses}L)</span>
        </div>
      </td>
      <td class="text-end pe-4">
        <div class="d-flex align-items-center justify-content-end gap-2">
          <button class="btn btn-sm btn-outline-info" onclick="openPlayerHistoryModal(${player.playerid})" title="View Match History">
            <i class="bi bi-clock-history"></i>
          </button>
          <button class="btn btn-sm btn-outline-primary" onclick="openEditPlayerModal(${player.playerid})" title="Edit Player">
            <i class="bi bi-pencil-fill"></i>
          </button>
          <button class="btn btn-sm btn-outline-danger" onclick="openDeletePlayerModal(${player.playerid})" title="Delete Player">
            <i class="bi bi-trash-fill"></i>
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function openAddPlayerModal() {
  document.getElementById('addPlayerModalLabel').innerHTML = `<i class="bi bi-person-plus-fill text-primary"></i> Add New Player`;
  document.getElementById('modalPlayerId').value = '';
  document.getElementById('modalPlayerNameInput').value = '';
  document.getElementById('modalPlayerGenderSelect').value = '';
  resetStarRating();
}

function openEditPlayerModal(playerId) {
  const player = allPlayers.find(p => p.playerid === playerId);
  if (!player) return;

  document.getElementById('addPlayerModalLabel').innerHTML = `<i class="bi bi-pencil-square text-primary"></i> Edit Player`;
  document.getElementById('modalPlayerId').value = player.playerid;
  document.getElementById('modalPlayerNameInput').value = player.name || '';
  document.getElementById('modalPlayerGenderSelect').value = player.gender || '';

  if (player.ratingid) {
    setStarRating(parseInt(player.ratingid, 10));
  } else {
    resetStarRating();
  }

  addPlayerModalInstance.show();
}

function resetStarRating() {
  const stars = document.querySelectorAll('#starRatingContainer .style-star');
  stars.forEach(s => {
    s.classList.remove('bi-star-fill');
    s.classList.add('bi-star');
  });
  document.getElementById('modalPlayerRatingId').value = '';
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
  
  document.getElementById('modalPlayerRatingId').value = ratingInfo.ratingid !== undefined ? ratingInfo.ratingid : starCount;
  document.getElementById('ratingValueBadge').textContent = ratingInfo.label || ratingInfo.value || 'Unassigned';
}

async function handleSavePlayer() {
  const playerId = document.getElementById('modalPlayerId').value;
  const name = document.getElementById('modalPlayerNameInput').value.trim();
  const rawRatingId = document.getElementById('modalPlayerRatingId').value;
  const gender = document.getElementById('modalPlayerGenderSelect').value || null;
  const ratingid = rawRatingId ? parseInt(rawRatingId, 10) : null;
  const saveBtn = document.getElementById('savePlayerBtn');

  if (!name) {
    showToast("Please enter a player name.", "warning");
    return;
  }

  saveBtn.disabled = true;

  try {
    if (playerId) {
      // Update existing player
      const { error } = await db
        .from('players')
        .update({ name, ratingid, gender })
        .eq('playerid', playerId);

      if (error) throw error;
      showToast(`Updated player "${name}" successfully!`, "success");
    } else {
      // Insert new player
      const { error } = await db
        .from('players')
        .insert([{ name, ratingid, gender, currentgameid: null, is_checked_in: null }]);

      if (error) throw error;
      showToast(`Added player "${name}" successfully!`, "success");
    }

    addPlayerModalInstance.hide();
    await loadPlayersPageData();
  } catch (err) {
    console.error("Error saving player:", err);
    showToast("Failed to save player: " + err.message, "danger");
  } finally {
    saveBtn.disabled = false;
  }
}

function openPlayerHistoryModal(playerId) {
  const player = allPlayers.find(p => p.playerid === playerId);
  if (!player) return;

  document.getElementById('historyPlayerNameHeader').textContent = `${player.name} - Match History`;

  const stats = playerStatsMap[playerId] || { matches: 0, wins: 0, losses: 0 };
  const winRate = stats.matches > 0 ? Math.round((stats.wins / stats.matches) * 100) : 0;
  document.getElementById('historyWinRateBadge').textContent = `Win Rate: ${winRate}% (${stats.wins}W - ${stats.losses}L)`;

  const container = document.getElementById('playerHistoryContentContainer');
  const matches = playerMatchesMap[playerId] || [];

  if (matches.length === 0) {
    container.innerHTML = `<div class="text-center py-4 text-muted italic">No match history recorded for this player yet.</div>`;
    playerHistoryModalInstance.show();
    return;
  }

  let html = `
    <div class="table-responsive">
      <table class="table table-sm table-striped align-middle mb-0">
        <thead class="table-light fs-7 text-uppercase text-muted">
          <tr>
            <th>Session</th>
            <th>Court</th>
            <th>Teammate</th>
            <th>Opponents</th>
            <th class="text-center">Result</th>
          </tr>
        </thead>
        <tbody>
  `;

  matches.forEach(mObj => {
    const m = mObj.match;
    const sessionName = activeSessionsMap[m.gameid] || `Session #${m.gameid}`;
    
    // Check if match is in draft (courtid is null and enddatetime is null)
    let courtName = 'N/A';
    if (m.courtid !== null && m.courtid !== undefined) {
      courtName = m.courts ? m.courts.courtname : `Court #${m.courtid}`;
    }

    const teammateStr = mObj.teammates.length > 0 ? mObj.teammates.join(', ') : 'None';
    const opponentsStr = mObj.opponents.length > 0 ? mObj.opponents.join(' & ') : 'None';

    let resultBadge = '<span class="badge bg-warning bg-opacity-10 text-warning border border-warning">In Draft</span>';
    if (m.enddatetime !== null && m.enddatetime !== undefined) {
      if (m.winning_team !== null && m.winning_team !== undefined) {
        if (m.winning_team === mObj.teamid) {
          resultBadge = `<span class="badge bg-success bg-opacity-10 text-success border border-success">Won (${m.team1_score}-${m.team2_score})</span>`;
        } else {
          resultBadge = `<span class="badge bg-danger bg-opacity-10 text-danger border border-danger">Lost (${m.team1_score}-${m.team2_score})</span>`;
        }
      }
    } else if (m.courtid !== null && m.courtid !== undefined) {
      resultBadge = '<span class="badge bg-primary bg-opacity-10 text-primary border border-primary">In Progress</span>';
    }

    html += `
      <tr>
        <td><small class="fw-semibold text-dark">${escapeHtml(sessionName)}</small></td>
        <td><small class="text-muted">${escapeHtml(courtName)}</small></td>
        <td><small class="text-dark">${escapeHtml(teammateStr)}</small></td>
        <td><small class="text-muted">${escapeHtml(opponentsStr)}</small></td>
        <td class="text-center">${resultBadge}</td>
      </tr>
    `;
  });

  html += `</tbody></table></div>`;
  container.innerHTML = html;
  playerHistoryModalInstance.show();
}

function openDeletePlayerModal(playerId) {
  const player = allPlayers.find(p => p.playerid === playerId);
  if (!player) return;

  document.getElementById('deletePlayerIdInput').value = player.playerid;
  document.getElementById('deletePlayerNameDisplay').textContent = player.name;
  deletePlayerModalInstance.show();
}

async function executeDeletePlayer() {
  const playerId = document.getElementById('deletePlayerIdInput').value;

  try {
    const { error } = await db
      .from('players')
      .delete()
      .eq('playerid', playerId);

    if (error) throw error;

    deletePlayerModalInstance.hide();
    showToast("Player deleted successfully!", "info");
    await loadPlayersPageData();
  } catch (err) {
    console.error("Failed to delete player:", err);
    showToast("Failed to delete player: " + err.message, "danger");
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