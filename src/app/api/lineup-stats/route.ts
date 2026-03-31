import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LineupPlayer = { spl_player_id: string; name: string; shirt_no: number | null };
type TeamLineup = { starters: LineupPlayer[]; bench: LineupPlayer[] };

type ParsedTeam = { spl_team_id: string | null; team_name: string | null };
type TeamsBlock = { home: ParsedTeam; away: ParsedTeam };

type LineupsFromReportResponse = {
  inputUrl: string;
  fetchUrl: string;
  counts: { startersHome: number; startersAway: number; benchHome: number; benchAway: number };
  teams?: TeamsBlock;
  match?: {
    home_score?: number | null;
    away_score?: number | null;
    kickoff_at?: string | null;
    competition?: {
      gender?: string | null;
      tier?: number | null;
      category_name?: string | null;
    } | null;
  } | null;
  home: TeamLineup;
  away: TeamLineup;
};

type NormalizedSeasonRow = {
  season_year: number;
  spl_team_id: string | null;
  spl_player_id: string | null;
  player_name: string | null;
  team_name: string | null;
  competition_tier: number | null;
  competition_category: string | null;
  gender: string | null;
  matches_played: number;
  starts: number;
  minutes: number;
  goals: number;
  yellows: number;
  reds: number;
};

type TeamTableRow = {
  season_year: number;
  spl_competition_id: string | null;
  group_id: string | null;
  group_name: string | null;
  competition_name: string | null;
  competition_category: string | null;
  competition_tier: number | null;
  team_spl_id: string | null;
  played: number;
  points: number;
  position: number | null;
  wins: number;
  draws: number;
  losses: number;
  goals_for: number;
  goals_against: number;
  goal_diff: number;
  team_name: string | null;
  club_name: string | null;
};

function parseSeasonYear(input: string | null): number | null {
  if (!input) return null;
  const m = input.match(/(19|20)\d{2}/);
  if (!m) return null;
  const y = Number(m[0]);
  return Number.isFinite(y) ? y : null;
}

function uniqById(xs: LineupPlayer[]) {
  const seen = new Set<string>();
  const out: LineupPlayer[] = [];
  for (const x of xs) {
    const id = String(x.spl_player_id);
    if (!id || id === "undefined" || seen.has(id)) continue;
    seen.add(id);
    out.push({ ...x, spl_player_id: id });
  }
  return out;
}

function minutesFromLineupRow(r: { minute_in: number | null; minute_out: number | null }) {
  const minIn = r.minute_in ?? 0;
  const minOut = r.minute_out ?? 90;
  return Math.max(0, Math.min(90, minOut) - Math.max(0, Math.min(90, minIn)));
}

function clamp01(x: number) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function clamp(x: number, lo: number, hi: number) {
  if (!Number.isFinite(x)) return lo;
  return Math.max(lo, Math.min(hi, x));
}

function normalizeSeasonRows(rows: any[] = []): NormalizedSeasonRow[] {
  return rows.map((r) => ({
    season_year: Number(r.season_year),
    spl_team_id: r.spl_team_id != null ? String(r.spl_team_id) : null,
    spl_player_id: r.spl_player_id != null ? String(r.spl_player_id) : null,
    player_name: r.player_name ?? null,
    team_name: r.team_name ?? r.club_name ?? null,
    competition_tier: Number.isFinite(Number(r.tier)) ? Number(r.tier) : null,
    competition_category: r.category_name ?? null,
    gender: r.gender ?? null,
    matches_played: Number(r.appearances ?? 0),
    starts: Number(r.starts ?? 0),
    minutes: Number(r.total_minutes ?? 0),
    goals: Number(r.goals ?? 0),
    yellows: Number(r.yellow_cards ?? 0),
    reds: Number(r.red_cards ?? 0),
  }));
}

function normalizeCategoryKey(category: string | null | undefined): string {
  if (!category) return "";
  const c = category.toLowerCase().trim();

  if (c.includes("p20") || c.includes("u20")) return "u20";
  if (c.includes("p19") || c.includes("u19")) return "u19";
  if (c.includes("p18") || c.includes("u18")) return "u18";
  if (c.includes("p17") || c.includes("u17")) return "u17";

  if (c.includes("kansallinen liiga")) return "women_t1";
  if (c.includes("kansallinen ykkönen")) return "women_t2";
  if (c.includes("kansallinen kakkonen")) return "women_t3";

  if (c.includes("naiset") || c.includes("naisten") || c.includes("women")) return "women";
  if (c.includes("miehet") || c.includes("miesten") || c.includes("men")) return "men";
  if (c.includes("suomen cup")) return "cup";

  return c;
}

function chooseDominantCategory(rows: NormalizedSeasonRow[]): string | null {
  if (!rows.length) return null;

  const scores = new Map<string, number>();
  for (const r of rows) {
    const key = normalizeCategoryKey(r.competition_category);
    if (!key) continue;
    const score =
      Number(r.minutes ?? 0) +
      Number(r.starts ?? 0) * 200 +
      Number(r.matches_played ?? 0) * 25;
    scores.set(key, (scores.get(key) ?? 0) + score);
  }

  let bestKey: string | null = null;
  let bestScore = -1;
  for (const [key, score] of scores.entries()) {
    if (score > bestScore) {
      bestScore = score;
      bestKey = key;
    }
  }
  return bestKey;
}

function genderMatches(rowGender: string | null | undefined, wantedGender: string | null | undefined) {
  if (!wantedGender) return true;
  if (!rowGender) return false;
  const rg = String(rowGender).toLowerCase();
  const wg = String(wantedGender).toLowerCase();
  if (wg === "male") return rg === "male" || rg === "youth_male";
  if (wg === "female") return rg === "female" || rg === "youth_female";
  if (wg === "youth_male") return rg === "male" || rg === "youth_male";
  if (wg === "youth_female") return rg === "female" || rg === "youth_female";
  return rg === wg;
}

function pickPreferredRows(
  rows: NormalizedSeasonRow[],
  teamId: string | null | undefined,
  preferredCategoryKey: string | null | undefined,
  preferredGender: string | null | undefined,
) {
  if (!rows.length) return [];

  const genderRows = rows.filter((r) => genderMatches(r.gender, preferredGender));

  const teamRows = teamId
    ? genderRows.filter((r) => String(r.spl_team_id ?? "") === String(teamId))
    : [];

  const teamAndCategoryRows =
    teamRows.length > 0 && preferredCategoryKey
      ? teamRows.filter((r) => normalizeCategoryKey(r.competition_category) === preferredCategoryKey)
      : [];

  if (teamAndCategoryRows.length > 0) {
    return teamAndCategoryRows.slice().sort((a, b) => Number(b.minutes ?? 0) - Number(a.minutes ?? 0));
  }

  if (teamRows.length > 0) {
    return teamRows.slice().sort((a, b) => Number(b.minutes ?? 0) - Number(a.minutes ?? 0));
  }

  const categoryRows = preferredCategoryKey
    ? genderRows.filter((r) => normalizeCategoryKey(r.competition_category) === preferredCategoryKey)
    : [];

  if (categoryRows.length > 0) {
    return categoryRows.slice().sort((a, b) => Number(b.minutes ?? 0) - Number(a.minutes ?? 0));
  }

  if (genderRows.length > 0) {
    return genderRows.slice().sort((a, b) => Number(b.minutes ?? 0) - Number(a.minutes ?? 0));
  }

  return rows.slice().sort((a, b) => Number(b.minutes ?? 0) - Number(a.minutes ?? 0));
}

function bestSideTeamName(rows: NormalizedSeasonRow[], preferredCategoryKey: string | null | undefined): string | null {
  const filtered = preferredCategoryKey
    ? rows.filter((r) => normalizeCategoryKey(r.competition_category) === preferredCategoryKey)
    : rows;

  const source = filtered.length > 0 ? filtered : rows;
  if (!source.length) return null;

  const scores = new Map<string, number>();
  for (const r of source) {
    const name = String(r.team_name ?? "").trim();
    if (!name) continue;

    const score =
      Number(r.minutes ?? 0) +
      Number(r.starts ?? 0) * 200 +
      Number(r.matches_played ?? 0) * 25;

    scores.set(name, (scores.get(name) ?? 0) + score);
  }

  let best: string | null = null;
  let bestScore = -1;
  for (const [name, score] of scores.entries()) {
    if (score > bestScore) {
      best = name;
      bestScore = score;
    }
  }

  return best;
}

