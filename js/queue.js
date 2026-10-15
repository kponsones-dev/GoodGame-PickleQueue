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
let activeCourtMatchesMap = {}; // { courtId: { match, team1Players, team2Players } }
let playerStatsMap = {}; // { playerId: { matches: 0, wins: 0, losses: 0 } }
let activeSessionId = null;
let activeSessionData = null;
let courtTimerInterval = null;

let editPlayerModalInstance = null;
let addCourtModalInstance = null;
let editCourtModalInstance = null;
let deleteCourtModalInstance = null;
let endMatchModalInstance = null;
let incompleteMatchModalInstance = null;

// Database-backed draft match pool array
let inMemoryMatchPool = [];

document.addEventListener("DOMContentLoaded", async () => {
  // Initialize layout.js header & footer
  initPageLayout("Queue & Matchmaking");

  editPlayerModalInstance = new bootstrap.Modal(document.getElementById('editPlayerModal'));
  addCourtModalInstance = new bootstrap.Modal(document.getElementById('addCourtModal'));
  editCourtModalInstance = new bootstrap.Modal(document.getElementById('editCourtModal'));
  deleteCourtModalInstance = new bootstrap.Modal(document.getElementById('deleteCourtModal'));
  endMatchModalInstance = new bootstrap.Modal(document.getElementById('endMatchModal'));
  incompleteMatchModalInstance = new bootstrap.Modal(document.getElementById('incompleteMatchModal'));

  setupSearchAutocompleteListener();

  await checkDbConnection();
  
  // Fetch active session first; redirects to index.html if none found
  const hasSession = await fetchActiveSession();
  if (!hasSession) return;

  await loadQueueData();
  await loadCourtsData();
  await loadDraftMatchesFromDb();

  // Start continuous ticker for active match court timers
  startCourtTimers();
});

// Start active match timer updates every second
function startCourtTimers() {
  if (courtTimerInterval) clearInterval(courtTimerInterval);
  courtTimerInterval = setInterval(updateCourtTimerDisplays, 1000);
}

