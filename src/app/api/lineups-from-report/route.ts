import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";
import chromium from "@sparticuz/chromium";
import { chromium as playwright } from "playwright-core";

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

async function launchBrowser() {
  const isVercel = process.env.VERCEL === "1";

  if (isVercel) {
    const executablePath = await chromium.executablePath();

    if (!executablePath) {
      throw new Error("Sparticuz Chromium executable not found on Vercel");
    }

    console.log("Using Vercel Chromium:", executablePath);

    return playwright.launch({
      args: chromium.args,
      executablePath,
      headless: true,
    });
  }

  console.log("Using local Playwright browser");

  return playwright.launch({
    headless: true,
  });
}

async function scrapeLineupsFromPage(url: string) {
  const browser = await launchBrowser();

  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });

    const cookieButton = page.getByText(/sallin evästeet|accept|allow/i).first();
    if (await cookieButton.isVisible().catch(() => false)) {
      await cookieButton.click().catch(() => {});
      await page.waitForTimeout(1000);
    }

    await page.waitForLoadState("networkidle", { timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(1500);

    const result = await page.evaluate(() => {
      function txt(el: Element | null | undefined) {
        return (el?.textContent || "").replace(/\s+/g, " ").trim();
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

      function parsePlayerRow(tr: Element) {
        const shirtText = txt(tr.querySelector(".shirtnumber"));
        const shirtNo = /^\d+$/.test(shirtText) ? Number(shirtText) : null;

        const link = tr.querySelector("td:nth-child(2) a");
        const nameText = cleanName(txt(link));
        if (!nameText) return null;

        const href = link?.getAttribute("href") || "";
        const m = href.match(/\/person\/(\d+)\//);
        const splPlayerId = m ? m[1] : null;

        return {
          spl_player_id: splPlayerId,
          name: nameText,
          shirt_no: shirtNo,
        };
      }

      const teamLinks = Array.from(document.querySelectorAll("h2.teamname a"));
      const homeHref = teamLinks[0]?.getAttribute("href") || "";
      const awayHref = teamLinks[1]?.getAttribute("href") || "";

      const homeMatch = homeHref.match(/\/team\/(\d+)\//);
      const awayMatch = awayHref.match(/\/team\/(\d+)\//);

      const homeTeamId = homeMatch ? homeMatch[1] : null;
      const awayTeamId = awayMatch ? awayMatch[1] : null;

      const homeName = txt(teamLinks[0]) || "Home";
      const awayName = txt(teamLinks[1]) || "Away";

      const headings = Array.from(document.querySelectorAll("h3"));
      const startersHeading = headings.find((h) =>
        txt(h).toLowerCase().includes("aloituskokoonpano"),
      );
      const benchHeading = headings.find((h) =>
        txt(h).toLowerCase().includes("vaihtopelaajat"),
      );

      if (!startersHeading) throw new Error("Could not find Aloituskokoonpano section");
      if (!benchHeading) throw new Error("Could not find Vaihtopelaajat section");

      const starterCols = startersHeading.nextElementSibling
        ? Array.from(startersHeading.nextElementSibling.querySelectorAll(".playerlist.col"))
        : [];
      const benchCols = benchHeading.nextElementSibling
        ? Array.from(benchHeading.nextElementSibling.querySelectorAll(".col"))
        : [];

      if (starterCols.length < 2) throw new Error("Could not find both starter columns");
      if (benchCols.length < 2) throw new Error("Could not find both bench columns");

      return {
        teams: {
          home: { spl_team_id: homeTeamId, team_name: homeName },
          away: { spl_team_id: awayTeamId, team_name: awayName },
        },
        home: {
          starters: Array.from(starterCols[0].querySelectorAll("tbody tr"))
            .map(parsePlayerRow)
            .filter(Boolean),
          bench: Array.from(benchCols[0].querySelectorAll("tbody tr"))
            .map(parsePlayerRow)
            .filter(Boolean),
        },
        away: {
          starters: Array.from(starterCols[1].querySelectorAll("tbody tr"))
            .map(parsePlayerRow)
            .filter(Boolean),
          bench: Array.from(benchCols[1].querySelectorAll("tbody tr"))
            .map(parsePlayerRow)
            .filter(Boolean),
        },
      };
    });

    const homeStarters = uniqById(
      result.home.starters.map((p: any, i: number) => ({
        spl_player_id: p.spl_player_id ?? `web-home-xi-${i}-${p.name}`,
        name: p.name,
        shirt_no: p.shirt_no,
      })),
    );

    const awayStarters = uniqById(
      result.away.starters.map((p: any, i: number) => ({
        spl_player_id: p.spl_player_id ?? `web-away-xi-${i}-${p.name}`,
        name: p.name,
        shirt_no: p.shirt_no,
      })),
    );

    const homeBench = uniqById(
      result.home.bench.map((p: any, i: number) => ({
        spl_player_id: p.spl_player_id ?? `web-home-bench-${i}-${p.name}`,
        name: p.name,
        shirt_no: p.shirt_no,
      })),
    );

    const awayBench = uniqById(
      result.away.bench.map((p: any, i: number) => ({
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
        spl_team_id: result.teams.home.spl_team_id ?? null,
        team_name: result.teams.home.team_name,
      },
      away: {
        spl_team_id: result.teams.away.spl_team_id ?? null,
        team_name: result.teams.away.team_name,
      },
    };

    return {
      teams,
      home: { starters: homeStarters, bench: homeBench } satisfies TeamLineup,
      away: { starters: awayStarters, bench: awayBench } satisfies TeamLineup,
    };
  } finally {
    await browser.close().catch(() => {});
  }
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