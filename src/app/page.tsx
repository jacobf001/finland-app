"use client";

import React, { useState } from "react";

const SEASONS = [2024, 2025, 2026];

function clsx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function SideHeaderCard({
  side, team, ctx,
}: {
  side: "Home" | "Away";
  team?: { spl_team_id?: string | null; team_name?: string | null };
  ctx?: { tier?: number | null; competition_tier?: number | null; competition_name?: string | null; strength?: number | null; position?: number | null; played?: number | null; points?: number | null } | null;}) {
  const isHome = side === "Home";
  return (
    <div className={clsx("rounded-xl border p-5 relative overflow-hidden", isHome ? "border-blue-500/20 bg-blue-950/20" : "border-orange-500/20 bg-orange-950/20")}>
      <div className={clsx("absolute top-0 left-0 w-1 h-full", isHome ? "bg-blue-500" : "bg-orange-500")} />
      <div className="pl-3">
        <div className={clsx("text-xs font-mono uppercase tracking-widest", isHome ? "text-blue-400" : "text-orange-400")}>{side}</div>
        <div className="mt-1 flex items-baseline justify-between gap-3">
          <div className="text-2xl font-bold">{team?.team_name ?? side}</div>
          <div className="text-sm text-white/40 font-mono">#{team?.spl_team_id ?? "—"}</div>
        </div>
       <div className="mt-3 space-y-1.5">
          {ctx?.competition_name && (
            <div className="text-sm text-white/70">{ctx.competition_name}</div>
          )}
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-white/40 w-12">Tier</span>
            <span className="text-sm text-white/80">
              {(ctx?.tier ?? ctx?.competition_tier) != null ? `Tier ${ctx?.tier ?? ctx?.competition_tier}` : "—"}{ctx?.position != null ? ` · Pos ${ctx.position}` : ""}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-white/40 w-12">Strength</span>
            <span className="text-sm text-white/80">{ctx?.strength != null ? `${Math.round(ctx.strength * 100)}/100` : "—"}</span>
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

  async function runLineupAnalysis() {
    if (!matchUrl.trim()) return;
    setAnalysisLoading(true); setAnalysisError(null); setAnalysis(null);
    try {
      const qs = new URLSearchParams({ url: matchUrl.trim(), season: String(seasonYear) });
      const res = await fetch(`/api/lineup-stats?${qs.toString()}`);
      const text = await res.text();
      let data: any;
      try { data = text ? JSON.parse(text) : null; } catch { throw new Error("API did not return valid JSON"); }
      if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
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
        <div className="mx-auto max-w-6xl px-6 py-5">
          <h1 className="text-2xl font-bold tracking-tight">FinlandDB</h1>
          <p className="text-xs text-white/40 mt-0.5 font-mono">SPL lineup analysis</p>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-6 py-8 space-y-8">
        <section className="rounded-2xl border border-white/8 bg-white/3 p-6">
          <h2 className="text-base font-semibold text-white/90">Match Analysis</h2>
          <p className="mt-1 text-sm text-white/40">Paste a palloliitto.fi match URL to analyse lineups and generate a match prediction.</p>
          <div className="mt-5 flex flex-col gap-3 md:flex-row md:items-end">
            <div className="w-full md:w-32">
              <label className="mb-1.5 block text-xs text-white/50 font-mono uppercase tracking-wider">Season</label>
              <select className="w-full rounded-lg border border-white/10 bg-black/60 px-3 py-2.5 text-sm focus:border-white/30 focus:outline-none" value={seasonYear} onChange={(e) => setSeasonYear(Number(e.target.value))}>
                {SEASONS.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <div className="flex-1">
              <label className="mb-1.5 block text-xs text-white/50 font-mono uppercase tracking-wider">Match URL</label>
              <input className="w-full rounded-lg border border-white/10 bg-black/60 px-3 py-2.5 text-sm focus:border-white/30 focus:outline-none" value={matchUrl} onChange={(e) => setMatchUrl(e.target.value)} placeholder="https://www.fotball.no/fotballdata/kamp/?fiksId=8443747" onKeyDown={(e) => e.key === "Enter" && runLineupAnalysis()} />
            </div>
            <button type="button" onClick={runLineupAnalysis} disabled={analysisLoading || !matchUrl.trim()} className={clsx("rounded-lg px-6 py-2.5 text-sm font-semibold transition-all", analysisLoading || !matchUrl.trim() ? "bg-white/8 text-white/30 cursor-not-allowed" : "bg-white text-black hover:bg-white/90 active:scale-95")}>
              {analysisLoading ? "Analysing…" : "Analyse"}
            </button>
          </div>
          {analysisError && <div className="mt-3 rounded-lg bg-red-950/40 border border-red-500/20 px-4 py-3 text-sm text-red-400">{analysisError}</div>}
        </section>

        {analysis && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <SideHeaderCard side="Home" team={analysis.teams?.home} ctx={analysis.teamStrengthDebug?.home} />
              <SideHeaderCard side="Away" team={analysis.teams?.away} ctx={analysis.teamStrengthDebug?.away} />
            </div>
            <H2HCard
              h2h={analysis.h2h}
              homeTeamId={analysis.teams?.home?.spl_team_id ?? null}
              awayTeamId={analysis.teams?.away?.spl_team_id ?? null}
              homeName={analysis.teams?.home?.team_name ?? "Home"}
              awayName={analysis.teams?.away?.team_name ?? "Away"}
            />
            <ModelCard analysis={analysis} />
            {((analysis.home?.missingLikelyXI?.length ?? 0) > 0 || (analysis.away?.missingLikelyXI?.length ?? 0) > 0) && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <MissingLikelyXI title={`${analysis.teams?.home?.team_name ?? "Home"} missing likely XI`} items={analysis.home?.missingLikelyXI ?? []} accent="blue" />
                <MissingLikelyXI title={`${analysis.teams?.away?.team_name ?? "Away"} missing likely XI`} items={analysis.away?.missingLikelyXI ?? []} accent="orange" />
              </div>
            )}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <PlayerAnalysisTable title={`${analysis.teams?.home?.team_name ?? "Home"} starters`} rows={analysis.home?.starters ?? []} accent="blue" />
              <PlayerAnalysisTable title={`${analysis.teams?.away?.team_name ?? "Away"} starters`} rows={analysis.away?.starters ?? []} accent="orange" />
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <PlayerAnalysisTable title={`${analysis.teams?.home?.team_name ?? "Home"} bench`} rows={analysis.home?.bench ?? []} accent="blue" />
              <PlayerAnalysisTable title={`${analysis.teams?.away?.team_name ?? "Away"} bench`} rows={analysis.away?.bench ?? []} accent="orange" />
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

// Replace the existing ModelCard function in page.tsx with this

const TIER_RANGES: Record<number, [number, number]> = {
  1: [0.30, 1.0],
  2: [0.20, 0.54],
  3: [0.12, 0.34],
  4: [0.07, 0.22],
  5: [0.03, 0.18],
  6: [0.01, 0.10],
};

function relativeStrength(strength: number, tier: number | null): number {
  if (!tier) return Math.round(strength * 100);
  const [lo, hi] = TIER_RANGES[tier] ?? [0, 1];
  const clamped = Math.max(0, Math.min(1, (strength - lo) / Math.max(0.01, hi - lo)));
  return Math.round(clamped * 100);
}

function ModelCard({ analysis }: { analysis: any }) {
  const p = analysis.probabilities;
  const odds = analysis.odds;
  const goals = analysis.goals;
  const [marketOdds, setMarketOdds] = useState({ home: "", away: "", over15: "", over25: "", over35: "" });
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved" | "error">("idle");
  const homeStrength = analysis.teamStrength?.home ?? analysis.teamStrengthDebug?.home?.strength ?? 0;
  const awayStrength = analysis.teamStrength?.away ?? analysis.teamStrengthDebug?.away?.strength ?? 0;
  const homeName = analysis.teams?.home?.team_name ?? "Home";
  const awayName = analysis.teams?.away?.team_name ?? "Away";

  function calcEdge(marketOdd: string, modelProb: number) {
    const mo = Number(marketOdd);
    if (!mo || mo <= 1 || !modelProb) return null;
    const edge = (mo / (1 / modelProb) - 1) * 100;
    return { edge, value: edge >= 5 };
  }

  async function savePrediction() {
    setSaving(true);
    setSaveStatus("idle");
    try {
      const payload = {
        fiks_id: analysis.match?.spl_match_id ?? null,
        home_team: homeName,
        away_team: awayName,
        home_team_id: analysis.teams?.home?.spl_team_id ?? null,
        away_team_id: analysis.teams?.away?.spl_team_id ?? null,
        kickoff_at: analysis.match?.kickoff_at ?? null,
        model_home_prob: p?.home ?? null,
        model_away_prob: p?.away ?? null,
        model_draw_prob: p?.draw ?? null,
        fair_home_odds: odds?.home ?? null,
        fair_away_odds: odds?.away ?? null,
        fair_draw_odds: odds?.draw ?? null,
        fair_over15_odds: goals?.markets?.over15?.odds ?? null,
        fair_over25_odds: goals?.markets?.over25?.odds ?? null,
        fair_over35_odds: goals?.markets?.over35?.odds ?? null,
        model_over15_prob: goals?.markets?.over15?.prob ?? null,
        model_over25_prob: goals?.markets?.over25?.prob ?? null,
        model_over35_prob: goals?.markets?.over35?.prob ?? null,
        market_home_odds: marketOdds.home ? Number(marketOdds.home) : null,
        market_away_odds: marketOdds.away ? Number(marketOdds.away) : null,
        market_over15_odds: marketOdds.over15 ? Number(marketOdds.over15) : null,
        market_over25_odds: marketOdds.over25 ? Number(marketOdds.over25) : null,
        market_over35_odds: marketOdds.over35 ? Number(marketOdds.over35) : null,
        edge_home: marketOdds.home ? calcEdge(marketOdds.home, p?.home)?.edge ?? null : null,
        edge_away: marketOdds.away ? calcEdge(marketOdds.away, p?.away)?.edge ?? null : null,
        edge_over15: marketOdds.over15 ? calcEdge(marketOdds.over15, goals?.markets?.over15?.prob)?.edge ?? null : null,
        edge_over25: marketOdds.over25 ? calcEdge(marketOdds.over25, goals?.markets?.over25?.prob)?.edge ?? null : null,
        edge_over35: marketOdds.over35 ? calcEdge(marketOdds.over35, goals?.markets?.over35?.prob)?.edge ?? null : null,
        value_home: marketOdds.home ? (calcEdge(marketOdds.home, p?.home)?.value ?? false) : false,
        value_away: marketOdds.away ? (calcEdge(marketOdds.away, p?.away)?.value ?? false) : false,
        value_over15: marketOdds.over15 ? (calcEdge(marketOdds.over15, goals?.markets?.over15?.prob)?.value ?? false) : false,
        value_over25: marketOdds.over25 ? (calcEdge(marketOdds.over25, goals?.markets?.over25?.prob)?.value ?? false) : false,
        value_over35: marketOdds.over35 ? (calcEdge(marketOdds.over35, goals?.markets?.over35?.prob)?.value ?? false) : false,
      };
      const res = await fetch("/api/predictions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Failed to save");
      setSaveStatus("saved");
      setTimeout(() => { window.location.href = "/predictions"; }, 800);
    } catch {
      setSaveStatus("error");
      setTimeout(() => setSaveStatus("idle"), 3000);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl border border-white/8 bg-white/3 p-6">
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-base font-semibold">Prediction</h3>
        <div className="text-xs font-mono text-white/30 uppercase tracking-wider">Finland model</div>
      </div>

      {p && (
        <div className="mb-6">
          <div className="flex justify-between text-sm mb-2">
            <span className="font-medium text-blue-300">{homeName} <span className="font-mono text-blue-400">{Math.round(p.home * 100)}%</span></span>
            <span className="font-mono text-white/30 text-xs">Draw {Math.round(p.draw * 100)}%</span>
            <span className="font-medium text-orange-300"><span className="font-mono text-orange-400">{Math.round(p.away * 100)}%</span> {awayName}</span>
          </div>
          <div className="h-3 rounded-full bg-white/5 overflow-hidden flex">
            <div className="h-full bg-blue-500" style={{ width: `${Math.round(p.home * 100)}%` }} />
            <div className="h-full bg-white/15" style={{ width: `${Math.round(p.draw * 100)}%` }} />
            <div className="h-full bg-orange-500 flex-1" />
          </div>
        </div>
      )}

      {odds && (
        <div className="flex items-center gap-4 pb-4 border-b border-white/5">
          <span className="text-xs text-white/30 font-mono uppercase tracking-wider">Match odds</span>
          <div className="flex gap-4 text-sm font-mono">
            <span><span className="text-white/40">H</span> <span className="text-blue-300">{odds.home?.toFixed(2)}</span></span>
            <span><span className="text-white/40">D</span> <span className="text-white/60">{odds.draw?.toFixed(2)}</span></span>
            <span><span className="text-white/40">A</span> <span className="text-orange-300">{odds.away?.toFixed(2)}</span></span>
          </div>
        </div>
      )}

      {p && (
        <div className="mt-4 pb-4 border-b border-white/5">
          <div className="text-xs text-white/30 font-mono uppercase tracking-wider mb-3">Market odds</div>
          <div className="flex gap-3">
            {([
              { label: "H", key: "home" as const, prob: p.home, nameColor: "text-blue-300" },
              { label: "A", key: "away" as const, prob: p.away, nameColor: "text-orange-300" },
            ]).map(({ label, key, prob, nameColor }) => {
              const edge = calcEdge(marketOdds[key], prob);
              return (
                <div key={key} className="flex-1">
                  <div className={`text-xs font-mono mb-1.5 ${nameColor}`}>{label} <span className="text-white/30">fair {(1 / prob).toFixed(2)}</span></div>
                  <input className="w-full rounded-lg border border-white/10 bg-black/60 px-2 py-1.5 text-sm font-mono focus:border-white/30 focus:outline-none" placeholder="2.10" value={marketOdds[key]} onChange={(e) => setMarketOdds(prev => ({ ...prev, [key]: e.target.value }))} />
                  {edge && <div className={clsx("mt-1.5 text-xs font-mono font-semibold", edge.value ? "text-teal-400" : edge.edge > 0 ? "text-white/40" : "text-red-400/60")}>{edge.edge >= 0 ? "+" : ""}{edge.edge.toFixed(1)}%{edge.value && <span className="ml-1">✓ VALUE</span>}</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {goals && (
        <div className="mt-4 pb-4 border-b border-white/5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-white/30 font-mono uppercase tracking-wider">Expected goals</span>
            <div className="flex items-center gap-3 text-sm font-mono">
              <span className="text-blue-300">{goals.xG.home.toFixed(2)}</span>
              <span className="text-white/20">—</span>
              <span className="text-orange-300">{goals.xG.away.toFixed(2)}</span>
              <span className="text-white/30 text-xs">({goals.expectedTotal} total)</span>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 mb-3">
            {[
              { label: "Over 1.5", prob: goals.markets.over15.prob, odds: goals.markets.over15.odds },
              { label: "Over 2.5", prob: goals.markets.over25.prob, odds: goals.markets.over25.odds },
              { label: "Over 3.5", prob: goals.markets.over35.prob, odds: goals.markets.over35.odds },
              { label: "BTTS Yes", prob: goals.markets.btts_yes.prob, odds: goals.markets.btts_yes.odds },
              { label: "BTTS No",  prob: goals.markets.btts_no.prob,  odds: goals.markets.btts_no.odds },
            ].map(({ label, prob, odds: mOdds }) => {
              const pctNum = Math.round(prob * 100);
              const isFav = prob >= 0.55;
              const isLong = prob < 0.30;
              const textColor = isFav ? "text-teal-400" : isLong ? "text-white/40" : "text-white/70";
              const bgColor = isFav ? "bg-teal-950/30 border-teal-500/15" : "bg-white/3 border-white/6";
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
          <div className="flex gap-3">
            {([
              { label: "O1.5", key: "over15" as const, prob: goals.markets.over15.prob },
              { label: "O2.5", key: "over25" as const, prob: goals.markets.over25.prob },
              { label: "O3.5", key: "over35" as const, prob: goals.markets.over35.prob },
            ]).map(({ label, key, prob }) => {
              const edge = calcEdge(marketOdds[key], prob);
              return (
                <div key={key} className="flex-1">
                  <div className="text-xs font-mono mb-1.5 text-white/40">{label} <span className="text-white/25">fair {(1 / prob).toFixed(2)}</span></div>
                  <input className="w-full rounded-lg border border-white/10 bg-black/60 px-2 py-1.5 text-sm font-mono focus:border-white/30 focus:outline-none" placeholder="1.80" value={marketOdds[key]} onChange={(e) => setMarketOdds(prev => ({ ...prev, [key]: e.target.value }))} />
                  {edge && <div className={clsx("mt-1.5 text-xs font-mono font-semibold", edge.value ? "text-teal-400" : edge.edge > 0 ? "text-white/40" : "text-red-400/60")}>{edge.edge >= 0 ? "+" : ""}{edge.edge.toFixed(1)}%{edge.value && <span className="ml-1">✓</span>}</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Strength bars */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        {([
          { name: homeName, strength: homeStrength, tier: analysis.teamStrengthDebug?.home?.competition_tier ?? analysis.teamStrengthDebug?.home?.tier, color: "blue" as const },
          { name: awayName, strength: awayStrength, tier: analysis.teamStrengthDebug?.away?.competition_tier ?? analysis.teamStrengthDebug?.away?.tier, color: "orange" as const },
        ]).map(({ name, strength, tier, color }) => {
          const str = Math.round(strength * 100);
          const relStr = relativeStrength(strength, tier);
          const isBlue = color === "blue";
          const tierLabel = tier != null && Number(tier) < 90 ? `T${tier}` : "—";
          const tierColor = tier == null ? "text-white/20 bg-white/5 border-white/5" : tier <= 1 ? "text-emerald-300 bg-emerald-950/60 border-emerald-500/20" : tier === 2 ? "text-green-300 bg-green-950/60 border-green-500/20" : tier === 3 ? "text-yellow-300 bg-yellow-950/60 border-yellow-500/20" : tier === 4 ? "text-orange-300 bg-orange-950/60 border-orange-500/20" : "text-red-300 bg-red-950/60 border-red-500/20";
          return (
            <div key={name} className="rounded-lg bg-white/3 border border-white/5 px-3 py-2.5">
              <div className="flex items-center justify-between mb-2">
                <span className={`text-xs font-mono font-semibold px-1.5 py-0.5 rounded border ${tierColor}`}>{tierLabel}</span>
                <div className="text-right">
                  <span className="text-xs font-mono text-white/50">{relStr}<span className="text-white/20">/100</span></span>
                  <span className="text-xs font-mono text-white/25 ml-1.5">({str} abs)</span>
                </div>
              </div>
              <div className="h-1.5 rounded-full bg-white/8 overflow-hidden mb-2">
                <div className={`h-full rounded-full ${isBlue ? "bg-blue-500" : "bg-orange-500"}`} style={{ width: `${Math.max(2, relStr)}%` }} />
              </div>
              <div className={`text-xs font-medium truncate ${isBlue ? "text-blue-300/80" : "text-orange-300/80"}`}>{name}</div>
            </div>
          );
        })}
      </div>

      {/* Save button */}
      <div className="mt-4 pt-4 border-t border-white/5 flex items-center justify-between">
        <p className="text-xs text-white/30">Save prediction + entered odds to tracker</p>
        <button
          type="button"
          onClick={savePrediction}
          disabled={saving}
          className={clsx(
            "rounded-lg px-4 py-2 text-sm font-semibold transition-all",
            saveStatus === "saved" ? "bg-teal-600 text-white" :
            saveStatus === "error" ? "bg-red-900/60 text-red-300" :
            saving ? "bg-white/8 text-white/30 cursor-not-allowed" :
            "bg-white/10 text-white hover:bg-white/15 active:scale-95"
          )}
        >
          {saving ? "Saving…" : saveStatus === "saved" ? "✓ Saved" : saveStatus === "error" ? "Error" : "Save Prediction"}
        </button>
      </div>
    </div>
  );
}

function MissingLikelyXI({ title, items, accent }: {
  title: string;
  items: Array<{ nff_player_id: string; player_name: string | null; importance: number; importanceCeiling?: number; goals?: number; starts?: number }>;
  accent: "blue" | "orange";
}) {
  if (!items?.length) return null;
  function impColor(imp: number, ceil: number) {
    const r = ceil > 0 ? imp / ceil : 0;
    return r >= 0.80 ? "text-emerald-400" : r >= 0.60 ? "text-sky-400" : r >= 0.40 ? "text-yellow-400" : "text-white/35";
  }
  function impLabel(imp: number, ceil: number) {
    const r = ceil > 0 ? imp / ceil : 0;
    return r >= 0.8 ? "Key" : r >= 0.6 ? "Regular" : r >= 0.4 ? "Squad" : "";
  }
  return (
    <div className={clsx("rounded-2xl border bg-white/3 p-5", accent === "blue" ? "border-blue-500/30" : "border-orange-500/30")}>
      <h3 className={clsx("text-sm font-semibold", accent === "blue" ? "text-blue-400" : "text-orange-400")}>{title}</h3>
      <p className="mt-1 text-xs text-white/40">Expected starters not in today's lineup.</p>
      <div className="mt-3 space-y-1">
        {items.slice(0, 8).map((p, i) => {
          const ceil = p.importanceCeiling ?? 100;
          const color = impColor(p.importance, ceil);
          const label = impLabel(p.importance, ceil);
          return (
            <div key={`${p.nff_player_id}-${i}`} className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-white/3 transition-colors">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm text-white/85 truncate">{p.player_name ?? p.nff_player_id}</span>
                {p.starts != null && <span className="text-xs text-white/30 font-mono shrink-0">{p.starts}gs</span>}
                {!!p.goals && <span className="text-xs font-mono text-emerald-400/80 shrink-0">⚽ {p.goals}</span>}
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-3">
                {label && <span className={`text-xs font-mono opacity-60 ${color}`}>{label}</span>}
                <span className={`text-sm font-bold font-mono ${color}`}>{p.importance}<span className="text-white/25 font-normal">/{ceil}</span></span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PlayerAnalysisTable({ title, rows, accent }: { title: string; rows: any[]; accent: "blue" | "orange" }) {
  const [expanded, setExpanded] = useState<string[]>([]);
  function toggle(id: string) { setExpanded(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]); }

  return (
    <div className="rounded-2xl border border-white/8 bg-white/3 p-5">
      <h3 className="text-sm font-semibold mb-3">{title}</h3>
      <div className="overflow-hidden rounded-xl border border-white/8">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-white/3 border-b border-white/8">
              <th className="px-3 py-2.5 text-left w-8 text-xs text-white/30 font-mono">#</th>
              <th className="px-3 py-2.5 text-left text-xs text-white/30 font-mono uppercase tracking-wider">Player</th>
              <th className="px-3 py-2.5 text-right text-xs text-white/30 font-mono hidden sm:table-cell">Min</th>
              <th className="px-3 py-2.5 text-right text-xs text-white/30 font-mono hidden sm:table-cell">GS</th>
              <th className="px-3 py-2.5 text-right text-xs text-white/30 font-mono hidden sm:table-cell">G</th>
              <th className="px-3 py-2.5 text-right text-xs text-white/30 font-mono hidden sm:table-cell">L5</th>
              <th className="px-3 py-2.5 text-right text-xs text-white/30 font-mono">Imp</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-4 text-white/30 text-xs text-center">No data</td></tr>
            ) : rows.map((p) => {
              const playerId = p.spl_player_id ?? p.nff_player_id;
              const isOpen = expanded.includes(playerId);
              const imp = p.importance ?? 0;
              const ceil = p.importanceCeiling ?? 100;
              const ratio = ceil > 0 ? imp / ceil : 0;
              const impColor = imp === 0 ? "text-white/30" : ratio >= 0.8 ? "text-emerald-400" : ratio >= 0.6 ? "text-sky-400" : ratio >= 0.4 ? "text-yellow-400" : "text-white/50";
              const rowHL = imp === 0 ? "" : ratio >= 0.8 ? "border-l-2 border-l-emerald-500 bg-emerald-950/20" : ratio >= 0.6 ? "border-l-2 border-l-sky-500/40 bg-sky-950/10" : ratio >= 0.4 ? "border-l-2 border-l-yellow-500/50 bg-yellow-950/10" : "";
              return (
                <React.Fragment key={playerId}>
                 <tr className={clsx("border-t border-white/5 cursor-pointer hover:bg-white/3 transition-colors", rowHL)} onClick={() => toggle(playerId)}>
                    <td className="px-3 py-2.5 text-white/25 text-xs font-mono">{p.shirt_no ?? "—"}</td>
                    <td className="px-3 py-2.5">
                      <div className="font-medium text-white/90 text-sm">{p.name ?? `Player ${p.nff_player_id}`}</div>
                    </td>
                    <td className="px-3 py-2.5 text-right text-white/50 text-xs font-mono hidden sm:table-cell">{p.season?.minutes ?? "—"}</td>
                    <td className="px-3 py-2.5 text-right text-white/50 text-xs font-mono hidden sm:table-cell">{p.season?.starts ?? "—"}</td>
                    <td className="px-3 py-2.5 text-right text-white/50 text-xs font-mono hidden sm:table-cell">{p.season?.goals ?? "—"}</td>
                    <td className="px-3 py-2.5 text-right hidden sm:table-cell"><FormDots recent5={p.recent5} /></td>
                    <td className={clsx("px-3 py-2.5 text-right font-mono", impColor)}>
                      {imp > 0 ? <div className="flex flex-col items-end leading-none"><span className="font-bold text-sm">{imp}</span><span className="text-xs opacity-40 mt-0.5">/{ceil}</span></div> : <span className="text-white/20">—</span>}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="border-t border-white/5 bg-black/20">
                      <td />
                      <td colSpan={6} className="px-3 py-3 text-xs text-white/50 space-y-1">
                        {p.recent5 && <div className="flex items-center gap-2 mb-1"><span className="text-white/30">Last 5:</span><span>{p.recent5.lastNMinutes}m in {p.recent5.lastNApps} apps ({p.recent5.lastNStarts} starts)</span></div>}
                        {(p.seasons ?? []).length > 0 ? p.seasons.map((s: any, i: number) => (
                          <div key={i} className="flex gap-1 items-center">
                            <span className="text-white/30 w-12 shrink-0">{s.season_year}</span>
                            <span className="flex-1 truncate">{s.team_name ?? "—"}{s.club_ctx?.competition_tier ? ` · Tier ${s.club_ctx.competition_tier}` : ""}{s.minutes ? ` (${s.minutes}m` : ""}{s.goals > 0 ? ` ⚽${s.goals}` : ""}{s.minutes ? `)` : ""}</span>                            <span className="text-white/30 shrink-0">{s.goals}g</span>
                            <span className={clsx("font-mono shrink-0 text-xs", s.ceiling > 0 && s.importance / s.ceiling >= 0.8 ? "text-emerald-400" : s.ceiling > 0 && s.importance / s.ceiling >= 0.5 ? "text-sky-400" : "text-white/40")}>
                              {s.importance}/{s.ceiling}
                            </span>
                          </div>
                        )) : <div className="text-white/30">No season data</div>}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-white/20 font-mono">Tap row to expand · L5 = minutes in last 5 apps</p>
    </div>
  );
}

function H2HCard({ h2h, homeTeamId, awayTeamId, homeName, awayName }: {
  h2h: any;
  homeTeamId: string | null;
  awayTeamId: string | null;
  homeName: string;
  awayName: string;
}) {
  if (!h2h || !h2h.played) return null;
  return (
    <div className="rounded-2xl border border-white/8 bg-white/3 p-6">
      <h3 className="text-base font-semibold mb-4">Head to Head</h3>
      <div className="flex items-center justify-between mb-5">
        <div className="text-center">
          <div className="text-2xl font-bold text-blue-400">{h2h.homeWins}</div>
          <div className="text-xs text-white/40 font-mono mt-1">{homeName}</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-white/40">{h2h.draws}</div>
          <div className="text-xs text-white/40 font-mono mt-1">Draws</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-orange-400">{h2h.awayWins}</div>
          <div className="text-xs text-white/40 font-mono mt-1">{awayName}</div>
        </div>
      </div>
      <div className="space-y-2">
        {h2h.recent.map((m: any) => {
          const mHomeId = String(m.home_team_spl_id);
          const mAwayId = String(m.away_team_spl_id);
          const mHomeName = mHomeId === homeTeamId ? homeName : awayName;
          const mAwayName = mAwayId === awayTeamId ? awayName : homeName;
          const isHomeWin = m.home_score > m.away_score;
          const isAwayWin = m.away_score > m.home_score;
          const date = new Date(m.kickoff_at).toLocaleDateString("fi-FI", { day: "2-digit", month: "2-digit", year: "2-digit" });
          return (
            <div key={m.spl_match_id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-white/3 text-sm">
              <span className="text-white/40 font-mono text-xs w-16">{date}</span>
              <span className={clsx("flex-1 text-right text-xs truncate", isHomeWin ? "text-white/80 font-semibold" : "text-white/40")}>{mHomeName}</span>
              <span className="mx-3 font-mono font-bold text-white/80">{m.home_score} - {m.away_score}</span>
              <span className={clsx("flex-1 text-left text-xs truncate", isAwayWin ? "text-white/80 font-semibold" : "text-white/40")}>{mAwayName}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FormDots({ recent5 }: { recent5?: { lastNApps: number; lastNMinutes: number; lastNStarts: number } | null }) {
  if (!recent5 || recent5.lastNApps === 0) return <span className="text-white/20 text-xs font-mono">—</span>;
  const percent = Math.min(100, Math.round((recent5.lastNMinutes / 450) * 100));
  const color = percent >= 70 ? "bg-teal-500" : percent >= 40 ? "bg-yellow-500" : "bg-white/20";
  return (
    <div className="flex items-center gap-1.5 justify-end">
      <div className="w-12 h-1.5 rounded-full bg-white/8 overflow-hidden">
        <div className={clsx("h-full rounded-full", color)} style={{ width: `${percent}%` }} />
      </div>
      <span className="text-xs font-mono text-white/40 w-8 text-right">{recent5.lastNMinutes}</span>
    </div>
  );
}