// Update elapsed match time displays
function updateCourtTimerDisplays() {
  const now = new Date();

  Object.keys(activeCourtMatchesMap).forEach(courtId => {
    const matchInfo = activeCourtMatchesMap[courtId];
    if (!matchInfo || !matchInfo.match || !matchInfo.match.startdatetime) return;

    const timerEl = document.getElementById(`courtTimer_${courtId}`);
    if (!timerEl) return;

    const start = new Date(matchInfo.match.startdatetime);
    const diffMs = Math.max(0, now - start);

    const totalSeconds = Math.floor(diffMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    const formattedTime = `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
    timerEl.textContent = formattedTime;
  });
}

// Fetch active session and matchmaking game type (Redirects to index if none found)
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

      const titleEl = document.getElementById('sessionTitleDisplay');
      if (titleEl) titleEl.textContent = activeSessionData.gamename || "Active Matchmaking Session";

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
      return true;
    } else {
      showToast("No active session found. Redirecting...", "warning");
      setTimeout(() => {
        window.location.href = 'index.html';
      }, 1500);
      return false;
    }
  } catch (err) {
    console.error("Error fetching active session:", err);
    showToast("Error fetching active session. Redirecting...", "danger");
    setTimeout(() => {
      window.location.href = 'index.html';
    }, 1500);
    return false;
  }
}

// Fetch session courts and their active ongoing matches
async function loadCourtsData() {
  const container = document.getElementById('courtsContainer');
  if (!container || !activeSessionId) return;

  try {
    const { data: courts, error: courtErr } = await db
      .from('courts')
      .select('*')
      .eq('gameid', activeSessionId)
      .order('courtid', { ascending: true });

    if (courtErr) throw courtErr;

    sessionCourts = courts || [];

    // Fetch active ongoing matches (where enddatetime IS NULL)
    const { data: activeMatches, error: matchErr } = await db
      .from('match')
      .select('*, playermatch(*, players(*))')
      .eq('gameid', activeSessionId)
      .is('enddatetime', null)
      .not('courtid', 'is', null);

    if (matchErr) throw matchErr;

    activeCourtMatchesMap = {};
    (activeMatches || []).forEach(m => {
      const t1 = (m.playermatch || []).filter(pm => pm.teamid === 1).map(pm => pm.players).filter(Boolean);
      const t2 = (m.playermatch || []).filter(pm => pm.teamid === 2).map(pm => pm.players).filter(Boolean);
      activeCourtMatchesMap[m.courtid] = {
        match: m,
        team1Players: [t1[0] || null, t1[1] || null],
        team2Players: [t2[0] || null, t2[1] || null]
      };
    });

    renderCourtsUI();
    renderMatchPoolUI();
    updateCourtTimerDisplays();
  } catch (err) {
    console.warn("Could not load courts from DB:", err.message);
    container.innerHTML = `<div class="col-12 text-center py-2 text-muted small"><i class="bi bi-info-circle me-1"></i>No courts configured yet. Click "Add Court" to set up courts.</div>`;
  }
}

// Load draft/queued matches from database sorted by matchid ascending
async function loadDraftMatchesFromDb() {
  if (!activeSessionId) return;

  try {
    const { data: drafts, error } = await db
      .from('match')
      .select('*, playermatch(*, players(*))')
      .eq('gameid', activeSessionId)
      .is('courtid', null)
      .is('enddatetime', null)
      .order('matchid', { ascending: true });

    if (error) throw error;

    inMemoryMatchPool = [];

    (drafts || []).forEach(d => {
      const t1Players = (d.playermatch || []).filter(pm => pm.teamid === 1).map(pm => pm.players).filter(Boolean);
      const t2Players = (d.playermatch || []).filter(pm => pm.teamid === 2).map(pm => pm.players).filter(Boolean);

      const isAuto = d.is_auto_fill !== undefined ? d.is_auto_fill : true;

      inMemoryMatchPool.push({
        id: d.matchid,
        isAutoFill: isAuto,
        assignedCourtId: "ANY",
        team1: [t1Players[0] || null, t1Players[1] || null],
        team2: [t2Players[0] || null, t2Players[1] || null]
      });
    });

    renderMatchPoolUI();
  } catch (err) {
    console.error("Failed to load draft matches from DB:", err);
  }
}

// Render session courts with original UI layout
function renderCourtsUI() {
  const container = document.getElementById('courtsContainer');
  if (!container) return;

  if (sessionCourts.length === 0) {
    container.innerHTML = `
      <div class="col-12 text-center py-3 text-muted small">
        No courts added to this session. Click <strong>"Add Court"</strong> above to create courts.
      </div>`;
    return;
  }

  container.innerHTML = '';

  sessionCourts.forEach(court => {
    const col = document.createElement('div');
    col.className = 'col-12 col-sm-6 col-md-4 col-lg-4';

    const courtMatchInfo = activeCourtMatchesMap[court.courtid];
    let matchContent = '';

    if (courtMatchInfo) {
      const matchId = courtMatchInfo.match.matchid;

      const buildActiveCourtPlayerSelect = (teamKey, playerIndex) => {
        const teamArr = courtMatchInfo[teamKey === 'team1' ? 'team1Players' : 'team2Players'];
        const currentSelectedPlayer = teamArr[playerIndex];
        const selectedId = currentSelectedPlayer ? currentSelectedPlayer.playerid : "";

        const currentCardPlayerIds = [];
        [...courtMatchInfo.team1Players, ...courtMatchInfo.team2Players].forEach(p => {
          if (p && p.playerid) currentCardPlayerIds.push(parseInt(p.playerid, 10));
        });

        const busyOnOtherCourts = new Set();
        Object.keys(activeCourtMatchesMap).forEach(otherCourtId => {
          if (parseInt(otherCourtId, 10) === parseInt(court.courtid, 10)) return;
          const otherInfo = activeCourtMatchesMap[otherCourtId];
          if (otherInfo) {
            [...otherInfo.team1Players, ...otherInfo.team2Players].forEach(p => {
              if (p && p.playerid) busyOnOtherCourts.add(parseInt(p.playerid, 10));
            });
          }
        });

        const sessionPlayers = allPlayers.filter(p => p.currentgameid === activeSessionId && p.is_checked_in !== false);

        let options = '<option value="">-- Select Player --</option>';
        sessionPlayers.forEach(p => {
          const pId = parseInt(p.playerid, 10);
          const isSelectedHere = selectedId == pId;
          const isDuplicateInCard = currentCardPlayerIds.includes(pId) && !isSelectedHere;
          const isBusyElsewhere = busyOnOtherCourts.has(pId);

          if (!isDuplicateInCard && !isBusyElsewhere) {
            options += `<option value="${p.playerid}" ${isSelectedHere ? 'selected' : ''}>${escapeHtml(p.name)}</option>`;
          }
        });

        return `
          <select class="form-select form-select-sm mb-1" style="font-size: 0.8rem;" onchange="handleActiveCourtPlayerChange(${matchId}, ${court.courtid}, '${teamKey}', ${playerIndex}, this)">
            ${options}
          </select>
        `;
      };

      matchContent = `
        <div class="mt-2 p-2 bg-primary bg-opacity-10 border border-primary border-opacity-25 rounded text-start w-100">
          <div class="small fw-bold text-primary mb-1 d-flex align-items-center justify-content-between">
            <span class="text-dark fw-bold" style="font-size:0.75rem;"><i class="bi bi-stopwatch text-danger me-1"></i><span id="courtTimer_${court.courtid}">0m 00s</span></span>
            <span class="badge bg-primary text-white" style="font-size:0.65rem;">Active Match</span>
          </div>

          <div class="mb-1">
            <span class="small fw-bold text-muted" style="font-size:0.7rem;">TEAM 1</span>
            ${buildActiveCourtPlayerSelect('team1', 0)}
            ${buildActiveCourtPlayerSelect('team1', 1)}
          </div>

          <div class="small text-muted text-center fw-bold my-1" style="font-size:0.7rem;">VS</div>

          <div class="mb-2">
            <span class="small fw-bold text-muted" style="font-size:0.7rem;">TEAM 2</span>
            ${buildActiveCourtPlayerSelect('team2', 0)}
            ${buildActiveCourtPlayerSelect('team2', 1)}
          </div>

          <button class="btn btn-sm btn-outline-success w-100 fw-bold" style="font-size: 0.8rem;" onclick="openEndMatchPrompt(${courtMatchInfo.match.matchid}, ${court.courtid})">
            <i class="bi bi-check-circle-fill me-1"></i> End Match
          </button>
        </div>
      `;
    } else if (court.isactive === false) {
      matchContent = `
        <div class="mt-2 py-2 px-2 bg-secondary bg-opacity-10 border border-secondary border-opacity-25 rounded w-100 text-center">
          <span class="text-secondary small fw-bold"><i class="bi bi-slash-circle me-1"></i>Disabled</span>
        </div>
      `;
    } else {
      matchContent = `
        <div class="mt-2 py-2 px-2 bg-light border border-dashed rounded w-100 text-center">
          <span class="text-success small fw-bold"><i class="bi bi-check2-circle me-1"></i>Available</span>
        </div>
      `;
    }

    col.innerHTML = `
      <div class="card h-100 border text-center shadow-sm">
        <div class="card-body p-2 px-3 d-flex flex-column justify-content-between align-items-center">
          <div class="d-flex justify-content-between align-items-center w-100 mb-1">
            <h6 class="fw-bold mb-0 text-dark text-truncate text-start pe-2">${escapeHtml(court.courtname)}</h6>
            <div class="d-flex align-items-center gap-2">
              <i class="bi bi-pencil-fill text-muted text-hover-primary" style="cursor:pointer;" onclick="openEditCourtModal(${court.courtid})" title="Edit Court"></i>
              <i class="bi bi-trash text-muted text-hover-danger" style="cursor:pointer;" onclick="deleteCourt(${court.courtid})" title="Delete Court"></i>
            </div>
          </div>
          ${matchContent}
        </div>
      </div>
    `;

    container.appendChild(col);
  });
}

async function handleActiveCourtPlayerChange(matchId, courtId, teamKey, playerIndex, selectElement) {
  const selectedPlayerId = selectElement.value;
  const courtInfo = activeCourtMatchesMap[courtId];
  if (!courtInfo) return;

  const targetTeamArr = teamKey === 'team1' ? courtInfo.team1Players : courtInfo.team2Players;

  if (!selectedPlayerId) {
    targetTeamArr[playerIndex] = null;
    await persistActiveCourtPlayerChanges(matchId, courtInfo.team1Players, courtInfo.team2Players);
    return;
  }

  const pIdNum = parseInt(selectedPlayerId, 10);

  const currentCardIds = [];
  [...courtInfo.team1Players, ...courtInfo.team2Players].forEach((p, idx) => {
    const isTargetSlot = (teamKey === 'team1' && idx === playerIndex) || (teamKey === 'team2' && idx === playerIndex + 2);
    if (p && p.playerid && !isTargetSlot) {
      currentCardIds.push(parseInt(p.playerid, 10));
    }
  });

  if (currentCardIds.includes(pIdNum)) {
    showToast("This player is already assigned in this match!", "warning");
    selectElement.value = targetTeamArr[playerIndex] ? targetTeamArr[playerIndex].playerid : "";
    return;
  }

  let isBusyElsewhere = false;
  Object.keys(activeCourtMatchesMap).forEach(otherId => {
    if (parseInt(otherId, 10) === parseInt(courtId, 10)) return;
    const otherInfo = activeCourtMatchesMap[otherId];
    if (otherInfo) {
      [...otherInfo.team1Players, ...otherInfo.team2Players].forEach(p => {
        if (p && parseInt(p.playerid, 10) === pIdNum) isBusyElsewhere = true;
      });
    }
  });

  if (isBusyElsewhere) {
    showToast("This player is currently playing on another active court!", "danger");
    selectElement.value = targetTeamArr[playerIndex] ? targetTeamArr[playerIndex].playerid : "";
    return;
  }

  const foundPlayer = allPlayers.find(p => p.playerid == pIdNum);
  targetTeamArr[playerIndex] = foundPlayer || { playerid: pIdNum, name: 'Unknown' };

  await persistActiveCourtPlayerChanges(matchId, courtInfo.team1Players, courtInfo.team2Players);
  showToast("Active court players updated successfully!", "success");
  await loadCourtsData();
}

async function persistActiveCourtPlayerChanges(matchId, t1Arr, t2Arr) {
  try {
    await db.from('playermatch').delete().eq('matchid', matchId);

    const records = [];
    t1Arr.forEach(p => {
      if (p) records.push({ matchid: matchId, playerid: p.playerid || p, teamid: 1 });
    });
    t2Arr.forEach(p => {
      if (p) records.push({ matchid: matchId, playerid: p.playerid || p, teamid: 2 });
    });

    if (records.length > 0) {
      await db.from('playermatch').insert(records);
    }
  } catch (err) {
    console.error("Failed to update active court players in DB:", err);
    showToast("Failed to update players on court: " + err.message, "danger");
  }
}

// Open End Match Prompt with validation for required player count
async function openEndMatchPrompt(matchId, courtId) {
  const matchInfo = activeCourtMatchesMap[courtId];
  if (!matchInfo) return;

  const t1Valid = matchInfo.team1Players.filter(Boolean);
  const t2Valid = matchInfo.team2Players.filter(Boolean);

  // Check if court has incomplete or missing players (< 4 total players assigned)
  if (t1Valid.length + t2Valid.length < 4) {
    document.getElementById('incompleteMatchId').value = matchId;
    document.getElementById('incompleteMatchCourtId').value = courtId;
    incompleteMatchModalInstance.show();
    return;
  }

  const t1Names = t1Valid.map(p => p.name).join(' & ');
  const t2Names = t2Valid.map(p => p.name).join(' & ');

  document.getElementById('endMatchId').value = matchId;
  document.getElementById('endMatchCourtId').value = courtId;
  document.getElementById('team1NamesLabel').textContent = t1Names || 'Team 1';
  document.getElementById('team2NamesLabel').textContent = t2Names || 'Team 2';

  document.getElementById('team1ScoreInput').value = '';
  document.getElementById('team2ScoreInput').value = '';
  document.getElementById('endMatchErrorAlert').classList.add('d-none');

  endMatchModalInstance.show();
}

async function executeDeleteIncompleteMatch() {
  const matchId = document.getElementById('incompleteMatchId').value;

  try {
    await db.from('playermatch').delete().eq('matchid', matchId);
    await db.from('match').delete().eq('matchid', matchId);

    incompleteMatchModalInstance.hide();
    showToast("Incomplete match disregarded and deleted successfully.", "info");
    await loadCourtsData();
    await loadQueueData();
  } catch (err) {
    console.error("Error deleting incomplete match:", err);
    showToast("Failed to delete match: " + err.message, "danger");
  }
}

async function handleSaveEndMatch() {
  const matchId = document.getElementById('endMatchId').value;
  const score1Raw = document.getElementById('team1ScoreInput').value.trim();
  const score2Raw = document.getElementById('team2ScoreInput').value.trim();
  const errBox = document.getElementById('endMatchErrorAlert');
  const errText = document.getElementById('endMatchErrorMessage');
  const saveBtn = document.getElementById('saveEndMatchBtn');

  errBox.classList.add('d-none');

  const score1 = score1Raw === '' ? 0 : parseInt(score1Raw, 10);
  const score2 = score2Raw === '' ? 0 : parseInt(score2Raw, 10);

  if (isNaN(score1) || isNaN(score2) || score1 < 0 || score2 < 0) {
    errText.textContent = "Scores must be valid non-negative numbers.";
    errBox.classList.remove('d-none');
    return;
  }

  if (score1 === score2) {
    errText.textContent = "Matches cannot end in a tie score.";
    errBox.classList.remove('d-none');
    return;
  }

  const maxScore = Math.max(score1, score2);
  const minScore = Math.min(score1, score2);
  const scoreDiff = maxScore - minScore;

  if (maxScore < 11) {
    errText.textContent = "Winning score must be at least 11 points.";
    errBox.classList.remove('d-none');
    return;
  }

  if (maxScore > 11 && scoreDiff < 2) {
    errText.textContent = `Invalid score (${score1}-${score2}). Past 11 points, a team must win by 2 or more points!`;
    errBox.classList.remove('d-none');
    return;
  }

  let winningTeam = score1 > score2 ? 1 : 2;

  saveBtn.disabled = true;
  saveBtn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span>Saving...`;

  try {
    const { error } = await db
      .from('match')
      .update({
        team1_score: score1,
        team2_score: score2,
        winning_team: winningTeam,
        enddatetime: new Date().toISOString()
      })
      .eq('matchid', matchId);

    if (error) throw error;

    endMatchModalInstance.hide();
    showToast("Match completed and scores saved successfully!", "success");
    await loadCourtsData();
    await loadQueueData();
  } catch (err) {
    console.error("Error completing match:", err);
    errText.textContent = "Failed to save match: " + err.message;
    errBox.classList.remove('d-none');
  } finally {
    saveBtn.disabled = false;
    saveBtn.innerHTML = `<i class="bi bi-check-circle me-1"></i> Save Results`;
  }
}

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

function openEditCourtModal(courtId) {
  const court = sessionCourts.find(c => c.courtid === courtId);
  if (!court) return;

  if (activeCourtMatchesMap[courtId]) {
    showToast("Cannot edit or disable this court while a match is actively running!", "warning");
    return;
  }

  document.getElementById('editCourtId').value = court.courtid;
  document.getElementById('editCourtNameInput').value = court.courtname || '';
  document.getElementById('editCourtIsActiveSwitch').checked = court.isactive !== false;

  editCourtModalInstance.show();
}

async function handleSaveCourtEdit() {
  const courtId = document.getElementById('editCourtId').value;
  const courtName = document.getElementById('editCourtNameInput').value.trim();
  const isActive = document.getElementById('editCourtIsActiveSwitch').checked;
  const saveBtn = document.getElementById('saveEditCourtBtn');

  if (!courtName || !courtId) {
    showToast("Please enter a valid court name.", "warning");
    return;
  }

  if (activeCourtMatchesMap[courtId]) {
    showToast("Cannot modify court state while a match is running.", "danger");
    editCourtModalInstance.hide();
    return;
  }

  saveBtn.disabled = true;

  try {
    const { error } = await db
      .from('courts')
      .update({
        courtname: courtName,
        isactive: isActive
      })
      .eq('courtid', courtId);

    if (error) throw error;

    showToast(`Updated "${courtName}" successfully!`, "success");
    editCourtModalInstance.hide();
    await loadCourtsData();
  } catch (err) {
    console.error("Failed to update court:", err);
    showToast("Failed to update court: " + err.message, "danger");
  } finally {
    saveBtn.disabled = false;
  }
}

async function deleteCourt(courtId) {
  const court = sessionCourts.find(c => c.courtid === courtId);
  if (!court) return;

  if (activeCourtMatchesMap[courtId]) {
    showToast("Cannot delete a court while an active match is in progress! End the match first.", "warning");
    return;
  }

  document.getElementById('deleteCourtId').value = court.courtid;
  document.getElementById('deleteCourtName').textContent = court.courtname;
  deleteCourtModalInstance.show();
}

async function executeDeleteCourt() {
  const courtId = document.getElementById('deleteCourtId').value;

  if (activeCourtMatchesMap[courtId]) {
    showToast("Action blocked: Court currently has an active match.", "danger");
    deleteCourtModalInstance.hide();
    return;
  }

  try {
    const { error } = await db
      .from('courts')
      .delete()
      .eq('courtid', courtId);

    if (error) throw error;

    deleteCourtModalInstance.hide();
    showToast("Court deleted successfully!", "info");
    await loadCourtsData();
    await loadQueueData();
  } catch (err) {
    console.error("Failed to delete court:", err);
    showToast("Failed to delete court: " + err.message, "danger");
  }
}

async function fetchSessionPlayerStats() {
  playerStatsMap = {};
  if (!activeSessionId) return;

  try {
    const { data: matches, error } = await db
      .from('match')
      .select('*, playermatch(*)')
      .eq('gameid', activeSessionId);

    if (error || !matches) return;

    matches.forEach(m => {
      const playerMatches = m.playermatch || [];
      const winner = m.winning_team;

      playerMatches.forEach(pm => {
        const pId = pm.playerid;
        if (!playerStatsMap[pId]) {
          playerStatsMap[pId] = { matches: 0, wins: 0, losses: 0 };
        }
        playerStatsMap[pId].matches += 1;

        if (winner && pm.teamid === winner) {
          playerStatsMap[pId].wins += 1;
        } else if (winner && pm.teamid !== winner) {
          playerStatsMap[pId].losses += 1;
        }
      });
    });
  } catch (err) {
    console.warn("Could not calculate match stats:", err.message);
  }
}

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

function renderQueueUI() {
  renderActiveQueuePool();
  renderCheckedOutList();
}

function renderActiveQueuePool() {
  const container = document.getElementById('rosterContainer');
  const badge = document.getElementById('queuePlayerCountBadge');

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
    return;
  }

  container.innerHTML = '';

  sessionPlayers.forEach((player) => {
    const stats = playerStatsMap[player.playerid] || { matches: 0, wins: 0, losses: 0 };

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

    const statsDisplay = `
      <div class="d-flex align-items-center gap-1 ms-2 ps-2 border-start small text-muted" style="font-size:0.75rem;">
        <span class="badge bg-white text-dark border px-1 py-0" title="Total Matches Played">Matches: <strong>${stats.matches}</strong></span>
        <span class="badge bg-success bg-opacity-10 text-success border border-success px-1 py-0" title="Wins">W: <strong>${stats.wins}</strong></span>
        <span class="badge bg-danger bg-opacity-10 text-danger border border-danger px-1 py-0" title="Losses">L: <strong>${stats.losses}</strong></span>
      </div>
    `;

    tag.innerHTML = `
      <i class="bi bi-person-fill text-primary"></i>
      <span class="fw-semibold text-dark">${escapeHtml(player.name)}</span>
      ${ratingBadge}
      ${genderBadge}
      ${idBadge}
      ${statsDisplay}
      <i class="bi bi-box-arrow-right text-warning ms-1" style="cursor:pointer;" onclick="checkOutPlayer(${player.playerid})" title="Check Out Player"></i>
      <i class="bi bi-pencil-fill text-muted text-hover-primary ms-1" style="cursor:pointer;" onclick="openEditPlayerModal(${player.playerid})" title="Edit Player"></i>
      <i class="bi bi-x-circle-fill text-muted text-hover-danger" style="cursor:pointer;" onclick="removePlayerFromSession(${player.playerid})" title="Remove from session"></i>
    `;
    container.appendChild(tag);
  });
}

function renderCheckedOutList() {
  const container = document.getElementById('checkedOutContainer');
  const badge = document.getElementById('checkedOutPlayerCountBadge');

  if (!container) return;

  const checkedOutPlayers = allPlayers.filter(p => p.currentgameid === activeSessionId && p.is_checked_in === false);

  if (badge) badge.textContent = `${checkedOutPlayers.length} Player${checkedOutPlayers.length === 1 ? '' : 's'}`;

  if (checkedOutPlayers.length === 0) {
    container.innerHTML = `<span class="text-muted small italic text-center py-3">No checked out players.</span>`;
    container.className = 'd-flex flex-column gap-2';
    return;
  }

  container.innerHTML = '';
  container.className = 'd-flex flex-wrap gap-2 align-items-center p-3 bg-light rounded border border-dashed';

  checkedOutPlayers.forEach(player => {
    const stats = playerStatsMap[player.playerid] || { matches: 0, wins: 0, losses: 0 };

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

    const statsDisplay = `
      <div class="d-flex align-items-center gap-1 ms-2 ps-2 border-start small text-muted" style="font-size:0.75rem;">
        <span class="badge bg-white text-dark border px-1 py-0" title="Total Matches Played">Matches: <strong>${stats.matches}</strong></span>
        <span class="badge bg-success bg-opacity-10 text-success border border-success px-1 py-0" title="Wins">W: <strong>${stats.wins}</strong></span>
        <span class="badge bg-danger bg-opacity-10 text-danger border border-danger px-1 py-0" title="Losses">L: <strong>${stats.losses}</strong></span>
      </div>
    `;

    tag.innerHTML = `
      <i class="bi bi-person-dash text-secondary"></i>
      <span class="fw-semibold text-dark">${escapeHtml(player.name)}</span>
      ${ratingBadge}
      ${genderBadge}
      ${idBadge}
      ${statsDisplay}
      <button type="button" class="btn btn-xs btn-success d-flex align-items-center gap-1 py-0 px-2 ms-1 fw-medium" style="font-size:0.75rem;" onclick="checkInPlayer(${player.playerid})" title="Check In Player">
        <i class="bi bi-box-arrow-in-right"></i> Check In
      </button>
    `;

    container.appendChild(tag);
  });
}

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
    renderMatchPoolUI();
  } catch (err) {
    console.error("Error checking in player:", err);
    const player = allPlayers.find(p => p.playerid === playerId);
    if (player) player.is_checked_in = true;
    renderQueueUI();
    renderMatchPoolUI();
  }
}

