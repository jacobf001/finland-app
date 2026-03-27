import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import * as cheerio from "cheerio";

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

async function scrapeLineupsFromPage(url: string) {
  const res = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "en-GB,en;q=0.9,fi;q=0.8",
      pragma: "no-cache",
      "cache-control": "no-cache",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch lineup page (${res.status})`);
  }

  const html = await res.text();
  if (!html || html.length < 500) {
    throw new Error("Lineup page returned empty HTML");
  }

  const $ = cheerio.load(html);

  function txt(input: cheerio.Cheerio<any>) {
    return input.text().replace(/\s+/g, " ").trim();
  }

  function cleanName(raw: string) {
    return raw
      .replace(/\|\s*MV/gi, "")
      .replace(/\|\s*C/gi, "")
      .replace(/\bMV\b/gi, "")
      .replace(/\bC\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function parsePlayerRow(el: any) {
    const row = $(el);

    let shirtText = txt(row.find(".shirtnumber").first());
    let shirtNo = /^\d+$/.test(shirtText) ? Number(shirtText) : null;

    const link = row.find("td:nth-child(2) a").first();
    const nameText = cleanName(txt(link));
    if (!nameText) return null;

    if (shirtNo == null) {
      const embeddedShirt = txt(link.find(".shirtnumber").first());
      shirtNo = /^\d+$/.test(embeddedShirt) ? Number(embeddedShirt) : null;
    }

    const href = link.attr("href") || "";
    const m = href.match(/\/person\/(\d+)\//);
    const splPlayerId = m ? m[1] : null;

    return {
      spl_player_id: splPlayerId,
      name: nameText,
      shirt_no: shirtNo,
    };
  }

  const teamLinks = $("h2.teamname a");

  if (teamLinks.length < 2) {
    throw new Error(
      JSON.stringify({
        message: "Could not find both team headings",
        hasMatchdetails: html.includes("matchdetails"),
        hasTeamname: html.includes("teamname"),
        hasAloituskokoonpano: html.toLowerCase().includes("aloituskokoonpano"),
        hasVaihtopelaajat: html.toLowerCase().includes("vaihtopelaajat"),
        sample: html.slice(0, 2000),
      }),
    );
  }

  const homeHref = teamLinks.eq(0).attr("href") || "";
  const awayHref = teamLinks.eq(1).attr("href") || "";

  const homeMatch = homeHref.match(/\/team\/(\d+)\//);
  const awayMatch = awayHref.match(/\/team\/(\d+)\//);

  const homeTeamId = homeMatch ? homeMatch[1] : null;
  const awayTeamId = awayMatch ? awayMatch[1] : null;

  const homeName = txt(teamLinks.eq(0)) || "Home";
  const awayName = txt(teamLinks.eq(1)) || "Away";

  const headings = $("h3").toArray();

  const startersHeading = headings.find((h) =>
    $(h).text().toLowerCase().includes("aloituskokoonpano"),
  );
  const benchHeading = headings.find((h) =>
    $(h).text().toLowerCase().includes("vaihtopelaajat"),
  );

  if (!startersHeading) {
    throw new Error(
      JSON.stringify({
        message: "Could not find Aloituskokoonpano section",
        sample: html.slice(0, 2000),
      }),
    );
  }

  if (!benchHeading) {
    throw new Error(
      JSON.stringify({
        message: "Could not find Vaihtopelaajat section",
        sample: html.slice(0, 2000),
      }),
    );
  }

  const starterCols = $(startersHeading).next().find(".playerlist.col");
  const benchCols = $(benchHeading).next().find(".col");

  if (starterCols.length < 2) {
    throw new Error("Could not find both starter columns");
  }
  if (benchCols.length < 2) {
    throw new Error("Could not find both bench columns");
  }

  const homeStarters = uniqById(
    starterCols
      .eq(0)
      .find("tbody tr")
      .toArray()
      .map(parsePlayerRow)
      .filter(Boolean)
      .map((p: any, i: number) => ({
        spl_player_id: p.spl_player_id ?? `web-home-xi-${i}-${p.name}`,
        name: p.name,
        shirt_no: p.shirt_no,
      })),
  );

  const awayStarters = uniqById(
    starterCols
      .eq(1)
      .find("tbody tr")
      .toArray()
      .map(parsePlayerRow)
      .filter(Boolean)
      .map((p: any, i: number) => ({
        spl_player_id: p.spl_player_id ?? `web-away-xi-${i}-${p.name}`,
        name: p.name,
        shirt_no: p.shirt_no,
      })),
  );

  const homeBench = uniqById(
    benchCols
      .eq(0)
      .find("tbody tr")
      .toArray()
      .map(parsePlayerRow)
      .filter(Boolean)
      .map((p: any, i: number) => ({
        spl_player_id: p.spl_player_id ?? `web-home-bench-${i}-${p.name}`,
        name: p.name,
        shirt_no: p.shirt_no,
      })),
  );

  const awayBench = uniqById(
    benchCols
      .eq(1)
      .find("tbody tr")
      .toArray()
      .map(parsePlayerRow)
      .filter(Boolean)
      .map((p: any, i: number) => ({
        spl_player_id: p.spl_player_id ?? `web-away-bench-${i}-${p.name}`,
        name: p.name,
        shirt_no: p.shirt_no,
      })),
  );

  if (homeStarters.length < 8 || awayStarters.length < 8) {
    throw new Error("Could not parse lineup tables cleanly from webpage");
  }

  const teams: TeamsBlock = {
    home: {
      spl_team_id: homeTeamId ?? null,
      team_name: homeName,
    },
    away: {
      spl_team_id: awayTeamId ?? null,
      team_name: awayName,
    },
  };

  return {
    teams,
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
    const scrapeUrl =
      inputUrl && inputUrl.startsWith("http")
        ? inputUrl
        : `https://tulospalvelu.palloliitto.fi/match/${matchId}/lineups`;

    const scraped = await scrapeLineupsFromPage(scrapeUrl);

    const { data: fallbackMatchRow } = await supabaseAdmin
      .from("matches")
      .select("spl_competition_id, spl_category_id, home_score, away_score, kickoff_at")
      .eq("spl_match_id", matchId)
      .maybeSingle();

    let fallbackCompRow: any = null;
    if (fallbackMatchRow?.spl_competition_id && fallbackMatchRow?.spl_category_id) {
      const { data } = await supabaseAdmin
        .from("competitions")
        .select("gender, tier, category_name")
        .eq("spl_competition_id", fallbackMatchRow.spl_competition_id)
        .eq("spl_category_id", fallbackMatchRow.spl_category_id)
        .maybeSingle();

      fallbackCompRow = data ?? null;
    }

    return NextResponse.json({
      inputUrl: inputUrl || `match:${matchId}`,
      fetchUrl: `web:${matchId}`,
      matchId,
      match: {
        home_score: fallbackMatchRow?.home_score ?? null,
        away_score: fallbackMatchRow?.away_score ?? null,
        kickoff_at: fallbackMatchRow?.kickoff_at ?? null,
        competition: {
          gender: fallbackCompRow?.gender ?? null,
          tier: fallbackCompRow?.tier ?? null,
          category_name: fallbackCompRow?.category_name ?? null,
        },
      },
      counts: {
        startersHome: scraped.home.starters.length,
        startersAway: scraped.away.starters.length,
        benchHome: scraped.home.bench.length,
        benchAway: scraped.away.bench.length,
      },
      teams: scraped.teams,
      home: scraped.home,
      away: scraped.away,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? `No lineups found for match ${matchId}` },
      { status: 404 },
    );
  }
}