function isWomenName(name: string | null | undefined): boolean {
  if (!name) return false;
  const n = name.toLowerCase();
  return (
    n.includes("naiset") ||
    n.includes("naisten") ||
    n.includes("women") ||
    n.includes("kansallinen liiga") ||
    n.includes("kansallinen ykkönen") ||
    n.includes("kansallinen kakkonen")
  );
}

function isWomenRow(row: Pick<NormalizedSeasonRow, "competition_category" | "gender"> | null | undefined) {
  if (!row) return false;
  const c = String(row.competition_category ?? "").toLowerCase();
  const g = String(row.gender ?? "").toLowerCase();
  return g === "female" || c.includes("naiset") || c.includes("kansallinen");
}

function isYouthCategory(category: string | null | undefined) {
  if (!category) return false;
  const c = category.toLowerCase();
  return (
    c.includes("u17") || c.includes("u-17") ||
    c.includes("u18") || c.includes("u-18") ||
    c.includes("u19") || c.includes("u-19") ||
    c.includes("u20") || c.includes("u-20") ||
    c.includes("u21") || c.includes("u-21") ||
    c.includes("p17") || c.includes("p18") ||
    c.includes("p19") || c.includes("p20") ||
    c.includes("p21")
  );
}

function tierQualityN(tier: number | null | undefined, women = false) {
  const t = Number.isFinite(Number(tier)) ? Number(tier) : 6;
  if (t <= 1) return 1.0;
  if (women) {
    if (t === 2) return 0.25;
    if (t === 3) return 0.06;
    if (t === 4) return 0.03;
    if (t === 5) return 0.02;
    return 0.01;
  }
  if (t === 2) return 0.78;
  if (t === 3) return 0.58;
  if (t === 4) return 0.43;
  if (t === 5) return 0.32;
  return 0.25;
}

function tierScale(tier: number, women = false) {
  const t = Number.isFinite(tier) ? tier : 99;
  if (t <= 1) return 1.0;
  if (women) {
    if (t === 2) return 0.25;
    if (t === 3) return 0.06;
    if (t === 4) return 0.03;
    return 0.02;
  }
  if (t === 2) return 0.78;
  if (t === 3) return 0.58;
  if (t === 4) return 0.43;
  return 0.32;
}

function posMultiplier(position: number | null, leagueSize: number | null) {
  if (!position || !leagueSize || leagueSize <= 1) return 1.0;
  const posN = clamp01(1 - (position - 1) / (leagueSize - 1));
  return 0.75 + 0.4 * posN;
}

function leagueSizeForTier(tier: number | null): number | null {
  const t = Number.isFinite(Number(tier)) ? Number(tier) : null;
  if (t === null) return null;
  if (t <= 3) return 12;
  if (t === 4) return 10;
  if (t === 5) return 8;
  return 12;
}

function strengthFromTableRow(row: TeamTableRow | null | undefined) {
  if (!row) {
    return {
      played: 0,
      points: 0,
      tier: null as number | null,
      position: null as number | null,
      ppm: 0,
      base: 0,
      scale: 0,
      posMul: 1,
      strength: 0.15,
    };
  }

  const played = Number(row.played ?? 0);
  const points = Number(row.points ?? 0);
  const tier = Number.isFinite(Number(row.competition_tier)) ? Number(row.competition_tier) : null;
  const position = Number.isFinite(Number(row.position)) ? Number(row.position) : null;
  const women = isWomenName(row.competition_name) || isWomenName(row.competition_category);
  const ppm = played > 0 ? points / played : 0;
  const base = clamp01(ppm / 3);
  const scale = tierScale(tier ?? 99, women);
  const posMul = posMultiplier(position, leagueSizeForTier(tier));

  return {
    played,
    points,
    tier,
    position,
    ppm,
    base,
    scale,
    posMul,
    strength: clamp01(base * scale * posMul),
  };
}

function blendStrength(current: number, prev: number, played: number, tier: number | null = null) {
  const w = clamp01(played / 8);
  const blended = w * current + (1 - w) * prev;

  const TIER_FLOORS: Record<number, number> = { 1: 0.55, 2: 0.35, 3: 0.2, 4: 0.12, 5: 0.06 };
  const TIER_CEILINGS: Record<number, number> = { 1: 1.0, 2: 0.54, 3: 0.34, 4: 0.19, 5: 0.11 };

  const t = Number.isFinite(Number(tier)) ? Number(tier) : null;
  const floor = t !== null ? (TIER_FLOORS[t] ?? 0.04) : 0;
  const ceiling = t !== null ? (TIER_CEILINGS[t] ?? 1.0) : 1.0;
  const effectiveFloor = floor * Math.max(0, 1 - played / 8);

  return clamp01(Math.min(Math.max(blended, effectiveFloor), ceiling));
}

function chooseBestTeamTableRow(
  rows: TeamTableRow[],
  preferredCategoryKey?: string | null,
  preferredTeamName?: string | null,
): TeamTableRow | null {
  if (!rows.length) return null;

  const leagueRows = rows.filter((r) => Number(r.competition_tier ?? 99) < 99);
  const source = leagueRows.length > 0 ? leagueRows : rows;

  const categoryRows = preferredCategoryKey
    ? source.filter((r) => normalizeCategoryKey(r.competition_category) === preferredCategoryKey)
    : [];

  const byCategory = categoryRows.length > 0 ? categoryRows : source;

  if (preferredTeamName) {
    const exactNameRows = byCategory.filter((r) => String(r.team_name ?? "").trim() === preferredTeamName.trim());
    if (exactNameRows.length > 0) {
      return exactNameRows.reduce((best: TeamTableRow | null, r) => {
        if (!best) return r;
        if (Number(r.played ?? 0) > Number(best.played ?? 0)) return r;
        if (
          Number(r.played ?? 0) === Number(best.played ?? 0) &&
          Number(r.position ?? 999) < Number(best.position ?? 999)
        ) {
          return r;
        }
        return best;
      }, null);
    }
  }

  return byCategory.reduce((best: TeamTableRow | null, r) => {
    if (!best) return r;
    const bestTier = Number(best.competition_tier ?? 99);
    const tier = Number(r.competition_tier ?? 99);
    if (tier < bestTier) return r;
    if (tier === bestTier && Number(r.played ?? 0) > Number(best.played ?? 0)) return r;
    return best;
  }, null);
}

function calcImportance(params: {
  minutes: number;
  starts: number;
  goals: number;
  yellows: number;
  reds: number;
  maxGames: number;
  importanceCeiling: number;
}) {
  const maxMins = params.maxGames * 90;
  const minutesN = clamp01(params.minutes / Math.max(1, maxMins));
  const startsN = clamp01(params.starts / Math.max(1, params.maxGames));
  const goalsBoost = clamp01(params.goals / 12) * 0.15;
  const cardPenalty = clamp01(params.yellows * 0.02 + params.reds * 0.08);
  const base = minutesN * 0.35 + startsN * 0.55 + goalsBoost - cardPenalty;
  const scale = clamp01(params.importanceCeiling / 92);
  return Math.max(0, Math.round(base * 100 * scale));
}