async function checkOutPlayer(playerId) {
  let isPlayingOnActiveCourt = false;
  Object.values(activeCourtMatchesMap).forEach(courtInfo => {
    if (courtInfo && courtInfo.team1Players && courtInfo.team2Players) {
      [...courtInfo.team1Players, ...courtInfo.team2Players].forEach(p => {
        if (p && parseInt(p.playerid, 10) === parseInt(playerId, 10)) {
          isPlayingOnActiveCourt = true;
        }
      });
    }
  });

  if (isPlayingOnActiveCourt) {
    const pObj = allPlayers.find(p => p.playerid === playerId);
    const pName = pObj ? pObj.name : `ID:${playerId}`;
    showToast(`Cannot check out ${pName}: Player is currently playing in an active court!`, "danger");
    return;
  }

  try {
    const { error } = await db
      .from('players')
      .update({ is_checked_in: false })
      .eq('playerid', playerId);

    if (error) throw error;

    const player = allPlayers.find(p => p.playerid === playerId);
    if (player) player.is_checked_in = false;

    let draftUpdated = false;
    for (let match of inMemoryMatchPool) {
      let modified = false;

      match.team1 = match.team1.map(p => {
        if (!p) return null;
        const pId = typeof p === 'object' ? p.playerid : p;
        if (parseInt(pId, 10) === parseInt(playerId, 10)) {
          modified = true;
          draftUpdated = true;
          return null;
        }
        return p;
      });

      match.team2 = match.team2.map(p => {
        if (!p) return null;
        const pId = typeof p === 'object' ? p.playerid : p;
        if (parseInt(pId, 10) === parseInt(playerId, 10)) {
          modified = true;
          draftUpdated = true;
          return null;
        }
        return p;
      });

      if (modified) {
        await saveDraftPlayerLinks(match.id, match.team1, match.team2, match.isAutoFill);
      }
    }

    if (draftUpdated) {
      renderMatchPoolUI();
      showToast("Player checked out and removed from draft matches.", "info");
    } else {
      showToast("Player checked out.", "info");
    }

    renderQueueUI();
  } catch (err) {
    console.error("Error checking out player:", err);
    showToast("Failed to check out player: " + err.message, "danger");
  }
}

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
  document.getElementById('multiLineCounter').textContent = `${names.length} name(s) detected`;
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
  }
}

