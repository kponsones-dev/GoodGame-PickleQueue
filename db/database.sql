-- ==========================================
-- PickleQueue Complete Database Schema
-- ==========================================

-- 1. Ratings Table (Skill levels: 2.0 to 4.5+)
CREATE TABLE IF NOT EXISTS Ratings (
    RatingId SERIAL PRIMARY KEY,
    Level VARCHAR(20) NOT NULL,
    Description TEXT
);

-- Seed initial ratings matching your star selector
INSERT INTO Ratings (RatingId, Level, Description) VALUES
(1, '2.0', 'Beginner'),
(2, '2.5', 'Advanced Beginner'),
(3, '3.0', 'Novice'),
(4, '3.5', 'Intermediate'),
(5, '4.0', 'Advanced'),
(6, '4.5+', 'Expert / Pro')
ON CONFLICT (RatingId) DO NOTHING;


-- 2. GameType Table (Static lookup table)
CREATE TABLE IF NOT EXISTS GameType (
    GameTypeId SERIAL PRIMARY KEY,
    Name VARCHAR(50) NOT NULL
);

-- Insert the static game types
INSERT INTO GameType (GameTypeId, Name) VALUES 
(1, 'Social Mix'),
(2, 'Skill Separated'),
(3, 'Winners/Losers'),
(4, 'Mixed Gender')
ON CONFLICT (GameTypeId) DO NOTHING;


-- 3. Game Table (Represents an overall open-play or tournament session)
CREATE TABLE IF NOT EXISTS Game (
    GameId SERIAL PRIMARY KEY,
    GameName VARCHAR(100) NOT NULL,
    GameTypeId INT REFERENCES GameType(GameTypeId),
    StartDateTime TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    EndDateTime TIMESTAMP WITH TIME ZONE
);


-- 4. Players Table
CREATE TABLE IF NOT EXISTS Players (
    PlayerId SERIAL PRIMARY KEY,
    Name VARCHAR(100) NOT NULL,
    Gender VARCHAR(20),
    RatingId INT REFERENCES Ratings(RatingId) ON DELETE SET NULL,
    CurrentGameId INT REFERENCES Game(GameId) ON DELETE SET NULL
);


-- 5. Match Table (Individual court matches with scores)
CREATE TABLE IF NOT EXISTS Match (
    MatchId SERIAL PRIMARY KEY,
    GameId INT REFERENCES Game(GameId) ON DELETE CASCADE,
    Team1_Score INT DEFAULT 0,
    Team2_Score INT DEFAULT 0,
    StartDateTime TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    EndDateTime TIMESTAMP WITH TIME ZONE
);


-- 6. PlayerMatch Table (Junction table linking players to matches and teams)
CREATE TABLE IF NOT EXISTS PlayerMatch (
    PlayerMatchId SERIAL PRIMARY KEY,
    PlayerId INT REFERENCES Players(PlayerId) ON DELETE CASCADE,
    MatchId INT REFERENCES Match(MatchId) ON DELETE CASCADE,
    TeamId INT CHECK (TeamId IN (1, 2)) -- Enforces team 1 or 2
);