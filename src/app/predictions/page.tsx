"use client";

import React, { useState, useEffect, useCallback } from "react";

function clsx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

type Prediction = {
  id: string;
  created_at: string;
  fiks_id: string | null;
  home_team: string;
  away_team: string;
  kickoff_at: string | null;
  fair_home_odds: number | null;
  fair_away_odds: number | null;
  fair_over15_odds: number | null;
  fair_over25_odds: number | null;
  fair_over35_odds: number | null;
  market_home_odds: number | null;
  market_away_odds: number | null;
  market_over15_odds: number | null;
  market_over25_odds: number | null;
  market_over35_odds: number | null;
  edge_home: number | null;
  edge_away: number | null;
  edge_over15: number | null;
  edge_over25: number | null;
  edge_over35: number | null;
  value_home: boolean;
  value_away: boolean;
  value_over15: boolean;
  value_over25: boolean;
  value_over35: boolean;
  home_score: number | null;
  away_score: number | null;
  bets?: AHBet[];
};

type AHBet = {
  id: string;
  prediction_id: string;
  side: string;
  line: number;
  odds: number;
  stake: number;
  result: string;
};

const AH_LINES = [-2, -1.75, -1.5, -1.25, -1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

function settleHalf(adjMargin: number, line: number, odds: number, stake: number): { result: string; pl: number } {
  const eff = adjMargin + line;
  if (Math.abs(eff) < 0.01) return { result: "push", pl: 0 };
  if (eff > 0) return { result: "win", pl: stake * (odds - 1) };
  return { result: "lose", pl: -stake };
}

function settleAH(side: string, line: number, odds: number, stake: number, hs: number, as_: number): { result: string; pl: number } {
  const margin = hs - as_;
  const adj = side === "home" ? margin : -margin;
  const isQuarter = Math.abs(Math.abs(line) % 0.5 - 0.25) < 0.01;
  if (isQuarter) {
    const lineA = line > 0 ? Math.floor(line * 2) / 2 : Math.ceil(line * 2) / 2;
    const lineB = line > 0 ? lineA + 0.5 : lineA - 0.5;
    const h = stake / 2;
    const rA = settleHalf(adj, lineA, odds, h);
    const rB = settleHalf(adj, lineB, odds, h);
    const pl = rA.pl + rB.pl;
    const bothWin = rA.result === "win" && rB.result === "win";
    const bothLose = rA.result === "lose" && rB.result === "lose";
    const halfWin = (rA.result === "win" && rB.result === "push") || (rA.result === "push" && rB.result === "win");
    const halfLose = (rA.result === "lose" && rB.result === "push") || (rA.result === "push" && rB.result === "lose");
    const result = bothWin ? "win" : bothLose ? "lose" : halfWin ? "half_win" : halfLose ? "half_lose" : pl > 0 ? "half_win" : "half_lose";
    return { result, pl };
  }
  return settleHalf(adj, line, odds, stake);
}

function fmtPL(pl: number) { return pl >= 0 ? `+£${pl.toFixed(2)}` : `-£${Math.abs(pl).toFixed(2)}`; }
function fmtDate(iso: string | null) { return iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "—"; }

type WRow = { label: string; mo: number | null; fo: number | null; edge: number | null; isVal: boolean; won: boolean | null; pl: number | null };

function deriveWDW(p: Prediction): WRow[] {
  const has = p.home_score !== null && p.away_score !== null;
  const tot = has ? p.home_score! + p.away_score! : null;
  const hw = has ? p.home_score! > p.away_score! : null;
  const aw = has ? p.away_score! > p.home_score! : null;
  const rows: WRow[] = [];
  const add = (label: string, mo: number | null, fo: number | null, edge: number | null, isVal: boolean, won: boolean | null) => {
    if (!mo) return;
    rows.push({ label, mo, fo, edge, isVal, won, pl: won === null ? null : won ? mo - 1 : -1 });
  };
  add(`${p.home_team} win`, p.market_home_odds, p.fair_home_odds, p.edge_home, p.value_home, has ? hw : null);
  add(`${p.away_team} win`, p.market_away_odds, p.fair_away_odds, p.edge_away, p.value_away, has ? aw : null);
  add("Over 1.5", p.market_over15_odds, p.fair_over15_odds, p.edge_over15, p.value_over15, has ? tot! > 1.5 : null);
  add("Over 2.5", p.market_over25_odds, p.fair_over25_odds, p.edge_over25, p.value_over25, has ? tot! > 2.5 : null);
  add("Over 3.5", p.market_over35_odds, p.fair_over35_odds, p.edge_over35, p.value_over35, has ? tot! > 3.5 : null);
  return rows;
}

export default function PredictionsPage() {
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resultInputs, setResultInputs] = useState<Record<string, { home: string; away: string }>>({});
  const [savingResult, setSavingResult] = useState<string | null>(null);
  const [ahInputs, setAhInputs] = useState<Record<string, { side: string; line: string; odds: string; stake: string }>>({});
  const [savingBet, setSavingBet] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/predictions");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load");
      setPredictions(data.predictions ?? []);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function saveResult(id: string) {
    const inp = resultInputs[id];
    if (!inp?.home || !inp?.away) return;
    setSavingResult(id);
    try {
      const res = await fetch(`/api/predictions/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ home_score: Number(inp.home), away_score: Number(inp.away) }) });
      if (!res.ok) throw new Error("Failed");
      await load();
    } catch (e: any) { alert(e.message); }
    finally { setSavingResult(null); }
  }

  async function saveAHBet(pid: string) {
    const inp = ahInputs[pid];
    if (!inp?.odds) return;
    setSavingBet(pid);
    try {
      const res = await fetch("/api/prediction-bets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prediction_id: pid, side: inp.side || "home", line: Number(inp.line ?? 0), odds: Number(inp.odds), stake: Number(inp.stake || 1), result: "pending" }) });
      if (!res.ok) throw new Error("Failed");
      setAhInputs(prev => ({ ...prev, [pid]: { side: "home", line: "0", odds: "", stake: "1" } }));
      await load();
    } catch (e: any) { alert(e.message); }
    finally { setSavingBet(null); }
  }

  async function deleteAHBet(betId: string) {
    console.log("deleting", betId);
    try {
        const res = await fetch(`/api/prediction-bets/${betId}`, { method: "DELETE" });
        if (!res.ok) throw new Error("Failed to delete");
        await load();
    } catch (e: any) { alert(e.message); }
  }

  async function deletePrediction(id: string) {
    if (!confirm("Delete this prediction and all its bets?")) return;
    try {
        const res = await fetch(`/api/predictions/${id}`, { method: "DELETE" });
        if (!res.ok) throw new Error("Failed to delete");
        await load();
    } catch (e: any) { alert(e.message); }
  }


  const allWDW = predictions.flatMap(p => deriveWDW(p));
  const settledWDW = allWDW.filter(b => b.won !== null);
  const totalWDWPL = settledWDW.reduce((s, b) => s + (b.pl ?? 0), 0);

  const allAH = predictions.flatMap(p => (p.bets ?? []).map(b => {
    if (p.home_score === null || p.away_score === null) return { ...b, pl: null, settled: false, rl: "PEND" };
    const { result, pl } = settleAH(b.side, b.line, b.odds, b.stake, p.home_score!, p.away_score!);
    const rl = result === "win" ? "WIN" : result === "lose" ? "LOSE" : result === "half_win" ? "½WIN" : result === "half_lose" ? "½LOSE" : "PUSH";
    return { ...b, pl, settled: true, rl };
  }));
  const settledAH = allAH.filter(b => b.settled);
  const totalAHPL = settledAH.reduce((s, b) => s + (b.pl ?? 0), 0);
  const pendingAH = allAH.filter(b => !b.settled).length;

  return (
    <main className="min-h-screen bg-[#0a0a0c] text-white">
      <div className="border-b border-white/5 bg-black/40">
        <div className="mx-auto max-w-6xl px-6 py-5 flex items-center justify-between">
          <div>
            <a href="/" className="text-white/40 text-sm hover:text-white/70 transition-colors">← NorwayDB</a>
            <h1 className="text-2xl font-bold tracking-tight mt-1">Prediction Tracker</h1>
          </div>
          <button onClick={load} className="text-xs font-mono text-white/30 hover:text-white/60 px-3 py-1.5 border border-white/10 rounded-lg">Refresh</button>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-6 py-8 space-y-8">

        {/* Summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "AH P&L", value: settledAH.length > 0 ? fmtPL(totalAHPL) : "—", color: totalAHPL >= 0 ? "text-teal-400" : "text-red-400" },
            { label: "AH settled", value: `${settledAH.length} bets`, color: "text-white/80" },
            { label: "AH pending", value: String(pendingAH), color: pendingAH > 0 ? "text-yellow-400" : "text-white/30" },
            { label: "WDW P&L", value: settledWDW.length > 0 ? fmtPL(totalWDWPL) : "—", color: totalWDWPL >= 0 ? "text-teal-400" : "text-red-400" },
          ].map(({ label, value, color }) => (
            <div key={label} className="rounded-xl border border-white/8 bg-white/3 px-4 py-4">
              <div className="text-xs text-white/40 font-mono uppercase tracking-wider mb-1">{label}</div>
              <div className={clsx("text-2xl font-bold font-mono", color)}>{value}</div>
            </div>
          ))}
        </div>

        {error && <div className="rounded-lg bg-red-950/40 border border-red-500/20 px-4 py-3 text-sm text-red-400">{error}</div>}
        {loading && <div className="text-white/30 text-sm font-mono">Loading…</div>}

        <div className="space-y-4">
          {predictions.map((p) => {
            const wdw = deriveWDW(p);
            const hasResult = p.home_score !== null && p.away_score !== null;
            const inp = resultInputs[p.id] ?? { home: "", away: "" };
            const ahInp = ahInputs[p.id] ?? { side: "home", line: "0", odds: "", stake: "1" };

            const betRows = (p.bets ?? []).map(b => {
              if (!hasResult) return { ...b, pl: null, rl: "PEND" };
              const { result, pl } = settleAH(b.side, b.line, b.odds, b.stake, p.home_score!, p.away_score!);
              const rl = result === "win" ? "WIN" : result === "lose" ? "LOSE" : result === "half_win" ? "½WIN" : result === "half_lose" ? "½LOSE" : "PUSH";
              return { ...b, pl, rl };
            });

            const ahMatchPL = betRows.reduce((s, b) => s + (b.pl ?? 0), 0);

            return (
              <div key={p.id} className="rounded-2xl border border-white/8 bg-white/3 overflow-hidden">

                {/* Match header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
                  <div>
                    <div className="flex items-center gap-3 mb-1">
                        <div className="text-xs text-white/30 font-mono">{fmtDate(p.kickoff_at ?? p.created_at)}</div>
                        <button onClick={() => deletePrediction(p.id)} className="text-white/15 hover:text-red-400 transition-colors text-base leading-none">×</button>
                    </div>
                    <div className="font-semibold">
                      <span className="text-blue-300">{p.home_team}</span>
                      <span className="text-white/30 mx-2">vs</span>
                      <span className="text-orange-300">{p.away_team}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    {hasResult ? (
                      <div className="text-center">
                        <div className="text-xl font-bold font-mono">{p.home_score} – {p.away_score}</div>
                        {betRows.length > 0 && <div className={clsx("text-xs font-mono font-semibold mt-0.5", ahMatchPL >= 0 ? "text-teal-400" : "text-red-400")}>AH {fmtPL(ahMatchPL)}</div>}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <input className="w-12 rounded-lg border border-white/10 bg-black/60 px-2 py-1.5 text-sm font-mono text-center focus:border-white/30 focus:outline-none" placeholder="H" value={inp.home} onChange={e => setResultInputs(prev => ({ ...prev, [p.id]: { ...inp, home: e.target.value } }))} />
                        <span className="text-white/30">–</span>
                        <input className="w-12 rounded-lg border border-white/10 bg-black/60 px-2 py-1.5 text-sm font-mono text-center focus:border-white/30 focus:outline-none" placeholder="A" value={inp.away} onChange={e => setResultInputs(prev => ({ ...prev, [p.id]: { ...inp, away: e.target.value } }))} />
                        <button onClick={() => saveResult(p.id)} disabled={savingResult === p.id || !inp.home || !inp.away} className={clsx("rounded-lg px-3 py-1.5 text-xs font-semibold", savingResult === p.id || !inp.home || !inp.away ? "bg-white/5 text-white/20 cursor-not-allowed" : "bg-white/10 text-white hover:bg-white/15")}>
                          {savingResult === p.id ? "…" : "Save"}
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* WDW reference */}
                {wdw.length > 0 && (
                  <div className="px-5 py-3 border-b border-white/5">
                    <div className="text-xs text-white/25 font-mono uppercase tracking-wider mb-2">WDW Reference</div>
                    <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-4 gap-y-1.5 text-xs">
                      {wdw.map((b, i) => (
                        <React.Fragment key={i}>
                          <div className="flex items-center gap-1.5">
                            {b.isVal && <span className="text-teal-400">★</span>}
                            <span className={clsx(b.isVal ? "text-white/80" : "text-white/40")}>{b.label}</span>
                          </div>
                          <div className="text-right font-mono text-white/25">{b.fo?.toFixed(2) ?? "—"}</div>
                          <div className="text-right font-mono text-white/55">{b.mo?.toFixed(2) ?? "—"}</div>
                          <div className={clsx("text-right font-mono font-semibold", b.edge == null ? "text-white/20" : b.edge >= 5 ? "text-teal-400" : b.edge > 0 ? "text-white/35" : "text-red-400/50")}>
                            {b.edge != null ? `${b.edge >= 0 ? "+" : ""}${b.edge.toFixed(1)}%` : "—"}
                          </div>
                          <div className={clsx("text-right font-mono font-bold", b.won === null ? "text-yellow-400/50" : b.won ? "text-teal-400" : "text-red-400")}>
                            {b.won === null ? "PEND" : b.won ? `+£${b.pl!.toFixed(2)}` : "-£1.00"}
                          </div>
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                )}

                {/* AH settled bets */}
                {betRows.length > 0 && (
                <div className="px-5 py-3 border-b border-white/5">
                    <div className="text-xs text-white/25 font-mono uppercase tracking-wider mb-2">Asian Handicap</div>
                    <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto_24px] gap-x-4 gap-y-1.5 text-xs">
                    <div className="text-white/20 font-mono">Side</div>
                    <div className="text-white/20 font-mono text-right">Line</div>
                    <div className="text-white/20 font-mono text-right">Odds</div>
                    <div className="text-white/20 font-mono text-right">Stake</div>
                    <div className="text-white/20 font-mono text-right">Result</div>
                    <div className="text-white/20 font-mono text-right">P&L</div>
                    <div />
                    {betRows.map((b, i) => {
                        const sideLabel = b.side === "home" ? p.home_team : p.away_team;
                        const rc = b.rl === "WIN" ? "text-teal-400" : b.rl === "LOSE" ? "text-red-400" : b.rl === "½WIN" ? "text-teal-300/70" : b.rl === "½LOSE" ? "text-red-300/70" : "text-white/40";
                        return (
                        <React.Fragment key={i}>
                            <div className="text-white/70 truncate">{sideLabel}</div>
                            <div className="text-right font-mono text-white/60">{Number(b.line) > 0 ? "+" : ""}{b.line}</div>
                            <div className="text-right font-mono text-white/60">{b.odds}</div>
                            <div className="text-right font-mono text-white/40">£{b.stake}</div>
                            <div className={clsx("text-right font-mono font-semibold", rc)}>{b.rl}</div>
                            <div className={clsx("text-right font-mono font-bold", b.pl === null ? "text-yellow-400/50" : (b.pl ?? 0) >= 0 ? "text-teal-400" : "text-red-400")}>
                            {b.pl === null ? "PEND" : fmtPL(b.pl)}
                            </div>
                            <button onClick={() => deleteAHBet(b.id)} className="w-6 text-red-400 hover:text-red-300 transition-colors font-mono">×</button>
                            
                        </React.Fragment>
                        );
                    })}
                    </div>
                </div>
                )}

                {/* Add AH bet */}
                <div className="px-5 py-3">
                  <div className="text-xs text-white/25 font-mono uppercase tracking-wider mb-2">Add AH Bet</div>
                  <div className="flex gap-2 flex-wrap items-end">
                    <div>
                      <div className="text-xs text-white/30 mb-1">Side</div>
                      <select className="rounded-lg border border-white/10 bg-black/60 px-2 py-1.5 text-sm focus:border-white/30 focus:outline-none" value={ahInp.side} onChange={e => setAhInputs(prev => ({ ...prev, [p.id]: { ...ahInp, side: e.target.value } }))}>
                        <option value="home">{p.home_team}</option>
                        <option value="away">{p.away_team}</option>
                      </select>
                    </div>
                    <div>
                      <div className="text-xs text-white/30 mb-1">Line</div>
                      <select className="rounded-lg border border-white/10 bg-black/60 px-2 py-1.5 text-sm focus:border-white/30 focus:outline-none" value={ahInp.line} onChange={e => setAhInputs(prev => ({ ...prev, [p.id]: { ...ahInp, line: e.target.value } }))}>
                        {AH_LINES.map(l => <option key={l} value={l}>{l > 0 ? `+${l}` : l}</option>)}
                      </select>
                    </div>
                    <div>
                      <div className="text-xs text-white/30 mb-1">Odds</div>
                      <input className="w-20 rounded-lg border border-white/10 bg-black/60 px-2 py-1.5 text-sm font-mono focus:border-white/30 focus:outline-none" placeholder="1.90" value={ahInp.odds} onChange={e => setAhInputs(prev => ({ ...prev, [p.id]: { ...ahInp, odds: e.target.value } }))} />
                    </div>
                    <div>
                      <div className="text-xs text-white/30 mb-1">Stake £</div>
                      <input className="w-16 rounded-lg border border-white/10 bg-black/60 px-2 py-1.5 text-sm font-mono focus:border-white/30 focus:outline-none" placeholder="1" value={ahInp.stake} onChange={e => setAhInputs(prev => ({ ...prev, [p.id]: { ...ahInp, stake: e.target.value } }))} />
                    </div>
                    <button onClick={() => saveAHBet(p.id)} disabled={savingBet === p.id || !ahInp.odds} className={clsx("rounded-lg px-4 py-1.5 text-sm font-semibold transition-all", savingBet === p.id || !ahInp.odds ? "bg-white/5 text-white/20 cursor-not-allowed" : "bg-white/10 text-white hover:bg-white/15 active:scale-95")}>
                      {savingBet === p.id ? "…" : "Add"}
                    </button>
                  </div>
                </div>

              </div>
            );
          })}

          {!loading && predictions.length === 0 && (
            <div className="rounded-2xl border border-white/8 bg-white/3 px-6 py-12 text-center">
              <div className="text-white/30 text-sm">No predictions saved yet.</div>
              <a href="/" className="mt-3 inline-block text-xs text-white/40 hover:text-white/70">← Go analyse a match</a>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}