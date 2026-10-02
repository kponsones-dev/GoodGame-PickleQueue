/**
 * Shared Page Layout Component for PickleQueue
 * Safe DOM Injection Version with Robust Event Delegation for Add Player Component
 */

const ADD_PLAYER_COMPONENT_HTML = `
  <div class="card shadow-sm mb-4 border-0">
    <div class="card-body">
      <label class="form-label fw-medium d-flex justify-content-between align-items-center mb-3">
        <span><i class="bi bi-person-plus text-primary me-2"></i>Add Players</span>
      </label>

      <!-- Navigation Tabs -->
      <ul class="nav nav-tabs nav-fill mb-3" id="playerEntryTabs" role="tablist">
        <li class="nav-item" role="presentation">
          <button class="nav-link active fw-medium" id="single-tab" data-bs-toggle="tab" data-bs-target="#single-pane" type="button" role="tab">
            <i class="bi bi-search me-1"></i> Single Player Search
          </button>
        </li>
        <li class="nav-item" role="presentation">
          <button class="nav-link fw-medium" id="multi-tab" data-bs-toggle="tab" data-bs-target="#multi-pane" type="button" role="tab">
            <i class="bi bi-card-text me-1"></i> Bulk Multi-Line Entry
          </button>
        </li>
      </ul>

      <div class="tab-content" id="playerEntryTabContent">
        <!-- TAB 1: Single Player Search -->
        <div class="tab-pane fade show active" id="single-pane" role="tabpanel">
          <div class="position-relative">
            <div class="input-group">
              <input type="text" id="singlePlayerInput" class="form-control" placeholder="Search existing player or type new name..." autocomplete="off">
              <button type="button" id="addSinglePlayerBtn" class="btn btn-outline-primary fw-medium">
                <i class="bi bi-plus-lg me-1"></i> Add Player
              </button>
            </div>
            <div id="autocompleteDropdown" class="autocomplete-dropdown list-group d-none bg-white border position-absolute w-100 shadow-sm" style="z-index: 1000;"></div>
          </div>
        </div>

        <!-- TAB 2: Bulk Multi-Line Entry -->
        <div class="tab-pane fade" id="multi-pane" role="tabpanel">
          <textarea class="form-control font-monospace" id="multiPlayerInput" rows="3" placeholder="Enter player names (one per line)"></textarea>
          <div class="d-flex justify-content-between align-items-center mt-2">
            <span class="text-muted small" id="multiLineCounter">0 names detected</span>
            <div>
              <button type="button" class="btn btn-sm btn-outline-secondary me-2" id="clearMultiLineBtn">Clear</button>
              <button type="button" id="addMultiPlayerBtn" class="btn btn-sm btn-primary">Add All</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
`;

function attachAddPlayerComponentListeners() {
  // Use event delegation on the document for maximum reliability with dynamically loaded elements
  document.addEventListener('input', (e) => {
    if (e.target && e.target.id === 'multiPlayerInput') {
      const multiInput = e.target;
      const counterSpan = document.getElementById('multiLineCounter');
      if (counterSpan) {
        const lines = multiInput.value.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        counterSpan.textContent = `${lines.length} name${lines.length === 1 ? '' : 's'} detected`;
      }
    }
  });

  document.addEventListener('click', (e) => {
    // 1. Clear Button
    if (e.target && (e.target.id === 'clearMultiLineBtn' || e.target.closest('#clearMultiLineBtn'))) {
      const multiInput = document.getElementById('multiPlayerInput');
      const counterSpan = document.getElementById('multiLineCounter');
      if (multiInput) multiInput.value = '';
      if (counterSpan) counterSpan.textContent = '0 names detected';
      if (multiInput) multiInput.focus();
    }

    // 2. Add All (Bulk) Button
    if (e.target && (e.target.id === 'addMultiPlayerBtn' || e.target.closest('#addMultiPlayerBtn'))) {
      const multiInput = document.getElementById('multiPlayerInput');
      if (!multiInput) return;

      const rawText = multiInput.value;
      const names = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      
      if (names.length === 0) return;

      // Dispatch custom event for page scripts to handle inserting names
      const event = new CustomEvent('addBulkPlayersSubmitted', { detail: { names, rawText } });
      document.dispatchEvent(event);
    }

    // 3. Single Add Button
    if (e.target && (e.target.id === 'addSinglePlayerBtn' || e.target.closest('#addSinglePlayerBtn'))) {
      const singleInput = document.getElementById('singlePlayerInput');
      if (!singleInput) return;

      const name = singleInput.value.trim();
      if (!name) return;

      const event = new CustomEvent('addSinglePlayerSubmitted', { detail: { name } });
      document.dispatchEvent(event);
    }
  });
}

