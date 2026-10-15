// Sessions Archive State
let allSessions = [];
let sessionDetailsModalInstance = null;
let currentLeaderboardPlayers = [];
let currentCompletedMatches = [];
let currentSortColumn = 'wins';
let currentSortAscending = false;

const GAME_TYPE_MAP = {
  1: "Social Mix",
  2: "Skill Separated",
  3: "Winners/Losers",
  4: "Mixed Gender"
};

document.addEventListener("DOMContentLoaded", async () => {
  initPageLayout("Game Sessions Archive");
  sessionDetailsModalInstance = new bootstrap.Modal(document.getElementById('sessionDetailsModal'));

  await checkDbConnection();
  await loadSessionsArchive();
});

async function loadSessionsArchive() {
  const tbody = document.getElementById('sessionsTableBody');
  const badge = document.getElementById('sessionsCountBadge');

  try {
    const { data: sessions, error: sessionErr } = await db
      .from('game')
      .select('*, gametype(name)')
      .order('startdatetime', { ascending: false });

    if (sessionErr) throw sessionErr;
    allSessions = sessions || [];

    badge.textContent = `${allSessions.length} Session(s) Recorded`;

    if (allSessions.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-muted">No game sessions recorded yet.</td></tr>`;
      return;
    }

    const { data: matches, error: matchErr } = await db
      .from('match')
      .select('matchid, gameid, enddatetime');

    if (matchErr) throw matchErr;

    const matchCountMap = {};
    (matches || []).forEach(m => {
      if (m.gameid) {
        if (!matchCountMap[m.gameid]) matchCountMap[m.gameid] = { total: 0, completed: 0 };
        matchCountMap[m.gameid].total += 1;
        if (m.enddatetime) matchCountMap[m.gameid].completed += 1;
      }
    });

    tbody.innerHTML = '';

    allSessions.forEach(session => {
      let typeName = "Standard";
      if (session.gametype && session.gametype.name) {
        typeName = session.gametype.name;
      } else if (session.gametypeid && GAME_TYPE_MAP[session.gametypeid]) {
        typeName = GAME_TYPE_MAP[session.gametypeid];
      }

      const startTime = session.startdatetime ? new Date(session.startdatetime).toLocaleString() : 'N/A';
      const endTime = session.enddatetime ? new Date(session.enddatetime).toLocaleString() : '<span class="badge bg-success bg-opacity-10 text-success border border-success">Active Session</span>';
      
      const stats = matchCountMap[session.gameid] || { total: 0, completed: 0 };

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="ps-4">
          <div class="fw-bold text-dark">${escapeHtml(session.gamename || 'Untitled Session')}</div>
          <small class="text-muted">ID: ${session.gameid}</small>
        </td>
        <td><span class="badge bg-primary bg-opacity-10 text-primary border border-primary">${escapeHtml(typeName)}</span></td>
        <td><small class="text-dark">${startTime}</small></td>
        <td><small class="text-muted">${endTime}</small></td>
        <td>
          <span class="badge bg-light text-dark border fw-semibold">${stats.completed} completed</span>
          <small class="text-muted ms-1">(${stats.total} total)</small>
        </td>
        <td class="text-end pe-4">
          <button class="btn btn-sm btn-outline-primary" onclick="openSessionDetails(${session.gameid})" title="View Details">
            <i class="bi bi-eye-fill"></i>
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });

  } catch (err) {
    console.error("Error loading sessions archive:", err);
    tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-danger">Failed to load sessions: ${escapeHtml(err.message)}</td></tr>`;
  }
}

