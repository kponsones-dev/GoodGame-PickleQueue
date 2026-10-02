// Queue Page State
let allPlayers = [];
let activeSessionId = null;
let activeSessionData = null;
let editPlayerModalInstance = null;
let clearRosterModalInstance = null;

document.addEventListener("DOMContentLoaded", async () => {
  // Initialize layout.js header & footer with page title
  initPageLayout("Queue & Matchmaking");

  editPlayerModalInstance = new bootstrap.Modal(document.getElementById('editPlayerModal'));
  clearRosterModalInstance = new bootstrap.Modal(document.getElementById('clearRosterModal'));

  setupSearchAutocompleteListener();

  await checkDbConnection();
  await fetchActiveSession();
  await loadQueueData();
});

// Fetch active session
async function fetchActiveSession() {
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const gameIdParam = urlParams.get('gameid');

    let query = db.from('game').select('*').is('enddatetime', null);

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
    } else {
      const titleEl = document.getElementById('sessionTitleDisplay');
      if (titleEl) titleEl.textContent = "No Active Session Found";
    }
  } catch (err) {
    console.error("Error fetching active session:", err);
    showToast("Error fetching active session", "danger");
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
    renderQueueUI();
  } catch (err) {
    console.error("Failed to load queue data:", err);
    showToast("Error loading players: " + err.message, "danger");
  }
}

// Render Session Players Pool matching UI
function renderQueueUI() {
  const container = document.getElementById('rosterContainer');
  const badge = document.getElementById('queuePlayerCountBadge');
  const clearBtn = document.getElementById('clearRosterBtn');

  if (!container) return;

  if (!activeSessionId) {
    container.innerHTML = `<span class="text-muted small italic w-100 text-center">No active session found.</span>`;
    if (badge) badge.textContent = "0 Players";
    return;
  }

  // Filter players assigned to this active session
  const sessionPlayers = allPlayers.filter(p => p.currentgameid === activeSessionId);

  if (badge) badge.textContent = `${sessionPlayers.length} Player${sessionPlayers.length === 1 ? '' : 's'}`;

  if (sessionPlayers.length === 0) {
    container.innerHTML = `<span class="text-muted small italic w-100 text-center">No players added to this session yet. Use the search above to add players.</span>`;
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

    // Pass ONLY player.playerid to avoid quote-escaping or identifier errors
    tag.innerHTML = `
      <i class="bi bi-person-fill text-primary"></i>
      <span class="fw-semibold text-dark">${escapeHtml(player.name)}</span>
      ${ratingBadge}
      ${genderBadge}
      ${idBadge}
      <i class="bi bi-pencil-fill text-muted text-hover-primary ms-1" style="cursor:pointer;" onclick="openEditPlayerModal(${player.playerid})" title="Edit Player"></i>
      <i class="bi bi-x-circle-fill text-muted text-hover-danger" style="cursor:pointer;" onclick="removePlayerFromSession(${player.playerid})" title="Remove from session"></i>
    `;
    container.appendChild(tag);
  });
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
        .insert([{ name: name, ratingid: null, gender: null, currentgameid: activeSessionId }])
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

// Add player to active session
async function addPlayerToSession(playerId) {
  if (!activeSessionId) {
    showToast("No active session found.", "warning");
    return;
  }

  try {
    const { error } = await db
      .from('players')
      .update({ currentgameid: activeSessionId })
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

// Remove player from session (sets currentgameid to null)
async function removePlayerFromSession(playerId) {
  try {
    const { error } = await db
      .from('players')
      .update({ currentgameid: null })
      .eq('playerid', playerId);

    if (error) throw error;

    showToast("Player removed from session.", "info");
    await loadQueueData();
  } catch (err) {
    console.error("Error removing player from session:", err);
    showToast("Failed to remove player: " + err.message, "danger");
  }
}

// Bulk Multi-Line Entry Support
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
        await db.from('players').update({ currentgameid: activeSessionId }).eq('playerid', exactMatch.playerid);
        addedCount++;
      } else {
        const { data: newData } = await db.from('players').insert([{ name: name, ratingid: null, gender: null, currentgameid: activeSessionId }]).select();
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

// Clear Session Roster Modal Handlers
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
      .update({ currentgameid: null })
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

// Edit Player Modal Handlers
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

// Open Edit Modal using player ID lookup to avoid variable passing syntax errors
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

// End current session action
async function endCurrentSession() {
  if (!activeSessionId) return;
  if (!confirm("Are you sure you want to end the current session? All players will be unassigned from this session.")) return;

  try {
    await db
      .from('players')
      .update({ currentgameid: null })
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

// Toast helper
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