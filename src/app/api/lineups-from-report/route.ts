/**
 * /api/lineups-from-report/route.ts
 *
 * Finland version — no HTML scraping needed.
 * Lineups are already in the database from the scrape pipeline.
 *
 * Accepts either:
 *   ?url=https://tulospalvelu.palloliitto.fi/match/3237368/lineups
 *   ?url=https://tulospalvelu.palloliitto.fi/match/3237368
 *   ?match_id=3237368
 *
 * Returns the same shape as the Iceland lineups-from-report route
 * so lineup-stats/route.ts needs minimal changes.
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";

export const runtime = "nodejs";

type LineupPlayer = {
  spl_player_id: string;
  name: string;
  shirt_no: number | null;
};

type TeamLineup = {
  starters: LineupPlayer[];
  bench: LineupPlayer[];
};

type ParsedTeam = {
  spl_team_id: string | null;
  team_name: string | null;
};

type TeamsBlock = {
  home: ParsedTeam;
  away: ParsedTeam;
};

function extractMatchId(input: string): string | null {
  // Handle full URLs: https://tulospalvelu.palloliitto.fi/match/3237368/...
  const urlMatch = input.match(/\/match\/(\d+)/);
  if (urlMatch) return urlMatch[1];

  // Handle plain match IDs
  if (/^\d+$/.test(input.trim())) return input.trim();

  return null;
}

function uniqById(xs: LineupPlayer[]): LineupPlayer[] {
  const seen = new Set<string>();
  const out: LineupPlayer[] = [];
  for (const x of xs) {
    if (seen.has(x.spl_player_id)) continue;
    seen.add(x.spl_player_id);
    out.push(x);
  }
  return out;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const inputUrl = searchParams.get("url") ?? "";
  const matchIdParam = searchParams.get("match_id") ?? "";

  // Extract match ID from URL or direct param
  const matchId = extractMatchId(inputUrl) ?? extractMatchId(matchIdParam);
  if (!matchId) {
    return NextResponse.json(
      {
        error:
          "Could not extract match ID. Provide ?url=https://tulospalvelu.palloliitto.fi/match/MATCH_ID or ?match_id=MATCH_ID",
      },
      { status: 400 }
    );
  }

  // Fetch match metadata
  const { data: matchRow, error: matchErr } = await supabaseAdmin
    .from("matches")
    .select("spl_match_id, home_team_spl_id, away_team_spl_id, home_score, away_score, kickoff_at")
    .eq("spl_match_id", matchId)
    .maybeSingle();

  if (matchErr) return NextResponse.json({ error: matchErr.message }, { status: 500 });
  if (!matchRow) {
    return NextResponse.json(
      { error: `Match ${matchId} not found in database. It may not have been scraped yet.` },
      { status: 404 }
    );
  }

  // Fetch lineups from DB FIRST
  const { data: lineupRows, error: lineupErr } = await supabaseAdmin
    .from("match_lineups")
    .select("spl_player_id, player_name, first_name, last_name, shirt_number, squad, side, spl_team_id")
    .eq("spl_match_id", matchId)
    .order("lineup_idx", { ascending: true });

  if (lineupErr) return NextResponse.json({ error: lineupErr.message }, { status: 500 });

  if (!lineupRows || lineupRows.length === 0) {
    return NextResponse.json(
      { error: `No lineups found for match ${matchId}. Lineups may not have been scraped yet.` },
      { status: 200 }
    );
  }

  // Infer team ids from lineup rows first
  const homeLineupRow = lineupRows.find((r) => r.side === "home" && r.spl_team_id != null);
  const awayLineupRow = lineupRows.find((r) => r.side === "away" && r.spl_team_id != null);

  const inferredHomeTeamId =
    homeLineupRow?.spl_team_id != null ? String(homeLineupRow.spl_team_id) : null;
  const inferredAwayTeamId =
    awayLineupRow?.spl_team_id != null ? String(awayLineupRow.spl_team_id) : null;

  // Fallback to matches table only if lineup rows don't contain team ids
  const matchHomeTeamId =
    matchRow.home_team_spl_id != null ? String(matchRow.home_team_spl_id) : null;
  const matchAwayTeamId =
    matchRow.away_team_spl_id != null ? String(matchRow.away_team_spl_id) : null;

  const homeTeamId = inferredHomeTeamId ?? matchHomeTeamId;
  const awayTeamId = inferredAwayTeamId ?? matchAwayTeamId;

  // Fetch team names using inferred ids
  const teamIds = [homeTeamId, awayTeamId].filter(Boolean) as string[];
  const { data: teamRows, error: teamErr } = await supabaseAdmin
    .from("teams")
    .select("spl_team_id, team_name, club_name")
    .in("spl_team_id", teamIds);

  if (teamErr) return NextResponse.json({ error: teamErr.message }, { status: 500 });

  const teamNameById = new Map<string, string>();
  for (const t of teamRows ?? []) {
    const id = String((t as any).spl_team_id);
    const nm = (t as any).team_name ?? (t as any).club_name ?? "";
    teamNameById.set(id, nm);
  }

  const teams: TeamsBlock = {
    home: {
        spl_team_id: matchRow.home_team_spl_id ?? null,
        team_name: matchRow.home_team_spl_id ? (teamNameById.get(matchRow.home_team_spl_id) ?? null) : null,
    },
    away: {
        spl_team_id: matchRow.away_team_spl_id ?? null,
        team_name: matchRow.away_team_spl_id ? (teamNameById.get(matchRow.away_team_spl_id) ?? null) : null,
    },
  };


  console.log("INFERRED TEAM IDS", {
    matchId,
    matchHomeTeamId,
    matchAwayTeamId,
    inferredHomeTeamId,
    inferredAwayTeamId,
  });

  function rowToPlayer(r: any): LineupPlayer {
    const name =
      r.player_name || [r.first_name, r.last_name].filter(Boolean).join(" ") || "Unknown";
    return {
      spl_player_id: String(r.spl_player_id),
      name,
      shirt_no: r.shirt_number ?? null,
    };
  }

  const homeStarters = uniqById(
    lineupRows.filter((r) => r.side === "home" && r.squad === "xi").map(rowToPlayer)
  );
  const homeBench = uniqById(
    lineupRows.filter((r) => r.side === "home" && r.squad === "bench").map(rowToPlayer)
  );
  const awayStarters = uniqById(
    lineupRows.filter((r) => r.side === "away" && r.squad === "xi").map(rowToPlayer)
  );
  const awayBench = uniqById(
    lineupRows.filter((r) => r.side === "away" && r.squad === "bench").map(rowToPlayer)
  );

  return NextResponse.json({
    inputUrl: inputUrl || `match:${matchId}`,
    fetchUrl: `db:match_lineups:${matchId}`,
    matchId,
    match: {
      home_score: matchRow.home_score,
      away_score: matchRow.away_score,
      kickoff_at: matchRow.kickoff_at,
    },
    counts: {
      startersHome: homeStarters.length,
      startersAway: awayStarters.length,
      benchHome: homeBench.length,
      benchAway: awayBench.length,
    },
    teams,
    home: { starters: homeStarters, bench: homeBench } satisfies TeamLineup,
    away: { starters: awayStarters, bench: awayBench } satisfies TeamLineup,
  });
}