async function openSessionDetails(gameId) {
  const session = allSessions.find(s => s.gameid === gameId);
  if (!session) return;

  document.getElementById('modalSessionTitle').textContent = session.gamename || `Session #${gameId}`;
  const startTime = session.startdatetime ? new Date(session.startdatetime).toLocaleString() : 'N/A';
  const endTime = session.enddatetime ? new Date(session.enddatetime).toLocaleString() : 'Ongoing';
  document.getElementById('modalSessionMeta').textContent = `Started: ${startTime} | Ended: ${endTime}`;

  // Reset filters
  document.getElementById('leaderboardSearchInput').value = '';
  document.getElementById('leaderboardAwardFilter').value = 'ALL';
  document.getElementById('matchLogSearchInput').value = '';

  const leaderboardBody = document.getElementById('sessionLeaderboardBody');
  const matchLogBody = document.getElementById('sessionMatchLogBody');

  leaderboardBody.innerHTML = `<tr><td colspan="8" class="text-center py-3 text-muted">Calculating player stats...</td></tr>`;
  matchLogBody.innerHTML = `<tr><td colspan="5" class="text-center py-3 text-muted">Loading match records...</td></tr>`;

  sessionDetailsModalInstance.show();

  try {
    const { data: matches, error: matchErr } = await db
      .from('match')
      .select('*, playermatch(*, players(*)), courts(courtname)')
      .eq('gameid', gameId)
      .order('matchid', { ascending: true });

    if (matchErr) throw matchErr;

    const { data: sessionPlayers, error: playerErr } = await db
      .from('players')
      .select('*')
      .eq('currentgameid', gameId);

    if (playerErr) throw playerErr;

    const playerStats = {};
    
    (sessionPlayers || []).forEach(p => {
      playerStats[p.playerid] = {
        id: p.playerid,
        name: p.name,
        ratingid: p.ratingid,
        gender: p.gender,
        matches: 0,
        wins: 0,
        losses: 0,
        pointsFor: 0,
        pointsAgainst: 0
      };
    });

    currentCompletedMatches = [];

    (matches || []).forEach(m => {
      const pmList = m.playermatch || [];
      const isCompleted = m.enddatetime !== null;

      if (isCompleted) {
        currentCompletedMatches.push(m);
        const t1Score = m.team1_score || 0;
        const t2Score = m.team2_score || 0;
        const winner = m.winning_team;

        pmList.forEach(pm => {
          const pId = pm.playerid;
          if (!pId) return;

          if (!playerStats[pId] && pm.players) {
            playerStats[pId] = {
              id: pm.players.playerid,
              name: pm.players.name,
              ratingid: pm.players.ratingid,
              gender: pm.players.gender,
              matches: 0,
              wins: 0,
              losses: 0,
              pointsFor: 0,
              pointsAgainst: 0
            };
          }

          if (playerStats[pId]) {
            playerStats[pId].matches += 1;
            if (pm.teamid === 1) {
              playerStats[pId].pointsFor += t1Score;
              playerStats[pId].pointsAgainst += t2Score;
            } else {
              playerStats[pId].pointsFor += t2Score;
              playerStats[pId].pointsAgainst += t1Score;
            }

            if (winner !== null && winner !== undefined) {
              if (pm.teamid === winner) {
                playerStats[pId].wins += 1;
              } else {
                playerStats[pId].losses += 1;
              }
            }
          }
        });
      }
    });

    currentLeaderboardPlayers = Object.values(playerStats);
    filterAndRenderLeaderboard();
    filterAndRenderMatchLog();

  } catch (err) {
    console.error("Error loading session details:", err);
    leaderboardBody.innerHTML = `<tr><td colspan="8" class="text-center py-3 text-danger">Error loading data.</td></tr>`;
    matchLogBody.innerHTML = `<tr><td colspan="5" class="text-center py-3 text-danger">Error loading data.</td></tr>`;
  }
}

