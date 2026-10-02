// Index Page State
let currentRoster = [];
let activeSessionData = null;
let timerInterval = null;
let activeSessionModalInstance = null;
let clearRosterModalInstance = null;
let editPlayerModalInstance = null;
let selectedSearchPlayer = null;
let tempSearchPlayerEdit = null;

// -------------------------------------------------------------
// INITIALIZATION
// -------------------------------------------------------------
document.addEventListener("DOMContentLoaded", async () => {
  activeSessionModalInstance = new bootstrap.Modal(document.getElementById('activeSessionModal'));
  clearRosterModalInstance = new bootstrap.Modal(document.getElementById('clearRosterModal'));
  editPlayerModalInstance = new bootstrap.Modal(document.getElementById('editPlayerModal'));

  setupSearchAutocompleteListener();
  
  renderRoster(); // Initial render for empty roster state
  await checkDbConnection();
  await checkForActiveGameSession();
});

document.addEventListener('addBulkPlayersSubmitted', (e) => {
  addMultiLinePlayers();
});

document.addEventListener('addSinglePlayerSubmitted', (e) => {
  addSinglePlayerFromInput();
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
  
  if (activeSessionData && activeSessionData.gameid) {
    showToast(`Resuming session "${activeSessionData.gamename}". Redirecting...`, "info");
    window.location.href = `queue.html?gameid=${activeSessionData.gameid}`;
  } else {
    window.location.href = 'queue.html';
  }
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

function searchPlayersInDb(query) {
  const dropdown = document.getElementById('autocompleteDropdown');
  
  db.from('players')
    .select('playerid, name, gender, ratingid')
    .ilike('name', `%${query}%`)
    .limit(5)
    .then(({ data, error }) => {
      if (error) throw error;

      dropdown.innerHTML = '';

      if (data && data.length > 0) {
        data.forEach(player => {
          const item = document.createElement('div');
          item.className = 'autocomplete-item border-bottom d-flex justify-content-between align-items-center p-2 bg-white';
          item.style.cursor = 'pointer';

          const idBadge = `<span class="badge bg-secondary bg-opacity-10 text-secondary border ms-1" style="font-size:0.65rem;">ID: ${player.playerid}</span>`;
          
          let ratingBadge = '';
          if (player.ratingid && RATING_MAP[player.ratingid]) {
            ratingBadge = `<span class="badge bg-warning bg-opacity-25 text-dark border border-warning" style="font-size:0.65rem;"><i class="bi bi-star-fill text-warning me-1"></i>${RATING_MAP[player.ratingid].value}</span>`;
          }

          let genderBadge = '';
          if (player.gender) {
            const genderText = player.gender === 'F' ? 'Female (F)' : 'Male (M)';
            genderBadge = `<span class="badge bg-info bg-opacity-10 text-info border border-info" style="font-size:0.65rem;">${genderText}</span>`;
          }

          const escapedName = escapeHtml(player.name).replace(/'/g, "\\'");
          const safeRatingId = player.ratingid !== null && player.ratingid !== undefined ? player.ratingid : 'null';
          const safeGender = player.gender ? player.gender : '';

          item.innerHTML = `
            <div class="d-flex align-items-center gap-2 flex-wrap">
              <i class="bi bi-person-fill text-primary"></i>
              <span class="fw-semibold text-dark">${escapeHtml(player.name)}</span>
              ${ratingBadge}
              ${genderBadge}
              ${idBadge}
            </div>
            <div class="d-flex align-items-center gap-1">
              <button type="button" class="btn btn-sm btn-outline-secondary py-0 px-1" title="Edit before adding" onclick="event.stopPropagation(); openEditExistingPlayerModal(${player.playerid}, '${escapedName}', ${safeRatingId}, '${safeGender}')">
                <i class="bi bi-pencil-fill"></i>
              </button>
            </div>
          `;
          
          item.onclick = () => selectAutocompletePlayer(player.playerid, player.name, player.ratingid, player.gender);
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

function selectAutocompletePlayer(playerId, name, ratingid, gender) {
  document.getElementById('singlePlayerInput').value = '';
  document.getElementById('autocompleteDropdown').classList.add('d-none');
  
  addPlayerToRoster(name, playerId, ratingid, gender, true);
}

function openEditExistingPlayerModal(playerId, name, ratingid, gender) {
  document.getElementById('autocompleteDropdown').classList.add('d-none');
  
  tempSearchPlayerEdit = {
    playerid: playerId,
    name: name,
    ratingid: ratingid !== null && ratingid !== undefined && !isNaN(ratingid) ? ratingid : null,
    gender: gender ? gender : null
  };

  document.getElementById('editPlayerIndex').value = 'temp';
  document.getElementById('editPlayerName').value = tempSearchPlayerEdit.name || '';
  document.getElementById('editPlayerGender').value = tempSearchPlayerEdit.gender || '';

  if (tempSearchPlayerEdit.ratingid) {
    setStarRating(tempSearchPlayerEdit.ratingid);
  } else {
    const stars = document.querySelectorAll('#starRatingContainer .style-star');
    stars.forEach(s => {
      s.classList.remove('bi-star-fill');
      s.classList.add('bi-star');
    });
    document.getElementById('editPlayerRatingId').value = '';
    document.getElementById('ratingValueBadge').textContent = 'Unassigned';
  }

  editPlayerModalInstance.show();
  document.getElementById('singlePlayerInput').value = '';
}

async function addSinglePlayerFromInput() {
  const input = document.getElementById('singlePlayerInput');
  const btn = document.getElementById('addSinglePlayerBtn');
  const name = input.value.trim();
  
  if (!name) {
    showToast("Please enter a player name.", "warning");
    return;
  }

  const isAlreadyInRoster = currentRoster.some(p => p.name.trim().toLowerCase() === name.toLowerCase());
  if (isAlreadyInRoster) {
    showToast(`"${name}" is already in the roster.`, "warning");
    input.value = '';
    selectedSearchPlayer = null;
    document.getElementById('autocompleteDropdown').classList.add('d-none');
    return;
  }

  if (selectedSearchPlayer) {
    const added = addPlayerToRoster(
      selectedSearchPlayer.name, 
      selectedSearchPlayer.playerid, 
      selectedSearchPlayer.ratingid, 
      selectedSearchPlayer.gender, 
      true
    );
    if (added) {
      input.value = '';
    }
    selectedSearchPlayer = null;
    document.getElementById('autocompleteDropdown').classList.add('d-none');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span>Checking...`;

  try {
    const { data: existingDbPlayers, error: searchErr } = await db
      .from('players')
      .select('playerid, name, gender, ratingid')
      .ilike('name', name);

    if (searchErr) throw searchErr;

    const exactMatch = existingDbPlayers ? existingDbPlayers.find(p => p.name.trim().toLowerCase() === name.toLowerCase()) : null;

    if (exactMatch) {
      addPlayerToRoster(
        exactMatch.name, 
        exactMatch.playerid, 
        exactMatch.ratingid, 
        exactMatch.gender, 
        false
      );
      showToast(`Found "${exactMatch.name}" in database and added to roster!`, "info");
      input.value = '';
    } else {
      btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span>Saving...`;
      
      const { data: newData, error: insertErr } = await db
        .from('players')
        .insert([{ name: name, ratingid: null, gender: null }])
        .select();

      if (insertErr) throw insertErr;

      const newPlayer = newData[0];
      addPlayerToRoster(
        newPlayer.name, 
        newPlayer.playerid, 
        newPlayer.ratingid, 
        newPlayer.gender, 
        false
      );
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
      const { data: existingDbPlayers } = await db.from('players').select('playerid, name, gender, ratingid').ilike('name', name);
      const exactMatch = existingDbPlayers ? existingDbPlayers.find(p => p.name.trim().toLowerCase() === name.toLowerCase()) : null;

      if (exactMatch) {
        addPlayerToRoster(
          exactMatch.name, 
          exactMatch.playerid, 
          exactMatch.ratingid, 
          exactMatch.gender, 
          false
        );
        addedCount++;
      } else {
        const { data: newData } = await db.from('players').insert([{ name: name, ratingid: null, gender: null }]).select();
        if (newData && newData.length > 0) {
          addPlayerToRoster(
            newData[0].name, 
            newData[0].playerid, 
            newData[0].ratingid, 
            newData[0].gender, 
            false
          );
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
// ROSTER MANAGEMENT & EDIT MODAL HANDLERS
// -------------------------------------------------------------
function addPlayerToRoster(name, playerId, ratingid = null, gender = null, showNotification = true) {
  const cleanName = name.trim();

  const exists = currentRoster.some(p => {
    const sameId = playerId && p.playerid && String(p.playerid) === String(playerId);
    const sameName = p.name.trim().toLowerCase() === cleanName.toLowerCase();
    return sameId || sameName;
  });

  if (exists) {
    showToast(`"${cleanName}" is already added to the roster!`, "warning");
    return false;
  }

  let validGender = null;
  if (gender) {
    const upperG = String(gender).trim().toUpperCase();
    if (upperG === 'M' || upperG === 'MALE') validGender = 'M';
    else if (upperG === 'F' || upperG === 'FEMALE') validGender = 'F';
  }

  let validRatingId = null;
  if (ratingid !== null && ratingid !== undefined && ratingid !== '') {
    const parsedRating = parseInt(ratingid, 10);
    if (!isNaN(parsedRating)) validRatingId = parsedRating;
  }

  currentRoster.push({
    playerid: playerId,
    name: cleanName,
    ratingid: validRatingId,
    gender: validGender
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

  const modalEl = document.getElementById('clearRosterModal');
  const modalInstance = bootstrap.Modal.getInstance(modalEl) || clearRosterModalInstance;
  if (modalInstance) {
    modalInstance.hide();
  }

  showToast("Roster cleared.", "info");
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
  document.getElementById('editPlayerRatingId').value = ratingInfo.ratingid || '';
  document.getElementById('ratingValueBadge').textContent = ratingInfo.label;
}

function openEditPlayerModal(index) {
  const player = currentRoster[index];
  if (!player) return;

  tempSearchPlayerEdit = null;
  document.getElementById('editPlayerIndex').value = index;
  document.getElementById('editPlayerName').value = player.name || '';
  document.getElementById('editPlayerGender').value = player.gender || '';

  if (player.ratingid) {
    setStarRating(player.ratingid);
  } else {
    const stars = document.querySelectorAll('#starRatingContainer .style-star');
    stars.forEach(s => {
      s.classList.remove('bi-star-fill');
      s.classList.add('bi-star');
    });
    document.getElementById('editPlayerRatingId').value = '';
    document.getElementById('ratingValueBadge').textContent = 'Unassigned';
  }

  editPlayerModalInstance.show();
}

async function savePlayerEdit() {
  const indexVal = document.getElementById('editPlayerIndex').value;
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

  if (indexVal === 'temp' && tempSearchPlayerEdit) {
    saveBtn.disabled = true;
    saveBtn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span>Saving...`;

    try {
      if (tempSearchPlayerEdit.playerid) {
        const { error } = await db
          .from('players')
          .update({
            name: newName,
            ratingid: newRatingId,
            gender: newGender
          })
          .eq('playerid', tempSearchPlayerEdit.playerid);

        if (error) throw error;
      }

      addPlayerToRoster(newName, tempSearchPlayerEdit.playerid, newRatingId, newGender, true);
      showToast(`Updated and added "${newName}" to roster!`, "success");
    } catch (err) {
      console.error("Error updating player in database:", err);
      showToast("Database update failed: " + err.message, "danger");
    } finally {
      saveBtn.disabled = false;
      saveBtn.innerHTML = `<i class="bi bi-check-circle me-1"></i>Save Changes`;
      tempSearchPlayerEdit = null;
      editPlayerModalInstance.hide();
    }
    return;
  }

  const index = parseInt(indexVal, 10);
  const player = currentRoster[index];

  if (player && player.playerid) {
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
        .eq('playerid', player.playerid);

      if (error) throw error;
    } catch (err) {
      console.error("Error updating player in database:", err);
      showToast("Database update failed: " + err.message, "danger");
      saveBtn.disabled = false;
      saveBtn.innerHTML = `<i class="bi bi-check-circle me-1"></i>Save Changes`;
      return;
    } finally {
      saveBtn.disabled = false;
      saveBtn.innerHTML = `<i class="bi bi-check-circle me-1"></i>Save Changes`;
    }
  }

  currentRoster[index] = {
    ...currentRoster[index],
    name: newName,
    ratingid: newRatingId,
    gender: newGender
  };

  renderRoster();
  editPlayerModalInstance.hide();
  showToast(`Updated "${newName}" in roster!`, "success");
}

// ROSTER RENDERING
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
    tag.className = 'badge bg-white text-dark border shadow-sm player-tag d-flex align-items-center gap-2 p-2';
    
    const idBadge = player.playerid 
      ? `<span class="badge bg-secondary bg-opacity-10 text-secondary border ms-1" style="font-size:0.65rem;">ID: ${player.playerid}</span>` 
      : '';

    let ratingBadge = '';
    if (player.ratingid && RATING_MAP[player.ratingid]) {
      ratingBadge = `<span class="badge bg-warning bg-opacity-25 text-dark border border-warning" style="font-size:0.65rem;"><i class="bi bi-star-fill text-warning me-1"></i>${RATING_MAP[player.ratingid].value}</span>`;
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
      <i class="bi bi-pencil-fill text-muted text-hover-primary ms-1" style="cursor:pointer;" onclick="openEditPlayerModal(${idx})" title="Edit Player"></i>
      <i class="bi bi-x-circle-fill text-muted text-hover-danger" style="cursor:pointer;" onclick="removePlayerFromRoster(${idx})" title="Remove"></i>
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

  // Minimum 4 players check
  if (currentRoster.length < 4) {
    showToast(`You need at least 4 players in the roster to start a session. Currently have ${currentRoster.length}.`, "warning");
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

    showToast(`Session "${gameName}" started! Redirecting to queue...`, "success");
    
    // Redirect to queue.html with the new game ID after a short delay
    setTimeout(() => {
      window.location.href = `queue.html?gameid=${newGameId}`;
    }, 800);

  } catch (err) {
    console.error("Error starting session:", err);
    showToast("Failed to start session: " + err.message, "danger");
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