async function endCurrentSession() {
  if (!activeSessionId) return;
  if (!confirm("Are you sure you want to end the current session? All uncompleted/draft matches will be deleted, and all players will be unassigned from this session.")) return;

  try {
    // 1. Fetch all uncompleted match IDs for this session (enddatetime IS NULL)
    const { data: uncompletedMatches, error: fetchErr } = await db
      .from('match')
      .select('matchid')
      .eq('gameid', activeSessionId)
      .is('enddatetime', null);

    if (fetchErr) throw fetchErr;

    if (uncompletedMatches && uncompletedMatches.length > 0) {
      const matchIds = uncompletedMatches.map(m => m.matchid);

      // 2. Delete associated playermatch records for uncompleted matches
      const { error: pmDeleteErr } = await db
        .from('playermatch')
        .delete()
        .in('matchid', matchIds);

      if (pmDeleteErr) throw pmDeleteErr;

      // 3. Delete uncompleted match records themselves
      const { error: matchDeleteErr } = await db
        .from('match')
        .delete()
        .eq('gameid', activeSessionId)
        .is('enddatetime', null);

      if (matchDeleteErr) throw matchDeleteErr;
    }

    // 4. Unassign all players from this session
    const { error: playerErr } = await db
      .from('players')
      .update({ currentgameid: null, is_checked_in: null })
      .eq('currentgameid', activeSessionId);

    if (playerErr) throw playerErr;

    // 5. Mark the game session as ended
    const { error: gameErr } = await db
      .from('game')
      .update({ enddatetime: new Date().toISOString() })
      .eq('gameid', activeSessionId);

    if (gameErr) throw gameErr;

    showToast("Session ended and uncompleted matches cleared successfully.", "success");
    setTimeout(() => {
      window.location.href = 'index.html';
    }, 1000);
  } catch (err) {
    console.error("Error ending session:", err);
    showToast("Failed to end session: " + err.message, "danger");
  }
}