function sideRating(side, sideStrength, missingImpact = 0, isYouthMatch = false, historicalStrength = sideStrength) {
// historicalStrength = blended team strength before lineup adjustment (used for floor)

  const starterSum = side.starters.reduce((s, p) => s + Number(p.importance ?? 0), 0);
  const benchSum = side.bench.reduce((s, p) => s + Number(p.importance ?? 0), 0);
  

  const presentAvg = side.starters.length > 0 ? starterSum / side.starters.length : 0;
  const expectedTotal = starterSum + missingImpact;
  const missingRatio = expectedTotal > 0 ? clamp01(missingImpact / expectedTotal) : 0;
  const avgStarterImp = clamp01((presentAvg / 100) * (1 - missingRatio));

  const histStrength = Number.isFinite(sideStrength) ? sideStrength : 0.5;
  const lineupGap = Math.max(0, histStrength - avgStarterImp);
  const lineupWeight = clamp01((isYouthMatch ? 0.2 : 0.4) + lineupGap * (isYouthMatch ? 0.3 : 0.6));
  const histWeight = 1 - lineupWeight;
  const historyCap = clamp01(1 - missingRatio * 0.8);
  const cappedHistStrength = histStrength * historyCap;
  const rawEffective = clamp01(cappedHistStrength * histWeight + avgStarterImp * lineupWeight);
  const tierFloor = histStrength * 0.4 * Math.min(1, avgStarterImp / Math.max(histStrength, 0.01));
  const rawEffectiveWithFloor = Math.max(rawEffective, tierFloor);

  const avgCeiling = side.starters.length > 0 
    ? side.starters.reduce((s, p) => s + (p.importanceCeiling ?? 100), 0) / side.starters.length 
    : 100;
  const avgImpRatio = side.starters.length > 0 ? (starterSum / side.starters.length) / avgCeiling : 0;

  const untrackedPenalty = clamp01(1 - avgImpRatio * 8);
  const effectiveStrength = rawEffectiveWithFloor * (1 - untrackedPenalty * (isYouthMatch ? 0.3 : 0.7));

  const raw = starterSum + benchSum * 0.35;
  const scaled = raw * (0.85 + 0.3 * effectiveStrength);
  const startersKnown = side.starters.filter((p) => p.season != null).length;
  const coverage = side.starters.length ? startersKnown / side.starters.length : 0;
  // Never let effective strength drop below a meaningful floor tied to historical strength.
  // Without this, a strong team with many missing players collapses to ~0 effective strength,
  // causing it to look weaker than a low-tier team with a full squad.
  const historicalFloor = sideStrength * 0.55;
  const effectiveStrengthFloored = Math.max(effectiveStrength, historicalFloor);
  return {
    starters: Math.round(starterSum),
    bench: Math.round(benchSum),
    raw: Math.round(raw),
    total: Math.round(scaled),
    coverage,
    effectiveStrength: effectiveStrengthFloored,
    // debug
    debug: {
      avgImpRatio,
      untrackedPenalty,
      rawEffective,
      rawEffectiveWithFloor,
      effectiveStrength,
      historicalFloor,
      missingRatio,
      avgStarterImp,
    }
  };
}

function sigmoid(x: number) {
  return 1 / (1 + Math.exp(-x));
}

function computeOverall(params: {
  teamStrength: number;
  tier: number | null;
  total: number;
  coverage: number;
  missingImpact: number;
  women?: boolean;
}) {
  const strengthN = clamp01(params.teamStrength);
  const tierN = clamp01(tierQualityN(params.tier, params.women));
  const lineupN = clamp01(params.total / 800);
  const coverageN = clamp01(params.coverage);

  function tierCeilingForMissing(tier: number | null, women: boolean): number {
    const t = Number.isFinite(Number(tier)) ? Number(tier) : 3;
    if (t <= 1) return 92;
    if (women) return t <= 2 ? 78 : 25;
    if (t === 2) return 78;
    if (t === 3) return 64;
    if (t === 4) return 50;
    if (t === 5) return 36;
    return 25;
  }

  const tierCeiling = tierCeilingForMissing(params.tier, params.women ?? false);
  const missingN = clamp01(params.missingImpact / (tierCeiling * 4));

  const overallN =
    0.18 * tierN +
    0.3 * strengthN +
    0.42 * lineupN +
    0.1 * coverageN -
    0.12 * missingN;

  return Math.round(clamp01(overallN) * 100);
}

function computeOdds(params: {
  homeTier: number | null;
  awayTier: number | null;
  homeRawStrength: number;
  awayRawStrength: number;
  homeMissingImpact: number;
  awayMissingImpact: number;
  homePosition: number | null;
  awayPosition: number | null;
  homePlayed: number;
  homeLineupTotal: number;  // ADD
  awayLineupTotal: number;  // ADD
}) {

  const homeTier = Number.isFinite(Number(params.homeTier)) ? Number(params.homeTier) : 6;
  const awayTier = Number.isFinite(Number(params.awayTier)) ? Number(params.awayTier) : 6;

  const rawStrengthDiff = clamp(params.homeRawStrength - params.awayRawStrength, -1, 1);
  const tierGapForStrength = Math.abs(homeTier - awayTier);
  const strengthMultiplier =
    tierGapForStrength === 0 ? 3.5 :
    tierGapForStrength === 1 ? 4.0 :
    6.5;

  function lineupBaseline(tier: number): number {
    if (tier <= 1) return 500;
    if (tier === 2) return 380;
    if (tier === 3) return 300;
    if (tier === 4) return 220;
    return 160;
  }

  const homeLineupRatio = clamp(params.homeLineupTotal / lineupBaseline(homeTier), 0, 1.5);
  const awayLineupRatio = clamp(params.awayLineupTotal / lineupBaseline(awayTier), 0, 1.5);

  const awayDepleted = awayTier < homeTier && awayLineupRatio < 0.75;
  const homeDepleted = homeTier < awayTier && homeLineupRatio < 0.75;
  const depletionFactor = (awayDepleted || homeDepleted) ? 0.5 : 1.0;

  const strengthZ = rawStrengthDiff * strengthMultiplier * depletionFactor;

  const lineupMultiplier = tierGapForStrength === 0 ? 2.5 : tierGapForStrength === 1 ? 1.8 : 1.2;
  const lineupZ = (homeLineupRatio - awayLineupRatio) * lineupMultiplier;

  const MISSING_CEILINGS: Record<number, number> = { 1: 92, 2: 78, 3: 64, 4: 50, 5: 36 };
  const homeMissingNorm = clamp(
    params.homeMissingImpact / ((MISSING_CEILINGS[homeTier] ?? 64) * 4),
    0,
    1,
  );
  const awayMissingNorm = clamp(
    params.awayMissingImpact / ((MISSING_CEILINGS[awayTier] ?? 64) * 4),
    0,
    1,
  );

  const missingCap = clamp(1.0 - tierGapForStrength * 0.25, 0.1, 1.0);
  const missingAdj = (awayMissingNorm - homeMissingNorm) * 0.9 * missingCap;

  const tierAdvRaw = clamp(
    (awayTier - homeTier) * 1.0 +
      Math.sign(awayTier - homeTier) * Math.max(0, Math.abs(awayTier - homeTier) - 1) * 0.5,
    -4.0,
    4.0,
  );

  const effectiveStrengthRatio = clamp(
    params.awayRawStrength / Math.max(params.homeRawStrength, 0.01),
    0, 3.0
  );
  const tierAdvScale = effectiveStrengthRatio < 1.0
    ? clamp(effectiveStrengthRatio, 0.1, 1.0)
    : 1.0;
  const tierAdv = tierAdvRaw * depletionFactor * tierAdvScale;

  const avgTier = (homeTier + awayTier) / 2;
  // Reduce home advantage when there's a large tier gap.
  // A Tier 1 away side should not be overridden by a flat home boost.
  const tierGapAbs = Math.abs(homeTier - awayTier);
  const homeAdvBase = clamp(0.4 - (avgTier - 1) * 0.1, 0.05, 0.4);
  const homeAdv = homeAdvBase * clamp(1 - tierGapAbs * 0.25, 0.2, 1.0);

    // Position term — only meaningful after enough games played
  const posWeight = clamp01(params.homePlayed / 6);
  const posGap = (params.awayPosition ?? 6) - (params.homePosition ?? 6);
  const tierPosWeight = clamp(1 - (Math.min(homeTier, awayTier) - 1) * 0.2, 0.2, 1.0);
  const posZ = clamp(posGap * 0.3, -2.0, 2.0) * posWeight * tierPosWeight;

  const z = strengthZ + lineupZ + missingAdj + tierAdv + homeAdv + posZ;

  const pHomeRaw = sigmoid(z);
  const pAwayRaw = 1 - pHomeRaw;

  const gap = Math.abs(z);
  const pDraw = clamp(0.22 - 0.07 * gap, 0.07, 0.24);

  const pHome = (1 - pDraw) * pHomeRaw;
  const pAway = (1 - pDraw) * pAwayRaw;


  return {
    probabilities: { home: pHome, draw: pDraw, away: pAway },
    odds: {
      home: pHome > 0 ? 1 / pHome : null,
      draw: pDraw > 0 ? 1 / pDraw : null,
      away: pAway > 0 ? 1 / pAway : null,
    },
  };
}

const TIER_GOAL_BASELINES: Record<number, [number, number]> = {
  1: [1.72, 1.38],
  2: [1.85, 1.52],
  3: [2.1, 1.72],
  4: [2.25, 1.85],
  5: [2.5, 2.1],
  6: [2.7, 2.25],
};

