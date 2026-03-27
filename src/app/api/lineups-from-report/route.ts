import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  spl_match_team_id?: string | null;
  team_name: string | null;
};

type TeamsBlock = {
  home: ParsedTeam;
  away: ParsedTeam;
};

function extractMatchId(input: string): string | null {
  const urlMatch = input.match(/\/match\/(\d+)/);
  if (urlMatch) return urlMatch[1];
  if (/^\d+$/.test(input.trim())) return input.trim();
  return null;
}

function uniqById(xs: LineupPlayer[]): LineupPlayer[] {
  const seen = new Set<string>();
  const out: LineupPlayer[] = [];
  for (const x of xs) {
    const id = String(x.spl_player_id ?? "");
    if (!id || id === "undefined" || seen.has(id)) continue;
    seen.add(id);
    out.push(x);
  }
  return out;
}

function rowToPlayer(r: any): LineupPlayer {
  const name =
    r.player_name ||
    [r.first_name, r.last_name].filter(Boolean).join(" ") ||
    "Unknown";

  return {
    spl_player_id: String(r.spl_player_id),
    name,
    shirt_no: r.shirt_number ?? null,
  };
}

async function fetchLineupsFromApi(matchId: string) {
  const apiUrl = `https://tulospalvelu.palloliitto.fi/api/public/match.php?match_id=${matchId}&method=getMatch`;

  const res = await fetch(apiUrl, {
    headers: {
      accept: "application/json,text/plain,*/*",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch match api (${res.status})`);
  }

  const json = await res.json();
  const match = json?.match;

  if (!match) {
    throw new Error("Match API returned no match object");
  }

  const allLineups = Array.isArray(match.lineups) ? match.lineups : [];
  if (allLineups.length === 0) {
    throw new Error("Match API returned no lineups");
  }

  const homeTeamId = match.team_A_id ? String(match.team_A_id) : null;
  const awayTeamId = match.team_B_id ? String(match.team_B_id) : null;

  const homeRows = allLineups.filter((p: any) => String(p.team_id ?? "") === String(homeTeamId ?? ""));
  const awayRows = allLineups.filter((p: any) => String(p.team_id ?? "") === String(awayTeamId ?? ""));

  function toPlayer(p: any, fallbackPrefix: string, i: number): LineupPlayer {
    const firstName = String(p.first_name ?? "").trim();
    const lastName = String(p.last_name ?? "").trim();
    const fullName =
      String(p.player_name ?? "").trim() ||
      [firstName, lastName].filter(Boolean).join(" ") ||
      "Unknown";

    const shirtText = String(p.shirt_number ?? "").trim();
    const shirtNo = /^\d+$/.test(shirtText) ? Number(shirtText) : null;

    return {
      spl_player_id: p.player_id != null ? String(p.player_id) : `${fallbackPrefix}-${i}`,
      name: fullName,
      shirt_no: shirtNo,
    };
  }

  const homeStarters = uniqById(
    homeRows
      .filter((p: any) => String(p.start) === "1")
      .map((p: any, i: number) => toPlayer(p, "api-home-xi", i)),
  );

  const homeBench = uniqById(
    homeRows
      .filter((p: any) => String(p.start) !== "1")
      .map((p: any, i: number) => toPlayer(p, "api-home-bench", i)),
  );

  const awayStarters = uniqById(
    awayRows
      .filter((p: any) => String(p.start) === "1")
      .map((p: any, i: number) => toPlayer(p, "api-away-xi", i)),
  );

  const awayBench = uniqById(
    awayRows
      .filter((p: any) => String(p.start) !== "1")
      .map((p: any, i: number) => toPlayer(p, "api-away-bench", i)),
  );

  const teams: TeamsBlock = {
    home: {
      spl_team_id: homeTeamId,
      team_name: match.team_A_name ?? null,
    },
    away: {
      spl_team_id: awayTeamId,
      team_name: match.team_B_name ?? null,
    },
  };

  return {
    teams,
    matchMeta: {
      home_score: match.fs_A != null && match.fs_A !== "" ? Number(match.fs_A) : null,
      away_score: match.fs_B != null && match.fs_B !== "" ? Number(match.fs_B) : null,
      kickoff_at:
        match.date && match.time
          ? `${match.date}T${match.time}${match.time_zone_offset ?? ""}`
          : null,
      competition: {
        gender:
          String(match.category_group_name ?? "").toLowerCase().includes("naiset") ? "Female" :
          String(match.category_group_name ?? "").toLowerCase().includes("miehet") ? "Male" :
          null,
        tier: null,
        category_name: match.category_name ?? null,
      },
    },
    home: { starters: homeStarters, bench: homeBench } satisfies TeamLineup,
    away: { starters: awayStarters, bench: awayBench } satisfies TeamLineup,
  };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const inputUrl = searchParams.get("url") ?? "";
  const matchIdParam = searchParams.get("match_id") ?? "";

  const matchId = extractMatchId(inputUrl) ?? extractMatchId(matchIdParam);
  if (!matchId) {
    return NextResponse.json(
      {
        error:
          "Could not extract match ID. Provide ?url=https://tulospalvelu.palloliitto.fi/match/MATCH_ID or ?match_id=MATCH_ID",
      },
      { status: 400 },
    );
  }

  const { data: lineupRows, error: lineupErr } = await supabaseAdmin
    .from("match_lineups")
    .select(
      "spl_match_id, spl_team_id, spl_player_id, player_name, first_name, last_name, shirt_number, squad, side, lineup_idx",
    )
    .eq("spl_match_id", Number(matchId))
    .order("lineup_idx", { ascending: true });

  if (lineupErr) {
    return NextResponse.json({ error: lineupErr.message }, { status: 500 });
  }

  if (lineupRows && lineupRows.length > 0) {
    const homeTeamSplId =
      lineupRows.find((r: any) => r.side === "home")?.spl_team_id != null
        ? String(lineupRows.find((r: any) => r.side === "home")!.spl_team_id)
        : null;

    const awayTeamSplId =
      lineupRows.find((r: any) => r.side === "away")?.spl_team_id != null
        ? String(lineupRows.find((r: any) => r.side === "away")!.spl_team_id)
        : null;

    const teamIds = [homeTeamSplId, awayTeamSplId].filter(Boolean) as string[];

    const { data: teamRows, error: teamErr } = await supabaseAdmin
      .from("teams")
      .select("spl_team_id, team_name, club_name")
      .in("spl_team_id", teamIds);

    if (teamErr) {
      return NextResponse.json({ error: teamErr.message }, { status: 500 });
    }

    const teamNameById = new Map<string, string>();
    for (const t of teamRows ?? []) {
      const tid = String((t as any).spl_team_id);
      const nm = (t as any).team_name ?? (t as any).club_name ?? "";
      if (nm) teamNameById.set(tid, nm);
    }

    const teams: TeamsBlock = {
      home: {
        spl_team_id: homeTeamSplId,
        team_name: homeTeamSplId ? (teamNameById.get(homeTeamSplId) ?? null) : null,
      },
      away: {
        spl_team_id: awayTeamSplId,
        team_name: awayTeamSplId ? (teamNameById.get(awayTeamSplId) ?? null) : null,
      },
    };

    const { data: matchRow } = await supabaseAdmin
      .from("matches")
      .select(
        "spl_match_id, home_team_spl_id, away_team_spl_id, home_score, away_score, kickoff_at, spl_competition_id, spl_category_id",
      )
      .eq("spl_match_id", matchId)
      .maybeSingle();

    let compRow: any = null;
    if (matchRow?.spl_competition_id && matchRow?.spl_category_id) {
      const { data } = await supabaseAdmin
        .from("competitions")
        .select("gender, tier, category_name")
        .eq("spl_competition_id", matchRow.spl_competition_id)
        .eq("spl_category_id", matchRow.spl_category_id)
        .maybeSingle();

      compRow = data ?? null;
    }

    const homeStarters = uniqById(
      lineupRows.filter((r: any) => r.side === "home" && r.squad === "xi").map(rowToPlayer),
    );
    const homeBench = uniqById(
      lineupRows.filter((r: any) => r.side === "home" && r.squad === "bench").map(rowToPlayer),
    );
    const awayStarters = uniqById(
      lineupRows.filter((r: any) => r.side === "away" && r.squad === "xi").map(rowToPlayer),
    );
    const awayBench = uniqById(
      lineupRows.filter((r: any) => r.side === "away" && r.squad === "bench").map(rowToPlayer),
    );

    return NextResponse.json({
      inputUrl: inputUrl || `match:${matchId}`,
      fetchUrl: `db:match_lineups:${matchId}`,
      matchId,
      match: {
        home_score: matchRow?.home_score ?? null,
        away_score: matchRow?.away_score ?? null,
        kickoff_at: matchRow?.kickoff_at ?? null,
        competition: {
          gender: compRow?.gender ?? null,
          tier: compRow?.tier ?? null,
          category_name: compRow?.category_name ?? null,
        },
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

    try {
    const apiData = await fetchLineupsFromApi(matchId);

    return NextResponse.json({
      inputUrl: inputUrl || `match:${matchId}`,
      fetchUrl: `api:getMatch:${matchId}`,
      matchId,
      match: apiData.matchMeta,
      counts: {
        startersHome: apiData.home.starters.length,
        startersAway: apiData.away.starters.length,
        benchHome: apiData.home.bench.length,
        benchAway: apiData.away.bench.length,
      },
      teams: apiData.teams,
      home: apiData.home,
      away: apiData.away,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? `No lineups found for match ${matchId}` },
      { status: 404 },
    );
  }
}