-- ============================================================
-- PickleQueue Complete Database Reset & Schema Script
-- ============================================================

-- ------------------------------------------------------------
-- 0. DROP EXISTING TABLES (Resets sequence IDs)
-- ------------------------------------------------------------
DROP TABLE IF EXISTS PlayerMatch CASCADE;
DROP TABLE IF EXISTS Match CASCADE;
DROP TABLE IF EXISTS Courts CASCADE;
DROP TABLE IF EXISTS Players CASCADE;
DROP TABLE IF EXISTS Game CASCADE;
DROP TABLE IF EXISTS GameType CASCADE;
DROP TABLE IF EXISTS Ratings CASCADE;


-- ------------------------------------------------------------
-- 1. RATINGS TABLE (Skill levels: 2.0 to 4.5+)
-- ------------------------------------------------------------
CREATE TABLE Ratings (
    RatingId SERIAL PRIMARY KEY,
    Level VARCHAR(20) NOT NULL,
    Description TEXT
);

-- Seed ratings
INSERT INTO Ratings (RatingId, Level, Description) VALUES
(1, '2.0', 'Beginner'),
(2, '2.5', 'Advanced Beginner'),
(3, '3.0', 'Novice'),
(4, '3.5', 'Intermediate'),
(5, '4.0', 'Advanced'),
(6, '4.5+', 'Expert / Pro');


-- ------------------------------------------------------------
-- 2. GAMETYPE TABLE (Static lookup table)
-- ------------------------------------------------------------
CREATE TABLE GameType (
    GameTypeId SERIAL PRIMARY KEY,
    Name VARCHAR(50) NOT NULL
);

-- Seed static game types
INSERT INTO GameType (GameTypeId, Name) VALUES 
(1, 'Social Mix'),
(2, 'Skill Separated'),
(3, 'Winners/Losers'),
(4, 'Mixed Gender');


-- ------------------------------------------------------------
-- 3. GAME TABLE (Represents open-play / tournament sessions)
-- ------------------------------------------------------------
CREATE TABLE Game (
    GameId SERIAL PRIMARY KEY,
    GameName VARCHAR(100) NOT NULL,
    GameTypeId INT REFERENCES GameType(GameTypeId) ON DELETE SET NULL,
    StartDateTime TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    EndDateTime TIMESTAMP WITH TIME ZONE
);


-- ------------------------------------------------------------
-- 4. PLAYERS TABLE
-- ------------------------------------------------------------
CREATE TABLE Players (
    PlayerId SERIAL PRIMARY KEY,
    Name VARCHAR(100) NOT NULL,
    Gender VARCHAR(20),
    RatingId INT REFERENCES Ratings(RatingId) ON DELETE SET NULL,
    CurrentGameId INT REFERENCES Game(GameId) ON DELETE SET NULL,
    Is_Checked_In BOOLEAN DEFAULT TRUE
);


-- ------------------------------------------------------------
-- 5. COURTS TABLE (Session Courts)
-- ------------------------------------------------------------
CREATE TABLE Courts (
    CourtId SERIAL PRIMARY KEY,
    GameId INT REFERENCES Game(GameId) ON DELETE CASCADE,
    CourtName VARCHAR(50) NOT NULL,
    IsActive BOOLEAN DEFAULT TRUE
);


-- ------------------------------------------------------------
-- 6. MATCH TABLE (Individual court matches)
-- ------------------------------------------------------------
CREATE TABLE Match (
    MatchId SERIAL PRIMARY KEY,
    GameId INT REFERENCES Game(GameId) ON DELETE CASCADE,
    CourtId INT REFERENCES Courts(CourtId) ON DELETE SET NULL,
    Team1_Score INT DEFAULT 0,
    Team2_Score INT DEFAULT 0,
    Winning_Team INT CHECK (Winning_Team IN (1, 2)),
    StartDateTime TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    EndDateTime TIMESTAMP WITH TIME ZONE
);


-- ------------------------------------------------------------
-- 7. PLAYERMATCH TABLE (Junction table linking players to teams/matches)
-- ------------------------------------------------------------
CREATE TABLE PlayerMatch (
    PlayerMatchId SERIAL PRIMARY KEY,
    PlayerId INT REFERENCES Players(PlayerId) ON DELETE CASCADE,
    MatchId INT REFERENCES Match(MatchId) ON DELETE CASCADE,
    TeamId INT CHECK (TeamId IN (1, 2)) -- Enforces team 1 or 2
);