function filterAndRenderLeaderboard() {
  const searchVal = document.getElementById('leaderboardSearchInput').value.trim().toLowerCase();
  const awardFilter = document.getElementById('leaderboardAwardFilter').value;

  let filtered = currentLeaderboardPlayers.filter(p => p.name.toLowerCase().includes(searchVal));

  // Apply Award / Highlight Filters
  if (awardFilter === 'HIGHEST_WIN_RATE') {
    const activePlayers = currentLeaderboardPlayers.filter(p => p.matches > 0);
    if (activePlayers.length > 0) {
      const maxWinRate = Math.max(...activePlayers.map(p => p.wins / p.matches));
      filtered = filtered.filter(p => p.matches > 0 && (p.wins / p.matches) === maxWinRate);
    } else {
      filtered = [];
    }
  } else if (awardFilter === 'IRON_MAN') {
    const maxMatches = Math.max(...currentLeaderboardPlayers.map(p => p.matches), 0);
    filtered = filtered.filter(p => p.matches === maxMatches && maxMatches > 0);
  } else if (awardFilter === 'POINT_MASTER') {
    const maxDiff = Math.max(...currentLeaderboardPlayers.map(p => p.pointsFor - p.pointsAgainst), -999);
    filtered = filtered.filter(p => (p.pointsFor - p.pointsAgainst) === maxDiff && maxDiff > -999);
  } else if (awardFilter === 'THE_WALL') {
    const activePlayers = currentLeaderboardPlayers.filter(p => p.matches > 0);
    if (activePlayers.length > 0) {
      const minPointsAgainstAvg = Math.min(...activePlayers.map(p => p.pointsAgainst / p.matches));
      filtered = filtered.filter(p => p.matches > 0 && (p.pointsAgainst / p.matches) === minPointsAgainstAvg);
    } else {
      filtered = [];
    }
  } else if (awardFilter === 'RISING_CHALLENGER') {
    filtered = filtered.filter(p => p.matches > 0 && p.wins === 0);
  }

  // Apply Sorting
  filtered.sort((a, b) => {
    let valA, valB;

    if (currentSortColumn === 'name') {
      valA = a.name.toLowerCase();
      valB = b.name.toLowerCase();
    } else if (currentSortColumn === 'matches') {
      valA = a.matches;
      valB = b.matches;
    } else if (currentSortColumn === 'wins') {
      valA = a.wins;
      valB = b.wins;
    } else if (currentSortColumn === 'losses') {
      valA = a.losses;
      valB = b.losses;
    } else if (currentSortColumn === 'winRate') {
      valA = a.matches > 0 ? (a.wins / a.matches) : 0;
      valB = b.matches > 0 ? (b.wins / b.matches) : 0;
    } else if (currentSortColumn === 'diff') {
      valA = a.pointsFor - a.pointsAgainst;
      valB = b.pointsFor - b.pointsAgainst;
    }

    if (valA < valB) return currentSortAscending ? -1 : 1;
    if (valA > valB) return currentSortAscending ? 1 : -1;
    return 0;
  });

  const leaderboardBody = document.getElementById('sessionLeaderboardBody');
  if (filtered.length === 0) {
    leaderboardBody.innerHTML = `<tr><td colspan="8" class="text-center py-3 text-muted">No players match the selected filter criteria.</td></tr>`;
    return;
  }

  leaderboardBody.innerHTML = '';
  filtered.forEach(p => {
    const winRate = p.matches > 0 ? Math.round((p.wins / p.matches) * 100) : 0;
    const diff = p.pointsFor - p.pointsAgainst;
    const diffDisplay = diff > 0 ? `+${diff}` : `${diff}`;
    const diffClass = diff > 0 ? 'text-success' : diff < 0 ? 'text-danger' : 'text-muted';

    let ratingLabel = 'Unassigned';
    if (p.ratingid && typeof RATING_MAP !== 'undefined' && RATING_MAP[p.ratingid]) {
      const r = RATING_MAP[p.ratingid];
      ratingLabel = r.label || r.value || p.ratingid;
    }

    const genderText = p.gender === 'F' ? 'Female' : p.gender === 'M' ? 'Male' : '-';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="ps-3 fw-bold text-dark">${escapeHtml(p.name)}</td>
      <td><span class="badge bg-warning bg-opacity-25 text-dark border border-warning px-2 py-1">${escapeHtml(ratingLabel)}</span></td>
      <td><span class="badge bg-info bg-opacity-10 text-info border border-info">${genderText}</span></td>
      <td class="text-center fw-semibold">${p.matches}</td>
      <td class="text-center text-success fw-bold">${p.wins}</td>
      <td class="text-center text-danger fw-semibold">${p.losses}</td>
      <td class="text-center fw-bold">${winRate}%</td>
      <td class="text-end pe-3 fw-bold ${diffClass}">${diffDisplay}</td>
    `;
    leaderboardBody.appendChild(tr);
  });
}

function filterAndRenderMatchLog() {
  const searchVal = document.getElementById('matchLogSearchInput').value.trim().toLowerCase();
  const matchLogBody = document.getElementById('sessionMatchLogBody');

  const filtered = currentCompletedMatches.filter(m => {
    const courtName = m.courts ? m.courts.courtname.toLowerCase() : '';
    const playersStr = (m.playermatch || []).map(pm => pm.players ? pm.players.name.toLowerCase() : '').join(' ');
    return courtName.includes(searchVal) || playersStr.includes(searchVal);
  });

  if (filtered.length === 0) {
    matchLogBody.innerHTML = `<tr><td colspan="5" class="text-center py-3 text-muted">No completed matches match your search.</td></tr>`;
    return;
  }

  matchLogBody.innerHTML = '';
  filtered.forEach(m => {
    const courtName = m.courts ? m.courts.courtname : 'Court';
    const t1Players = (m.playermatch || []).filter(pm => pm.teamid === 1).map(pm => pm.players ? pm.players.name : 'Unknown').join(' & ');
    const t2Players = (m.playermatch || []).filter(pm => pm.teamid === 2).map(pm => pm.players ? pm.players.name : 'Unknown').join(' & ');

    const t1Won = m.winning_team === 1;
    const t2Won = m.winning_team === 2;

    let durationStr = 'N/A';
    if (m.startdatetime && m.enddatetime) {
      const start = new Date(m.startdatetime);
      const end = new Date(m.enddatetime);
      const diffMs = Math.max(0, end - start);
      const totalMins = Math.floor(diffMs / (1000 * 60));
      const hours = Math.floor(totalMins / 60);
      const mins = totalMins % 60;

      if (hours > 0) {
        durationStr = `${hours}h ${mins}m`;
      } else {
        durationStr = `${mins}m`;
      }
    }

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="ps-3"><span class="badge bg-secondary bg-opacity-10 text-secondary border">${escapeHtml(courtName)}</span></td>
      <td><span class="${t1Won ? 'fw-bold text-success' : 'text-dark'}">${escapeHtml(t1Players || 'Team 1')}</span></td>
      <td class="text-center">
        <span class="badge bg-dark text-white px-2 py-1 fs-6">${m.team1_score} - ${m.team2_score}</span>
      </td>
      <td><span class="${t2Won ? 'fw-bold text-success' : 'text-dark'}">${escapeHtml(t2Players || 'Team 2')}</span></td>
      <td class="text-end pe-3"><span class="badge bg-light text-dark border">${durationStr}</span></td>
    `;
    matchLogBody.appendChild(tr);
  });
}

function sortLeaderboard(columnName) {
  if (currentSortColumn === columnName) {
    currentSortAscending = !currentSortAscending;
  } else {
    currentSortColumn = columnName;
    currentSortAscending = false;
  }
  filterAndRenderLeaderboard();
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