async function generateMatches() {
  if (!activeSessionData) {
    showToast("No active session found.", "warning");
    return;
  }

  const assignedPlayerIds = getAllAssignedPlayerIds();
  const availablePlayers = allPlayers.filter(p => 
    p.currentgameid === activeSessionId && 
    p.is_checked_in !== false && 
    !assignedPlayerIds.has(p.playerid)
  );

  if (availablePlayers.length < 4) {
    showToast("Not enough available unique players to generate a new match!", "warning");
    return;
  }

  try {
    const { data: newMatch, error: matchErr } = await db
      .from('match')
      .insert([{
        gameid: activeSessionId,
        courtid: null,
        team1_score: 0,
        team2_score: 0,
        winning_team: null,
        startdatetime: null,
        enddatetime: null,
        is_auto_fill: true
      }])
      .select()
      .single();

    if (matchErr) throw matchErr;

    const newDraftMatch = {
      id: newMatch.matchid,
      isAutoFill: true,
      assignedCourtId: "ANY",
      team1: [null, null],
      team2: [null, null]
    };

    inMemoryMatchPool.push(newDraftMatch);
    inMemoryMatchPool.sort((a, b) => a.id - b.id);
    await triggerAutoFillForMatch(newDraftMatch.id);
    showToast("Generated and saved new match to queue!", "success");
  } catch (err) {
    console.error("Error generating match:", err);
    showToast("Failed to generate match: " + err.message, "danger");
  }
}

