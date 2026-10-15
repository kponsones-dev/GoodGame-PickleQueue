// Players Management State
let allPlayers = [];
let playerProfileModalInstance = null;
let currentPlayerMatches = [];
let currentPlayerSessions = [];

document.addEventListener("DOMContentLoaded", async () => {
  initPageLayout("Manage Players");
  playerProfileModalInstance = new bootstrap.Modal(document.getElementById('playerProfileModal'));

  await checkDbConnection();
  populateRatingDropdowns();
  await loadPlayersDirectory();
});

async function loadPlayersDirectory() {
  const tbody = document.getElementById('playersTableBody');
  const countBadge = document.getElementById('playersCountBadge');

  try {
    const { data: players, error: playerErr } = await db
      .from('players')
      .select('*')
      .order('name', { ascending: true });

    if (playerErr) throw playerErr;
    allPlayers = players || [];

    const { data: matchData, error: matchErr } = await db
      .from('playermatch')
      .select('playerid, teamid, matchid, match(winning_team, enddatetime)');

    if (matchErr) throw matchErr;

    const statsMap = {};
    (matchData || []).forEach(pm => {
      const pId = pm.playerid;
      if (!pId) return;
      if (!statsMap[pId]) statsMap[pId] = { matches: 0, wins: 0, losses: 0 };

      if (pm.match && pm.match.enddatetime !== null) {
        statsMap[pId].matches += 1;
        if (pm.match.winning_team !== null && pm.match.winning_team !== undefined) {
          if (pm.match.winning_team === pm.teamid) {
            statsMap[pId].wins += 1;
          } else {
            statsMap[pId].losses += 1;
          }
        }
      }
    });

    allPlayers.forEach(p => {
      p.stats = statsMap[p.playerid] || { matches: 0, wins: 0, losses: 0 };
    });

    updateSummaryCards();
    filterAndRenderPlayers();

  } catch (err) {
    console.error("Error loading players directory:", err);
    tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-danger">Failed to load players: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function updateSummaryCards() {
  const total = allPlayers.length;
  let available = 0;
  let checkedIn = 0;
  let checkedOut = 0;

  allPlayers.forEach(p => {
    if (p.sessionstatus === 'CHECKED_IN') {
      checkedIn++;
    } else if (p.sessionstatus === 'CHECKED_OUT') {
      checkedOut++;
    } else {
      available++;
    }
  });

  document.getElementById('statTotalPlayers').textContent = total;
  document.getElementById('statAvailablePool').textContent = available;
  document.getElementById('statCheckedIn').textContent = checkedIn;
  document.getElementById('statCheckedOut').textContent = checkedOut;
}

function filterAndRenderPlayers() {
  const searchVal = document.getElementById('playerSearchInput').value.trim().toLowerCase();
  const statusFilter = document.getElementById('playerStatusFilter').value;
  const tbody = document.getElementById('playersTableBody');
  const countBadge = document.getElementById('playersCountBadge');

  let filtered = allPlayers.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(searchVal);
    let matchesStatus = true;

    if (statusFilter === 'CHECKED_IN') {
      matchesStatus = p.sessionstatus === 'CHECKED_IN';
    } else if (statusFilter === 'CHECKED_OUT') {
      matchesStatus = p.sessionstatus === 'CHECKED_OUT';
    } else if (statusFilter === 'UNASSIGNED') {
      matchesStatus = !p.sessionstatus || p.sessionstatus === 'UNASSIGNED';
    }

    return matchesSearch && matchesStatus;
  });

  countBadge.textContent = `Showing ${filtered.length} of ${allPlayers.length} player(s)`;

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-muted">No players match your search or filter criteria.</td></tr>`;
    return;
  }

  tbody.innerHTML = '';

  filtered.forEach(p => {
    let ratingLabel = 'Unassigned';
    if (p.ratingid && typeof RATING_MAP !== 'undefined' && RATING_MAP[p.ratingid]) {
      const r = RATING_MAP[p.ratingid];
      ratingLabel = r.label || r.value || p.ratingid;
    }

    const genderText = p.gender === 'F' ? 'Female (F)' : p.gender === 'M' ? 'Male (M)' : '-';

    let statusBadge = '<span class="badge bg-secondary bg-opacity-10 text-secondary border">Unassigned</span>';
    if (p.sessionstatus === 'CHECKED_IN') {
      statusBadge = '<span class="badge bg-success bg-opacity-10 text-success border border-success">Checked In</span>';
    } else if (p.sessionstatus === 'CHECKED_OUT') {
      statusBadge = '<span class="badge bg-secondary bg-opacity-10 text-secondary border">Checked Out</span>';
    }

    const stats = p.stats || { matches: 0, wins: 0, losses: 0 };
    const statsText = `${stats.matches} matches <small class="text-muted">(${stats.wins}W - ${stats.losses}L)</small>`;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="ps-4">
        <div class="fw-bold text-dark">${escapeHtml(p.name)}</div>
        <small class="text-muted">ID: ${p.playerid}</small>
      </td>
      <td><span class="badge bg-warning bg-opacity-25 text-dark border border-warning px-2 py-1">${escapeHtml(ratingLabel)}</span></td>
      <td><span class="badge bg-info bg-opacity-10 text-info border border-info">${genderText}</span></td>
      <td>${statusBadge}</td>
      <td class="fw-semibold">${statsText}</td>
      <td class="text-end pe-4">
        <div class="btn-group btn-group-sm" role="group">
          <button class="btn btn-outline-primary" onclick="openPlayerProfile(${p.playerid})" title="View Profile & Match History">
            <i class="bi bi-clock-history"></i>
          </button>
          <button class="btn btn-outline-secondary" onclick="openEditPlayerModal(${p.playerid})" title="Edit Player">
            <i class="bi bi-pencil-fill"></i>
          </button>
          <button class="btn btn-outline-danger" onclick="deletePlayer(${p.playerid})" title="Delete Player">
            <i class="bi bi-trash-fill"></i>
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function openAddPlayerModal() {
  document.getElementById('addPlayerModalLabel').textContent = 'Add New Player';
  document.getElementById('editPlayerId').value = '';
  document.getElementById('playerNameInput').value = '';
  document.getElementById('playerRatingSelect').value = '';
  document.getElementById('playerGenderSelect').value = '';
}

function openEditPlayerModal(playerId) {
  const player = allPlayers.find(p => p.playerid === playerId);
  if (!player) return;

  document.getElementById('addPlayerModalLabel').textContent = 'Edit Player Details';
  document.getElementById('editPlayerId').value = player.playerid;
  document.getElementById('playerNameInput').value = player.name || '';
  document.getElementById('playerRatingSelect').value = player.ratingid || '';
  document.getElementById('playerGenderSelect').value = player.gender || '';

  const modal = new bootstrap.Modal(document.getElementById('addPlayerModal'));
  modal.show();
}

async function savePlayerForm() {
  const playerId = document.getElementById('editPlayerId').value;
  const name = document.getElementById('playerNameInput').value.trim();
  const ratingid = document.getElementById('playerRatingSelect').value ? parseInt(document.getElementById('playerRatingSelect').value) : null;
  const gender = document.getElementById('playerGenderSelect').value || null;

  if (!name) {
    showToast('Please enter a player name.', 'warning');
    return;
  }

  try {
    if (playerId) {
      const { error } = await db
        .from('players')
        .update({ name, ratingid, gender })
        .eq('playerid', parseInt(playerId));

      if (error) throw error;
      showToast('Player updated successfully!', 'success');
    } else {
      const { error } = await db
        .from('players')
        .insert([{ name, ratingid, gender, sessionstatus: 'UNASSIGNED' }]);

      if (error) throw error;
      showToast('New player added successfully!', 'success');
    }

    bootstrap.Modal.getInstance(document.getElementById('addPlayerModal')).hide();
    await loadPlayersDirectory();

  } catch (err) {
    console.error("Error saving player:", err);
    showToast(`Failed to save player: ${err.message}`, 'danger');
  }
}

async function deletePlayer(playerId) {
  const player = allPlayers.find(p => p.playerid === playerId);
  if (!player) return;

  if (!confirm(`Are you sure you want to delete player "${player.name}"? This action cannot be undone.`)) {
    return;
  }

  try {
    const { error } = await db
      .from('players')
      .delete()
      .eq('playerid', playerId);

    if (error) throw error;
    showToast('Player deleted successfully.', 'success');
    await loadPlayersDirectory();

  } catch (err) {
    console.error("Error deleting player:", err);
    showToast(`Failed to delete player: ${err.message}`, 'danger');
  }
}

async function openPlayerProfile(playerId) {
  const player = allPlayers.find(p => p.playerid === playerId);
  if (!player) return;

  let ratingLabel = 'Unassigned';
  if (player.ratingid && typeof RATING_MAP !== 'undefined' && RATING_MAP[player.ratingid]) {
    const r = RATING_MAP[player.ratingid];
    ratingLabel = r.label || r.value || player.ratingid;
  }
  const genderText = player.gender === 'F' ? 'Female' : player.gender === 'M' ? 'Male' : 'Not Specified';

  document.getElementById('modalProfileName').textContent = player.name;
  document.getElementById('modalProfileMeta').textContent = `Rating: ${ratingLabel} | Gender: ${genderText}`;

  // Reset filters
  const sessionFilterSelect = document.getElementById('modalSessionFilter');
  sessionFilterSelect.innerHTML = '<option value="ALL">All Sessions</option>';
  document.getElementById('modalMatchSearchInput').value = '';

  const historyBody = document.getElementById('playerMatchHistoryBody');
  historyBody.innerHTML = `<tr><td colspan="7" class="text-center py-3 text-muted">Loading match history...</td></tr>`;

  playerProfileModalInstance.show();

  try {
    const { data: pmData, error: pmErr } = await db
      .from('playermatch')
      .select('*, match(*, game(gameid, gamename, startdatetime), courts(courtname), playermatch(*, players(playerid, name)))')
      .eq('playerid', playerId);

    if (pmErr) throw pmErr;

    currentPlayerMatches = pmData || [];

    // Extract unique sessions for dropdown
    const sessionMap = new Map();
    currentPlayerMatches.forEach(pm => {
      if (pm.match && pm.match.game) {
        const g = pm.match.game;
        sessionMap.set(g.gameid, g.gamename || `Session #${g.gameid}`);
      }
    });

    currentPlayerSessions = Array.from(sessionMap.entries());
    currentPlayerSessions.forEach(([gId, gName]) => {
      const opt = document.createElement('option');
      opt.value = String(gId);
      opt.textContent = gName;
      sessionFilterSelect.appendChild(opt);
    });

    filterAndRenderPlayerMatches();

  } catch (err) {
    console.error("Error loading player match history:", err);
    historyBody.innerHTML = `<tr><td colspan="7" class="text-center py-3 text-danger">Failed to load match history.</td></tr>`;
  }
}

function filterAndRenderPlayerMatches() {
  const selectedSession = document.getElementById('modalSessionFilter').value;
  const searchVal = document.getElementById('modalMatchSearchInput').value.trim().toLowerCase();
  const historyBody = document.getElementById('playerMatchHistoryBody');

  const filtered = currentPlayerMatches.filter(pm => {
    const match = pm.match;
    if (!match) return false;

    // Only show completed matches
    if (match.enddatetime === null) return false;

    // Session Filter check
    if (selectedSession !== 'ALL') {
      if (!match.game || String(match.game.gameid) !== String(selectedSession)) {
        return false;
      }
    }

    // Search Filter check (court, teammate, opponents)
    if (searchVal) {
      const courtName = match.courts ? match.courts.courtname.toLowerCase() : '';
      
      const teamMates = [];
      const opponents = [];

      (match.playermatch || []).forEach(otherPm => {
        if (otherPm.players) {
          const pName = otherPm.players.name.toLowerCase();
          if (otherPm.teamid === pm.teamid) {
            teamMates.push(pName);
          } else {
            opponents.push(pName);
          }
        }
      });

      const searchableText = `${courtName} ${teamMates.join(' ')} ${opponents.join(' ')}`;
      if (!searchableText.includes(searchVal)) {
        return false;
      }
    }

    return true;
  });

  if (filtered.length === 0) {
    historyBody.innerHTML = `<tr><td colspan="7" class="text-center py-3 text-muted">No match records found matching your filters.</td></tr>`;
    return;
  }

  historyBody.innerHTML = '';

  filtered.forEach(pm => {
    const match = pm.match;
    const sessionName = match.game && match.game.gamename ? match.game.gamename : 'Session';
    const matchDate = match.startdatetime ? new Date(match.startdatetime).toLocaleDateString() : '';
    const courtName = match.courts ? match.courts.courtname : 'Court';

    const teammates = [];
    const opponents = [];

    (match.playermatch || []).forEach(otherPm => {
      if (otherPm.players && otherPm.playerid !== pm.playerid) {
        if (otherPm.teamid === pm.teamid) {
          teammates.push(otherPm.players.name);
        } else {
          opponents.push(otherPm.players.name);
        }
      }
    });

    const teammateStr = teammates.length > 0 ? teammates.join(' & ') : 'None (Singles)';
    const opponentStr = opponents.length > 0 ? opponents.join(' & ') : 'Unknown';

    let t1Score = match.team1_score || 0;
    let t2Score = match.team2_score || 0;
    const scoreStr = `${t1Score} - ${t2Score}`;

    let won = false;
    if (match.winning_team !== null && match.winning_team !== undefined) {
      won = match.winning_team === pm.teamid;
    }
    const resultBadge = won 
      ? '<span class="badge bg-success bg-opacity-10 text-success border border-success px-2 py-1">Win</span>' 
      : '<span class="badge bg-danger bg-opacity-10 text-danger border border-danger px-2 py-1">Loss</span>';

    // Duration calculation
    let durationStr = 'N/A';
    if (match.startdatetime && match.enddatetime) {
      const start = new Date(match.startdatetime);
      const end = new Date(match.enddatetime);
      const diffMs = Math.max(0, end - start);
      const totalMins = Math.floor(diffMs / (1000 * 60));
      const hours = Math.floor(totalMins / 60);
      const mins = totalMins % 60;
      durationStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
    }

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="ps-3 py-3">
        <div class="fw-bold text-dark">${escapeHtml(sessionName)}</div>
        <small class="text-muted">${matchDate}</small>
      </td>
      <td><span class="badge bg-secondary bg-opacity-10 text-secondary border">${escapeHtml(courtName)}</span></td>
      <td><span class="text-dark fw-medium">${escapeHtml(teammateStr)}</span></td>
      <td><span class="text-dark fw-medium">${escapeHtml(opponentStr)}</span></td>
      <td class="text-center"><span class="badge bg-dark text-white px-2 py-1">${scoreStr}</span></td>
      <td class="text-center">${resultBadge}</td>
      <td class="text-end pe-3"><span class="badge bg-light text-dark border">${durationStr}</span></td>
    `;
    historyBody.appendChild(tr);
  });
}

function populateRatingDropdowns() {
  const select = document.getElementById('playerRatingSelect');
  if (!select || typeof RATING_MAP === 'undefined') return;

  select.innerHTML = '<option value="">Unassigned</option>';
  Object.keys(RATING_MAP).forEach(key => {
    const r = RATING_MAP[key];
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = r.label || r.value || key;
    select.appendChild(opt);
  });
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