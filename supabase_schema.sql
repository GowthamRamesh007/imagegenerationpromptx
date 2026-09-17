-- âš¡ PROMPTX â€” AI Image Recreation Competition Supabase Database Schema
-- Run this script in the Supabase SQL Editor (https://app.supabase.com -> SQL Editor)

-- 1. Enable UUID Extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. EVENTS TABLE
CREATE TABLE IF NOT EXISTS public.events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_name TEXT NOT NULL DEFAULT 'PROMPTX 2026',
  status TEXT NOT NULL DEFAULT 'ACTIVE', -- ACTIVE | PAUSED | COMPLETED
  current_round INT NOT NULL DEFAULT 1, -- 1, 2, 3
  results_revealed BOOLEAN NOT NULL DEFAULT FALSE,
  joining_code TEXT NOT NULL DEFAULT 'PROMPTX2026',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. ROUNDS TABLE
CREATE TABLE IF NOT EXISTS public.rounds (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID REFERENCES public.events(id) ON DELETE CASCADE,
  round_number INT NOT NULL, -- 1, 2, 3
  reference_image_url TEXT,
  status TEXT NOT NULL DEFAULT 'UPCOMING', -- UPCOMING | ACTIVE | PAUSED | ENDED
  timer_duration INT NOT NULL DEFAULT 1800, -- seconds
  timer_started_at TIMESTAMPTZ,
  timer_ends_at TIMESTAMPTZ,
  timer_remaining INT NOT NULL DEFAULT 1800,
  timer_is_running BOOLEAN NOT NULL DEFAULT FALSE,
  prompt_quality_max INT NOT NULL DEFAULT 25,
  image_similarity_max INT NOT NULL DEFAULT 40,
  creativity_max INT NOT NULL DEFAULT 20,
  overall_accuracy_max INT NOT NULL DEFAULT 15,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(event_id, round_number)
);

-- 4. PARTICIPANTS TABLE
CREATE TABLE IF NOT EXISTS public.participants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_name TEXT NOT NULL UNIQUE,
  members TEXT,
  access_code TEXT NOT NULL DEFAULT 'PROMPTX2026',
  status TEXT NOT NULL DEFAULT 'idle', -- idle | working | submitted | disqualified
  current_qualified_round INT NOT NULL DEFAULT 1, -- 1 (all), 2 (top 7), 3 (top 5)
  last_activity TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. SUBMISSIONS TABLE
CREATE TABLE IF NOT EXISTS public.submissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  participant_id UUID NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  round_id UUID REFERENCES public.rounds(id) ON DELETE CASCADE,
  round_number INT NOT NULL DEFAULT 1,
  prompt TEXT NOT NULL,
  recreated_image_url TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE(participant_id, round_number)
);

-- 6. SCORES TABLE
CREATE TABLE IF NOT EXISTS public.scores (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  submission_id UUID NOT NULL UNIQUE REFERENCES public.submissions(id) ON DELETE CASCADE,
  prompt_quality NUMERIC NOT NULL DEFAULT 0,
  image_similarity NUMERIC NOT NULL DEFAULT 0,
  creativity NUMERIC NOT NULL DEFAULT 0,
  overall_accuracy NUMERIC NOT NULL DEFAULT 0,
  total_score NUMERIC NOT NULL DEFAULT 0,
  comments TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. QUALIFIERS TABLE
CREATE TABLE IF NOT EXISTS public.qualifiers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  round_number INT NOT NULL, -- 1, 2, 3
  participant_id UUID NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  rank INT NOT NULL,
  qualified BOOLEAN NOT NULL DEFAULT TRUE,
  confirmed_by_admin BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(round_number, participant_id)
);

-- 8. ROW LEVEL SECURITY (RLS) POLICIES
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qualifiers ENABLE ROW LEVEL SECURITY;

-- Public & Participant Read Policies
CREATE POLICY "Allow public read access to events" ON public.events FOR SELECT USING (true);
CREATE POLICY "Allow public read access to rounds" ON public.rounds FOR SELECT USING (true);
CREATE POLICY "Allow public read access to participants" ON public.participants FOR SELECT USING (true);
CREATE POLICY "Allow public read access to qualifiers" ON public.qualifiers FOR SELECT USING (true);

-- Submission Security: Participants can only read/insert their own submissions
CREATE POLICY "Allow participants to insert own submission" ON public.submissions 
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow public read access to submissions" ON public.submissions 
  FOR SELECT USING (true);

CREATE POLICY "Allow public read access to scores" ON public.scores 
  FOR SELECT USING (true);

-- Admin Full Access Policies (Allow service role and full write)
CREATE POLICY "Allow all access to events" ON public.events FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to rounds" ON public.rounds FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to participants" ON public.participants FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to submissions" ON public.submissions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to scores" ON public.scores FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to qualifiers" ON public.qualifiers FOR ALL USING (true) WITH CHECK (true);

-- 9. INITIAL EVENT & ROUND SEED DATA
INSERT INTO public.events (event_name, status, current_round, results_revealed, joining_code)
VALUES ('PROMPTX 2026 â€” AI Image Recreation', 'ACTIVE', 1, false, 'PROMPTX2026')
ON CONFLICT DO NOTHING;

INSERT INTO public.rounds (round_number, reference_image_url, status, timer_duration, timer_remaining)
VALUES 
  (1, 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1000&q=80', 'ACTIVE', 1800, 1800),
  (2, 'https://images.unsplash.com/photo-1634017839464-5c339ebe3cb4?auto=format&fit=crop&w=1000&q=80', 'UPCOMING', 1800, 1800),
  (3, 'https://images.unsplash.com/photo-1620641788421-7a1c342ea42e?auto=format&fit=crop&w=1000&q=80', 'UPCOMING', 1800, 1800)
ON CONFLICT DO NOTHING;

-- 10. EVENT STATE TABLE & REALTIME PUBLICATION
CREATE TABLE IF NOT EXISTS public.event_state (
  id INT PRIMARY KEY DEFAULT 1,
  stage TEXT NOT NULL DEFAULT 'WAITING',
  current_round INT NOT NULL DEFAULT 1,
  timer_remaining INT NOT NULL DEFAULT 1800,
  timer_is_running BOOLEAN NOT NULL DEFAULT FALSE,
  reference_image TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.event_state (id, stage, current_round, timer_remaining, timer_is_running, reference_image)
VALUES (1, 'WAITING', 1, 1800, false, 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1000&q=80')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.event_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "event_state_all" ON public.event_state FOR ALL USING (true) WITH CHECK (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.participants;
ALTER PUBLICATION supabase_realtime ADD TABLE public.event_state;