async function generateCustomMatch() {
  if (!activeSessionData) {
    showToast("No active session found.", "warning");
    return;
  }

  try {
    const { data: newMatch, error: matchErr } = await db
      .from('match')
      .insert([{
        gameid: activeSessionId,
        courtid: null,
        team1_score: 0,
        team2_score: 0,
        winning_team: null,
        startdatetime: null,
        enddatetime: null,
        is_auto_fill: false
      }])
      .select()
      .single();

    if (matchErr) throw matchErr;

    const newCustomMatch = {
      id: newMatch.matchid,
      isAutoFill: false,
      assignedCourtId: "ANY",
      team1: [null, null],
      team2: [null, null]
    };

    inMemoryMatchPool.push(newCustomMatch);
    inMemoryMatchPool.sort((a, b) => a.id - b.id);
    renderMatchPoolUI();
    showToast("Created custom match slot successfully!", "success");
  } catch (err) {
    console.error("Error creating custom match:", err);
    showToast("Failed to create custom match: " + err.message, "danger");
  }
}

async function triggerAutoFillForMatch(matchId) {
  const match = inMemoryMatchPool.find(m => m.id === matchId);
  if (!match) return;

  const assignedPlayerIds = getAllAssignedPlayerIds(matchId);
  const availablePlayers = allPlayers.filter(p => 
    p.currentgameid === activeSessionId && 
    p.is_checked_in !== false && 
    !assignedPlayerIds.has(p.playerid)
  );

  const activeCourts = sessionCourts.filter(c => c.isactive !== false);
  const { data: matchHistory } = await db.from('match').select('matchid, courtid, playermatch(playerid, teamid)').eq('gameid', activeSessionId);

  const formattedHistory = (matchHistory || []).map(m => ({
    matchid: m.matchid,
    courtid: m.courtid,
    team1_players: (m.playermatch || []).filter(pm => pm.teamid === 1).map(pm => pm.playerid),
    team2_players: (m.playermatch || []).filter(pm => pm.teamid === 2).map(pm => pm.playerid)
  }));

  const gameTypeId = activeSessionData ? activeSessionData.gametypeid : 1;
  let proposed = [];

  switch (gameTypeId) {
    case 1: proposed = generateSocialMixMatches(availablePlayers, activeCourts, formattedHistory); break;
    case 2: proposed = generateSkillSeparatedMatches(availablePlayers, activeCourts, formattedHistory); break;
    case 3: proposed = generateWinLoseMatches(availablePlayers, activeCourts, formattedHistory); break;
    case 4: proposed = generateMixedGenderMatches(availablePlayers, activeCourts, formattedHistory); break;
    default: proposed = generateSocialMixMatches(availablePlayers, activeCourts, formattedHistory); break;
  }

  if (proposed && proposed.length > 0) {
    match.team1 = proposed[0].team1;
    match.team2 = proposed[0].team2;
    await saveDraftPlayerLinks(matchId, match.team1, match.team2, match.isAutoFill);
  } else {
    showToast("Not enough available unique players to auto-fill.", "warning");
    match.isAutoFill = false;
    await updateDraftAutoFillFlag(matchId, false);
  }

  renderMatchPoolUI();
}

async function saveDraftPlayerLinks(matchId, team1Arr, team2Arr, isAutoFill = true) {
  try {
    await db.from('match').update({ is_auto_fill: isAutoFill }).eq('matchid', matchId);
    await db.from('playermatch').delete().eq('matchid', matchId);

    const records = [];
    team1Arr.forEach(p => {
      if (p) records.push({ matchid: matchId, playerid: p.playerid || p, teamid: 1 });
    });
    team2Arr.forEach(p => {
      if (p) records.push({ matchid: matchId, playerid: p.playerid || p, teamid: 2 });
    });

    if (records.length > 0) {
      await db.from('playermatch').insert(records);
    }
  } catch (err) {
    console.error("Error saving draft player linkages:", err);
  }
}

async function updateDraftAutoFillFlag(matchId, isAutoFill) {
  try {
    await db.from('match').update({ is_auto_fill: isAutoFill }).eq('matchid', matchId);
  } catch (err) {
    console.error("Error updating is_auto_fill flag:", err);
  }
}

function getAllAssignedPlayerIds(excludeMatchId = null) {
  const assigned = new Set();
  inMemoryMatchPool.forEach(m => {
    if (excludeMatchId && m.id === excludeMatchId) return;
    [...m.team1, ...m.team2].forEach(p => {
      if (p) {
        const pId = typeof p === 'object' ? p.playerid : p;
        if (pId) assigned.add(parseInt(pId, 10));
      }
    });
  });
  return assigned;
}

