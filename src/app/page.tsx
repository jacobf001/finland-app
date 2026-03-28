"use client";

import React, { useState } from "react";

const SEASONS = [2021, 2022, 2023, 2024, 2025, 2026];

function clsx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function formatLeagueLine(row: any) {
  if (!row) return "—";
  const name = row.competition_name ?? "—";
  const tier = row.competition_tier ?? "—";
  const group = row.group_name && row.group_name !== "Runkosarja" ? ` · ${row.group_name}` : "";
  const pos = row.position != null ? ` (Pos ${row.position})` : "";
  return `${name}${group}${pos} · Tier ${tier}`;
}

function SideHeaderCard({
  side,
  team,
  ctx,
}: {
  side: "Home" | "Away";
  team?: { spl_team_id?: string | null; team_name?: string | null };
  ctx?: {
    competition_name?: string | null;
    competition_tier?: number | null;
    strength?: number | null;
    position?: number | null;
    group_name?: string | null;
  } | null;
}) {
  const isHome = side === "Home";

  return (
    <div
      className={clsx(
        "rounded-xl border p-5 relative overflow-hidden",
        isHome ? "border-blue-500/20 bg-blue-950/20" : "border-orange-500/20 bg-orange-950/20",
      )}
    >
      <div
        className={clsx(
          "absolute top-0 left-0 w-1 h-full",
          isHome ? "bg-blue-500" : "bg-orange-500",
        )}
      />
      <div className="pl-3">
        <div
          className={clsx(
            "text-xs font-mono uppercase tracking-widest",
            isHome ? "text-blue-400" : "text-orange-400",
          )}
        >
          {side}
        </div>
        <div className="mt-1 flex items-baseline justify-between gap-3">
          <div className="text-2xl font-bold">{team?.team_name ?? side}</div>
          <div className="text-sm text-white/40 font-mono">#{team?.spl_team_id ?? "—"}</div>
        </div>
        <div className="mt-3 space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-white/40 w-12">League</span>
            <span className="text-sm text-white/80">{formatLeagueLine(ctx)}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-white/40 w-12">Strength</span>
            <span className="text-sm text-white/80">
              {ctx?.strength != null ? `${Math.round(ctx.strength * 100)}/100` : "—"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function HomePage() {
  const [seasonYear, setSeasonYear] = useState<number>(2025);
  const [matchUrl, setMatchUrl] = useState<string>("");
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<any | null>(null);

  const canRunLineup = Boolean(matchUrl.trim().length > 0);

  async function runLineupAnalysis() {
    setAnalysisLoading(true);
    setAnalysisError(null);
    setAnalysis(null);

    try {
      const qs = new URLSearchParams({
        url: matchUrl.trim(),
        season: String(seasonYear),
      });

      const res = await fetch(`/api/lineup-stats?${qs.toString()}`);
      const text = await res.text();

      let data: any;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        console.error("Non-JSON response:", text);
        throw new Error("API did not return valid JSON");
      }

      if (!res.ok) {
        throw new Error(data?.error || `Request failed (${res.status})`);
      }

      setAnalysis(data);
    } catch (e: any) {
      setAnalysisError(e?.message ?? "Failed to analyze lineup");
    } finally {
      setAnalysisLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#0a0a0c] text-white">
      <div className="border-b border-white/5 bg-black/40">
        <div className="mx-auto max-w-6xl px-6 py-5 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">FinlandDB</h1>
            <p className="text-xs text-white/40 mt-0.5 font-mono">
              Palloliitto lineup analysis
            </p>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-6 py-8 space-y-8">
        <section className="rounded-2xl border border-white/8 bg-white/3 p-6">
          <h2 className="text-base font-semibold text-white/90">Match Analysis</h2>
          <p className="mt-1 text-sm text-white/40">
            Paste a Palloliitto match URL to analyse lineups and generate a match prediction.
          </p>

          <div className="mt-5 flex flex-col gap-3 md:flex-row md:items-end">
            <div className="w-full md:w-32">
              <label className="mb-1.5 block text-xs text-white/50 font-mono uppercase tracking-wider">
                Season
              </label>
              <select
                className="w-full rounded-lg border border-white/10 bg-black/60 px-3 py-2.5 text-sm focus:border-white/30 focus:outline-none"
                value={seasonYear}
                onChange={(e) => setSeasonYear(Number(e.target.value))}
              >
                {SEASONS.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex-1">
              <label className="mb-1.5 block text-xs text-white/50 font-mono uppercase tracking-wider">
                Match URL
              </label>
              <input
                className="w-full rounded-lg border border-white/10 bg-black/60 px-3 py-2.5 text-sm focus:border-white/30 focus:outline-none"
                value={matchUrl}
                onChange={(e) => setMatchUrl(e.target.value)}
                placeholder="https://tulospalvelu.palloliitto.fi/match/3237368/lineups"
              />
            </div>

            <button
              type="button"
              onClick={runLineupAnalysis}
              disabled={analysisLoading || !canRunLineup}
              className={clsx(
                "rounded-lg px-6 py-2.5 text-sm font-semibold transition-all",
                analysisLoading || !canRunLineup
                  ? "bg-white/8 text-white/30 cursor-not-allowed"
                  : "bg-white text-black hover:bg-white/90 active:scale-95",
              )}
            >
              {analysisLoading ? "Analysing…" : "Analyse"}
            </button>
          </div>

          {analysisError && (
            <div className="mt-3 rounded-lg bg-red-950/40 border border-red-500/20 px-4 py-3 text-sm text-red-400">
              {analysisError}
            </div>
          )}
        </section>

        {analysis && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <SideHeaderCard
                side="Home"
                team={analysis.teams?.home}
                ctx={analysis.teamStrengthDebug?.home}
              />
              <SideHeaderCard
                side="Away"
                team={analysis.teams?.away}
                ctx={analysis.teamStrengthDebug?.away}
              />
            </div>

            <ModelCard analysis={analysis} />

            {((analysis.home?.missingLikelyXI?.length ?? 0) > 0 ||
              (analysis.away?.missingLikelyXI?.length ?? 0) > 0) && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <MissingLikelyXI
                  title={`${analysis.teams?.home?.team_name ?? "Home"} missing likely XI`}
                  items={analysis.home?.missingLikelyXI ?? []}
                  accent="blue"
                />
                <MissingLikelyXI
                  title={`${analysis.teams?.away?.team_name ?? "Away"} missing likely XI`}
                  items={analysis.away?.missingLikelyXI ?? []}
                  accent="orange"
                />
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <PlayerAnalysisTable
                title={`${analysis.teams?.home?.team_name ?? "Home"} starters`}
                rows={analysis.home?.starters ?? []}
                accent="blue"
              />
              <PlayerAnalysisTable
                title={`${analysis.teams?.away?.team_name ?? "Away"} starters`}
                rows={analysis.away?.starters ?? []}
                accent="orange"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <PlayerAnalysisTable
                title={`${analysis.teams?.home?.team_name ?? "Home"} bench`}
                rows={analysis.home?.bench ?? []}
                accent="blue"
              />
              <PlayerAnalysisTable
                title={`${analysis.teams?.away?.team_name ?? "Away"} bench`}
                rows={analysis.away?.bench ?? []}
                accent="orange"
              />
            </div>
          </div>
        )}

        <section className="rounded-2xl border border-white/8 bg-white/3 p-6">
          <h2 className="text-base font-semibold text-white/90">Next steps</h2>
          <p className="mt-1 text-sm text-white/40">
            This Finland version is currently wired for lineup analysis only. Season preview,
            team search, and richer dashboards can be added after the Finland APIs are in place.
          </p>
        </section>
      </div>
    </main>
  );
}

function ModelCard({ analysis }: { analysis: any }) {
  const p = analysis.probabilities;
  const odds = analysis.odds;
  const goals = analysis.goals;

  const homeStrength = analysis.teamStrengthDebug?.home?.strength ?? analysis.teamStrength?.home ?? 0;
  const awayStrength = analysis.teamStrengthDebug?.away?.strength ?? analysis.teamStrength?.away ?? 0;
  const homeName = analysis.teams?.home?.team_name ?? "Home";
  const awayName = analysis.teams?.away?.team_name ?? "Away";

  return (
    <div className="rounded-2xl border border-white/8 bg-white/3 p-6">
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-base font-semibold">Prediction</h3>
        <div className="text-xs font-mono text-white/30 uppercase tracking-wider">
          Finland model
        </div>
      </div>

      {p && (
        <div className="mb-6">
          <div className="flex justify-between text-sm mb-2">
            <span className="font-medium text-blue-300">
              {homeName} <span className="font-mono text-blue-400">{Math.round(p.home * 100)}%</span>
            </span>
            <span className="font-mono text-white/30 text-xs">Draw {Math.round(p.draw * 100)}%</span>
            <span className="font-medium text-orange-300">
              <span className="font-mono text-orange-400">{Math.round(p.away * 100)}%</span> {awayName}
            </span>
          </div>
          <div className="h-3 rounded-full bg-white/5 overflow-hidden flex">
            <div className="h-full bg-blue-500" style={{ width: `${Math.round(p.home * 100)}%` }} />
            <div className="h-full bg-white/15" style={{ width: `${Math.round(p.draw * 100)}%` }} />
            <div className="h-full bg-orange-500" style={{ width: `${Math.round(p.away * 100)}%` }} />
          </div>
        </div>
      )}

      {odds && (
        <div className="flex items-center gap-4 pb-4 border-b border-white/5">
          <span className="text-xs text-white/30 font-mono uppercase tracking-wider">Match odds</span>
          <div className="flex gap-4 text-sm font-mono">
            <span>
              <span className="text-white/40">H</span>{" "}
              <span className="text-blue-300">{odds.home?.toFixed(2)}</span>
            </span>
            <span>
              <span className="text-white/40">D</span>{" "}
              <span className="text-white/60">{odds.draw?.toFixed(2)}</span>
            </span>
            <span>
              <span className="text-white/40">A</span>{" "}
              <span className="text-orange-300">{odds.away?.toFixed(2)}</span>
            </span>
          </div>
        </div>
      )}

      {goals && (
        <div className="mt-4 pb-4 border-b border-white/5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-white/30 font-mono uppercase tracking-wider">
              Expected goals
            </span>
            <div className="flex items-center gap-3 text-sm font-mono">
              <span className="text-blue-300">{goals.xG.home.toFixed(2)}</span>
              <span className="text-white/20">—</span>
              <span className="text-orange-300">{goals.xG.away.toFixed(2)}</span>
              <span className="text-white/30 text-xs">({goals.expectedTotal} total)</span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "Over 1.5", prob: goals.markets.over15.prob, odds: goals.markets.over15.odds },
              { label: "Over 2.5", prob: goals.markets.over25.prob, odds: goals.markets.over25.odds },
              { label: "Over 3.5", prob: goals.markets.over35.prob, odds: goals.markets.over35.odds },
              { label: "Under 2.5", prob: goals.markets.under25.prob, odds: goals.markets.under25.odds },
              { label: "BTTS Yes", prob: goals.markets.btts_yes.prob, odds: goals.markets.btts_yes.odds },
              { label: "BTTS No", prob: goals.markets.btts_no.prob, odds: goals.markets.btts_no.odds },
            ].map(({ label, prob, odds: mOdds }) => {
              const pctNum = Math.round(prob * 100);
              const isFav = prob >= 0.55;
              const isLong = prob < 0.30;
              const textColor = isFav ? "text-emerald-400" : isLong ? "text-white/40" : "text-white/70";
              const bgColor = isFav ? "bg-emerald-950/30 border-emerald-500/15" : "bg-white/3 border-white/6";

              return (
                <div key={label} className={`rounded-lg border px-3 py-2 ${bgColor}`}>
                  <div className="text-xs text-white/35 font-mono mb-1">{label}</div>
                  <div className="flex items-baseline justify-between gap-1">
                    <span className={`text-sm font-bold font-mono ${textColor}`}>{pctNum}%</span>
                    <span className="text-xs font-mono text-white/30">{mOdds?.toFixed(2)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-3">
        {[
          { name: homeName, strength: homeStrength, tier: analysis.teamStrengthDebug?.home?.competition_tier, color: "blue" as const },
          { name: awayName, strength: awayStrength, tier: analysis.teamStrengthDebug?.away?.competition_tier, color: "orange" as const },
        ].map(({ name, strength, tier, color }) => {
          const str = Math.round(strength * 100);
          const isBlue = color === "blue";
          const tierLabel =
            tier != null && Number.isFinite(Number(tier)) && Number(tier) < 90
              ? `T${tier}`
              : "—";
          const tierColor =
            tier == null
              ? "text-white/20 bg-white/5 border-white/5"
              : tier <= 1
                ? "text-emerald-300 bg-emerald-950/60 border-emerald-500/20"
                : tier === 2
                  ? "text-green-300 bg-green-950/60 border-green-500/20"
                  : tier === 3
                    ? "text-yellow-300 bg-yellow-950/60 border-yellow-500/20"
                    : tier === 4
                      ? "text-orange-300 bg-orange-950/60 border-orange-500/20"
                      : "text-red-300 bg-red-950/60 border-red-500/20";

          const barColor = isBlue ? "bg-blue-500" : "bg-orange-500";

          return (
            <div key={name} className="rounded-lg bg-white/3 border border-white/5 px-3 py-2.5">
              <div className="flex items-center justify-between mb-2">
                <span className={`text-xs font-mono font-semibold px-1.5 py-0.5 rounded border ${tierColor}`}>
                  {tierLabel}
                </span>
                <span className="text-xs font-mono text-white/50">
                  {str}
                  <span className="text-white/20">/100</span>
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-white/8 overflow-hidden mb-2">
                <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.max(2, str)}%` }} />
              </div>
              <div className={`text-xs font-medium truncate ${isBlue ? "text-blue-300/80" : "text-orange-300/80"}`}>
                {name}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MissingLikelyXI({
  title,
  items,
  accent,
}: {
  title: string;
  items: Array<{
    spl_player_id: string;
    player_name: string | null;
    importance: number;
    importanceCeiling?: number;
    birth_year?: number | null;
    goals?: number;
  }>;
  accent: "blue" | "orange";
}) {
  if (!items || items.length === 0) return null;

  function impactColor(imp: number, ceiling: number): string {
    const ratio = ceiling > 0 ? imp / ceiling : 0;
    if (ratio >= 0.8) return "text-emerald-400";
    if (ratio >= 0.6) return "text-green-400";
    if (ratio >= 0.4) return "text-yellow-400";
    return "text-white/35";
  }

  function impactLabel(imp: number, ceiling: number): string {
    const ratio = ceiling > 0 ? imp / ceiling : 0;
    if (ratio >= 0.8) return "Key";
    if (ratio >= 0.6) return "Regular";
    if (ratio >= 0.4) return "Squad";
    return "";
  }

  const accentBorder = accent === "blue" ? "border-blue-500/30" : "border-orange-500/30";
  const accentHeader = accent === "blue" ? "text-blue-400" : "text-orange-400";

  return (
    <div className={clsx("rounded-2xl border bg-white/3 p-5", accentBorder)}>
      <h3 className={clsx("text-sm font-semibold", accentHeader)}>{title}</h3>
      <p className="mt-1 text-xs text-white/40">Expected starters not in today's lineup.</p>

      <div className="mt-3 space-y-1">
        {items.slice(0, 8).map((p, i) => {
          const ceiling = p.importanceCeiling ?? 100;
          const color = impactColor(p.importance, ceiling);
          const label = impactLabel(p.importance, ceiling);

          return (
            <div
              key={`${p.spl_player_id ?? "missing"}-${p.player_name ?? "unknown"}-${i}`}
              className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-white/3 transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm text-white/85 truncate">
                  {p.player_name ?? `Player ${p.spl_player_id}`}
                </span>
                {p.birth_year && (
                  <span className="text-xs text-white/30 font-mono shrink-0">{p.birth_year}</span>
                )}
                {p.goals != null && p.goals > 0 && (
                  <span className="text-xs font-mono text-emerald-400/80 shrink-0">⚽ {p.goals}</span>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-3">
                {label && (
                  <span className={`text-xs font-mono opacity-60 ${color}`}>
                    {label}
                  </span>
                )}
                <span className={`text-sm font-bold font-mono text-right ${color}`}>
                  {p.importance}
                  <span className="text-white/25 font-normal">/{ceiling}</span>
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function avgAge(rows: any[]): string {
  const currentYear = new Date().getFullYear();
  const years = rows
    .filter((p) => p.birth_year && p.birth_year > 1940)
    .map((p) => currentYear - p.birth_year);

  if (years.length === 0) return "—";
  return (years.reduce((a, b) => a + b, 0) / years.length).toFixed(1);
}

function PlayerAnalysisTable({
  title,
  rows,
  accent,
}: {
  title: string;
  rows: any[];
  accent: "blue" | "orange";
}) {
  const [expanded, setExpanded] = useState<string[]>([]);

  function toggle(id: string) {
    setExpanded((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  const starters = rows.filter((p) => !p.squad || p.squad === "xi");
  const age = avgAge(starters.length > 0 ? starters : rows);

  return (
    <div className="rounded-2xl border border-white/8 bg-white/3 p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        {age !== "—" && (
          <div className="text-xs font-mono text-white/40">
            Avg age <span className="text-white/70 font-semibold">{age}</span>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-white/8">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-white/3 border-b border-white/8">
              <th className="px-3 py-2.5 text-left w-8 text-xs text-white/30 font-mono">#</th>
              <th className="px-3 py-2.5 text-left text-xs text-white/30 font-mono uppercase tracking-wider">
                Player
              </th>
              <th className="px-3 py-2.5 text-right text-xs text-white/30 font-mono hidden sm:table-cell">
                Min
              </th>
              <th className="px-3 py-2.5 text-right text-xs text-white/30 font-mono hidden sm:table-cell">
                GS
              </th>
              <th className="px-3 py-2.5 text-right text-xs text-white/30 font-mono hidden sm:table-cell">
                G
              </th>
              <th className="px-3 py-2.5 text-right text-xs text-white/30 font-mono hidden sm:table-cell">
                L5
              </th>
              <th className="px-3 py-2.5 text-right text-xs text-white/30 font-mono">Imp</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-4 text-white/30 text-xs text-center">
                  No data
                </td>
              </tr>
            ) : (
              rows.map((p) => {
                const isOpen = expanded.includes(p.spl_player_id);
                const imp = p.importance ?? 0;
                const ceiling = p.importanceCeiling ?? 100;
                const impRatio = ceiling > 0 ? imp / ceiling : 0;
                const impColor =
                  imp < 30
                    ? "text-white/30"
                    : impRatio >= 0.8
                      ? "text-emerald-400"
                      : impRatio >= 0.6
                        ? "text-green-400"
                        : impRatio >= 0.4
                          ? "text-yellow-400"
                          : "text-white/70";

                const rowHighlight =
                  imp < 30
                    ? ""
                    : impRatio >= 0.8
                      ? "border-l-2 border-l-emerald-500 bg-emerald-950/20"
                      : impRatio >= 0.6
                        ? "border-l-2 border-l-green-500/40 bg-green-950/10"
                        : impRatio >= 0.4
                          ? "border-l-2 border-l-yellow-500/50 bg-yellow-950/10"
                          : "";

                return (
                  <React.Fragment key={p.spl_player_id}>
                    <tr
                      className={clsx(
                        "border-t border-white/5 cursor-pointer hover:bg-white/3 transition-colors",
                        rowHighlight,
                      )}
                      onClick={() => toggle(p.spl_player_id)}
                    >
                      <td className="px-3 py-2.5 text-white/25 text-xs font-mono">{p.shirt_no ?? "—"}</td>
                      <td className="px-3 py-2.5">
                        <div className="font-medium text-white/90 text-sm leading-snug">
                          {p.season?.player_name ?? p.name ?? `Player ${p.spl_player_id}`}
                        </div>
                        {p.birth_year && (
                          <div className="text-xs text-white/30 font-mono">{p.birth_year}</div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right text-white/50 text-xs font-mono hidden sm:table-cell">
                        {p.season?.minutes ?? "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right text-white/50 text-xs font-mono hidden sm:table-cell">
                        {p.season?.starts ?? "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right text-white/50 text-xs font-mono hidden sm:table-cell">
                        {p.season?.goals ?? "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right hidden sm:table-cell">
                        <FormDots recent5={p.recent5} />
                      </td>
                      <td className={clsx("px-3 py-2.5 text-right font-mono", impColor)}>
                        {imp > 0 ? (
                          <div className="flex flex-col items-end leading-none">
                            <span className="font-bold text-sm">{imp}</span>
                            <span className="text-xs opacity-40 mt-0.5">/{ceiling}</span>
                          </div>
                        ) : (
                          <span className="text-white/20">—</span>
                        )}
                      </td>
                    </tr>

                    {isOpen && (
                      <tr className="border-t border-white/5 bg-black/20">
                        <td />
                        <td colSpan={6} className="px-3 py-3 text-xs text-white/50 space-y-1">
                          <div className="flex gap-4 sm:hidden mb-2 text-white/60">
                            <span>Min: {p.season?.minutes ?? "—"}</span>
                            <span>GS: {p.season?.starts ?? "—"}</span>
                            <span>G: {p.season?.goals ?? "—"}</span>
                          </div>

                          {p.recent5 && (
                            <div className="mb-1 flex items-center gap-2">
                              <span className="text-white/30">Last 5:</span>
                              <span>
                                {p.recent5.lastNMinutes}m in {p.recent5.lastNApps} apps ({p.recent5.lastNStarts} starts)
                              </span>
                            </div>
                          )}

                          {p.seasons?.filter((s: any) => s.club_ctx?.competition_tier !== 99).length > 0 ? (
                            p.seasons
                              .filter((s: any) => s.club_ctx?.competition_tier !== 99)
                              .map((s: any, i: number) => (
                                <div key={i} className="flex gap-1">
                                  <span className="text-white/30 w-12 shrink-0">{s.season_year ?? "—"}</span>
                                  <span>
                                    {s.team_name ?? "—"}
                                    {s.club_ctx?.competition_tier ? ` · ${s.club_ctx.competition_name ?? `Tier ${s.club_ctx.competition_tier}`}` : ""}
                                    {s.club_ctx?.position ? ` · Pos ${s.club_ctx.position}` : ""}
                                    {s.minutes ? ` (${s.minutes}m)` : ""}
                                  </span>
                                </div>
                              ))
                          ) : (
                            <div className="flex gap-1">
                              <span className="text-white/30 w-12">—</span>
                              <span>—</span>
                            </div>
                          )}

                          {p.prevSeasons?.filter((ps: any) => ps.club_ctx?.competition_tier !== 99).length > 0 ? (
                            p.prevSeasons
                              .filter((ps: any) => ps.club_ctx?.competition_tier !== 99)
                              .map((ps: any, i: number) => (
                                <div key={i} className="flex gap-1">
                                  <span className="text-white/30 w-12 shrink-0">{ps.season_year ?? "—"}</span>
                                  <span>
                                    {ps.team_name ?? "—"}
                                    {ps.club_ctx?.competition_tier ? ` · ${ps.club_ctx.competition_name ?? `Tier ${ps.club_ctx.competition_tier}`}` : ""}
                                    {ps.club_ctx?.position ? ` · Pos ${ps.club_ctx.position}` : ""}
                                    {ps.minutes ? ` (${ps.minutes}m)` : ""}
                                  </span>
                                </div>
                              ))
                          ) : (
                            <div className="flex gap-1">
                              <span className="text-white/30 w-12">—</span>
                              <span>—</span>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-xs text-white/20 font-mono">
        Tap row to expand · L5 = minutes in last 5 apps
      </p>
    </div>
  );
}

function FormDots({
  recent5,
}: {
  recent5?: { lastNApps: number; lastNMinutes: number; lastNStarts: number } | null;
}) {
  if (!recent5 || recent5.lastNApps === 0) {
    return <span className="text-white/20 text-xs font-mono">—</span>;
  }

  const mins = recent5.lastNMinutes;
  const percent = Math.min(100, Math.round((mins / 450) * 100));
  const color = percent >= 70 ? "bg-emerald-500" : percent >= 40 ? "bg-yellow-500" : "bg-white/20";

  return (
    <div className="flex items-center gap-1.5 justify-end">
      <div className="w-12 h-1.5 rounded-full bg-white/8 overflow-hidden">
        <div className={clsx("h-full rounded-full", color)} style={{ width: `${percent}%` }} />
      </div>
      <span className="text-xs font-mono text-white/40 w-8 text-right">{mins}</span>
    </div>
  );
}