/**
 * Shared Page Layout Component for PickleQueue
 * Safe DOM Injection Version
 */

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
  // This preserves all attached event listeners and Bootstrap Modal references!
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
}

// Auto-initialize on page load based on title
document.addEventListener("DOMContentLoaded", () => {
  let currentPageTitle = "PickleQueue";
  if (document.title.includes("-")) {
    currentPageTitle = document.title.split("-")[1].trim();
  }
  initPageLayout(currentPageTitle);
});