// Render Draft Matches sorted by database matchid
function renderMatchPoolUI() {
  const container = document.getElementById('matchesResultContainer');
  if (!container) return;

  inMemoryMatchPool.sort((a, b) => a.id - b.id);

  if (inMemoryMatchPool.length === 0) {
    container.innerHTML = `
      <div class="text-center py-5 text-muted">
        <i class="bi bi-diagram-3 fs-1 text-secondary opacity-50 mb-2 d-block"></i>
        <p class="mb-1 fw-semibold">No matches generated yet.</p>
        <p class="small text-muted">Click "Generate Matches" or "Custom Match" to create matchups for available courts.</p>
      </div>`;
    return;
  }

  container.innerHTML = `<div class="row g-3"></div>`;
  const row = container.querySelector('.row');

  const busyCourtIds = new Set(Object.keys(activeCourtMatchesMap).map(id => parseInt(id, 10)));
  const availableCourts = sessionCourts.filter(c => c.isactive !== false && !busyCourtIds.has(c.courtid));
  const sessionPlayers = allPlayers.filter(p => p.currentgameid === activeSessionId && p.is_checked_in !== false);

  inMemoryMatchPool.forEach((match, idx) => {
    const matchCol = document.createElement('div');
    matchCol.className = 'col-12 col-md-6 col-lg-4';

    const isAnySelected = match.assignedCourtId === "ANY" ? 'selected' : '';
    let courtOptions = `
      <option value="">-- Select Court --</option>
      <option value="ANY" ${isAnySelected}>Any Available Court</option>
    `;

    availableCourts.forEach(c => {
      const selected = match.assignedCourtId == c.courtid ? 'selected' : '';
      courtOptions += `<option value="${c.courtid}" ${selected}>${escapeHtml(c.courtname)}</option>`;
    });

    const buildPlayerSelect = (teamKey, playerIndex) => {
      const currentAssignedInThisCard = [];
      [...match.team1, ...match.team2].forEach((p) => {
        if (p) {
          const pId = typeof p === 'object' ? p.playerid : p;
          currentAssignedInThisCard.push(parseInt(pId, 10));
        }
      });

      const selectedValue = match[teamKey][playerIndex] 
        ? (typeof match[teamKey][playerIndex] === 'object' ? match[teamKey][playerIndex].playerid : match[teamKey][playerIndex])
        : "";

      let options = '<option value="">-- Select Player --</option>';
      sessionPlayers.forEach(p => {
        const pId = parseInt(p.playerid, 10);
        const isSelectedInThisSlot = selectedValue == pId;
        const isAssignedElsewhereInCard = currentAssignedInThisCard.includes(pId) && !isSelectedInThisSlot;

        const assignedInOtherCards = match.isAutoFill ? getAllAssignedPlayerIds(match.id) : new Set();
        const isAssignedElsewhereGlobal = assignedInOtherCards.has(pId);

        if (!isAssignedElsewhereInCard && (!match.isAutoFill || !isAssignedElsewhereGlobal || isSelectedInThisSlot)) {
          options += `<option value="${p.playerid}" ${isSelectedInThisSlot ? 'selected' : ''}>${escapeHtml(p.name)}</option>`;
        }
      });

      return `
        <select class="form-select form-select-sm mb-1" ${match.isAutoFill ? 'disabled' : ''} onchange="handleManualPlayerSelect(${match.id}, '${teamKey}', ${playerIndex}, this)">
          ${options}
        </select>
      `;
    };

    const autoFillSwitchHtml = match.isAutoFill ? `
      <div class="form-check form-switch mb-3 bg-light p-2 rounded d-flex align-items-center justify-content-between">
        <label class="form-check-label fw-semibold small text-dark mb-0 ms-1" for="autoFillSwitch_${match.id}">
          <i class="bi bi-magic text-primary me-1"></i> Auto-Fill Match
        </label>
        <input class="form-check-input mt-0 me-1" type="checkbox" role="switch" id="autoFillSwitch_${match.id}" ${match.isAutoFill ? 'checked' : ''} onchange="toggleAutoFill(${match.id}, this.checked)">
      </div>
    ` : `
      <div class="mb-2 bg-secondary bg-opacity-10 p-2 rounded d-flex align-items-center justify-content-between">
        <span class="small fw-bold text-secondary"><i class="bi bi-tools me-1"></i>Custom Match Mode</span>
      </div>
    `;

    matchCol.innerHTML = `
      <div class="card border shadow-sm h-100">
        <div class="card-header bg-light fw-bold d-flex justify-content-between align-items-center py-2">
          <span><i class="bi bi-diagram-3 me-1"></i> Draft Match #${idx + 1} <span class="text-muted fw-normal" style="font-size:0.75rem;">(ID: ${match.id})</span></span>
          <button class="btn-close text-danger" title="Remove Match Slot" onclick="removeDraftMatch(${match.id})"></button>
        </div>
        <div class="card-body p-3">
          ${autoFillSwitchHtml}

          <!-- Teams View -->
          <div class="mb-3 text-center">
            <div class="p-2 bg-light rounded mb-2 text-start">
              <small class="text-muted fw-bold d-block mb-1">TEAM 1</small>
              ${buildPlayerSelect('team1', 0)}
              ${buildPlayerSelect('team1', 1)}
            </div>

            <div class="fw-bold text-danger my-1 fs-6">VS</div>

            <div class="p-2 bg-light rounded text-start">
              <small class="text-muted fw-bold d-block mb-1">TEAM 2</small>
              ${buildPlayerSelect('team2', 0)}
              ${buildPlayerSelect('team2', 1)}
            </div>
          </div>

          <!-- Court Selection Dropdown -->
          <div class="mb-3">
            <label class="form-label small fw-semibold text-muted mb-1">Assign Court</label>
            <select class="form-select form-select-sm" onchange="handleCourtSelect(${match.id}, this.value)">
              ${courtOptions}
            </select>
          </div>

          <!-- Send to Court Button -->
          <button class="btn btn-sm btn-success w-100 fw-bold d-flex align-items-center justify-content-center gap-1" onclick="sendMatchToCourt(${match.id})">
            <i class="bi bi-send-fill"></i> Send to Court
          </button>
        </div>
      </div>
    `;

    row.appendChild(matchCol);
  });
}

