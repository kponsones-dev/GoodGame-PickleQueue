// js/history.js - Shared Player History Module

let currentActivePlayerId = null;

function initHistoryModule() {
  const modalEl = document.getElementById('historyModal');
  if (modalEl && !historyModalInstance) {
    historyModalInstance = new bootstrap.Modal(modalEl);
  }
}

async function openHistoryModal(playerId, playerName) {
  initHistoryModule();
  currentActivePlayerId = playerId;
  
  const nameEl = document.getElementById('historyPlayerName');
  if (nameEl) {
    nameEl.textContent = playerName;
  }

  // Reset tabs to first tab by default
  const activeTabEl = document.getElementById('active-game-tab');
  if (activeTabEl) {
    const tabTrigger = new bootstrap.Tab(activeTabEl);
    tabTrigger.show();
  }

  // Load contents for both tabs
  await loadPlayerActiveGameTab(playerId);
  await loadPlayerMatchHistoryTab(playerId);

  historyModalInstance.show();
}

// Tab 1: Active Games currently recorded
async function loadPlayerActiveGameTab(playerId) {
  const container = document.getElementById('activeGameContentContainer');
  if (!container) return;
  
  container.innerHTML = `<div class="text-center py-4 text-muted"><span class="spinner-border spinner-border-sm me-2"></span>Checking active sessions...</div>`;

  try {
    const client = window.db || db;
    const { data: playerData, error: playerErr } = await client
      .from('players')
      .select('currentgameid')
      .eq('playerid', playerId)
      .single();

    if (playerErr) throw playerErr;

    if (playerData && playerData.currentgameid) {
      const { data: gameData, error: gameErr } = await client
        .from('game')
        .select('*')
        .eq('gameid', playerData.currentgameid)
        .single();

      if (gameErr) throw gameErr;

      container.innerHTML = `
        <div class="alert alert-success mb-3">
          <i class="bi bi-check-circle-fill me-1"></i> Player is actively linked to an ongoing session.
        </div>
        <div class="p-3 bg-light rounded border">
          <div class="fw-bold text-primary fs-5">${escapeHtml(gameData ? gameData.gamename : 'Active Session')}</div>
          <div class="text-muted small mt-1">Game ID: ${playerData.currentgameid}</div>
          <div class="text-dark small mt-1">Started: ${gameData ? new Date(gameData.startdatetime).toLocaleString() : '--'}</div>
        </div>
      `;
    } else {
      container.innerHTML = `
        <div class="text-center py-4 text-muted">
          <i class="bi bi-slash-circle fs-2 d-block mb-2 text-secondary"></i>
          This player is not currently assigned to any active game session.
        </div>
      `;
    }
  } catch (err) {
    console.error("Error loading active game tab:", err);
    container.innerHTML = `<div class="text-danger small text-center py-3">Failed to load active game data.</div>`;
  }
}

