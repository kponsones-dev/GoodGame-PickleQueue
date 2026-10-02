// Queue Page State
let allPlayers = [];
let activeSessionId = null;
let playerModalInstance = null;

document.addEventListener("DOMContentLoaded", async () => {
  // Initialize layout.js header & footer with page title
  initPageLayout("Queue & Courts");

  playerModalInstance = new bootstrap.Modal(document.getElementById('playerModal'));

  await checkDbConnection();
  await fetchActiveSession();
  await loadQueueData();
});

// Fetch active session
async function fetchActiveSession() {
  try {
    const { data, error } = await db
      .from('game')
      .select('gameid, gamename')
      .is('enddatetime', null)
      .order('startdatetime', { ascending: false })
      .limit(1);

    if (error) throw error;
    if (data && data.length > 0) {
      activeSessionId = data[0].gameid;
      const titleEl = document.getElementById('gameSessionTitle');
      if (titleEl) titleEl.textContent = data[0].gamename || "Open Play";
    }
  } catch (err) {
    console.error("Error fetching active session:", err);
  }
}

// Load all players and determine status (Checked Out vs Waiting / Active)
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
    showToast("Error loading player status: " + err.message, "danger");
  }
}

// Render UI matching reference screenshot structure
function renderQueueUI() {
  const playersCountBadge = document.getElementById('playersCountBadge');
  const queueCountBadge = document.getElementById('queueCountBadge');
  const queueHeaderCount = document.getElementById('queueHeaderCount');
  const queueContainerBody = document.getElementById('queueContainerBody');
  const checkedOutContainer = document.getElementById('checkedOutPlayersContainer');
  const leftSectionHeader = document.getElementById('leftSectionHeader');

  if (playersCountBadge) playersCountBadge.textContent = allPlayers.length;

  // Filter players: Checked out means currentgameid is null (or not assigned to active session)
  const checkedOutPlayers = allPlayers.filter(p => p.currentgameid === null || p.currentgameid === undefined);
  const waitingPlayers = allPlayers.filter(p => p.currentgameid !== null && p.currentgameid !== undefined);

  if (queueCountBadge) queueCountBadge.textContent = waitingPlayers.length;
  if (queueHeaderCount) queueHeaderCount.textContent = waitingPlayers.length;

  // 1. Render Queue / Waiting Section
  if (waitingPlayers.length === 0) {
    queueContainerBody.innerHTML = `<p class="text-muted mb-0 py-2">No players in queue</p>`;
  } else {
    let queueHtml = `<div class="list-group list-group-flush bg-transparent">`;
    waitingPlayers.forEach((p, idx) => {
      queueHtml += `
        <div class="list-group-item bg-transparent text-light border-secondary d-flex justify-content-between align-items-center py-2">
          <div>
            <span class="text-muted me-2">${idx + 1}</span>
            <span class="fw-semibold">${escapeHtml(p.name)}</span>
          </div>
          <button class="btn btn-sm btn-outline-warning py-0 px-2" onclick="checkoutPlayer(${p.playerid})">Check Out</button>
        </div>
      `;
    });
    queueHtml += `</div>`;
    queueContainerBody.innerHTML = queueHtml;
  }

  // 2. Render Left (Checked Out) Section matching the screenshot list style
  if (leftSectionHeader) leftSectionHeader.textContent = `Left (${checkedOutPlayers.length})`;

  if (checkedOutPlayers.length === 0) {
    checkedOutContainer.innerHTML = `<div class="text-center text-muted py-3">No checked-out players</div>`;
  } else {
    let leftHtml = `<div class="d-flex flex-column gap-2">`;
    checkedOutPlayers.forEach((p, idx) => {
      leftHtml += `
        <div class="card bg-dark border border-secondary border-opacity-25 rounded-3 p-3 d-flex flex-row justify-content-between align-items-center">
          <div class="d-flex align-items-center gap-3">
            <span class="text-muted fw-medium">${idx + 1}</span>
            <div>
              <h6 class="mb-0 text-white fw-semibold">${escapeHtml(p.name)}</h6>
              <small class="text-muted" style="font-size: 0.75rem;">0-0 (0 games)</small>
            </div>
          </div>
          <button type="button" class="btn btn-sm btn-success fw-medium px-3" onclick="checkInPlayer(${p.playerid})">
            Check In
          </button>
        </div>
      `;
    });
    leftHtml += `</div>`;
    checkedOutContainer.innerHTML = leftHtml;
  }
}

// Check In Action (Moves player into active queue state)
async function checkInPlayer(playerId) {
  try {
    const { error } = await db
      .from('players')
      .update({ currentgameid: activeSessionId })
      .eq('playerid', playerId);

    if (error) throw error;
    showToast("Player checked in successfully!", "success");
    await loadQueueData();
  } catch (err) {
    console.error("Check-in error:", err);
    showToast("Failed to check in player: " + err.message, "danger");
  }
}

// Check Out Action (Moves player back to Left list)
async function checkoutPlayer(playerId) {
  try {
    const { error } = await db
      .from('players')
      .update({ currentgameid: null })
      .eq('playerid', playerId);

    if (error) throw error;
    showToast("Player checked out.", "info");
    await loadQueueData();
  } catch (err) {
    console.error("Check-out error:", err);
    showToast("Failed to check out player: " + err.message, "danger");
  }
}

// Add Player Modal triggers (reuses exact logic from players.js)
function openAddPlayerModal() {
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

  btn.disabled = true;
  btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span>Processing...`;

  try {
    let addedCount = 0;
    for (let name of names) {
      const { error } = await db
        .from('players')
        .insert([{ name: name, ratingid: null, gender: null, currentgameid: null }]);

      if (!error) addedCount++;
    }

    showToast(`Successfully added ${addedCount} player(s)!`, "success");
    clearMultiLineText();
    playerModalInstance.hide();
    await loadQueueData();
  } catch (err) {
    console.error("Bulk insert error:", err);
    showToast("Error saving players: " + err.message, "danger");
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
    const { error } = await db
      .from('players')
      .insert([{ name, ratingid: ratingId, gender, currentgameid: null }]);

    if (error) throw error;
    showToast(`Successfully created "${name}"!`, "success");

    playerModalInstance.hide();
    await loadQueueData();
  } catch (err) {
    console.error("Save error:", err);
    showToast("Failed to save player: " + err.message, "danger");
  } finally {
    saveBtn.disabled = false;
    saveBtn.innerHTML = `<i class="bi bi-check-circle me-1"></i>Save Player`;
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

function openAddCourtModal() {
  showToast("Court management feature coming up next!", "info");
}