async function removeDraftMatch(matchId) {
  try {
    await db.from('playermatch').delete().eq('matchid', matchId);
    await db.from('match').delete().eq('matchid', matchId);

    inMemoryMatchPool = inMemoryMatchPool.filter(m => m.id !== matchId);
    renderMatchPoolUI();
    showToast("Removed draft match.", "info");
  } catch (err) {
    console.error("Failed to delete draft match:", err);
    showToast("Failed to delete draft match: " + err.message, "danger");
  }
}

async function toggleAutoFill(matchId, isChecked) {
  const match = inMemoryMatchPool.find(m => m.id === matchId);
  if (!match) return;

  match.isAutoFill = isChecked;

  if (isChecked) {
    await triggerAutoFillForMatch(matchId);
  } else {
    await updateDraftAutoFillFlag(matchId, false);
    renderMatchPoolUI();
  }
}

async function handleManualPlayerSelect(matchId, teamKey, playerIndex, selectElement) {
  const selectedPlayerId = selectElement.value;
  const match = inMemoryMatchPool.find(m => m.id === matchId);
  if (!match) return;

  if (!selectedPlayerId) {
    match[teamKey][playerIndex] = null;
    await saveDraftPlayerLinks(matchId, match.team1, match.team2, match.isAutoFill);
    renderMatchPoolUI();
    return;
  }

  const pIdNum = parseInt(selectedPlayerId, 10);

  const currentCardPlayerIds = [];
  [...match.team1, ...match.team2].forEach((p, idx) => {
    const isCurrentSlot = (teamKey === 'team1' && idx === playerIndex) || (teamKey === 'team2' && idx === playerIndex + 2);
    if (p && !isCurrentSlot) {
      const pId = typeof p === 'object' ? p.playerid : p;
      if (pId) currentCardPlayerIds.push(parseInt(pId, 10));
    }
  });

  if (currentCardPlayerIds.includes(pIdNum)) {
    showToast("This player is already assigned in this match!", "warning");
    selectElement.value = "";
    match[teamKey][playerIndex] = null;
    return;
  }

  if (match.isAutoFill) {
    const assignedInOtherCards = getAllAssignedPlayerIds(matchId);
    if (assignedInOtherCards.has(pIdNum)) {
      showToast("This player is already assigned in another draft match card!", "warning");
      selectElement.value = "";
      match[teamKey][playerIndex] = null;
      return;
    }
  }

  const player = allPlayers.find(p => p.playerid == pIdNum);
  match[teamKey][playerIndex] = player || pIdNum;

  await saveDraftPlayerLinks(matchId, match.team1, match.team2, match.isAutoFill);
  renderMatchPoolUI();
}

function handleCourtSelect(matchId, courtIdValue) {
  const match = inMemoryMatchPool.find(m => m.id === matchId);
  if (!match) return;

  if (courtIdValue === "ANY") {
    match.assignedCourtId = "ANY";
  } else {
    match.assignedCourtId = courtIdValue ? parseInt(courtIdValue, 10) : null;
  }
}

async function sendMatchToCourt(matchId) {
  const match = inMemoryMatchPool.find(m => m.id === matchId);
  if (!match) return;

  const t1Valid = match.team1.filter(Boolean);
  const t2Valid = match.team2.filter(Boolean);

  if (t1Valid.length < 2 || t2Valid.length < 2) {
    showToast("Please assign 2 players to Team 1 and 2 players to Team 2 before sending.", "warning");
    return;
  }

  const playerIds = [...t1Valid, ...t2Valid].map(p => typeof p === 'object' ? p.playerid : p);
  const uniquePlayerIds = new Set(playerIds);

  if (uniquePlayerIds.size < 4) {
    showToast("Duplicate players detected in this match!", "danger");
    return;
  }

  const activeCourtPlayerIds = new Set();
  Object.values(activeCourtMatchesMap).forEach(courtInfo => {
    if (courtInfo && courtInfo.team1Players && courtInfo.team2Players) {
      [...courtInfo.team1Players, ...courtInfo.team2Players].forEach(p => {
        if (p && p.playerid) activeCourtPlayerIds.add(parseInt(p.playerid, 10));
      });
    }
  });

  const conflictingPlayers = playerIds.filter(id => activeCourtPlayerIds.has(parseInt(id, 10)));
  if (conflictingPlayers.length > 0) {
    const conflictingNames = conflictingPlayers.map(id => {
      const found = allPlayers.find(p => p.playerid == id);
      return found ? found.name : `ID:${id}`;
    }).join(', ');
    
    showToast(`Cannot send match: Player(s) [${conflictingNames}] are currently playing in an active court!`, "danger");
    return;
  }

  if (!match.assignedCourtId) {
    showToast("Please select a court option before sending.", "warning");
    return;
  }

  let finalCourtId = match.assignedCourtId;

  if (match.assignedCourtId === "ANY") {
    const busyCourtIds = new Set(Object.keys(activeCourtMatchesMap).map(id => parseInt(id, 10)));
    const availableCourt = sessionCourts.filter(c => c.isactive !== false && !busyCourtIds.has(c.courtid));

    if (!availableCourt || availableCourt.length === 0) {
      showToast("No active courts are currently available.", "warning");
      return;
    }

    finalCourtId = availableCourt[0].courtid;
  }

  if (activeCourtMatchesMap[finalCourtId]) {
    showToast(`Court is already occupied by an active match. Please select a different court.`, "danger");
    return;
  }

  try {
    await saveDraftPlayerLinks(matchId, t1Valid, t2Valid, match.isAutoFill);

    const { error: updateErr } = await db
      .from('match')
      .update({
        courtid: finalCourtId,
        startdatetime: new Date().toISOString()
      })
      .eq('matchid', matchId);

    if (updateErr) throw updateErr;

    const assignedCourtObj = sessionCourts.find(c => c.courtid === finalCourtId);
    const courtNameStr = assignedCourtObj ? assignedCourtObj.courtname : `Court #${finalCourtId}`;

    inMemoryMatchPool = inMemoryMatchPool.filter(m => m.id !== matchId);
    
    await loadCourtsData();
    await loadQueueData();
    await loadDraftMatchesFromDb();

    showToast(`Match successfully sent to ${courtNameStr}!`, "success");

  } catch (err) {
    console.error("Error sending match to court:", err);
    showToast("Failed to send match to court: " + err.message, "danger");
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