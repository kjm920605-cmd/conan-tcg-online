CREATE TABLE player_sessions (
  id text PRIMARY KEY, resume_token_hash text NOT NULL CHECK (resume_token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL, last_seen_at timestamptz NOT NULL
);
CREATE TABLE rooms (
  id text PRIMARY KEY, code text NOT NULL UNIQUE,
  player_a_id text REFERENCES player_sessions(id), player_b_id text REFERENCES player_sessions(id),
  ready_a boolean NOT NULL, ready_b boolean NOT NULL,
  deck_a text NOT NULL CHECK (deck_a = 'Fixture Deck A'), deck_b text NOT NULL CHECK (deck_b = 'Fixture Deck B'),
  match_id text UNIQUE, status text NOT NULL CHECK (status IN ('WAITING','PLAYING','FINISHED','RULE_BLOCKED')),
  created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
  CHECK (player_a_id IS DISTINCT FROM player_b_id OR player_a_id IS NULL),
  CHECK (NOT ready_a OR player_a_id IS NOT NULL), CHECK (NOT ready_b OR player_b_id IS NOT NULL)
);
CREATE INDEX rooms_player_a_idx ON rooms(player_a_id);
CREATE INDEX rooms_player_b_idx ON rooms(player_b_id);
CREATE TABLE matches (
  id text PRIMARY KEY, room_id text NOT NULL UNIQUE REFERENCES rooms(id),
  status text NOT NULL CHECK (status IN ('SETUP','PLAYING','FINISHED','RULE_BLOCKED')),
  state_version bigint NOT NULL CHECK (state_version BETWEEN 0 AND 9007199254740991),
  ruleset_version text NOT NULL, engine_version text NOT NULL, card_data_version text NOT NULL,
  outcome jsonb, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, finished_at timestamptz,
  CHECK ((status = 'FINISHED') = (finished_at IS NOT NULL)),
  CHECK ((status = 'FINISHED') = (outcome IS NOT NULL))
);
ALTER TABLE rooms ADD CONSTRAINT rooms_match_fk FOREIGN KEY (match_id) REFERENCES matches(id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE match_snapshots (
  match_id text NOT NULL REFERENCES matches(id), state_version bigint NOT NULL CHECK (state_version BETWEEN 0 AND 9007199254740991),
  serialized_state text NOT NULL, integrity_hash text NOT NULL CHECK (integrity_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL, PRIMARY KEY(match_id, state_version)
);
CREATE TABLE match_commands (
  match_id text NOT NULL REFERENCES matches(id), command_id text NOT NULL, player_id text NOT NULL,
  expected_version bigint NOT NULL CHECK (expected_version >= 0), result_version bigint NOT NULL CHECK (result_version = expected_version + 1),
  command_type text NOT NULL CHECK (command_type IN ('GAME_COMMAND','MULLIGAN','RESOLVE_DECISION')),
  payload jsonb NOT NULL, fingerprint text NOT NULL, result_status text NOT NULL CHECK (result_status = 'ACCEPTED'),
  created_at timestamptz NOT NULL, PRIMARY KEY(match_id, command_id), UNIQUE(match_id, result_version)
);