// Tab 2: Match History & Logs
async function loadPlayerMatchHistoryTab(playerId) {
  const container = document.getElementById('matchHistoryContentContainer');
  if (!container) return;
  
  container.innerHTML = `<div class="text-center py-4 text-muted"><span class="spinner-border spinner-border-sm me-2"></span>Loading past matches...</div>`;

  try {
    const client = window.db || db;
    const { data: playerMatches, error: pmError } = await client
      .from('playermatch')
      .select(`
        teamid,
        match:matchid (
          matchid,
          team1_score,
          team2_score,
          startdatetime,
          enddatetime,
          game:gameid (
            gamename
          )
        )
      `)
      .eq('playerid', playerId);

    if (pmError) throw pmError;

    if (!playerMatches || playerMatches.length === 0) {
      container.innerHTML = `
        <div class="text-center py-4 text-muted">
          <i class="bi bi-journal-x fs-2 d-block mb-2"></i>
          No completed match history records found for this player.
        </div>
      `;
      return;
    }

    let listHtml = `
      <div class="list-group" style="max-height: 350px; overflow-y: auto;">
    `;

    playerMatches.forEach(pm => {
      const match = pm.match;
      if (!match) return;

      const gameName = match.game ? match.game.gamename : 'Open Match';
      const matchDate = match.startdatetime ? new Date(match.startdatetime).toLocaleString() : 'Recent';
      const teamId = pm.teamid;
      const scoreText = `Team 1 (${match.team1_score}) vs Team 2 (${match.team2_score})`;
      
      listHtml += `
        <button type="button" class="list-group-item list-group-item-action py-3 text-start" onclick="loadMatchDetailView(${match.matchid}, ${playerId})">
          <div class="d-flex w-100 justify-content-between align-items-center">
            <h6 class="mb-1 fw-bold text-primary"><i class="bi bi-controller me-1"></i>${escapeHtml(gameName)} (Match #${match.matchid})</h6>
            <small class="text-muted">${matchDate}</small>
          </div>
          <p class="mb-1 small text-dark">Score: <strong>${scoreText}</strong></p>
          <small class="text-secondary"><i class="bi bi-people me-1"></i>Player was on Team ${teamId} &bull; Click to view match details</small>
        </button>
      `;
    });

    listHtml += `</div>`;
    container.innerHTML = listHtml;

  } catch (err) {
    console.error("Error loading match history tab:", err);
    container.innerHTML = `<div class="text-danger small text-center py-3">Failed to load match history records.</div>`;
  }
}

// Upon clicking a match name, show specific player/match details
async function loadMatchDetailView(matchId, playerId) {
  const container = document.getElementById('matchHistoryContentContainer');
  if (!container) return;
  
  container.innerHTML = `<div class="text-center py-4 text-muted"><span class="spinner-border spinner-border-sm me-2"></span>Loading match details...</div>`;

  try {
    const client = window.db || db;
    const { data: matchData, error: matchErr } = await client
      .from('match')
      .select(`
        *,
        game:gameid(gamename),
        playermatch(
          teamid,
          player:playerid(playerid, name)
        )
      `)
      .eq('matchid', matchId)
      .single();

    if (matchErr) throw matchErr;

    let team1Players = [];
    let team2Players = [];

    if (matchData.playermatch) {
      matchData.playermatch.forEach(pm => {
        if (pm.player) {
          if (pm.teamid === 1) team1Players.push(pm.player.name);
          else if (pm.teamid === 2) team2Players.push(pm.player.name);
        }
      });
    }

    container.innerHTML = `
      <button type="button" class="btn btn-sm btn-outline-secondary mb-3" onclick="loadPlayerMatchHistoryTab(${playerId})">
        <i class="bi bi-arrow-left me-1"></i> Back to Match List
      </button>
      <div class="card border shadow-none p-3 bg-light">
        <h6 class="fw-bold text-dark mb-2"><i class="bi bi-info-circle me-1"></i>Match #${matchData.matchid} Details</h6>
        <div class="small text-muted mb-2">Session: ${escapeHtml(matchData.game ? matchData.game.gamename : 'N/A')}</div>
        <div class="row text-center my-2">
          <div class="col-5 p-2 bg-white rounded border">
            <div class="fw-bold text-primary">Team 1 (${matchData.team1_score} pts)</div>
            <div class="small text-muted mt-1">${team1Players.map(escapeHtml).join(', ') || 'None'}</div>
          </div>
          <div class="col-2 d-flex align-items-center justify-content-center fw-bold text-muted">VS</div>
          <div class="col-5 p-2 bg-white rounded border">
            <div class="fw-bold text-danger">Team 2 (${matchData.team2_score} pts)</div>
            <div class="small text-muted mt-1">${team2Players.map(escapeHtml).join(', ') || 'None'}</div>
          </div>
        </div>
      </div>
    `;

  } catch (err) {
    console.error("Error loading match details:", err);
    container.innerHTML = `<div class="text-danger small text-center py-3">Failed to load match detail view.</div>`;
  }
}