function poissonPmf(lambda: number, k: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = -lambda + k * Math.log(lambda);
  for (let i = 1; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

function computeGoals(params: {
  homeTier: number | null;
  awayTier: number | null;
  homeStrength: number;
  awayStrength: number;
  homeMissingGoals: number;
  awayMissingGoals: number;
}) {
  const homeTier = Number.isFinite(Number(params.homeTier)) ? Number(params.homeTier) : 3;
  const awayTier = Number.isFinite(Number(params.awayTier)) ? Number(params.awayTier) : 3;

  const homeBaseline = TIER_GOAL_BASELINES[homeTier] ?? TIER_GOAL_BASELINES[3];
  const awayBaseline = TIER_GOAL_BASELINES[awayTier] ?? TIER_GOAL_BASELINES[3];
  let baseHome = homeBaseline[0];
  let baseAway = awayBaseline[1];

  const awayTierAdv = Math.max(0, homeTier - awayTier);
  const homeTierAdv = Math.max(0, awayTier - homeTier);

  const awayBaselineHome = (TIER_GOAL_BASELINES[awayTier] ?? TIER_GOAL_BASELINES[3])[0];
  baseAway = baseAway + (awayBaselineHome - baseAway) * clamp(awayTierAdv * 0.25, 0, 0.75);

  const homeBaselineAway = (TIER_GOAL_BASELINES[homeTier] ?? TIER_GOAL_BASELINES[3])[1];
  baseHome = baseHome + (homeBaselineAway - baseHome) * clamp(homeTierAdv * 0.25, 0, 0.75);

  const TIER_AVG: Record<number, number> = { 1: 0.42, 2: 0.28, 3: 0.18, 4: 0.12, 5: 0.07, 6: 0.04 };
  const homeAvgStrength = TIER_AVG[homeTier] ?? 0.18;
  const awayAvgStrength = TIER_AVG[awayTier] ?? 0.18;

  const homeAttackMod = clamp(1 + (params.homeStrength - homeAvgStrength) * 2.0, 0.6, 1.6);
  const awayAttackMod = clamp(1 + (params.awayStrength - awayAvgStrength) * 2.0, 0.6, 1.6);

  let homeXG = baseHome * homeAttackMod;
  let awayXG = baseAway * awayAttackMod;

  homeXG = homeXG * clamp(1 - Math.max(0, homeTier - awayTier) * 0.2, 0.3, 1.0);
  awayXG = awayXG * clamp(1 - Math.max(0, awayTier - homeTier) * 0.2, 0.3, 1.0);

  const homeMissingCap = clamp(0.2 - homeTierAdv * 0.04, 0.05, 0.2);
  const awayMissingCap = clamp(0.2 - awayTierAdv * 0.04, 0.05, 0.2);

  homeXG = homeXG * (1 - clamp(params.homeMissingGoals / Math.max(0.01, baseHome * 2), 0, homeMissingCap));
  awayXG = awayXG * (1 - clamp(params.awayMissingGoals / Math.max(0.01, baseAway * 2), 0, awayMissingCap));

  const MAX_GOALS = 6;
  let p_over15 = 0;
  let p_over25 = 0;
  let p_over35 = 0;
  let p_btts = 0;
  let p_under15 = 0;
  let p_under25 = 0;

  for (let h = 0; h <= MAX_GOALS; h++) {
    for (let a = 0; a <= MAX_GOALS; a++) {
      const p = poissonPmf(homeXG, h) * poissonPmf(awayXG, a);
      const total = h + a;
      if (total > 1.5) p_over15 += p;
      if (total > 2.5) p_over25 += p;
      if (total > 3.5) p_over35 += p;
      if (h > 0 && a > 0) p_btts += p;
      if (total < 1.5) p_under15 += p;
      if (total < 2.5) p_under25 += p;
    }
  }

  return {
    xG: { home: Math.round(homeXG * 100) / 100, away: Math.round(awayXG * 100) / 100 },
    expectedTotal: Math.round((homeXG + awayXG) * 10) / 10,
    markets: {
      over15: { prob: p_over15, odds: p_over15 > 0 ? 1 / p_over15 : null },
      under15: { prob: p_under15, odds: p_under15 > 0 ? 1 / p_under15 : null },
      over25: { prob: p_over25, odds: p_over25 > 0 ? 1 / p_over25 : null },
      under25: { prob: p_under25, odds: p_under25 > 0 ? 1 / p_under25 : null },
      over35: { prob: p_over35, odds: p_over35 > 0 ? 1 / p_over35 : null },
      btts_yes: { prob: p_btts, odds: p_btts > 0 ? 1 / p_btts : null },
      btts_no: { prob: 1 - p_btts, odds: 1 - p_btts > 0 ? 1 / (1 - p_btts) : null },
    },
  };
}

function maxGamesForTier(tier: number, isYouthComp: boolean, women: boolean): number {
  if (isYouthComp) return 27;
  if (women) {
    if (tier <= 2) return 18;
    if (tier === 3) return 11;
    return 10;
  }
  if (tier <= 3) return 22;
  if (tier === 4) return 18;
  if (tier === 5) return 14;
  return 22;
}

function tierBaseCeiling(tier: number, isYouth: boolean, women: boolean): number {
  if (isYouth) {
    // Youth ceiling is half the senior ceiling at that tier
    if (tier <= 2) return 50;
    if (tier === 3) return 36;
    if (tier === 4) return 28;
    return 22;
  }
  if (women && tier >= 3) return 22;
  if (tier <= 1) return 92;
  if (tier === 2) return 78;
  if (tier === 3) return 64;
  if (tier === 4) return 50;
  if (tier === 5) return 36;
  if (tier === 6) return 28;
  return 22;
}

function fallbackTierFromCategory(category: string | null | undefined): number | null {
  if (!category) return null;
  const c = category.toLowerCase();
  if (c.includes("p20 sm") || c.includes("p21 sm")) return 3;
  if (c.includes("p20 sm-karsinta") || c.includes("p21 sm-karsinta")) return 4;
  if (c.includes("p20 ykkönen") || c.includes("p21 ykkönen") || c.includes("p20 1") || c.includes("p21 1")) return 3;
  if (c.includes("p20 kakkonen") || c.includes("p21 kakkonen") || c.includes("p20 2") || c.includes("p21 2")) return 4;
  if (c.includes("p20 kolmonen") || c.includes("p21 kolmonen") || c.includes("p20 3") || c.includes("p21 3")) return 5;
  if (c.includes("p19") || c.includes("u19")) return 4;
  if (c.includes("p18") || c.includes("u18")) return 5;
  if (c.includes("p17") || c.includes("u17")) return 6;
  return null;
}

function calcWeightedImportance(playerRows: NormalizedSeasonRow[], seasonYearCtx: number) {
  let totalMins = 0;
  let totalStarts = 0;
  let totalGoals = 0;
  let totalYellows = 0;
  let totalReds = 0;

  let primaryTier = 99;
  let primaryCategory: string | null = null;
  let women = false;

  let bestOverallTier = 99;
  let bestOverallWMins = 0;
  let bestSeniorTierByMins = 99;
  let bestSeniorWMins = 0;
  let seniorMinsTotal = 0;

  for (const row of playerRows) {
    const fallbackTier = fallbackTierFromCategory(row.competition_category);
    const t =
      Number.isFinite(Number(row.competition_tier)) && Number(row.competition_tier) < 90
        ? Number(row.competition_tier)
        : (fallbackTier ?? 99);

    const isYouth = isYouthCategory(row.competition_category);
    const youthDiscount = isYouth 
      ? (row.competition_category?.toLowerCase().includes("p20") || row.competition_category?.toLowerCase().includes("p21") ? 0.6 : 0.35)
      : 1.0;
    const wmins = Number(row.minutes ?? 0) * youthDiscount;

    totalMins += Number(row.minutes ?? 0) * youthDiscount;
    totalStarts += Number(row.starts ?? 0) * youthDiscount;
    if (!isYouth) totalGoals += Number(row.goals ?? 0);
    totalYellows += Number(row.yellows ?? 0) * youthDiscount;
    totalReds += Number(row.reds ?? 0) * youthDiscount;

    if (wmins > bestOverallWMins) {
      bestOverallWMins = wmins;
      bestOverallTier = t;
      primaryCategory = row.competition_category ?? null;
      women = isWomenRow(row);
    }

    if (!isYouth) {
      seniorMinsTotal += Number(row.minutes ?? 0);
      if (wmins > bestSeniorWMins) {
        bestSeniorWMins = wmins;
        bestSeniorTierByMins = t;
      }
    }
  }

  if (seniorMinsTotal >= 540 && bestSeniorTierByMins < 99) {
    primaryTier = bestSeniorTierByMins;
  } else if (bestOverallTier < 99) {
    primaryTier = bestOverallTier;
  }

  const isPrimaryYouth = isYouthCategory(primaryCategory);
  const maxGames = primaryTier < 99 ? maxGamesForTier(primaryTier, isPrimaryYouth, women) : women ? 18 : 22;
  const importanceCeiling = primaryTier < 99 ? tierBaseCeiling(primaryTier, isPrimaryYouth, women) : women ? 22 : 64;

  const rawImportance = calcImportance({
    minutes: totalMins,
    starts: totalStarts,
    goals: totalGoals,
    yellows: totalYellows,
    reds: totalReds,
    maxGames,
    importanceCeiling,
  });

  return {
    importance: Math.min(rawImportance, importanceCeiling),
    ceiling: importanceCeiling,
    tier: primaryTier < 99 ? primaryTier : null,
    competition_category: primaryCategory,
    women,
    season_year: seasonYearCtx,
  };
}

async function getLikelyXI(teamId: string, seasonYear: number, matchGender: string | null) {
  const { data, error } = await supabaseAdmin
    .from("player_season_stats")
    .select(`
      season_year,
      spl_team_id,
      spl_player_id,
      player_name,
      team_name,
      club_name,
      category_name,
      gender,
      tier,
      appearances,
      starts,
      total_minutes,
      goals,
      yellow_cards,
      red_cards
    `)
    .eq("season_year", seasonYear)
    .eq("spl_team_id", teamId);

  if (error) throw new Error(error.message);

  const rows = normalizeSeasonRows(data ?? []);
  const filteredRows = matchGender ? rows.filter((r) => genderMatches(r.gender, matchGender)) : rows;
  const source = filteredRows.length > 0 ? filteredRows : rows;

  const ranked = [...source].sort((a, b) => {
    const aScore = Number(a.starts ?? 0) * 1000 + Number(a.minutes ?? 0);
    const bScore = Number(b.starts ?? 0) * 1000 + Number(b.minutes ?? 0);
    return bScore - aScore;
  });

  const seen = new Set<string>();
  const out: Array<{ spl_player_id: string }> = [];

  for (const r of ranked) {
    const id = r.spl_player_id ? String(r.spl_player_id) : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ spl_player_id: id });
    if (out.length >= 11) break;
  }

  return out;
}

