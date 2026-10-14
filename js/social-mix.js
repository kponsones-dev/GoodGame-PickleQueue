/**
 * Social Mix Matchmaking Strategy (Round Robin Style)
 * Goal: Maximize variety by avoiding duplicate teammates and opponents.
 */

/**
 * Main generator for Social Mix mode
 * @param {Array} availablePlayers - Array of player objects checked into the session
 * @param {Array} activeCourts - Array of active court objects for the session
 * @param {Array} matchHistory - Historical matches for the current session
 * @returns {Array} List of proposed match objects ready for DB insertion or preview
 */
function generateSocialMixMatches(availablePlayers, activeCourts, matchHistory = []) {
  if (!availablePlayers || availablePlayers.length < 4) {
    throw new Error("At least 4 players are required to generate a match.");
  }

  if (!activeCourts || activeCourts.length === 0) {
    throw new Error("No active courts available for match generation.");
  }

  // 1. Build co-occurrence stats from match history
  const { playCounts, partnerMatrix, opponentMatrix } = buildSocialHistoryMatrices(matchHistory);

  // 2. Sort available players: fewest matches played first (randomize ties for fairness)
  const sortedPlayers = [...availablePlayers].sort((a, b) => {
    const countA = playCounts[a.playerid] || 0;
    const countB = playCounts[b.playerid] || 0;
    if (countA !== countB) return countA - countB;
    return 0.5 - Math.random();
  });

  // 3. Determine how many courts we can fill (4 players per court)
  const maxPossibleCourts = Math.floor(sortedPlayers.length / 4);
  const courtsToFill = Math.min(activeCourts.length, maxPossibleCourts);

  if (courtsToFill === 0) {
    throw new Error("Not enough players to fill a single court (minimum 4 needed).");
  }

  const generatedMatches = [];
  let playerPool = [...sortedPlayers];

  // 4. Fill courts one by one with optimal 4-player groupings and team splits
  for (let i = 0; i < courtsToFill; i++) {
    const court = activeCourts[i];

    // Pick 4 players from the top of the queue (fewest games played)
    const selectedGroup = playerPool.splice(0, 4);

    // Find best 2v2 arrangement that minimizes repeated partner/opponent scores
    const bestMatchup = findBestSocialMatchup(selectedGroup, partnerMatrix, opponentMatrix);

    generatedMatches.push({
      courtid: court.courtid,
      courtname: court.courtname,
      team1: bestMatchup.team1,
      team2: bestMatchup.team2,
      score: bestMatchup.score
    });
  }

  return generatedMatches;
}

/**
 * Builds history lookup matrices for play counts, partner frequency, and opponent frequency
 */
function buildSocialHistoryMatrices(matchHistory) {
  const playCounts = {};
  const partnerMatrix = {};  // partnerMatrix[p1][p2] = times partnered
  const opponentMatrix = {}; // opponentMatrix[p1][p2] = times opposed

  const recordPair = (matrix, p1, p2) => {
    if (!matrix[p1]) matrix[p1] = {};
    if (!matrix[p2]) matrix[p2] = {};
    matrix[p1][p2] = (matrix[p1][p2] || 0) + 1;
    matrix[p2][p1] = (matrix[p2][p1] || 0) + 1;
  };

  matchHistory.forEach(m => {
    const t1 = m.team1_players || [];
    const t2 = m.team2_players || [];
    const all = [...t1, ...t2];

    // Record play counts
    all.forEach(pId => {
      playCounts[pId] = (playCounts[pId] || 0) + 1;
    });

    // Record teammates
    if (t1.length === 2) recordPair(partnerMatrix, t1[0], t1[1]);
    if (t2.length === 2) recordPair(partnerMatrix, t2[0], t2[1]);

    // Record opponents
    t1.forEach(p1 => {
      t2.forEach(p2 => {
        recordPair(opponentMatrix, p1, p2);
      });
    });
  });

  return { playCounts, partnerMatrix, opponentMatrix };
}

/**
 * Tests all 3 possible 2v2 split combinations for 4 players and returns the one with lowest repeat history penalty
 */
function findBestSocialMatchup(fourPlayers, partnerMatrix, opponentMatrix) {
  const [p1, p2, p3, p4] = fourPlayers;

  // 3 possible 2v2 configurations for 4 players
  const possibleSplits = [
    { team1: [p1, p2], team2: [p3, p4] },
    { team1: [p1, p3], team2: [p2, p4] },
    { team1: [p1, p4], team2: [p2, p3] }
  ];

  let bestSplit = null;
  let lowestPenalty = Infinity;

  possibleSplits.forEach(split => {
    const penalty = calculateSocialMatchupPenalty(split.team1, split.team2, partnerMatrix, opponentMatrix);
    if (penalty < lowestPenalty) {
      lowestPenalty = penalty;
      bestSplit = { ...split, score: penalty };
    }
  });

  return bestSplit;
}

/**
 * Calculates history repeat penalty for a specific 2v2 configuration
 * (Partner repeat penalty is weighted higher than opponent repeat penalty)
 */
function calculateSocialMatchupPenalty(team1, team2, partnerMatrix, opponentMatrix) {
  let penalty = 0;

  const getPartnerCount = (a, b) => (partnerMatrix[a.playerid]?.[b.playerid] || 0);
  const getOpponentCount = (a, b) => (opponentMatrix[a.playerid]?.[b.playerid] || 0);

  // Partner repeat penalty (Weight: 3x per prior match)
  penalty += getPartnerCount(team1[0], team1[1]) * 3;
  penalty += getPartnerCount(team2[0], team2[1]) * 3;

  // Opponent repeat penalty (Weight: 1x per prior match)
  penalty += getOpponentCount(team1[0], team2[0]);
  penalty += getOpponentCount(team1[0], team2[1]);
  penalty += getOpponentCount(team1[1], team2[0]);
  penalty += getOpponentCount(team1[1], team2[1]);

  return penalty;
}