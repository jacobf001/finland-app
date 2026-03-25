import { supabaseAdmin } from "./supabaseServer";
import type { TeamRow, TeamSeasonSummary, PlayerSeasonRow, LikelyXIPlayer } from "./types";

export async function listTeams(): Promise<TeamRow[]> {
  const { data, error } = await supabaseAdmin
    .from("teams")
    .select("spl_team_id, team_name, club_name")
    .order("team_name", { ascending: true });

  if (error) throw new Error(error.message);

  return (data ?? []).map((r: any) => ({
    spl_team_id: String(r.spl_team_id),
    name: r.team_name ?? r.club_name ?? null,
    team_name: r.team_name ?? r.club_name ?? null,
  }));
}

async function getTeamName(teamId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("teams")
    .select("team_name, club_name")
    .eq("spl_team_id", teamId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return ((data as any)?.team_name ?? (data as any)?.club_name ?? null) as string | null;
}

export async function getTeamSeasonSummary(
  teamId: string,
  seasonYear: number,
): Promise<TeamSeasonSummary | null> {
  const { data, error } = await supabaseAdmin
    .from("computed_league_table")
    .select("*")
    .eq("season_year", seasonYear)
    .eq("team_ksi_id", teamId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  if (!(data as any).team_name) {
    (data as any).team_name = await getTeamName(teamId);
  }

  return data as TeamSeasonSummary;
}

export async function getTeamPlayersSeason(
  teamId: string,
  seasonYear: number,
  limitRows = 250,
): Promise<PlayerSeasonRow[]> {
  const { data, error } = await supabaseAdmin
    .from("player_season_to_date")
    .select("*")
    .eq("season_year", seasonYear)
    .eq("spl_team_id", teamId)
    .order("minutes", { ascending: false })
    .limit(limitRows);

  if (error) throw new Error(error.message);
  return (data ?? []) as PlayerSeasonRow[];
}

export async function getMatchMeta(matchId: string): Promise<{
  spl_match_id: string;
  kickoff_at: string | null;
  home_team_spl_id: string | null;
  away_team_spl_id: string | null;
} | null> {
  const { data, error } = await supabaseAdmin
    .from("matches")
    .select("spl_match_id, kickoff_at, home_team_spl_id, away_team_spl_id")
    .eq("spl_match_id", matchId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  return {
    spl_match_id: String((data as any).spl_match_id),
    kickoff_at: (data as any).kickoff_at ?? null,
    home_team_spl_id: (data as any).home_team_spl_id ? String((data as any).home_team_spl_id) : null,
    away_team_spl_id: (data as any).away_team_spl_id ? String((data as any).away_team_spl_id) : null,
  };
}

export async function getLikelyXI(teamId: string, seasonYear: number): Promise<LikelyXIPlayer[]> {
  const prevYear = seasonYear - 1;

  const [
    { data: curData, error: curErr },
    { data: prevData, error: prevErr },
  ] = await Promise.all([
    supabaseAdmin
      .from("player_season_to_date")
      .select("spl_player_id, player_name, minutes, starts, goals")
      .eq("season_year", seasonYear)
      .eq("spl_team_id", teamId)
      .order("starts", { ascending: false })
      .order("minutes", { ascending: false })
      .limit(40),
    supabaseAdmin
      .from("player_season_to_date")
      .select("spl_player_id, player_name, minutes, starts, goals")
      .eq("season_year", prevYear)
      .eq("spl_team_id", teamId)
      .order("starts", { ascending: false })
      .order("minutes", { ascending: false })
      .limit(40),
  ]);

  if (curErr) throw new Error(curErr.message);
  if (prevErr) throw new Error(prevErr.message);

  const curRows = (curData ?? []) as LikelyXIPlayer[];
  const prevRows = (prevData ?? []) as LikelyXIPlayer[];

  const maxStartsCur = curRows.length > 0 ? Math.max(...curRows.map(r => r.starts ?? 0)) : 0;
  const seasonProgress = Math.min(1, maxStartsCur / 18);

  const prevById = new Map<string, LikelyXIPlayer>();
  for (const r of prevRows) prevById.set(String(r.spl_player_id), r);

  const scores = new Map<string, { player: LikelyXIPlayer; score: number }>();

  for (const r of curRows) {
    const id = String(r.spl_player_id);
    const curScore = (r.starts ?? 0) * 90 + (r.minutes ?? 0);
    const prev = prevById.get(id);
    const prevScore = prev ? (prev.starts ?? 0) * 90 + (prev.minutes ?? 0) : 0;
    const curStarts = r.starts ?? 0;
    const curWeight = Math.min(1, seasonProgress + (curStarts / 15) * 0.5);
    const prevWeight = (1 - curWeight) * 0.6;
    scores.set(id, { player: r, score: curScore * curWeight + prevScore * prevWeight });
  }

  for (const r of prevRows) {
    const id = String(r.spl_player_id);
    if (scores.has(id)) continue;
    if ((r.starts ?? 0) < 8) continue;
    const prevScore = (r.starts ?? 0) * 90 + (r.minutes ?? 0);
    const prevWeight = 0.50 - (seasonProgress * 0.35);
    scores.set(id, { player: r, score: prevScore * prevWeight });
  }

  const MIN_SCORE = 450;
  return Array.from(scores.values())
    .filter(x => x.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .map(x => x.player);
}

export async function getPlayersSeasonRows(
  playerIds: string[],
  seasonYear: number,
): Promise<PlayerSeasonRow[]> {
  const ids = playerIds.map(String).filter(Boolean);
  if (!ids.length) return [];

  const { data, error } = await supabaseAdmin
    .from("player_season_to_date")
    .select("*")
    .eq("season_year", seasonYear)
    .in("spl_player_id", ids);

  if (error) throw new Error(error.message);
  return (data ?? []) as PlayerSeasonRow[];
}

export type RecentAppearanceRow = {
  spl_player_id: string;
  spl_match_id: string;
  spl_team_id: string | null;
  side: string | null;
  squad: string | null;
  minute_in: number | null;
  minute_out: number | null;
  kickoff_at: string | null;
  home_team_spl_id: string | null;
  away_team_spl_id: string | null;
  home_score: number | null;
  away_score: number | null;
};

export async function getPlayersRecentAppearances(
  playerIds: string[],
  seasonYear: number,
  lastX: number,
): Promise<Record<string, RecentAppearanceRow[]>> {
  const ids = playerIds.map(String).filter(Boolean);
  if (!ids.length) return {};

  const maxFetch = Math.min(ids.length * lastX * 3, 5000);

  const { data, error } = await supabaseAdmin
    .from("match_lineups")
    .select(
      `
      spl_player_id,
      spl_match_id,
      spl_team_id,
      side,
      squad,
      minute_in,
      minute_out,
      matches!inner (
        kickoff_at,
        season_year,
        home_team_spl_id,
        away_team_spl_id,
        home_score,
        away_score
      )
    `,
    )
    .in("spl_player_id", ids)
    .eq("matches.season_year", seasonYear)
    .order("kickoff_at", { foreignTable: "matches", ascending: false })
    .limit(maxFetch);

  if (error) throw new Error(error.message);

  const grouped: Record<string, RecentAppearanceRow[]> = {};
  for (const r of data ?? []) {
    const pid = String((r as any).spl_player_id);
    const m = (r as any).matches ?? {};

    const row: RecentAppearanceRow = {
      spl_player_id: pid,
      spl_match_id: String((r as any).spl_match_id),
      spl_team_id: (r as any).spl_team_id ? String((r as any).spl_team_id) : null,
      side: (r as any).side ?? null,
      squad: (r as any).squad ?? null,
      minute_in: (r as any).minute_in ?? null,
      minute_out: (r as any).minute_out ?? null,
      kickoff_at: m.kickoff_at ?? null,
      home_team_spl_id: m.home_team_spl_id ? String(m.home_team_spl_id) : null,
      away_team_spl_id: m.away_team_spl_id ? String(m.away_team_spl_id) : null,
      home_score: m.home_score ?? null,
      away_score: m.away_score ?? null,
    };

    (grouped[pid] ||= []).push(row);
  }

  for (const pid of Object.keys(grouped)) {
    grouped[pid] = grouped[pid].slice(0, lastX);
  }

  return grouped;
}