function dominantPlayerTier(starters: any[]): number | null {
  const tierCounts = new Map<number, number>();
  for (const p of starters) {
    const tier = p.season?.club_ctx?.competition_tier;
    if (tier && tier < 90) {
      tierCounts.set(tier, (tierCounts.get(tier) ?? 0) + (p.importance ?? 0));
    }
  }
  let bestTier: number | null = null;
  let bestScore = -1;
  for (const [tier, score] of tierCounts.entries()) {
    if (score > bestScore) { bestScore = score; bestTier = tier; }
  }
  return bestTier;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const inputUrl = searchParams.get("url");
    if (!inputUrl) {
      return NextResponse.json({ error: "Missing params", expected: "url" }, { status: 400 });
    }

    const seasonYear = parseSeasonYear(searchParams.get("season")) ?? new Date().getUTCFullYear();
    const prevSeasonYear = seasonYear - 1;

    const origin = new URL(req.url).origin;
    const lineupRes = await fetch(
      `${origin}/api/lineups-from-report?` + new URLSearchParams({ url: inputUrl }).toString(),
      { cache: "no-store" },
    );

    const lineupText = await lineupRes.text();

    let lineupJson: LineupsFromReportResponse | null = null;
    try {
      lineupJson = lineupText ? JSON.parse(lineupText) : null;
    } catch {
      return NextResponse.json(
        {
          error: `lineups-from-report returned non-JSON (${lineupRes.status})`,
          body: lineupText.slice(0, 500),
        },
        { status: 500 },
      );
    }

    if (!lineupRes.ok || !lineupJson) {
      return NextResponse.json(
        {
          error:
            (lineupJson as any)?.error ??
            `Failed to parse lineups (${lineupRes.status})`,
        },
        { status: 400 },
      );
    }

    const teams: TeamsBlock = lineupJson.teams ?? {
      home: { spl_team_id: null, team_name: null },
      away: { spl_team_id: null, team_name: null },
    };

    const matchGender = lineupJson.match?.competition?.gender ?? null;
    const matchCategoryName = lineupJson.match?.competition?.category_name ?? null;
    const matchCategoryKey = normalizeCategoryKey(matchCategoryName);

    const homePlayers = uniqById([...lineupJson.home.starters, ...lineupJson.home.bench]);
    const awayPlayers = uniqById([...lineupJson.away.starters, ...lineupJson.away.bench]);
    const allIds = uniqById([...homePlayers, ...awayPlayers]).map((p) => p.spl_player_id);
    const allIdsNum = allIds.map((id) => Number(id)).filter((id) => Number.isFinite(id));

    if (allIds.length === 0) {
      return NextResponse.json({ error: "No players parsed from lineups" }, { status: 200 });
    }

    const [
      { data: playerBirthRows, error: birthErr },
      { data: seasonRawRows, error: seasonErr },
      { data: prevSeasonRawRows, error: prevSeasonErr },
    ] = await Promise.all([
      supabaseAdmin.from("players").select("spl_player_id, birth_year").in("spl_player_id", allIdsNum),
      supabaseAdmin
        .from("player_season_stats")
        .select(`
          season_year,
          spl_team_id,
          spl_player_id,
          player_name,
          team_name,
          club_name,
          category_name,
          gender,
          tier,
          appearances,
          starts,
          total_minutes,
          goals,
          yellow_cards,
          red_cards
        `)
        .eq("season_year", seasonYear)
        .in("spl_player_id", allIdsNum),
      supabaseAdmin
        .from("player_season_stats")
        .select(`
          season_year,
          spl_team_id,
          spl_player_id,
          player_name,
          team_name,
          club_name,
          category_name,
          gender,
          tier,
          appearances,
          starts,
          total_minutes,
          goals,
          yellow_cards,
          red_cards
        `)
        .eq("season_year", prevSeasonYear)
        .in("spl_player_id", allIdsNum),
    ]);

    if (birthErr) return NextResponse.json({ error: birthErr.message }, { status: 500 });
    if (seasonErr) return NextResponse.json({ error: seasonErr.message }, { status: 500 });
    if (prevSeasonErr) return NextResponse.json({ error: prevSeasonErr.message }, { status: 500 });

    const seasonRows = normalizeSeasonRows(seasonRawRows ?? []);
    const prevSeasonRows = normalizeSeasonRows(prevSeasonRawRows ?? []);

    const birthYearById = new Map<string, number | null>();
    for (const r of playerBirthRows ?? []) {
      birthYearById.set(String((r as any).spl_player_id), (r as any).birth_year ?? null);
    }

    const allRowsByPlayer = new Map<string, NormalizedSeasonRow[]>();
    for (const r of seasonRows) {
      const id = String(r.spl_player_id);
      const arr = allRowsByPlayer.get(id) ?? [];
      arr.push(r);
      allRowsByPlayer.set(id, arr);
    }

    const allPrevRowsByPlayer = new Map<string, NormalizedSeasonRow[]>();
    for (const r of prevSeasonRows) {
      const id = String(r.spl_player_id);
      const arr = allPrevRowsByPlayer.get(id) ?? [];
      arr.push(r);
      allPrevRowsByPlayer.set(id, arr);
    }

    const homeTeamId = teams.home.spl_team_id;
    const awayTeamId = teams.away.spl_team_id;

    const teamNameById = new Map<string, string>();
    const teamIdsToLoad = Array.from(new Set([homeTeamId, awayTeamId].filter(Boolean))) as string[];

    if (teamIdsToLoad.length) {
      const { data: teamRows, error: teamErr } = await supabaseAdmin
        .from("teams")
        .select("spl_team_id, team_name, club_name")
        .in("spl_team_id", teamIdsToLoad);

      if (teamErr) return NextResponse.json({ error: teamErr.message }, { status: 500 });

      for (const t of teamRows ?? []) {
        const teamId = (t as any).spl_team_id != null ? String((t as any).spl_team_id) : null;
        const nm = (t as any).team_name ?? (t as any).club_name ?? null;
        if (!nm) continue;
        if (teamId) teamNameById.set(teamId, String(nm));
      }
    }

    const homeTeamSeasonRows = seasonRows.filter((r) => String(r.spl_team_id ?? "") === String(homeTeamId ?? ""));
    const awayTeamSeasonRows = seasonRows.filter((r) => String(r.spl_team_id ?? "") === String(awayTeamId ?? ""));

    const homeCategoryKey = matchCategoryKey || chooseDominantCategory(homeTeamSeasonRows);
    const awayCategoryKey = matchCategoryKey || chooseDominantCategory(awayTeamSeasonRows);

    const resolvedTeams = {
      home: {
        spl_team_id: homeTeamId,
        team_name: teams.home?.team_name ?? bestSideTeamName(homeTeamSeasonRows, homeCategoryKey) ?? null,
      },
      away: {
        spl_team_id: awayTeamId,
        team_name: teams.away?.team_name ?? bestSideTeamName(awayTeamSeasonRows, awayCategoryKey) ?? null,
      },
    };

    const [{ data: curTeamRows, error: curTeamErr }, { data: prevTeamRows, error: prevTeamErr }] =
      await Promise.all([
        teamIdsToLoad.length
          ? supabaseAdmin
              .from("computed_league_table")
              .select(`
                season_year,
                spl_competition_id,
                group_id,
                group_name,
                competition_name,
                competition_category,
                competition_tier,
                team_spl_id,
                played,
                points,
                position,
                wins,
                draws,
                losses,
                goals_for,
                goals_against,
                goal_diff,
                team_name,
                club_name
              `)
              .eq("season_year", seasonYear)
              .in("team_spl_id", teamIdsToLoad)
          : Promise.resolve({ data: [], error: null }),
        teamIdsToLoad.length
          ? supabaseAdmin
              .from("computed_league_table")
              .select(`
                season_year,
                spl_competition_id,
                group_id,
                group_name,
                competition_name,
                competition_category,
                competition_tier,
                team_spl_id,
                played,
                points,
                position,
                wins,
                draws,
                losses,
                goals_for,
                goals_against,
                goal_diff,
                team_name,
                club_name
              `)
              .eq("season_year", prevSeasonYear)
              .in("team_spl_id", teamIdsToLoad)
          : Promise.resolve({ data: [], error: null }),
      ]);

    if (curTeamErr) return NextResponse.json({ error: curTeamErr.message }, { status: 500 });
    if (prevTeamErr) return NextResponse.json({ error: prevTeamErr.message }, { status: 500 });

    const currentTableRows = (curTeamRows ?? []) as unknown as TeamTableRow[];
    const previousTableRows = (prevTeamRows ?? []) as unknown as TeamTableRow[];

    const currentByTeam = new Map<string, TeamTableRow[]>();
    for (const r of currentTableRows) {
      const id = String((r as any).team_spl_id ?? "");
      if (!id) continue;
      const arr = currentByTeam.get(id) ?? [];
      arr.push(r);
      currentByTeam.set(id, arr);
    }

    const previousByTeam = new Map<string, TeamTableRow[]>();
    for (const r of previousTableRows) {
      const id = String((r as any).team_spl_id ?? "");
      if (!id) continue;
      const arr = previousByTeam.get(id) ?? [];
      arr.push(r);
      previousByTeam.set(id, arr);
    }

    const homeCurrentTable = chooseBestTeamTableRow(
      currentByTeam.get(String(homeTeamId ?? "")) ?? [],
      homeCategoryKey,
      teams.home?.team_name ?? null,
    );

    const awayCurrentTable = chooseBestTeamTableRow(
      currentByTeam.get(String(awayTeamId ?? "")) ?? [],
      awayCategoryKey,
      teams.away?.team_name ?? null,
    );

    const homePrevTable = chooseBestTeamTableRow(
      previousByTeam.get(String(homeTeamId ?? "")) ?? [],
      homeCategoryKey,
      teams.home?.team_name ?? null,
    );

    const awayPrevTable = chooseBestTeamTableRow(
      previousByTeam.get(String(awayTeamId ?? "")) ?? [],
      awayCategoryKey,
      teams.away?.team_name ?? null,
    );

    const homeCompName = homeCurrentTable?.competition_name ?? homePrevTable?.competition_name ?? null;
    const awayCompName = awayCurrentTable?.competition_name ?? awayPrevTable?.competition_name ?? null;

    const homeCurrentStrengthBits = strengthFromTableRow(homeCurrentTable);
    const awayCurrentStrengthBits = strengthFromTableRow(awayCurrentTable);
    const homePrevStrengthBits = strengthFromTableRow(homePrevTable);
    const awayPrevStrengthBits = strengthFromTableRow(awayPrevTable);

    const homeTier = homeCurrentStrengthBits.tier ?? homePrevStrengthBits.tier ?? null;
    const awayTier = awayCurrentStrengthBits.tier ?? awayPrevStrengthBits.tier ?? null;

    const isWomen =
      String(matchGender ?? "").toLowerCase() === "female" ||
      isWomenName(homeCompName) ||
      isWomenName(awayCompName);

    const homeStrength = blendStrength(
      homeCurrentStrengthBits.strength,
      homePrevStrengthBits.strength,
      homeCurrentStrengthBits.played,
      homeTier,
    );

    const awayStrength = blendStrength(
      awayCurrentStrengthBits.strength,
      awayPrevStrengthBits.strength,
      awayCurrentStrengthBits.played,
      awayTier,
    );

    const teamStrengthDebug = {
      home: homeTeamId
        ? {
            team_spl_id: String(homeTeamId),
            competition_tier: homeTier,
            competition_name: homeCompName,
            position: homeCurrentStrengthBits.position,
            played: homeCurrentStrengthBits.played,
            points: homeCurrentStrengthBits.points,
            ppm: homeCurrentStrengthBits.ppm,
            base: homeCurrentStrengthBits.base,
            scale: homeCurrentStrengthBits.scale,
            strength: homeStrength,
            prev: homePrevTable
              ? {
                  season_year: prevSeasonYear,
                  competition_tier: homePrevStrengthBits.tier,
                  competition_name: homePrevTable.competition_category ?? homePrevTable.competition_name,
                  position: homePrevStrengthBits.position,
                  played: homePrevStrengthBits.played,
                  points: homePrevStrengthBits.points,
                }
              : null,
          }
        : null,
      away: awayTeamId
        ? {
            team_spl_id: String(awayTeamId),
            competition_tier: awayTier,
            competition_name: awayCompName,
            position: awayCurrentStrengthBits.position,
            played: awayCurrentStrengthBits.played,
            points: awayCurrentStrengthBits.points,
            ppm: awayCurrentStrengthBits.ppm,
            base: awayCurrentStrengthBits.base,
            scale: awayCurrentStrengthBits.scale,
            strength: awayStrength,
            prev: awayPrevTable
              ? {
                  season_year: prevSeasonYear,
                  competition_tier: awayPrevStrengthBits.tier,
                  competition_name: awayPrevTable.competition_category ?? awayPrevTable.competition_name,
                  position: awayPrevStrengthBits.position,
                  played: awayPrevStrengthBits.played,
                  points: awayPrevStrengthBits.points,
                }
              : null,
          }
        : null,
    };

    const { data: lineupRows, error: lineupErr } = await supabaseAdmin
      .from("match_lineups")
      .select("spl_player_id, spl_match_id, minute_in, minute_out, spl_team_id")
      .in("spl_player_id", allIdsNum);

    if (lineupErr) return NextResponse.json({ error: lineupErr.message }, { status: 500 });

    const matchIds = Array.from(new Set((lineupRows ?? []).map((r: any) => String(r.spl_match_id)).filter(Boolean)));
    const kickoffMap = new Map<string, number>();

    if (matchIds.length) {
      const { data: matchRows, error: matchErr } = await supabaseAdmin
        .from("matches")
        .select("spl_match_id, kickoff_at")
        .in("spl_match_id", matchIds);

      if (matchErr) return NextResponse.json({ error: matchErr.message }, { status: 500 });

      for (const m of matchRows ?? []) {
        const k = String((m as any).spl_match_id);
        const t = (m as any).kickoff_at ? Date.parse((m as any).kickoff_at) : 0;
        kickoffMap.set(k, Number.isFinite(t) ? t : 0);
      }
    }

    const byPlayer = new Map<string, Array<any>>();
    for (const r of lineupRows ?? []) {
      const pid = String((r as any).spl_player_id);
      const mid = String((r as any).spl_match_id);
      const kickoff = kickoffMap.get(mid) ?? 0;
      const started = (r as any).minute_in === null || (r as any).minute_in === 0;
      const mins = minutesFromLineupRow({
        minute_in: (r as any).minute_in,
        minute_out: (r as any).minute_out,
      });

      const arr = byPlayer.get(pid) ?? [];
      arr.push({ spl_match_id: mid, kickoff, started, minutes: mins });
      byPlayer.set(pid, arr);
    }

    function lastN(pid: string, n: number) {
      const arr = (byPlayer.get(pid) ?? []).slice().sort((a, b) => (b.kickoff ?? 0) - (a.kickoff ?? 0));
      const take = arr.slice(0, n);
      return {
        lastNApps: take.length,
        lastNMinutes: take.reduce((s, x) => s + (x.minutes ?? 0), 0),
        lastNStarts: take.reduce((s, x) => s + (x.started ? 1 : 0), 0),
      };
    }

    function enrich(p: LineupPlayer, side: "home" | "away") {
      const sideTeamId = side === "home" ? homeTeamId : awayTeamId;
      const sideCategoryKey = side === "home" ? homeCategoryKey : awayCategoryKey;

      const playerRows = allRowsByPlayer.get(String(p.spl_player_id)) ?? [];
      const prevPlayerRows = allPrevRowsByPlayer.get(String(p.spl_player_id)) ?? [];

      const chosenRows = pickPreferredRows(playerRows, null, null, matchGender);
      const prevChosenRows = pickPreferredRows(prevPlayerRows, null, null, matchGender);

      const currResult = chosenRows.length > 0 ? calcWeightedImportance(chosenRows, seasonYear) : null;
      const prevResult = prevChosenRows.length > 0 ? calcWeightedImportance(prevChosenRows, prevSeasonYear) : null;

      let importance = 0;
      let importanceCeiling = currResult?.ceiling ?? prevResult?.ceiling ?? 100;

      if (currResult !== null && prevResult !== null) {
        const currMins = chosenRows.reduce((sum, r) => sum + Number(r.minutes ?? 0), 0);
        const prevWeight = Math.max(0, 1 - currMins / 500) * 0.3;
        importance = Math.round(currResult.importance * (1 - prevWeight) + prevResult.importance * prevWeight);
      } else if (currResult !== null) {
        importance = currResult.importance;
      } else if (prevResult !== null) {
        importance = prevResult.importance;
        importanceCeiling = prevResult.ceiling;
      }

      const sideTierRaw = side === "home" ? homeTier : awayTier;
      const sideTier = Number.isFinite(Number(sideTierRaw)) ? Number(sideTierRaw) : 99;

      if (sideTier < 99) {
        const sideCeiling = isWomen
          ? sideTier <= 1
            ? 92
            : sideTier <= 2
              ? 78
              : 22
          : sideTier <= 1
            ? 92
            : sideTier === 2
              ? 78
              : sideTier === 3
                ? 64
                : sideTier === 4
                  ? 50
                  : sideTier === 5
                    ? 36
                    : 28;

        const playerHighestTier = [...chosenRows].reduce((best: number, r) => {
          const fallbackTier = fallbackTierFromCategory(r.competition_category);
          const t =
            Number.isFinite(Number(r.competition_tier)) && Number(r.competition_tier) < 90
              ? Number(r.competition_tier)
              : (fallbackTier ?? 99);
          return Number(r.minutes ?? 0) >= 180 && t < best ? t : best;
        }, 99);

        const effectiveCeiling = playerHighestTier < sideTier ? importanceCeiling : sideCeiling;
        if (effectiveCeiling < importanceCeiling) {
          importanceCeiling = effectiveCeiling;
          const hasTeamStats =
            sideTeamId != null
              ? chosenRows.some((r) => String(r.spl_team_id ?? "") === String(sideTeamId) && Number(r.minutes ?? 0) > 0)
              : false;

          importance = !hasTeamStats && importance < Math.round(effectiveCeiling * 0.35)
            ? Math.round(effectiveCeiling * 0.35)
            : Math.min(importance, effectiveCeiling);
        }
      }

      const seasons = playerRows
        .filter((r) => Number(r.competition_tier ?? 99) < 99)
        .sort((a, b) => Number(b.minutes ?? 0) - Number(a.minutes ?? 0))
        .slice(0, 5)
        .map((sr) => {
          const sTeamId = sr.spl_team_id ? String(sr.spl_team_id) : null;
          return {
            season_year: seasonYear,
            spl_team_id: sTeamId,
            team_name: sr.team_name ?? (sTeamId ? teamNameById.get(sTeamId) ?? null : null),
            player_name: sr.player_name ?? p.name,
            matches_played: Number(sr.matches_played ?? 0),
            starts: Number(sr.starts ?? 0),
            minutes: Number(sr.minutes ?? 0),
            goals: Number(sr.goals ?? 0),
            yellows: Number(sr.yellows ?? 0),
            reds: Number(sr.reds ?? 0),
            club_ctx: {
              competition_tier: sr.competition_tier,
              competition_category: sr.competition_category,
              competition_name: sr.competition_category,
            },
          };
        });

      const prevSeasons = prevPlayerRows
        .filter((r) => Number(r.competition_tier ?? 99) < 99)
        .sort((a, b) => Number(b.minutes ?? 0) - Number(a.minutes ?? 0))
        .slice(0, 5)
        .map((pr) => {
          const prevTeamId = pr.spl_team_id ? String(pr.spl_team_id) : null;
          return {
            season_year: prevSeasonYear,
            spl_team_id: prevTeamId,
            team_name: pr.team_name ?? (prevTeamId ? teamNameById.get(prevTeamId) ?? null : null),
            player_name: pr.player_name ?? p.name,
            matches_played: Number(pr.matches_played ?? 0),
            starts: Number(pr.starts ?? 0),
            minutes: Number(pr.minutes ?? 0),
            goals: Number(pr.goals ?? 0),
            yellows: Number(pr.yellows ?? 0),
            reds: Number(pr.reds ?? 0),
            club_ctx: {
              competition_tier: pr.competition_tier,
              competition_category: pr.competition_category,
              competition_name: pr.competition_category,
            },
          };
        });

      return {
        ...p,
        birth_year: birthYearById.get(String(p.spl_player_id)) ?? null,
        season: seasons[0] ?? null,
        seasons,
        prevSeasons,
        recent5: lastN(String(p.spl_player_id), 5),
        importance,
        importanceCeiling,
      };
    }

    const home = {
      starters: lineupJson.home.starters.map((p) => enrich(p, "home")),
      bench: lineupJson.home.bench.map((p) => enrich(p, "home")),
    };

    const away = {
      starters: lineupJson.away.starters.map((p) => enrich(p, "away")),
      bench: lineupJson.away.bench.map((p) => enrich(p, "away")),
    };

    async function buildMissingLikelyXI(side: "home" | "away") {
      const teamId = side === "home" ? homeTeamId : awayTeamId;
      if (!teamId) return { missing: [], missingImpact: 0 };

      const likely = await getLikelyXI(teamId, seasonYear, matchGender);
      const starterIds = new Set((side === "home" ? home.starters : away.starters).map((p) => String(p.spl_player_id)));
      const benchIds = new Set((side === "home" ? home.bench : away.bench).map((p) => String(p.spl_player_id)));
      const presentIds = new Set([...starterIds, ...benchIds]);

      const missingIds = likely.map((p) => String(p.spl_player_id)).filter((id) => !presentIds.has(id));
      const missingIdsNum = missingIds.map((id) => Number(id)).filter((id) => Number.isFinite(id));
      if (missingIds.length === 0) return { missing: [], missingImpact: 0 };

      const [{ data: missRawRows, error: missErr }, { data: missPrevRawRows, error: missPrevErr }] =
        await Promise.all([
          supabaseAdmin
            .from("player_season_stats")
            .select(`
              season_year,
              spl_team_id,
              spl_player_id,
              player_name,
              team_name,
              club_name,
              category_name,
              gender,
              tier,
              appearances,
              starts,
              total_minutes,
              goals,
              yellow_cards,
              red_cards
            `)
            .eq("season_year", seasonYear)
            .in("spl_player_id", missingIdsNum),
          supabaseAdmin
            .from("player_season_stats")
            .select(`
              season_year,
              spl_team_id,
              spl_player_id,
              player_name,
              team_name,
              club_name,
              category_name,
              gender,
              tier,
              appearances,
              starts,
              total_minutes,
              goals,
              yellow_cards,
              red_cards
            `)
            .eq("season_year", prevSeasonYear)
            .eq("spl_team_id", teamId)
            .in("spl_player_id", missingIdsNum),
        ]);

      if (missErr) throw new Error(missErr.message);
      if (missPrevErr) throw new Error(missPrevErr.message);

      const missRows = normalizeSeasonRows(missRawRows ?? []);
      const missPrevRows = normalizeSeasonRows(missPrevRawRows ?? []);

      const missingRowsByPlayer = new Map<string, { rows: NormalizedSeasonRow[]; seasonCtx: number }>();
      for (const r of missRows) {
        const pid = String(r.spl_player_id);
        const entry = missingRowsByPlayer.get(pid) ?? { rows: [], seasonCtx: seasonYear };
        entry.rows.push(r);
        missingRowsByPlayer.set(pid, entry);
      }
      for (const r of missPrevRows) {
        const pid = String(r.spl_player_id);
        if (!missingRowsByPlayer.has(pid)) {
          missingRowsByPlayer.set(pid, { rows: [r], seasonCtx: prevSeasonYear });
        }
      }

      const sideTierRaw = side === "home" ? homeTier : awayTier;
      const sideTier = Number.isFinite(Number(sideTierRaw)) ? Number(sideTierRaw) : 99;
      const sideCeiling =
        sideTier < 99
          ? isWomen
            ? sideTier <= 1
              ? 92
              : sideTier <= 2
                ? 78
                : 22
            : sideTier <= 1
              ? 92
              : sideTier === 2
                ? 78
                : sideTier === 3
                  ? 64
                  : sideTier === 4
                    ? 50
                    : sideTier === 5
                      ? 36
                      : 28
          : 100;

      const missing = Array.from(missingRowsByPlayer.entries()).map(([pid, { rows, seasonCtx }]) => {
        const sideCategoryKey = side === "home" ? homeCategoryKey : awayCategoryKey;
        const preferredRows = pickPreferredRows(rows, teamId, sideCategoryKey, matchGender);
        const best = preferredRows.reduce((a, b) =>
          Number(a.minutes ?? 0) >= Number(b.minutes ?? 0) ? a : b,
        );
        const { importance: rawImp, ceiling: rawCeiling } = calcWeightedImportance(preferredRows, seasonCtx);

        return {
          spl_player_id: pid,
          player_name: best.player_name ?? null,
          birth_year: birthYearById.get(pid) ?? null,
          starts: preferredRows.reduce((s, r) => s + Number(r.starts ?? 0), 0),
          minutes: preferredRows.reduce((s, r) => s + Number(r.minutes ?? 0), 0),
          goals: preferredRows.reduce((s, r) => s + Number(r.goals ?? 0), 0),
          importance: Math.min(rawImp, sideCeiling),
          importanceCeiling: Math.min(rawCeiling, sideCeiling),
          fromPrevSeason: seasonCtx === prevSeasonYear,
        };
      });

      const missingImpact = missing.reduce((s, p) => s + Number(p.importance ?? 0), 0);
      missing.sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0));

      return { missing, missingImpact };
    }

    const [homeMissing, awayMissing] = await Promise.all([
      buildMissingLikelyXI("home"),
      buildMissingLikelyXI("away"),
    ]);

    const isYouthMatch = matchCategoryKey?.startsWith("u") || matchCategoryKey?.includes("p20") || matchCategoryKey?.includes("p21") || false;
    const homeRating = sideRating(home, homeStrength, homeMissing.missingImpact, isYouthMatch, homeStrength);
    const awayRating = sideRating(away, awayStrength, awayMissing.missingImpact, isYouthMatch, awayStrength);
    const homeEffectiveTier = dominantPlayerTier(home.starters) ?? homeTier;
    const awayEffectiveTier = dominantPlayerTier(away.starters) ?? awayTier;


    const homeOverall = computeOverall({
      teamStrength: homeRating.effectiveStrength,
      tier: homeTier,
      total: homeRating.total,
      coverage: homeRating.coverage,
      missingImpact: homeMissing.missingImpact,
      women: isWomen,
    });

    const awayOverall = computeOverall({
      teamStrength: awayRating.effectiveStrength,
      tier: awayTier,
      total: awayRating.total,
      coverage: awayRating.coverage,
      missingImpact: awayMissing.missingImpact,
      women: isWomen,
    });

    const homeMissingImpactForOdds = isYouthMatch ? 0 : homeMissing.missingImpact;
    const awayMissingImpactForOdds = isYouthMatch ? 0 : awayMissing.missingImpact;

    const homeRawStrength = isYouthMatch ? homeStrength : homeRating.effectiveStrength;
    const awayRawStrength = isYouthMatch ? awayStrength : awayRating.effectiveStrength;

    const pricing = computeOdds({
      homeTier: homeEffectiveTier,  // was homeTier
      awayTier: awayEffectiveTier,  // was awayTier
      homeRawStrength: homeRawStrength,
      awayRawStrength: awayRawStrength,
      homeMissingImpact: homeMissingImpactForOdds,
      awayMissingImpact: awayMissingImpactForOdds,
      homePosition: homeCurrentStrengthBits.position,
      awayPosition: awayCurrentStrengthBits.position,
      homePlayed: homeCurrentStrengthBits.played,
      homeLineupTotal: homeRating.total,
      awayLineupTotal: awayRating.total,
    });
      
    function missingGoalsPerGame(missing: any[], tier: number | null): number {
      const t = Number.isFinite(Number(tier)) ? Number(tier) : 3;
      const maxG = t <= 3 ? 22 : t === 4 ? 18 : 14;
      return missing.reduce((s, p) => s + Number(p.goals ?? 0) / maxG, 0);
    }

    const goalsModel = computeGoals({
      homeTier,
      awayTier,
      homeStrength,
      awayStrength,
      homeMissingGoals: missingGoalsPerGame(homeMissing.missing, homeTier),
      awayMissingGoals: missingGoalsPerGame(awayMissing.missing, awayTier),
    });

    return NextResponse.json({
      inputUrl,
      season_year: seasonYear,
      teams: resolvedTeams,
      teamStrength: { home: homeRating.effectiveStrength, away: awayRating.effectiveStrength },
      teamStrengthDebug,
      overall: { home: homeOverall, away: awayOverall },
      ...pricing,
      goals: goalsModel,
      home: {
        ...home,
        rating: homeRating,
        ratingDebug: homeRating.debug,
        missingLikelyXI: homeMissing.missing,
        missingImpact: homeMissing.missingImpact,
      },
      away: {
        ...away,
          rating: awayRating,
          ratingDebug: awayRating.debug,
          missingLikelyXI: awayMissing.missing,
          missingImpact: awayMissing.missingImpact,
      },
      model_version: "v3_finland_computed_table",

        debug: {
          oddsInputs: {
            homeTier,
            awayTier,
            homeStrengthRaw: homeStrength,
            awayStrengthRaw: awayStrength,
            homeEffectiveStrength: homeRating.effectiveStrength,
            awayEffectiveStrength: awayRating.effectiveStrength,
            homeLineupTotal: homeRating.total,
            awayLineupTotal: awayRating.total,
            homeCoverage: homeRating.coverage,
            awayCoverage: awayRating.coverage,
            homeMissingImpact: homeMissing.missingImpact,
            awayMissingImpact: awayMissing.missingImpact,
            homeOverall,
            awayOverall,
            awayLawayLineupRatio: awayRating.total / (awayTier === 3 ? 300 : awayTier === 4 ? 220 : 160),
            depletionTriggered: (awayRating.total / (awayTier === 3 ? 300 : awayTier === 4 ? 220 : 160)) < 0.6,
          },
        }
    });
  } catch (e: any) {
    console.error("lineup-stats error:", e);
    return NextResponse.json(
      { error: e?.message ?? "Unknown server error" },
      { status: 500 },
    );
  }
}