/**
 * Game Types Configuration and Matchmaking Rules for PickleQueue
 */

const GAME_TYPES = {
  1: {
    id: 1,
    name: 'Social Mix',
    description: 'Casual recreational play designed to mix players up for fun, social matches without strict skill constraints.',
    validatePairing: (player1, player2) => true
  },

  2: {
    id: 2,
    name: 'Skill Separated',
    description: 'Comfortable skill brackets: 1-star beginners play with 1-3s; 2-star advanced beginners play with 2-4s; and 3-star players act as wildcards/bridges who can drop down to play with 1s or swing up to challenge 6-star pros.',
    validatePairing: (rating1, rating2) => {
      if (!rating1 || !rating2) return true;

      const r1 = parseInt(rating1, 10);
      const r2 = parseInt(rating2, 10);

      const isValidPair = (a, b) => {
        // 1-star: can be matched with 1 up to 3
        if (a === 1) return b >= 1 && b <= 3;
        if (b === 1) return a >= 1 && a <= 3;

        // 2-star: can be matched with 2 up to 4
        if (a === 2) return b >= 2 && b <= 4;
        if (b === 2) return a >= 2 && a <= 4;

        // 3-star: can be matched to 1 and 6 (plus standard close ranges)
        if (a === 3) return b === 1 || b === 6 || (b >= 2 && b <= 4);
        if (b === 3) return a === 1 || a === 6 || (a >= 2 && a <= 4);

        // General fallback for other ratings (4, 5, 6) within reasonable proximity
        return Math.abs(a - b) <= 2;
      };

      return isValidPair(r1, r2);
    }
  },

  3: {
    id: 3,
    name: 'Winners/Losers',
    description: 'Court-based ladder style play where winners move up a court and split/mix, while losers move down or rotate out.',
    validatePairing: (player1, player2) => true
  },

  4: {
    id: 4,
    name: 'Mixed Gender',
    description: 'Balanced matchmaking focused on pairing or alternating male and female players across matches.',
    validatePairing: (player1, player2) => true
  }
};

/**
 * Populates the game type select dropdown and wires up the description placeholder.
 */
function initializeGameTypes() {
  const selectElement = document.getElementById('gameTypeSelect');
  const descriptionElement = document.getElementById('gameTypeDescription');

  if (!selectElement) return;

  // Clear existing options
  selectElement.innerHTML = '<option value="" disabled selected>Select a game type...</option>';

  // Populate options from GAME_TYPES dictionary using the numeric IDs (1, 2, 3, 4)
  Object.values(GAME_TYPES).forEach(type => {
    const option = document.createElement('option');
    option.value = type.id;
    option.textContent = type.name;
    selectElement.appendChild(option);
  });

  // Add event listener to update the description when selection changes
  selectElement.addEventListener('change', (e) => {
    const selectedType = GAME_TYPES[e.target.value];
    if (selectedType && descriptionElement) {
      descriptionElement.textContent = selectedType.description;
      descriptionElement.style.display = 'block';
    } else if (descriptionElement) {
      descriptionElement.style.display = 'none';
    }
  });
}

// Auto-initialize when DOM is ready if dropdown exists
document.addEventListener('DOMContentLoaded', () => {
  initializeGameTypes();
});