-- Migration: Add IP-based rate limiting to depth chart voting
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New query)

-- 1. Add ip_hash column to the votes table (stores hashed IP, never raw)
ALTER TABLE dc_live_user_votes_v2
  ADD COLUMN IF NOT EXISTS ip_hash text;

-- 2. Index for fast IP+player+day lookups
CREATE INDEX IF NOT EXISTS idx_dc_votes_ip_player_day
  ON dc_live_user_votes_v2 (ip_hash, player_id, vote_day)
  WHERE ip_hash IS NOT NULL;

-- 3. New toggle function with IP enforcement
CREATE OR REPLACE FUNCTION depth_chart_toggle_vote_v2(
  p_position   text,
  p_player_id  text,
  p_vote_value integer,
  p_voter_hash text,
  p_ip_hash    text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today        text := to_char(
                           CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York',
                           'YYYY-MM-DD'
                         );
  v_existing     record;
  v_ip_conflict  record;
  v_action       text;
BEGIN
  -- Validate inputs
  IF p_vote_value NOT IN (1, -1) THEN
    RAISE EXCEPTION 'Invalid vote_value';
  END IF;
  IF length(coalesce(p_voter_hash,'')) < 8 THEN
    RAISE EXCEPTION 'Invalid voter_hash';
  END IF;
  IF length(coalesce(p_ip_hash,'')) < 8 THEN
    RAISE EXCEPTION 'Invalid ip_hash';
  END IF;

  -- Look up this browser's existing vote on this player today
  SELECT * INTO v_existing
  FROM dc_live_user_votes_v2
  WHERE voter_hash = p_voter_hash
    AND player_id  = p_player_id
    AND vote_day   = v_today
  LIMIT 1;

  -- Look for a DIFFERENT browser from the same IP that already voted today
  IF v_existing IS NULL THEN
    SELECT * INTO v_ip_conflict
    FROM dc_live_user_votes_v2
    WHERE ip_hash   = p_ip_hash
      AND player_id = p_player_id
      AND vote_day  = v_today
      AND voter_hash <> p_voter_hash
    LIMIT 1;

    IF FOUND THEN
      -- Same IP already voted on this player today from a different browser
      RETURN json_build_object(
        'action', 'rate_limited',
        'reason', 'One vote per player per day is allowed per IP address.'
      );
    END IF;
  END IF;

  -- Toggle logic
  IF v_existing IS NOT NULL THEN
    IF v_existing.vote_value = p_vote_value THEN
      -- Same direction → remove vote
      DELETE FROM dc_live_user_votes_v2 WHERE id = v_existing.id;
      v_action := 'removed';
    ELSE
      -- Opposite direction → switch vote
      UPDATE dc_live_user_votes_v2
        SET vote_value = p_vote_value,
            ip_hash    = p_ip_hash
        WHERE id = v_existing.id;
      v_action := 'changed';
    END IF;
  ELSE
    -- New vote
    INSERT INTO dc_live_user_votes_v2
      (position, player_id, vote_value, voter_hash, ip_hash, vote_day)
    VALUES
      (p_position, p_player_id, p_vote_value, p_voter_hash, p_ip_hash, v_today);
    v_action := 'added';
  END IF;

  RETURN json_build_object('action', v_action);
END;
$$;

-- 4. Grant execute to anon role (same as existing toggle function)
GRANT EXECUTE ON FUNCTION depth_chart_toggle_vote_v2(text,text,integer,text,text)
  TO anon, authenticated;

-- Verify
SELECT 'Migration complete. Run SELECT * FROM dc_live_user_votes_v2 LIMIT 1; to confirm ip_hash column exists.' AS status;