function injectAddPlayerComponent(containerId = 'addPlayerSlot') {
  const container = document.getElementById(containerId);
  if (container) {
    container.innerHTML = ADD_PLAYER_COMPONENT_HTML;
  }
}

function initPageLayout(pageTitle = "PickleQueue") {
  const body = document.body;

  // Prevent double execution if already wrapped
  if (document.getElementById('appLayoutWrapper')) return;

  body.className = "py-3 py-md-4 bg-light";

  // 1. Create the main layout wrapper
  const wrapper = document.createElement('div');
  wrapper.id = 'appLayoutWrapper';
  wrapper.className = 'container';
  wrapper.style.maxWidth = '900px';

  // 2. Inject Header and Sidebar HTML into the wrapper
  wrapper.innerHTML = `
    <header class="card shadow-sm mb-4 border-0">
      <div class="card-body d-flex justify-content-between align-items-center py-3">
        <div class="d-flex align-items-center gap-3">
          <button class="btn btn-outline-primary btn-sm" type="button" data-bs-toggle="offcanvas" data-bs-target="#sidebarMenu" aria-controls="sidebarMenu" title="Open Navigation Menu">
            <i class="bi bi-list fs-4"></i>
          </button>
          <div class="d-flex align-items-center gap-2">
            <i class="bi bi-dribbble text-primary fs-2"></i>
            <div>
              <h1 class="h4 mb-0 fw-bold text-dark">${pageTitle}</h1>
              <small class="text-muted">Pickleball Queue & Matchmaking Manager</small>
            </div>
          </div>
        </div>
        <div id="dbConnectionStatus" class="badge bg-secondary db-badge px-2 py-1">
          <i class="bi bi-plug-fill me-1"></i>Connecting...
        </div>
      </div>
    </header>

    <div class="offcanvas offcanvas-start" tabindex="-1" id="sidebarMenu" aria-labelledby="sidebarMenuLabel">
      <div class="offcanvas-header bg-dark text-white">
        <h5 class="offcanvas-title fw-bold" id="sidebarMenuLabel">
          <i class="bi bi-dribbble text-primary me-2"></i>PickleQueue Menu
        </h5>
        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="offcanvas" aria-label="Close"></button>
      </div>
      <div class="offcanvas-body p-0">
        <div class="list-group list-group-flush rounded-0">
          <a href="index.html" class="list-group-item list-group-item-action py-3 fw-medium">
            <i class="bi bi-play-circle text-primary me-2"></i> Start Matchmaking Session
          </a>
          <a href="players.html" class="list-group-item list-group-item-action py-3 fw-medium">
            <i class="bi bi-people text-primary me-2"></i> Manage Players
          </a>
          <a href="#" class="list-group-item list-group-item-action py-3 fw-medium text-muted">
            <i class="bi bi-gear text-secondary me-2"></i> Settings (Coming Soon)
          </a>
        </div>
      </div>
    </div>
  `;

  // 3. Create the main content container
  const contentContainer = document.createElement('main');
  contentContainer.id = 'pageContentContainer';
  contentContainer.className = 'mb-4';

  // 4. Safely move all existing <body> children into the content container.
  while (body.firstChild) {
    contentContainer.appendChild(body.firstChild);
  }

  // 5. Create and append the footer to the content container
  contentContainer.insertAdjacentHTML('beforeend', `
    <footer class="text-center text-muted py-3 border-top small">
      <p class="mb-0">&copy; 2026 PickleQueue Manager. All rights reserved.</p>
    </footer>
  `);

  // 6. Put everything together in the DOM
  wrapper.appendChild(contentContainer);
  body.appendChild(wrapper);

  // Inject the component and initialize listeners
  injectAddPlayerComponent();
  attachAddPlayerComponentListeners();
}

// Auto-initialize on page load based on title
document.addEventListener("DOMContentLoaded", () => {
  let currentPageTitle = "PickleQueue";
  if (document.title.includes("-")) {
    currentPageTitle = document.title.split("-")[1].trim();
  }
  initPageLayout(currentPageTitle);
});