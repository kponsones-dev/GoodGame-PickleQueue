-- 1. Create GameType Table first (Static lookup table)
CREATE TABLE GameType (
    GameTypeId SERIAL PRIMARY KEY,
    Name VARCHAR(50) NOT NULL
);

-- Insert the static game types
INSERT INTO GameType (GameTypeId, Name) VALUES 
(1, 'Social Mix'),
(2, 'Skill Separated'),
(3, 'Winners/Losers'),
(4, 'Mixed Gender');

-- 2. Create Game Table
-- (Created before Players so CurrentGameId can reference it)
CREATE TABLE Game (
    GameId SERIAL PRIMARY KEY,
    GameName VARCHAR(100) NOT NULL,
    GameTypeId INT REFERENCES GameType(GameTypeId),
    StartDateTime TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    EndDateTime TIMESTAMP WITH TIME ZONE
);

-- 3. Create Players Table
CREATE TABLE Players (
    PlayerId SERIAL PRIMARY KEY,
    Name VARCHAR(100) NOT NULL,
    Gender VARCHAR(20),
    RatingId INT, -- Ready for a future Ratings table, or just a static number
    CurrentGameId INT REFERENCES Game(GameId)
);

-- 4. Create Match Table
CREATE TABLE Match (
    MatchId SERIAL PRIMARY KEY,
    GameId INT REFERENCES Game(GameId),
    TeamIdWinner INT, -- Populated with 1 or 2 when the match is finished
    StartDateTime TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    EndDateTime TIMESTAMP WITH TIME ZONE
);

-- 5. Create PlayerMatch Table
CREATE TABLE PlayerMatch (
    PlayerMatchId SERIAL PRIMARY KEY,
    PlayerId INT REFERENCES Players(PlayerId),
    MatchId INT REFERENCES Match(MatchId),
    TeamId INT CHECK (TeamId IN (1, 2)) -- Enforces that team can only be 1 or 2
);
