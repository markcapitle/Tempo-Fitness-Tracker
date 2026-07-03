import { useState, useEffect } from "react";
import {
  Dumbbell, Target, TrendingUp, Plus, Trash2, Check, X,
  Activity, Calendar, Flag, Award, ChevronDown, ChevronUp,
  ClipboardList, Zap, ChevronRight, HeartPulse, Scale, Search, Pencil, StickyNote
} from "lucide-react";
import { LineChart, Line, BarChart, Bar, ResponsiveContainer, YAxis, Tooltip, XAxis } from "recharts";

// ---------- helpers ----------
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const fmtDate = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
};
const blankSet = () => ({ reps: "", weight: "", rpe: "" });

// Persistence layer — the loadKey/saveKey "seam".
// Today it uses the browser's localStorage. To add accounts + cloud sync later,
// swap the bodies of these two functions for Supabase calls (keyed by user id)
// and the rest of the app stays untouched.
const STORAGE_PREFIX = "tempo:";
async function loadKey(key, fallback) {
  try { const r = localStorage.getItem(STORAGE_PREFIX + key); return r != null ? JSON.parse(r) : fallback; }
  catch { return fallback; }
}
async function saveKey(key, value) {
  try { localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value)); }
  catch (e) { console.error("save failed", key, e); }
}

// ---------- exercise / set helpers ----------
function parseNum(str) {
  if (str == null) return null;
  const m = String(str).match(/(\d+(?:\.\d+)?)/);
  return m ? { num: parseFloat(m[1]) } : null;
}
function isTimeStr(str) { return /s\b|sec|min|hold/i.test(String(str || "")); }
function cleanSets(sets) {
  return (sets || []).filter((s) =>
    String(s.reps || "").trim() !== "" || String(s.weight || "").trim() !== "" || String(s.rpe || "").trim() !== "");
}
function exVolume(e) {
  if (e.type !== "strength") return 0;
  return (e.sets || []).reduce((a, s) => a + (parseFloat(s.reps) || 0) * (parseFloat(s.weight) || 0), 0);
}
// Estimated 1-rep max (Epley) — lets a heavy single and a lighter high-rep set compare on one scale.
function epley(reps, weight) { return weight * (1 + (reps || 0) / 30); }
function topSet(e) {
  const sets = e.sets || [];
  if (!sets.length) return null;
  let best = sets[0], bestW = -1;
  sets.forEach((s) => {
    const w = parseNum(s.weight);
    const val = w && !isTimeStr(s.weight) ? w.num : -1;
    if (val > bestW) { bestW = val; best = s; }
  });
  if (bestW < 0) {
    let bestR = -1;
    sets.forEach((s) => { const r = parseNum(s.reps); const rv = r ? r.num : -1; if (rv > bestR) { bestR = rv; best = s; } });
  }
  return best;
}
function normalizeExercise(e) {
  if (Array.isArray(e.sets)) {
    const sets = e.sets.length ? e.sets.map((s) => ({ reps: s.reps || "", weight: s.weight || "", rpe: s.rpe || "" })) : [blankSet()];
    return { id: e.id || uid(), name: e.name, type: e.type || "strength", notes: e.notes || "", sets };
  }
  const n = Math.max(1, Math.min(parseInt(e.sets) || 1, 12));
  const row = { reps: e.reps || "", weight: e.weight || "", rpe: e.rpe || "" };
  return { id: e.id || uid(), name: e.name, type: e.type || "strength", notes: e.notes || "", sets: Array.from({ length: n }, () => ({ ...row })) };
}
function normalizeWorkouts(workouts) {
  const out = {};
  Object.entries(workouts || {}).forEach(([date, list]) => { out[date] = (list || []).map(normalizeExercise); });
  return out;
}

// ---------- progression helpers ----------
function lastEntryFor(workouts, name) {
  const target = String(name || "").trim().toLowerCase();
  if (!target) return null;
  const dates = Object.keys(workouts).sort((a, b) => b.localeCompare(a));
  for (const d of dates) {
    const matches = workouts[d].filter((e) => e.name.trim().toLowerCase() === target);
    if (matches.length) return { ...matches[matches.length - 1], date: d };
  }
  return null;
}
function formatLast(last) {
  const sets = last.sets || [];
  const top = topSet(last);
  const sc = sets.length;
  if (!top) return `${sc} sets · ${fmtDate(last.date)}`;
  const wt = top.weight ? (isTimeStr(top.weight) ? top.weight : `@ ${top.weight}`) : "";
  const bits = [top.reps && `${top.reps} reps`, wt].filter(Boolean).join(" ");
  return `${sc} set${sc !== 1 ? "s" : ""} · top ${bits || "logged"} · ${fmtDate(last.date)}`;
}
function suggestProgression(last, targetReps) {
  const top = topSet(last);
  if (!top) return null;
  const w = parseNum(top.weight);
  const repsNum = parseNum(top.reps) ? parseNum(top.reps).num : null;
  if ((!top.reps || top.reps === "") && w && isTimeStr(top.weight)) {
    const next = w.num + 5;
    return { weight: String(top.weight).replace(/\d+(\.\d+)?/, String(next)), reps: "", note: `+5s (was ${w.num}s)` };
  }
  if (w && !isTimeStr(top.weight) && targetReps) {
    if (repsNum != null && repsNum >= targetReps) {
      const inc = w.num < 45 ? 2.5 : 5;
      const next = w.num + inc;
      return { weight: String(top.weight).replace(/\d+(\.\d+)?/, String(next)), reps: String(targetReps), note: `+${inc} (hit ${repsNum} reps)` };
    }
    const nextReps = repsNum != null ? repsNum + 1 : targetReps;
    return { weight: top.weight, reps: String(nextReps), note: `+1 rep at ${top.weight}` };
  }
  if (!w && targetReps && repsNum != null) {
    return { weight: top.weight || "", reps: String(repsNum + 1), note: `+1 rep (was ${repsNum})` };
  }
  return null;
}

// ---------- progress-graph helpers ----------
function strengthNames(workouts) {
  const set = {};
  Object.values(workouts).forEach((list) => list.forEach((e) => {
    if (e.type === "strength" && (e.sets || []).some((s) => parseNum(s.weight) && !isTimeStr(s.weight))) set[e.name] = true;
  }));
  return Object.keys(set).sort();
}
function strengthSeries(workouts, name, from, to) {
  const rows = [];
  Object.entries(workouts).forEach(([date, list]) => {
    if (from && date < from) return;
    if (to && date > to) return;
    let best = null;
    list.filter((e) => e.name === name).forEach((e) => (e.sets || []).forEach((s) => {
      if (isTimeStr(s.weight)) return;
      const w = parseNum(s.weight);
      if (!w) return;
      const r = parseNum(s.reps);
      const e1 = epley(r ? r.num : 1, w.num);
      if (best === null || e1 > best) best = e1;
    }));
    if (best !== null) rows.push({ date: date.slice(5), full: date, value: Math.round(best) });
  });
  return rows.sort((a, b) => a.full.localeCompare(b.full));
}
function strengthPR(workouts, name) {
  let pr = null, unit = "";
  Object.values(workouts).forEach((list) => list.forEach((e) => {
    if (e.name !== name) return;
    (e.sets || []).forEach((s) => {
      if (isTimeStr(s.weight)) return;
      const w = parseNum(s.weight);
      if (!w) return;
      const r = parseNum(s.reps);
      const e1 = epley(r ? r.num : 1, w.num);
      if (pr === null || e1 > pr) { pr = e1; unit = String(s.weight).replace(/[\d.\s]/g, ""); }
    });
  }));
  return pr === null ? null : { value: Math.round(pr), unit };
}
function cardioNames(workouts) {
  const set = {};
  Object.values(workouts).forEach((list) => list.forEach((e) => { if (e.type === "cardio") set[e.name] = true; }));
  return Object.keys(set).sort();
}
function parseCardio(str) {
  const s = String(str || "").toLowerCase();
  let minutes = null, distance = null, distUnit = "";
  const minM = s.match(/(\d+(?:\.\d+)?)\s*min/);
  const secM = s.match(/(\d+(?:\.\d+)?)\s*s(?:ec)?\b/);
  if (minM) minutes = parseFloat(minM[1]);
  else if (secM) minutes = parseFloat(secM[1]) / 60;
  const miM = s.match(/(\d+(?:\.\d+)?)\s*(?:mi|mile|miles)\b/);
  const kmM = s.match(/(\d+(?:\.\d+)?)\s*(?:km|kms|kilometer|kilometers)\b/);
  if (miM) { distance = parseFloat(miM[1]); distUnit = "mi"; }
  else if (kmM) { distance = parseFloat(kmM[1]); distUnit = "km"; }
  return { minutes, distance, distUnit };
}
function cardioSeries(workouts, name, from, to, metric) {
  const rows = [];
  Object.entries(workouts).forEach(([date, list]) => {
    if (from && date < from) return;
    if (to && date > to) return;
    let total = 0, unit = "", has = false;
    list.filter((e) => e.name === name).forEach((e) => (e.sets || []).forEach((s) => {
      const c = parseCardio(s.weight);
      if (metric === "time" && c.minutes != null) { total += c.minutes; has = true; unit = "min"; }
      if (metric === "distance" && c.distance != null) { total += c.distance; has = true; unit = c.distUnit; }
    }));
    if (has) rows.push({ date: date.slice(5), full: date, value: Math.round(total * 100) / 100, unit });
  });
  return rows.sort((a, b) => a.full.localeCompare(b.full));
}

// ---------- exercise library ----------
const STRENGTH_EXERCISES = [
  "Barbell Bench Press", "Incline Barbell Bench Press", "Decline Barbell Bench Press", "Close-Grip Bench Press",
  "Dumbbell Bench Press", "Incline Dumbbell Press", "Decline Dumbbell Press", "Dumbbell Fly", "Incline Dumbbell Fly",
  "Cable Fly", "Cable Crossover", "Low Cable Crossover", "Pec Deck", "Chest Press Machine", "Incline Chest Press Machine",
  "Smith Machine Bench Press", "Push-Up", "Wide Push-Up", "Diamond Push-Up", "Incline Push-Up", "Decline Push-Up",
  "Archer Push-Up", "Pseudo Planche Push-Up", "Plyo Push-Up", "Dips", "Chest Dip", "Bench Dip", "Svend Press",
  "Deadlift", "Conventional Deadlift", "Sumo Deadlift", "Romanian Deadlift", "Stiff-Leg Deadlift", "Rack Pull",
  "Barbell Row", "Pendlay Row", "Bent-Over Row", "T-Bar Row", "Dumbbell Row", "One-Arm Dumbbell Row",
  "Chest-Supported Row", "Seal Row", "Seated Cable Row", "Single-Arm Cable Row", "Lat Pulldown", "Wide-Grip Lat Pulldown",
  "Close-Grip Lat Pulldown", "Neutral-Grip Lat Pulldown", "Straight-Arm Pulldown", "Pull-Up", "Chin-Up",
  "Wide-Grip Pull-Up", "Neutral-Grip Pull-Up", "Weighted Pull-Up", "Assisted Pull-Up", "Muscle-Up", "Inverted Row",
  "Australian Row", "Machine Row", "Smith Machine Row", "Dumbbell Pullover", "Back Extension", "Hyperextension",
  "Barbell Shrug", "Dumbbell Shrug", "Trap Bar Deadlift", "Good Morning", "Face Pull",
  "Overhead Press", "Barbell Overhead Press", "Seated Barbell Press", "Dumbbell Shoulder Press", "Seated Dumbbell Press",
  "Arnold Press", "Push Press", "Single-Arm Dumbbell Press", "Shoulder Press Machine", "Smith Machine Shoulder Press",
  "Dumbbell Lateral Raise", "Cable Lateral Raise", "Lateral Raise Machine", "Dumbbell Front Raise", "Cable Front Raise",
  "Plate Front Raise", "Dumbbell Rear Delt Fly", "Cable Rear Delt Fly", "Rear Delt Machine", "Reverse Pec Deck",
  "Upright Row", "Barbell Upright Row", "Cable Upright Row", "Landmine Press", "Handstand Push-Up", "Pike Push-Up",
  "Barbell Curl", "EZ-Bar Curl", "Dumbbell Bicep Curl", "Hammer Curl", "Incline Dumbbell Curl", "Concentration Curl",
  "Preacher Curl", "Cable Bicep Curl", "Cable Hammer Curl", "Spider Curl", "Zottman Curl", "Reverse Curl",
  "Machine Preacher Curl", "Towel Bicep Curl",
  "Triceps Pushdown", "Rope Pushdown", "Cable Triceps Pushdown", "Overhead Triceps Extension", "Dumbbell Triceps Extension",
  "Skull Crusher", "Lying Triceps Extension", "Triceps Kickback", "Cable Kickback", "Close-Grip Push-Up",
  "Triceps Extension Machine", "Tate Press",
  "Back Squat", "Front Squat", "High-Bar Squat", "Low-Bar Squat", "Box Squat", "Zercher Squat", "Goblet Squat",
  "Hack Squat", "Smith Machine Squat", "Leg Press", "Bulgarian Split Squat", "Dumbbell Bulgarian Split Squat",
  "Split Squat", "Walking Lunge", "Reverse Lunge", "Forward Lunge", "Lateral Lunge", "Curtsy Lunge", "Dumbbell Lunge",
  "Barbell Lunge", "Step-Up", "Dumbbell Step-Up", "Pistol Squat", "Bodyweight Squat", "Jump Squat", "Wall Sit",
  "Leg Extension", "Lying Leg Curl", "Seated Leg Curl", "Nordic Curl", "Single-Leg Romanian Deadlift",
  "Barbell Hip Thrust", "Dumbbell Hip Thrust", "Glute Bridge", "Single-Leg Glute Bridge", "Hip Thrust Machine",
  "Glute Kickback", "Cable Pull-Through", "Hip Abduction Machine", "Hip Adduction Machine", "Standing Calf Raise",
  "Seated Calf Raise", "Calf Raise", "Calf Press", "Donkey Calf Raise",
  "Plank", "Side Plank", "Hollow Hold", "Superman", "Mountain Climbers", "Hanging Leg Raise", "Lying Leg Raise",
  "Captain's Chair Leg Raise", "Bicycle Crunch", "Crunch", "Sit-Up", "Cable Crunch", "Ab Crunch Machine",
  "Russian Twist", "V-Up", "Flutter Kicks", "Dead Bug", "Bird Dog", "Toes-to-Bar", "Ab Wheel Rollout",
  "Cable Woodchopper", "Pallof Press", "Hanging Knee Raise",
  "Power Clean", "Hang Clean", "Clean and Jerk", "Snatch", "Hang Snatch", "Clean Pull", "Snatch Pull",
  "Kettlebell Swing", "Kettlebell Goblet Squat", "Kettlebell Clean", "Kettlebell Snatch", "Turkish Get-Up",
  "Kettlebell Press", "Kettlebell Row", "Kettlebell Deadlift", "Box Jump", "Broad Jump", "Depth Jump", "Tuck Jump",
  "Medicine Ball Slam", "Medicine Ball Chest Pass", "Farmer's Carry", "Suitcase Carry", "Sled Push", "Sled Drag",
  "Battle Ropes", "Thruster", "Dumbbell Thruster", "Renegade Row", "Wall Ball",
  "Band Pull-Apart", "Band Chest Press", "Band Row", "Band Lat Pulldown", "Band Squat", "Band Bicep Curl",
  "Band Triceps Pushdown", "Band Face Pull", "Band Lateral Raise", "Band Good Morning", "Band Hip Thrust", "Band Pallof Press",
];
const CARDIO_EXERCISES = [
  "Running", "Jogging", "Treadmill Run", "Treadmill Walk", "Incline Walk", "Walking", "Cycling", "Stationary Bike",
  "Spin Bike", "Assault Bike", "Elliptical", "Rowing Machine", "Row Erg", "Ski Erg", "Stair Climber", "StairMaster",
  "Jump Rope", "Swimming", "Sprints", "Hill Sprints", "Hiking", "Bike Sprints",
];
const CARDIO_SET = new Set(CARDIO_EXERCISES.map((s) => s.toLowerCase()));

function highlightMatch(text, q) {
  if (!q) return text;
  const i = text.toLowerCase().indexOf(q);
  if (i < 0) return text;
  return (<>{text.slice(0, i)}<span className="font-semibold text-emerald-700">{text.slice(i, i + q.length)}</span>{text.slice(i + q.length)}</>);
}

function ExerciseAutocomplete({ value, onChange, onPickType, library, cardioSet, onAddCustom }) {
  const [focused, setFocused] = useState(false);
  const q = value.trim().toLowerCase();
  const matches = q ? library.filter((n) => n.toLowerCase().includes(q)).slice(0, 8) : [];
  const exact = library.some((n) => n.toLowerCase() === q);
  const showAdd = q.length > 0 && !exact;
  const open = focused && (matches.length > 0 || showAdd);

  const pick = (name) => {
    onChange(name);
    if (onPickType) onPickType(cardioSet.has(name.toLowerCase()) ? "cardio" : "strength");
    setFocused(false);
  };
  const addNew = () => { const v = value.trim(); if (!v) return; onAddCustom(v); onChange(v); setFocused(false); };

  return (
    <div className="relative">
      <input value={value}
        onChange={(e) => { onChange(e.target.value); setFocused(true); }}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 120)}
        placeholder="Start typing… e.g. Incline Dumbbell Press"
        className="w-full mt-1 px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
      {open && (
        <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-56 overflow-auto">
          {matches.map((n) => (
            <button key={n} type="button" onMouseDown={(e) => { e.preventDefault(); pick(n); }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-emerald-50 flex items-center justify-between gap-2">
              <span className="truncate">{highlightMatch(n, q)}</span>
              {cardioSet.has(n.toLowerCase()) && <span className="text-[10px] text-sky-500 uppercase shrink-0">cardio</span>}
            </button>
          ))}
          {showAdd && (
            <button type="button" onMouseDown={(e) => { e.preventDefault(); addNew(); }}
              className="w-full text-left px-3 py-2 text-sm text-emerald-700 hover:bg-emerald-50 border-t border-slate-100 flex items-center gap-1">
              <Plus size={13} /> Add &ldquo;{value.trim()}&rdquo; to library
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- reusable set-row editor ----------
function SetRows({ sets, type, onUpdate, onAdd, onRemove }) {
  const vol = type === "strength" ? sets.reduce((a, s) => a + (parseFloat(s.reps) || 0) * (parseFloat(s.weight) || 0), 0) : 0;
  return (
    <div>
      <div className="flex items-center gap-1.5 px-0.5 mb-1">
        <span className="w-6 shrink-0" />
        <span className="flex-1 text-[10px] text-slate-400 uppercase tracking-wide">Reps</span>
        <span className="flex-1 text-[10px] text-slate-400 uppercase tracking-wide">{type === "cardio" ? "Dur / Dist" : "Weight"}</span>
        <span className="flex-1 text-[10px] text-slate-400 uppercase tracking-wide">RPE</span>
        <span className="w-6 shrink-0" />
      </div>
      <div className="space-y-1.5">
        {sets.map((s, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <span className="w-6 h-8 flex items-center justify-center text-[11px] font-semibold text-slate-500 bg-slate-100 rounded shrink-0">{i + 1}</span>
            <input value={s.reps} onChange={(e) => onUpdate(i, "reps", e.target.value)} inputMode="numeric" placeholder="—"
              className="flex-1 min-w-0 px-2 py-1.5 rounded-md border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
            <input value={s.weight} onChange={(e) => onUpdate(i, "weight", e.target.value)} placeholder={type === "cardio" ? "20 min" : "135"}
              className="flex-1 min-w-0 px-2 py-1.5 rounded-md border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
            <input value={s.rpe} onChange={(e) => onUpdate(i, "rpe", e.target.value)} inputMode="numeric" placeholder="—"
              className="flex-1 min-w-0 px-2 py-1.5 rounded-md border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
            <button onClick={() => onRemove(i)} disabled={sets.length === 1}
              className="w-6 flex items-center justify-center text-slate-300 hover:text-red-500 disabled:opacity-30 disabled:hover:text-slate-300 shrink-0"><X size={14} /></button>
          </div>
        ))}
      </div>
      <button onClick={onAdd} className="mt-2 text-xs text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 rounded-md transition flex items-center gap-1"><Plus size={13} /> Add set</button>
      {type === "strength" && (
        <div className="text-xs text-slate-500 mt-2 flex justify-between border-t border-slate-100 pt-2">
          <span>Total volume</span>
          <span className="font-semibold text-slate-700">{vol.toLocaleString()}</span>
        </div>
      )}
    </div>
  );
}

// ---------- program library ----------
const PROGRAMS = [
  {
    id: "powerbuilding", name: "Power Building", level: "Intermediate", focus: "Strength + Size", freq: "4 days / week",
    desc: "Powerlifting meets bodybuilding. Heavy low-rep compounds for strength, then moderate-to-high-rep accessory work for size. Upper/lower split with power and volume days.",
    days: [
      { name: "Power Upper", exercises: [
        { name: "Bench Press", type: "strength", sets: "4", reps: "4" }, { name: "Weighted Pull-Up", type: "strength", sets: "4", reps: "5" },
        { name: "Overhead Press", type: "strength", sets: "3", reps: "6" }, { name: "Barbell Row", type: "strength", sets: "3", reps: "8" },
        { name: "Lateral Raise", type: "strength", sets: "3", reps: "15" }, { name: "Hammer Curl", type: "strength", sets: "3", reps: "12" } ]},
      { name: "Power Lower", exercises: [
        { name: "Back Squat", type: "strength", sets: "4", reps: "4" }, { name: "Deadlift", type: "strength", sets: "3", reps: "4" },
        { name: "Leg Press", type: "strength", sets: "3", reps: "10" }, { name: "Romanian Deadlift", type: "strength", sets: "3", reps: "10" },
        { name: "Calf Raise", type: "strength", sets: "4", reps: "15" } ]},
      { name: "Volume Upper", exercises: [
        { name: "Incline Dumbbell Press", type: "strength", sets: "4", reps: "10" }, { name: "Lat Pulldown", type: "strength", sets: "4", reps: "12" },
        { name: "Cable Fly", type: "strength", sets: "3", reps: "15" }, { name: "Face Pull", type: "strength", sets: "3", reps: "15" },
        { name: "Triceps Pushdown", type: "strength", sets: "3", reps: "15" }, { name: "Bicep Curl", type: "strength", sets: "3", reps: "12" } ]},
      { name: "Volume Lower", exercises: [
        { name: "Front Squat", type: "strength", sets: "4", reps: "8" }, { name: "Bulgarian Split Squat", type: "strength", sets: "3", reps: "12" },
        { name: "Leg Curl", type: "strength", sets: "3", reps: "15" }, { name: "Leg Extension", type: "strength", sets: "3", reps: "15" },
        { name: "Calf Raise", type: "strength", sets: "4", reps: "20" } ]},
    ],
  },
  {
    id: "endurance", name: "Endurance", level: "Beginner", focus: "Muscular Endurance", freq: "3 days / week",
    desc: "High reps, lighter loads (~50–60% of max), and short rest to build muscles that resist fatigue. Full-body sessions, great for runners and general conditioning.",
    days: [
      { name: "Endurance A", exercises: [
        { name: "Goblet Squat", type: "strength", sets: "3", reps: "20" }, { name: "Push-Up", type: "strength", sets: "3", reps: "20" },
        { name: "Dumbbell Row", type: "strength", sets: "3", reps: "18" }, { name: "Walking Lunge", type: "strength", sets: "3", reps: "16" },
        { name: "Plank", type: "strength", sets: "3", reps: "", weight: "45s hold" } ]},
      { name: "Endurance B", exercises: [
        { name: "Romanian Deadlift", type: "strength", sets: "3", reps: "18" }, { name: "Overhead Press", type: "strength", sets: "3", reps: "18" },
        { name: "Lat Pulldown", type: "strength", sets: "3", reps: "20" }, { name: "Step-Up", type: "strength", sets: "3", reps: "16" },
        { name: "Russian Twist", type: "strength", sets: "3", reps: "30" } ]},
      { name: "Endurance C", exercises: [
        { name: "Leg Press", type: "strength", sets: "3", reps: "20" }, { name: "Incline Dumbbell Press", type: "strength", sets: "3", reps: "18" },
        { name: "Cable Row", type: "strength", sets: "3", reps: "20" }, { name: "Glute Bridge", type: "strength", sets: "3", reps: "20" },
        { name: "Mountain Climbers", type: "strength", sets: "3", reps: "", weight: "45s" } ]},
    ],
  },
  {
    id: "power", name: "Power", level: "Advanced", focus: "Explosive Power", freq: "3 days / week",
    desc: "Explosive, low-rep training for speed and force production — olympic-style lifts, heavy triples, and plyometrics. Move every rep with maximal intent. Best with a solid strength base first.",
    days: [
      { name: "Lower Power", exercises: [
        { name: "Box Jump", type: "strength", sets: "4", reps: "4" }, { name: "Power Clean", type: "strength", sets: "5", reps: "3" },
        { name: "Back Squat (explosive)", type: "strength", sets: "4", reps: "3" }, { name: "Jump Squat", type: "strength", sets: "3", reps: "5" },
        { name: "Broad Jump", type: "strength", sets: "3", reps: "4" } ]},
      { name: "Upper Power", exercises: [
        { name: "Plyo Push-Up", type: "strength", sets: "4", reps: "5" }, { name: "Bench Press (explosive)", type: "strength", sets: "5", reps: "3" },
        { name: "Push Press", type: "strength", sets: "4", reps: "4" }, { name: "Medicine Ball Chest Pass", type: "strength", sets: "3", reps: "6" },
        { name: "Explosive Row", type: "strength", sets: "4", reps: "4" } ]},
      { name: "Athletic Power", exercises: [
        { name: "Hang Clean", type: "strength", sets: "5", reps: "3" }, { name: "Trap Bar Deadlift", type: "strength", sets: "4", reps: "3" },
        { name: "Kettlebell Swing", type: "strength", sets: "4", reps: "8" }, { name: "Medicine Ball Slam", type: "strength", sets: "3", reps: "8" },
        { name: "Depth Jump", type: "strength", sets: "3", reps: "4" } ]},
    ],
  },
  {
    id: "hypertrophy", name: "Hypertrophy", level: "Intermediate", focus: "Muscle Growth", freq: "4 days / week",
    desc: "Classic body-part split built for size. Moderate loads (~65–80% of max) in the 8–15 rep range with plenty of isolation volume and a strong mind-muscle focus.",
    days: [
      { name: "Chest & Triceps", exercises: [
        { name: "Bench Press", type: "strength", sets: "4", reps: "10" }, { name: "Incline Dumbbell Press", type: "strength", sets: "4", reps: "12" },
        { name: "Cable Fly", type: "strength", sets: "3", reps: "15" }, { name: "Triceps Pushdown", type: "strength", sets: "3", reps: "12" },
        { name: "Overhead Triceps Extension", type: "strength", sets: "3", reps: "15" } ]},
      { name: "Back & Biceps", exercises: [
        { name: "Lat Pulldown", type: "strength", sets: "4", reps: "12" }, { name: "Barbell Row", type: "strength", sets: "4", reps: "10" },
        { name: "Seated Cable Row", type: "strength", sets: "3", reps: "12" }, { name: "Bicep Curl", type: "strength", sets: "3", reps: "12" },
        { name: "Hammer Curl", type: "strength", sets: "3", reps: "15" } ]},
      { name: "Shoulders & Abs", exercises: [
        { name: "Overhead Press", type: "strength", sets: "4", reps: "10" }, { name: "Lateral Raise", type: "strength", sets: "4", reps: "15" },
        { name: "Rear Delt Fly", type: "strength", sets: "3", reps: "15" }, { name: "Shrug", type: "strength", sets: "3", reps: "15" },
        { name: "Hanging Leg Raise", type: "strength", sets: "3", reps: "15" } ]},
      { name: "Legs", exercises: [
        { name: "Back Squat", type: "strength", sets: "4", reps: "10" }, { name: "Romanian Deadlift", type: "strength", sets: "4", reps: "12" },
        { name: "Leg Press", type: "strength", sets: "4", reps: "12" }, { name: "Leg Curl", type: "strength", sets: "3", reps: "15" },
        { name: "Calf Raise", type: "strength", sets: "4", reps: "20" } ]},
    ],
  },
  {
    id: "fat-loss", name: "Fat Loss", level: "Beginner", focus: "Fat Loss / Conditioning", freq: "3 days / week",
    desc: "Metabolic circuit training — compound moves run back-to-back with minimal rest, capped with a cardio finisher. Keeps the heart rate high to burn calories while holding onto muscle. Rest 15–30s between moves.",
    days: [
      { name: "Circuit A", exercises: [
        { name: "Goblet Squat", type: "strength", sets: "3", reps: "15" }, { name: "Push-Up", type: "strength", sets: "3", reps: "15" },
        { name: "Dumbbell Row", type: "strength", sets: "3", reps: "15" }, { name: "Kettlebell Swing", type: "strength", sets: "3", reps: "20" },
        { name: "Jump Rope (finisher)", type: "cardio", sets: "3", reps: "", weight: "60s" } ]},
      { name: "Circuit B", exercises: [
        { name: "Reverse Lunge", type: "strength", sets: "3", reps: "16" }, { name: "Dumbbell Push Press", type: "strength", sets: "3", reps: "15" },
        { name: "Lat Pulldown", type: "strength", sets: "3", reps: "15" }, { name: "Mountain Climbers", type: "strength", sets: "3", reps: "", weight: "45s" },
        { name: "Rowing Machine (finisher)", type: "cardio", sets: "3", reps: "", weight: "2 min" } ]},
      { name: "Circuit C", exercises: [
        { name: "Deadlift", type: "strength", sets: "3", reps: "15" }, { name: "Incline Dumbbell Press", type: "strength", sets: "3", reps: "15" },
        { name: "Cable Row", type: "strength", sets: "3", reps: "15" }, { name: "Burpees", type: "strength", sets: "3", reps: "12" },
        { name: "Bike Sprints (finisher)", type: "cardio", sets: "3", reps: "", weight: "60s" } ]},
    ],
  },
  {
    id: "full-body", name: "Full-Body 3-Day", level: "Beginner", focus: "General Fitness", freq: "3 days / week",
    desc: "Dumbbell-friendly full-body sessions. Great if you're easing in or training at home.",
    days: [
      { name: "Full Body A", exercises: [
        { name: "Goblet Squat", type: "strength", sets: "3", reps: "12" }, { name: "Dumbbell Bench Press", type: "strength", sets: "3", reps: "10" },
        { name: "One-Arm Dumbbell Row", type: "strength", sets: "3", reps: "10" }, { name: "Plank", type: "strength", sets: "3", reps: "", weight: "30s hold" } ]},
      { name: "Full Body B", exercises: [
        { name: "Romanian Deadlift", type: "strength", sets: "3", reps: "10" }, { name: "Overhead Press", type: "strength", sets: "3", reps: "10" },
        { name: "Lat Pulldown", type: "strength", sets: "3", reps: "12" }, { name: "Bicycle Crunch", type: "strength", sets: "3", reps: "20" } ]},
    ],
  },
  {
    id: "ppl", name: "Push / Pull / Legs", level: "Intermediate", focus: "Hypertrophy", freq: "3–6 days / week",
    desc: "Train by movement pattern. Run it 3 days a week, or twice through for a 6-day split.",
    days: [
      { name: "Push", exercises: [
        { name: "Bench Press", type: "strength", sets: "4", reps: "8" }, { name: "Overhead Press", type: "strength", sets: "3", reps: "10" },
        { name: "Incline Dumbbell Press", type: "strength", sets: "3", reps: "10" }, { name: "Lateral Raise", type: "strength", sets: "3", reps: "15" },
        { name: "Triceps Pushdown", type: "strength", sets: "3", reps: "12" } ]},
      { name: "Pull", exercises: [
        { name: "Deadlift", type: "strength", sets: "3", reps: "5" }, { name: "Pull-Up", type: "strength", sets: "3", reps: "8" },
        { name: "Barbell Row", type: "strength", sets: "4", reps: "8" }, { name: "Face Pull", type: "strength", sets: "3", reps: "15" },
        { name: "Bicep Curl", type: "strength", sets: "3", reps: "12" } ]},
      { name: "Legs", exercises: [
        { name: "Back Squat", type: "strength", sets: "4", reps: "8" }, { name: "Romanian Deadlift", type: "strength", sets: "3", reps: "10" },
        { name: "Leg Press", type: "strength", sets: "3", reps: "12" }, { name: "Leg Curl", type: "strength", sets: "3", reps: "12" },
        { name: "Calf Raise", type: "strength", sets: "4", reps: "15" } ]},
    ],
  },
  {
    id: "upper-lower", name: "Upper / Lower", level: "Intermediate", focus: "Strength + Size", freq: "4 days / week",
    desc: "Two upper and two lower days a week. A balanced hybrid of strength and muscle building.",
    days: [
      { name: "Upper", exercises: [
        { name: "Bench Press", type: "strength", sets: "4", reps: "6" }, { name: "Barbell Row", type: "strength", sets: "4", reps: "6" },
        { name: "Overhead Press", type: "strength", sets: "3", reps: "8" }, { name: "Lat Pulldown", type: "strength", sets: "3", reps: "10" },
        { name: "Bicep Curl", type: "strength", sets: "3", reps: "12" }, { name: "Triceps Extension", type: "strength", sets: "3", reps: "12" } ]},
      { name: "Lower", exercises: [
        { name: "Back Squat", type: "strength", sets: "4", reps: "6" }, { name: "Romanian Deadlift", type: "strength", sets: "3", reps: "8" },
        { name: "Leg Press", type: "strength", sets: "3", reps: "10" }, { name: "Leg Curl", type: "strength", sets: "3", reps: "12" },
        { name: "Calf Raise", type: "strength", sets: "4", reps: "15" } ]},
    ],
  },
  {
    id: "couch-5k", name: "Couch to 5K", level: "Beginner", focus: "Cardio / Endurance", freq: "3 days / week",
    desc: "Run/walk intervals that build you up to a continuous 5K. Adjust interval times as you progress.",
    days: [
      { name: "Run Day", exercises: [
        { name: "Warm-up Walk", type: "cardio", sets: "1", reps: "", weight: "5 min" },
        { name: "Run / Walk Intervals", type: "cardio", sets: "8", reps: "", weight: "60s run / 90s walk" },
        { name: "Cool-down Walk", type: "cardio", sets: "1", reps: "", weight: "5 min" } ]},
    ],
  },
  {
    id: "calisthenics", name: "Calisthenics", level: "Beginner", focus: "Bodyweight Strength", freq: "3 days / week",
    desc: "Pure bodyweight, zero equipment. Push/pull/legs/core movements you scale by changing leverage and reps. Train each set close to failure (1–2 reps in reserve) and progress by adding reps before harder variations.",
    days: [
      { name: "Push", exercises: [
        { name: "Push-Up", type: "strength", sets: "4", reps: "12" }, { name: "Pike Push-Up", type: "strength", sets: "3", reps: "10" },
        { name: "Dips (chair/bench)", type: "strength", sets: "3", reps: "10" }, { name: "Diamond Push-Up", type: "strength", sets: "3", reps: "10" },
        { name: "Pseudo Planche Lean", type: "strength", sets: "3", reps: "", weight: "20s hold" } ]},
      { name: "Pull", exercises: [
        { name: "Pull-Up (or Negative)", type: "strength", sets: "4", reps: "8" }, { name: "Australian Row (under table)", type: "strength", sets: "4", reps: "12" },
        { name: "Chin-Up", type: "strength", sets: "3", reps: "8" }, { name: "Towel Bicep Curl", type: "strength", sets: "3", reps: "12" },
        { name: "Superman Hold", type: "strength", sets: "3", reps: "", weight: "30s hold" } ]},
      { name: "Legs", exercises: [
        { name: "Bodyweight Squat", type: "strength", sets: "4", reps: "20" }, { name: "Walking Lunge", type: "strength", sets: "3", reps: "16" },
        { name: "Bulgarian Split Squat", type: "strength", sets: "3", reps: "12" }, { name: "Single-Leg Glute Bridge", type: "strength", sets: "3", reps: "15" },
        { name: "Calf Raise", type: "strength", sets: "4", reps: "20" } ]},
      { name: "Core", exercises: [
        { name: "Plank", type: "strength", sets: "3", reps: "", weight: "45s hold" }, { name: "Hollow Hold", type: "strength", sets: "3", reps: "", weight: "30s hold" },
        { name: "Lying Leg Raise", type: "strength", sets: "3", reps: "15" }, { name: "Mountain Climbers", type: "strength", sets: "3", reps: "", weight: "40s" },
        { name: "Bicycle Crunch", type: "strength", sets: "3", reps: "30" } ]},
    ],
  },
  {
    id: "home-gym", name: "Home Workout", level: "Beginner", focus: "Full-Body Strength", freq: "3 days / week",
    desc: "Minimal-equipment full-body training with just dumbbells and resistance bands. Every move works with either tool. Use a load where the last 2–3 reps are hard; add reps weekly, then bump weight or band tension.",
    days: [
      { name: "Full Body A", exercises: [
        { name: "Goblet Squat (DB) / Band Squat", type: "strength", sets: "3", reps: "12" }, { name: "DB Floor Press / Band Chest Press", type: "strength", sets: "3", reps: "12" },
        { name: "One-Arm DB Row / Band Row", type: "strength", sets: "3", reps: "12" }, { name: "DB Shoulder Press / Band Press", type: "strength", sets: "3", reps: "12" },
        { name: "Plank", type: "strength", sets: "3", reps: "", weight: "45s hold" } ]},
      { name: "Full Body B", exercises: [
        { name: "DB Romanian Deadlift / Band RDL", type: "strength", sets: "3", reps: "12" }, { name: "DB Reverse Lunge / Band Lunge", type: "strength", sets: "3", reps: "12" },
        { name: "Band Lat Pulldown / DB Pullover", type: "strength", sets: "3", reps: "12" }, { name: "DB Lateral Raise / Band Raise", type: "strength", sets: "3", reps: "15" },
        { name: "Russian Twist (DB)", type: "strength", sets: "3", reps: "20" } ]},
      { name: "Full Body C", exercises: [
        { name: "DB Bulgarian Split Squat", type: "strength", sets: "3", reps: "12" }, { name: "DB Incline Press / Band Press", type: "strength", sets: "3", reps: "12" },
        { name: "Band Face Pull / DB Rear Fly", type: "strength", sets: "3", reps: "15" }, { name: "DB Bicep Curl / Band Curl", type: "strength", sets: "3", reps: "12" },
        { name: "DB Overhead Triceps Ext / Band Pushdown", type: "strength", sets: "3", reps: "12" } ]},
    ],
  },
];

// =================== PERIODIZATION ENGINE ===================
// Each program maps to a periodization model. The engine lays the program across
// 4/8/12 weeks as 4-week mesocycles (3 build weeks + 1 deload), driven by an
// RPE/RIR ramp, and schedules dated sessions for the Calendar.
const PROGRAM_MODELS = {
  powerbuilding: "block", "upper-lower": "block", power: "block",
  hypertrophy: "volume", ppl: "volume",
  endurance: "density", "fat-loss": "maintenance",
  "full-body": "linear", "home-gym": "linear", calisthenics: "linear",
  "couch-5k": "runwalk",
};
const MODEL_LABEL = {
  block: "Block periodization · size → strength → peak",
  volume: "Volume progression · add sets toward your ceiling",
  density: "Density progression · more reps, less rest",
  maintenance: "Maintenance · hold strength, progress conditioning",
  linear: "Linear progression · add a little each session",
  runwalk: "Run/walk intervals · build to a 30-minute run",
};

function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}
const numBlocks = (weeks) => Math.max(1, Math.round(weeks / 4));
function blockPhases(model, weeks) {
  const n = numBlocks(weeks);
  if (model === "block") {
    const seq = ["Accumulation", "Intensification", "Realization"];
    return Array.from({ length: n }, (_, i) => seq[Math.min(i, seq.length - 1)]);
  }
  const base = { volume: "Volume Block", density: "Density Block", maintenance: "Maintain Block", linear: "Progression Block" }[model] || "Block";
  return Array.from({ length: n }, (_, i) => `${base} ${i + 1}`);
}

// NHS-style Couch-to-5K run/walk progression, sampled across the chosen length.
// Most weeks repeat one session ×3; weeks 5 & 6 give three distinct runs.
function runwalkWeek(weekNum, weeks) {
  const nine = [
    { all: "Brisk 5-min walk, then 8 rounds of 60s run / 90s walk." },
    { all: "Brisk 5-min walk, then 6 rounds of 90s run / 2-min walk." },
    { all: "5-min walk, then 2 × (90s run, 90s walk, 3-min run, 3-min walk)." },
    { all: "5-min walk, then: 3-min run, 90s walk, 5-min run, 2.5-min walk, 3-min run, 90s walk, 5-min run." },
    { runs: [
      "Run 1 — 5-min walk, then 5-min run, 3-min walk, 5-min run, 3-min walk, 5-min run.",
      "Run 2 — 5-min walk, then 8-min run, 5-min walk, 8-min run.",
      "Run 3 — 5-min walk, then a 20-min run with no walking.",
    ] },
    { runs: [
      "Run 1 — 5-min walk, then 5-min run, 3-min walk, 8-min run, 3-min walk, 5-min run.",
      "Run 2 — 5-min walk, then 10-min run, 3-min walk, 10-min run.",
      "Run 3 — 5-min walk, then a 25-min run with no walking.",
    ] },
    { all: "5-min walk, then 25-min continuous run." },
    { all: "5-min walk, then 28-min continuous run." },
    { all: "5-min walk, then 30-min continuous run — that's your 5K." },
  ];
  // Short plans stay in the interval portion; only 8+ week plans reach the 30-min run.
  const maxIdx = weeks >= 8 ? nine.length - 1 : Math.min(nine.length - 1, weeks - 1);
  const idx = Math.round(((weekNum - 1) / Math.max(1, weeks - 1)) * maxIdx);
  const entry = nine[Math.min(idx, nine.length - 1)];
  if (entry.runs) {
    return { phase: `Run/Walk · Week ${weekNum}`, deload: false, rpe: null, setMult: 1,
      runs: entry.runs, directive: "Three different runs this week — each one is shown below. Rest a day between each." };
  }
  return { phase: `Run/Walk · Week ${weekNum}`, deload: false, rpe: null, setMult: 1,
    runs: null, directive: entry.all + "  3 runs this week, with a rest day between each." };
}

function weekPrescription(model, weekNum, weeks) {
  if (model === "runwalk") return runwalkWeek(weekNum, weeks);
  const wInBlock = (weekNum - 1) % 4;
  const blockIdx = Math.floor((weekNum - 1) / 4);
  const phases = blockPhases(model, weeks);
  const phase = phases[Math.min(blockIdx, phases.length - 1)];
  const deload = wInBlock === 3;
  let rpe = deload ? 6 : [7, 8, 9][wInBlock];
  let setMult = deload ? 0.5 : 1;
  let directive;
  if (deload) {
    directive = "Deload — about half the sets, ~10% lighter, leave 4+ reps in reserve. Recover so the next block starts fresh.";
  } else if (model === "block") {
    const repHint = phase === "Realization" ? "main lift 1–3 reps (heavy top sets)"
      : phase === "Intensification" ? "main lift 4–6 reps" : "main lift 8–12 reps";
    directive = `${phase} — ${repHint}, accessories 8–15, RPE ${rpe}. ${wInBlock === 0 ? "Set your working loads this week." : "Nudge load up from last week if reps were clean."}`;
  } else if (model === "volume") {
    setMult = 1 + 0.25 * wInBlock;
    directive = `Build volume — same loads, add a set or two and chase reps, RPE ${rpe}. Taken near failure, lighter loads grow muscle just as well.`;
  } else if (model === "density") {
    directive = `Build endurance — same loads, add reps or a round and trim rest toward 30–45s, RPE ${rpe}.`;
  } else if (model === "maintenance") {
    rpe = Math.min(rpe, 8);
    directive = `Maintain strength in your deficit — hold loads at RPE ≤${rpe} to keep muscle; progress by adding conditioning rounds or cutting rest, not weight.`;
  } else {
    directive = `Linear progression — add a little weight or one rep on each lift versus last session, RPE ${rpe}.`;
  }
  return { phase, deload, rpe, setMult, directive };
}

function sessionsPerWeek(program) {
  const f = parseInt(program.freq);
  return Number.isFinite(f) && f > 0 ? f : program.days.length;
}
function weekOffsets(s) { return Array.from({ length: s }, (_, k) => Math.round((k * 7) / s)); }

function buildPlan(program, weeks, startDate, daysPerWeek) {
  const model = PROGRAM_MODELS[program.id] || "linear";
  const spw = (Number.isFinite(daysPerWeek) && daysPerWeek > 0) ? daysPerWeek : sessionsPerWeek(program);
  const offsets = weekOffsets(spw);
  const weeksArr = [];
  for (let w = 1; w <= weeks; w++) {
    const pres = weekPrescription(model, w, weeks);
    const sessions = [];
    for (let k = 0; k < spw; k++) {
      const day = program.days[k % program.days.length];
      const scheduledDate = addDays(startDate, (w - 1) * 7 + offsets[k]);
      const exercises = (day.exercises || []).map((e, ei) => {
        let setN = Math.max(1, parseInt(e.sets) || 3);
        setN = Math.max(1, Math.round(setN * (pres.setMult || 1)));
        let reps = e.reps || "";
        // A "main lift" is the day's lead compound prescribed in a low/strength rep range
        // (≤6). Accessory- or volume-day leads (e.g. Incline DB Press @10) are left alone.
        const tmplReps = parseInt(e.reps);
        const isMain = ei === 0 && e.type !== "cardio" && Number.isFinite(tmplReps) && tmplReps <= 6;
        if (model === "block" && isMain && !pres.deload) {
          if (pres.phase === "Intensification") reps = "4–6";
          else if (pres.phase === "Realization") reps = "1–3";
        }
        return { name: e.name, type: e.type, sets: setN, reps, rpe: pres.rpe, main: isMain };
      });
      const sess = { id: uid(), dayName: day.name, scheduledDate, done: false, exercises };
      if (model === "runwalk" && pres.runs) sess.directive = pres.runs[k % pres.runs.length];
      sessions.push(sess);
    }
    weeksArr.push({ weekNum: w, phase: pres.phase, deload: !!pres.deload, directive: pres.directive, sessions });
  }
  return { id: uid(), programId: program.id, programName: program.name, model, weeks, daysPerWeek: spw, startDate, createdAt: Date.now(), weeksArr };
}

export default function WorkoutTracker() {
  const [tab, setTab] = useState("workouts");
  const [loading, setLoading] = useState(true);
  const [workouts, setWorkouts] = useState({});
  const [goals, setGoals] = useState({ short: [], long: [] });
  const [milestones, setMilestones] = useState([]);
  const [bodyweight, setBodyweight] = useState([]);
  const [customExercises, setCustomExercises] = useState([]);
  const [activeProgramId, setActiveProgramId] = useState(null);
  const [activePlan, setActivePlan] = useState(null);
  const [planHistory, setPlanHistory] = useState([]);

  useEffect(() => {
    (async () => {
      const [w, g, m, bw, ce, p, pl, ph] = await Promise.all([
        loadKey("workouts", {}), loadKey("goals", { short: [], long: [] }), loadKey("milestones", []),
        loadKey("bodyweight", []), loadKey("customExercises", []), loadKey("activeProgram", null), loadKey("activePlan", null), loadKey("planHistory", []),
      ]);
      setWorkouts(normalizeWorkouts(w)); setGoals(g); setMilestones(m); setBodyweight(bw); setCustomExercises(ce); setActiveProgramId(p); setActivePlan(pl); setPlanHistory(ph);
      setLoading(false);
    })();
  }, []);

  const updateWorkouts = (next) => { setWorkouts(next); saveKey("workouts", next); };
  const updateGoals = (next) => { setGoals(next); saveKey("goals", next); };
  const updateMilestones = (next) => { setMilestones(next); saveKey("milestones", next); };
  const updateBodyweight = (next) => { setBodyweight(next); saveKey("bodyweight", next); };
  const updatePlan = (next) => { setActivePlan(next); saveKey("activePlan", next); };
  const updateHistory = (next) => { setPlanHistory(next); saveKey("planHistory", next); };
  const addCustomExercise = (name) => {
    const exists = [...STRENGTH_EXERCISES, ...CARDIO_EXERCISES, ...customExercises].some((n) => n.toLowerCase() === name.toLowerCase());
    if (name && !exists) { const next = [...customExercises, name]; setCustomExercises(next); saveKey("customExercises", next); }
  };
  const selectProgram = (id) => { const next = activeProgramId === id ? null : id; setActiveProgramId(next); saveKey("activeProgram", next); };

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-slate-400"><Activity className="animate-pulse mr-2" /> Loading your training data…</div>;
  }

  const activeProgram = PROGRAMS.find((p) => p.id === activeProgramId) || null;
  const tabs = [
    // { id: "programs", label: "Programs", icon: ClipboardList },
    // { id: "calendar", label: "Calendar", icon: Calendar },
    { id: "workouts", label: "Workouts", icon: Dumbbell },
    { id: "notes", label: "Notes", icon: StickyNote },
    { id: "goals", label: "Goals", icon: Target },
    { id: "milestones", label: "Milestones", icon: TrendingUp },
  ];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans">
      <div className="max-w-3xl mx-auto p-4 sm:p-6">
        <header className="mb-6">
          <h1 className="text-2xl font-bold flex items-center gap-2 text-slate-900">
            <span className="bg-emerald-500 text-white p-2 rounded-xl"><Activity size={22} /></span> The Workout Tracker
          </h1>
          <p className="text-sm text-slate-500 mt-1">Pick a program, log workouts, set goals, and track milestones.</p>
        </header>

        <nav className="grid grid-cols-4 gap-1 bg-white rounded-xl p-1 shadow-sm border border-slate-200 mb-6">
          {tabs.map((t) => {
            const Icon = t.icon; const active = tab === t.id;
            return (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs sm:text-sm font-medium transition ${active ? "bg-emerald-500 text-white shadow" : "text-slate-500 hover:bg-slate-100"}`}>
                <Icon size={15} /> <span className="hidden xs:inline sm:inline">{t.label}</span>
              </button>
            );
          })}
        </nav>

        {tab === "programs" && <ProgramsTab activeId={activeProgramId} onSelect={selectProgram} goToWorkouts={() => setTab("workouts")} />}
        {tab === "workouts" && <WorkoutsTab workouts={workouts} update={updateWorkouts} program={activeProgram} goToPrograms={() => setTab("programs")} customExercises={customExercises} addCustomExercise={addCustomExercise} />}
        {tab === "calendar" && <CalendarTab plan={activePlan} updatePlan={updatePlan} workouts={workouts} updateWorkouts={updateWorkouts} goToWorkouts={() => setTab("workouts")} planHistory={planHistory} updateHistory={updateHistory} />}
        {tab === "notes" && <NotesTab workouts={workouts} update={updateWorkouts} goToWorkouts={() => setTab("workouts")} />}
        {tab === "goals" && <GoalsTab goals={goals} update={updateGoals} />}
        {tab === "milestones" && <MilestonesTab milestones={milestones} update={updateMilestones} workouts={workouts} bodyweight={bodyweight} updateBodyweight={updateBodyweight} planHistory={planHistory} />}
      </div>
    </div>
  );
}

// =================== PROGRAMS ===================
const LEVEL_STYLE = {
  Beginner: "bg-green-100 text-green-700", Intermediate: "bg-amber-100 text-amber-700", Advanced: "bg-red-100 text-red-700",
};

function ProgramsTab({ activeId, onSelect, goToWorkouts }) {
  const [expanded, setExpanded] = useState(null);
  const [level, setLevel] = useState("All");
  const [query, setQuery] = useState("");
  const [overrides, setOverrides] = useState({});

  useEffect(() => { (async () => { setOverrides(await loadKey("programOverrides", {})); })(); }, []);
  const saveDays = (id, days) => { const next = { ...overrides, [id]: days }; setOverrides(next); saveKey("programOverrides", next); };
  const resetProgram = (id) => { const next = { ...overrides }; delete next[id]; setOverrides(next); saveKey("programOverrides", next); };

  const effective = PROGRAMS.map((p) => ({ ...p, days: overrides[p.id] || p.days, customized: !!overrides[p.id] }));
  const q = query.trim().toLowerCase();
  const filtered = effective.filter((p) => {
    if (level !== "All" && p.level !== level) return false;
    if (!q) return true;
    const hay = [p.name, p.focus, p.desc, p.level, p.freq, ...p.days.map((d) => d.name), ...p.days.flatMap((d) => d.exercises.map((e) => e.name))].join(" ").toLowerCase();
    return hay.includes(q);
  });

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl p-3 shadow-sm border border-slate-200 space-y-2">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search programs, goals, or exercises…"
            className="w-full pl-9 pr-8 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
          {query && <button onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500"><X size={15} /></button>}
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-500 shrink-0">Difficulty</label>
          <select value={level} onChange={(e) => setLevel(e.target.value)}
            className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-400">
            {["All", "Beginner", "Intermediate", "Advanced"].map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
      </div>

      <p className="text-xs text-slate-400 px-1">
        Showing {filtered.length} of {PROGRAMS.length} programs
        {(q || level !== "All") && <button onClick={() => { setQuery(""); setLevel("All"); }} className="ml-2 text-emerald-600 hover:underline">reset filters</button>}
      </p>

      {filtered.length === 0 && <div className="text-center text-slate-400 py-10 text-sm">No programs match your filters. Try a different keyword or difficulty.</div>}

      {["Beginner", "Intermediate", "Advanced"].map((lvl) => {
        const group = filtered.filter((p) => p.level === lvl);
        if (group.length === 0) return null;
        return (
          <div key={lvl} className="space-y-4">
            <div className="flex items-center gap-2 px-1 pt-1">
              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${LEVEL_STYLE[lvl]}`}>{lvl}</span>
              <div className="h-px flex-1 bg-slate-200" />
              <span className="text-[11px] text-slate-400">{group.length}</span>
            </div>
            {group.map((p) => (
              <ProgramCard key={p.id} p={p} active={activeId === p.id} open={expanded === p.id}
                onSelect={onSelect} onToggle={() => setExpanded(expanded === p.id ? null : p.id)} goToWorkouts={goToWorkouts}
                customized={p.customized} onSaveDays={saveDays} onReset={resetProgram} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function ProgramCard({ p, active, open, onSelect, onToggle, goToWorkouts, customized, onSaveDays, onReset }) {
  const [editPos, setEditPos] = useState(null);
  const [exDraft, setExDraft] = useState(null);

  const startEditEx = (di, ei) => {
    const e = p.days[di].exercises[ei];
    setEditPos({ di, ei });
    setExDraft({ name: e.name, type: e.type || "strength", sets: e.sets || "", reps: e.reps || "", weight: e.weight || "" });
  };
  const cancelEx = () => { setEditPos(null); setExDraft(null); };
  const saveEx = () => {
    const name = (exDraft.name || "").trim();
    if (!name) { cancelEx(); return; }
    const cleaned = { name, type: exDraft.type, sets: exDraft.sets, reps: exDraft.reps };
    if ((exDraft.weight || "").trim()) cleaned.weight = exDraft.weight.trim();
    const newDays = p.days.map((d, di) => di === editPos.di ? { ...d, exercises: d.exercises.map((x, ei) => ei === editPos.ei ? cleaned : x) } : d);
    onSaveDays(p.id, newDays); cancelEx();
  };
  const removeEx = (di, ei) => {
    const newDays = p.days.map((d, dii) => dii === di ? { ...d, exercises: d.exercises.filter((_, eii) => eii !== ei) } : d);
    onSaveDays(p.id, newDays);
  };
  const addEx = (di) => {
    const newDays = p.days.map((d, dii) => dii === di ? { ...d, exercises: [...d.exercises, { name: "New exercise", type: "strength", sets: "3", reps: "10" }] } : d);
    onSaveDays(p.id, newDays);
  };

  return (
    <div className={`bg-white rounded-xl shadow-sm border overflow-hidden transition ${active ? "border-emerald-400 ring-1 ring-emerald-300" : "border-slate-200"}`}>
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-bold text-slate-900">{p.name}</h3>
              {active && <span className="text-[10px] uppercase tracking-wide bg-emerald-500 text-white px-2 py-0.5 rounded-full flex items-center gap-1"><Check size={11} /> Active</span>}
              {customized && <span className="text-[10px] uppercase tracking-wide bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">Customized</span>}
            </div>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${LEVEL_STYLE[p.level]}`}>{p.level}</span>
              <span className="text-[11px] text-slate-500">{p.focus}</span>
              <span className="text-slate-300">·</span>
              <span className="text-[11px] text-slate-500">{p.freq}</span>
            </div>
          </div>
          <button onClick={() => onSelect(p.id)}
            className={`shrink-0 text-sm font-medium px-4 py-2 rounded-lg transition ${active ? "bg-slate-100 text-slate-600 hover:bg-slate-200" : "bg-emerald-500 text-white hover:bg-emerald-600"}`}>
            {active ? "Deselect" : "Select"}
          </button>
        </div>
        <p className="text-sm text-slate-600 mt-3">{p.desc}</p>
        <div className="flex flex-wrap gap-1.5 mt-3">
          {p.days.map((d) => <span key={d.name} className="text-[11px] bg-slate-100 text-slate-600 px-2 py-1 rounded-md">{d.name}</span>)}
        </div>
        <button onClick={onToggle} className="mt-3 text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1">
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />} {open ? "Hide" : "View & edit"} exercises
        </button>
        {open && (
          <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
            {p.days.map((d, di) => (
              <div key={di}>
                <p className="text-xs font-semibold text-slate-700 mb-1">{d.name}</p>
                <div className="space-y-1">
                  {d.exercises.map((e, ei) => (
                    (editPos && editPos.di === di && editPos.ei === ei) ? (
                      <div key={ei} className="bg-slate-50 rounded-md p-2 space-y-1.5">
                        <div className="flex items-center gap-1.5">
                          <input value={exDraft.name} onChange={(ev) => setExDraft({ ...exDraft, name: ev.target.value })} placeholder="Exercise name"
                            className="flex-1 min-w-0 px-2 py-1 rounded border border-slate-200 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-400" />
                          <select value={exDraft.type} onChange={(ev) => setExDraft({ ...exDraft, type: ev.target.value })}
                            className="px-1.5 py-1 rounded border border-slate-200 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-emerald-400">
                            <option value="strength">Str</option><option value="cardio">Cardio</option>
                          </select>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <input value={exDraft.sets} onChange={(ev) => setExDraft({ ...exDraft, sets: ev.target.value })} placeholder="sets" inputMode="numeric"
                            className="w-12 px-2 py-1 rounded border border-slate-200 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-400" />
                          <span className="text-xs text-slate-400">×</span>
                          <input value={exDraft.reps} onChange={(ev) => setExDraft({ ...exDraft, reps: ev.target.value })} placeholder="reps"
                            className="w-14 px-2 py-1 rounded border border-slate-200 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-400" />
                          <input value={exDraft.weight} onChange={(ev) => setExDraft({ ...exDraft, weight: ev.target.value })} placeholder={exDraft.type === "cardio" ? "dur/dist" : "weight (opt)"}
                            className="flex-1 min-w-0 px-2 py-1 rounded border border-slate-200 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-400" />
                        </div>
                        <div className="flex justify-end gap-1.5">
                          <button onClick={cancelEx} className="text-[11px] px-2 py-1 rounded bg-slate-100 text-slate-600 hover:bg-slate-200 transition">Cancel</button>
                          <button onClick={saveEx} className="text-[11px] px-2 py-1 rounded bg-emerald-500 text-white hover:bg-emerald-600 transition">Save</button>
                        </div>
                      </div>
                    ) : (
                      <div key={ei} className="text-xs text-slate-500 flex items-center gap-2">
                        <span className="truncate flex-1">{e.name}</span>
                        <span className="text-slate-400 shrink-0">{[e.sets && `${e.sets}×${e.reps || "—"}`, e.weight].filter(Boolean).join(" · ")}</span>
                        <button onClick={() => startEditEx(di, ei)} className="text-slate-300 hover:text-emerald-600 transition shrink-0"><Pencil size={12} /></button>
                        <button onClick={() => removeEx(di, ei)} className="text-slate-300 hover:text-red-500 transition shrink-0"><Trash2 size={12} /></button>
                      </div>
                    )
                  ))}
                </div>
                <button onClick={() => addEx(di)} className="mt-1.5 text-[11px] text-emerald-700 hover:underline flex items-center gap-1"><Plus size={11} /> Add exercise</button>
              </div>
            ))}
            {customized && (
              <button onClick={() => onReset(p.id)} className="text-[11px] text-slate-400 hover:text-red-500 underline">Reset &ldquo;{p.name}&rdquo; to default</button>
            )}
          </div>
        )}
        {active && (
          <button onClick={goToWorkouts} className="mt-3 w-full text-sm text-emerald-700 bg-emerald-50 hover:bg-emerald-100 py-2 rounded-lg transition flex items-center justify-center gap-1 font-medium">
            Log a session <ChevronRight size={15} />
          </button>
        )}
      </div>
    </div>
  );
}

// =================== WORKOUTS ===================
function WorkoutsTab({ workouts, update, program, goToPrograms, customExercises, addCustomExercise }) {
  const blank = { name: "", type: "strength", sets: [blankSet()], date: todayStr(), notes: "" };
  const [form, setForm] = useState(blank);
  const [sessionDate, setSessionDate] = useState(todayStr());
  const [session, setSession] = useState(null);
  const [editNameId, setEditNameId] = useState(null);
  const [confirmLog, setConfirmLog] = useState(false);

  const mergedLibrary = Array.from(new Set([...STRENGTH_EXERCISES, ...CARDIO_EXERCISES, ...customExercises])).sort((a, b) => a.localeCompare(b));

  const updFormSet = (i, f, v) => setForm((s) => ({ ...s, sets: s.sets.map((x, idx) => idx === i ? { ...x, [f]: v } : x) }));
  const addFormSet = () => setForm((s) => ({ ...s, sets: [...s.sets, blankSet()] }));
  const removeFormSet = (i) => setForm((s) => ({ ...s, sets: s.sets.length > 1 ? s.sets.filter((_, idx) => idx !== i) : s.sets }));

  const addExercise = () => {
    if (!form.name.trim()) return;
    const sets = cleanSets(form.sets);
    const ex = { id: uid(), name: form.name.trim(), type: form.type, sets: sets.length ? sets : [blankSet()], notes: (form.notes || "").trim() };
    const day = workouts[form.date] ? [...workouts[form.date]] : [];
    day.push(ex);
    update({ ...workouts, [form.date]: day });
    setForm({ ...blank, sets: [blankSet()], date: form.date, type: form.type });
  };

  const removeExercise = (date, id) => {
    const day = workouts[date].filter((e) => e.id !== id);
    const next = { ...workouts };
    if (day.length) next[date] = day; else delete next[date];
    update(next);
  };
  const removeDay = (date) => { const next = { ...workouts }; delete next[date]; update(next); };
  const updateExercise = (date, id, patch) => { const day = workouts[date].map((e) => e.id === id ? { ...e, ...patch } : e); update({ ...workouts, [date]: day }); };
  const replaceDay = (date, list) => { const next = { ...workouts }; if (list.length) next[date] = list; else delete next[date]; update(next); };

  const loadSession = async (day) => {
    setConfirmLog(false);
    let src = day.exercises;
    if (program) {
      const ov = await loadKey("programOverrides", {});
      const days = ov[program.id] || program.days;
      const real = days.find((d) => d.name === day.name);
      if (real) src = real.exercises;
    }
    setSession({
      dayName: day.name,
      exercises: src.map((e) => {
        const last = lastEntryFor(workouts, e.name);
        const count = Math.max(1, parseInt(e.sets) || 1);
        let weight = e.weight || "", reps = e.reps || "", hint = null;
        if (last && e.type !== "cardio") {
          const sug = suggestProgression(last, parseInt(e.reps) || null);
          if (sug) { if (sug.weight !== undefined) weight = sug.weight; if (sug.reps) reps = sug.reps; hint = sug.note; }
        }
        const sets = Array.from({ length: count }, () => ({ reps, weight, rpe: "" }));
        return { id: uid(), name: e.name, type: e.type, sets, notes: "", last: last ? formatLast(last) : null, hint };
      }),
    });
  };
  const updSessionSet = (exId, i, f, v) => setSession((s) => ({ ...s, exercises: s.exercises.map((e) => e.id === exId ? { ...e, sets: e.sets.map((x, idx) => idx === i ? { ...x, [f]: v } : x) } : e) }));
  const updSessionField = (exId, field, val) => setSession((s) => ({ ...s, exercises: s.exercises.map((e) => {
    if (e.id !== exId) return e;
    const upd = { ...e, [field]: val };
    if (field === "name") { const last = lastEntryFor(workouts, val); upd.last = last ? formatLast(last) : null; upd.hint = null; }
    return upd;
  }) }));
  const addSessionSet = (exId) => setSession((s) => ({ ...s, exercises: s.exercises.map((e) => e.id === exId ? { ...e, sets: [...e.sets, blankSet()] } : e) }));
  const removeSessionSet = (exId, i) => setSession((s) => ({ ...s, exercises: s.exercises.map((e) => e.id === exId ? { ...e, sets: e.sets.length > 1 ? e.sets.filter((_, idx) => idx !== i) : e.sets } : e) }));
  const removeSessionEx = (id) => setSession((s) => ({ ...s, exercises: s.exercises.filter((e) => e.id !== id) }));
  const logSession = () => {
    if (!session || session.exercises.length === 0) return;
    const day = workouts[sessionDate] ? [...workouts[sessionDate]] : [];
    session.exercises.forEach((e) => { const sets = cleanSets(e.sets); day.push({ id: uid(), name: e.name.trim(), type: e.type, sets: sets.length ? sets : [blankSet()], notes: (e.notes || "").trim() }); });
    update({ ...workouts, [sessionDate]: day });
    setSession(null);
  };

  const dates = Object.keys(workouts).sort((a, b) => b.localeCompare(a));

  return (
    <div className="space-y-6">
      {program ? (
        <div className="bg-white rounded-xl p-4 shadow-sm border border-emerald-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-700"><Zap size={16} className="text-emerald-500" /> {program.name}</div>
            <span className="text-[11px] text-slate-400">Active program</span>
          </div>
          {!session && (
            <>
              <p className="text-xs text-slate-500 mt-2 mb-2">Tap a day to load its exercises:</p>
              <div className="flex flex-wrap gap-2">
                {program.days.map((d) => (
                  <button key={d.name} onClick={() => loadSession(d)}
                    className="text-sm bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-medium px-3 py-2 rounded-lg transition">{d.name}</button>
                ))}
              </div>
            </>
          )}
          {session && (
            <div className="mt-3 border-t border-slate-100 pt-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-slate-700">{session.dayName} — fill in your sets</span>
                <button onClick={() => setSession(null)} className="text-slate-400 hover:text-red-500"><X size={16} /></button>
              </div>
              <div className="space-y-3">
                {session.exercises.map((e) => (
                  <div key={e.id} className="bg-slate-50 rounded-lg p-2.5">
                    <div className="flex items-center gap-2 mb-1.5">
                      {editNameId === e.id ? (
                        <div className="flex-1 min-w-0 flex items-center gap-1.5">
                          <div className="flex-1 min-w-0">
                            <ExerciseAutocomplete value={e.name}
                              onChange={(v) => updSessionField(e.id, "name", v)}
                              onPickType={(t) => { updSessionField(e.id, "type", t); setEditNameId(null); }}
                              library={mergedLibrary} cardioSet={CARDIO_SET} onAddCustom={addCustomExercise} />
                          </div>
                          <button onClick={() => setEditNameId(null)} className="text-emerald-600 hover:text-emerald-700 shrink-0"><Check size={15} /></button>
                        </div>
                      ) : (
                        <>
                          <span className="text-sm font-medium text-slate-700 flex-1 min-w-0 truncate">{e.name}</span>
                          <button onClick={() => setEditNameId(e.id)} className="text-slate-300 hover:text-emerald-600 transition shrink-0"><Pencil size={14} /></button>
                        </>
                      )}
                      <button onClick={() => removeSessionEx(e.id)} className="text-slate-300 hover:text-red-500 transition shrink-0"><Trash2 size={14} /></button>
                    </div>
                    {e.last ? (
                      <div className="text-[11px] mb-2 flex items-center gap-1.5 flex-wrap">
                        <span className="text-slate-400">Last: {e.last}</span>
                        {e.hint && <span className="text-emerald-600 font-medium bg-emerald-50 px-1.5 py-0.5 rounded">→ {e.hint}</span>}
                      </div>
                    ) : <div className="text-[11px] text-slate-300 mb-2">No history yet — set a baseline</div>}
                    <SetRows sets={e.sets} type={e.type} onUpdate={(i, f, v) => updSessionSet(e.id, i, f, v)} onAdd={() => addSessionSet(e.id)} onRemove={(i) => removeSessionSet(e.id, i)} />
                    <input value={e.notes || ""} onChange={(ev) => updSessionField(e.id, "notes", ev.target.value)} placeholder="Note (optional)"
                      className="w-full mt-2 px-2 py-1.5 rounded-md border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400" />
                  </div>
                ))}
              </div>
              {!confirmLog ? (
                <div className="flex gap-2 mt-3 items-center">
                  <input type="date" value={sessionDate} onChange={(ev) => setSessionDate(ev.target.value)}
                    className="px-2 py-2 rounded-lg border border-slate-200 text-sm text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-400" />
                  <button onClick={() => setSession(null)} className="px-4 py-2 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 font-medium transition">Cancel</button>
                  <button onClick={() => setConfirmLog(true)} className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white font-medium py-2 rounded-lg transition flex items-center justify-center gap-1">
                    <Check size={16} /> Log {session.dayName}
                  </button>
                </div>
              ) : (
                <div className="mt-3 bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                  <p className="text-sm text-slate-700 mb-2">Log <b>{session.dayName}</b> to {fmtDate(sessionDate)}?</p>
                  <div className="flex gap-2">
                    <button onClick={() => setConfirmLog(false)} className="flex-1 bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 font-medium py-2 rounded-lg transition">Cancel</button>
                    <button onClick={() => { logSession(); setConfirmLog(false); }} className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white font-medium py-2 rounded-lg transition flex items-center justify-center gap-1"><Check size={16} /> Confirm</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
       null
      )}

      <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200">
        <div className="flex items-center gap-2 mb-3 text-slate-700 font-semibold text-sm"><Plus size={16} /> Add single exercise</div>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div className="col-span-2 sm:col-span-1">
            <label className="text-xs text-slate-500">Exercise name</label>
            <ExerciseAutocomplete value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} onPickType={(t) => setForm((f) => ({ ...f, type: t }))}
              library={mergedLibrary} cardioSet={CARDIO_SET} onAddCustom={addCustomExercise} />
            {(() => { const l = form.name.trim() ? lastEntryFor(workouts, form.name) : null; return l ? <p className="text-[11px] text-emerald-600 mt-1">Last: {formatLast(l)}</p> : null; })()}
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label className="text-xs text-slate-500">Type</label>
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}
              className="w-full mt-1 px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-400">
              <option value="strength">Strength</option><option value="cardio">Cardio</option>
            </select>
          </div>
        </div>
        <label className="text-xs text-slate-500">Sets</label>
        <div className="mt-1.5">
          <SetRows sets={form.sets} type={form.type} onUpdate={updFormSet} onAdd={addFormSet} onRemove={removeFormSet} />
        </div>
        <div className="mt-3">
          <label className="text-xs text-slate-500 flex items-center gap-1"><StickyNote size={12} /> Note <span className="text-slate-300 lowercase">(optional)</span></label>
          <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="How it felt, form cues, tweaks for next time…"
            className="w-full mt-1 px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
        </div>
        <div className="mt-3">
          <label className="text-xs text-slate-500 flex items-center gap-1"><Calendar size={12} /> Date</label>
          <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })}
            className="w-full mt-1 px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
        </div>
        <button onClick={addExercise} className="mt-4 w-full bg-slate-800 hover:bg-slate-900 text-white font-medium py-2.5 rounded-lg transition flex items-center justify-center gap-2">
          <Plus size={16} /> Add to log
        </button>
      </div>

      {dates.length === 0 && <div className="text-center text-slate-400 py-10 text-sm">No workouts logged yet.</div>}
      {dates.map((date) => (
        <DayCard key={date} date={date} exercises={workouts[date]} onRemove={removeExercise} onRemoveDay={removeDay} onUpdate={updateExercise} onReplaceDay={replaceDay} />
      ))}
    </div>
  );
}

function DayCard({ date, exercises, onRemove, onRemoveDay, onUpdate, onReplaceDay }) {
  const [confirmId, setConfirmId] = useState(null);
  const [confirmDay, setConfirmDay] = useState(false);
  const [editId, setEditId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [sessionEdit, setSessionEdit] = useState(false);
  const [sessionDraft, setSessionDraft] = useState(null);

  const startEdit = (e) => { setConfirmId(null); setEditId(e.id); setDraft({ name: e.name, type: e.type || "strength", notes: e.notes || "", sets: (e.sets || [blankSet()]).map((s) => ({ ...s })) }); };
  const updDraftSet = (i, f, v) => setDraft((d) => ({ ...d, sets: d.sets.map((s, idx) => idx === i ? { ...s, [f]: v } : s) }));
  const addDraftSet = () => setDraft((d) => ({ ...d, sets: [...d.sets, blankSet()] }));
  const removeDraftSet = (i) => setDraft((d) => ({ ...d, sets: d.sets.length > 1 ? d.sets.filter((_, idx) => idx !== i) : d.sets }));
  const saveEdit = () => {
    const sets = cleanSets(draft.sets);
    onUpdate(date, editId, { name: draft.name.trim() || draft.name, type: draft.type, notes: (draft.notes || "").trim(), sets: sets.length ? sets : [blankSet()] });
    setEditId(null); setDraft(null);
  };

  const startSessionEdit = () => { setConfirmId(null); setConfirmDay(false); setEditId(null); setSessionDraft(exercises.map((e) => ({ ...e, sets: (e.sets || []).map((s) => ({ ...s })) }))); setSessionEdit(true); };
  const updRow = (id, f, v) => setSessionDraft((d) => d.map((r) => r.id === id ? { ...r, [f]: v } : r));
  const updRowSet = (id, i, f, v) => setSessionDraft((d) => d.map((r) => r.id === id ? { ...r, sets: r.sets.map((s, idx) => idx === i ? { ...s, [f]: v } : s) } : r));
  const addRowSet = (id) => setSessionDraft((d) => d.map((r) => r.id === id ? { ...r, sets: [...r.sets, blankSet()] } : r));
  const removeRowSet = (id, i) => setSessionDraft((d) => d.map((r) => r.id === id ? { ...r, sets: r.sets.length > 1 ? r.sets.filter((_, idx) => idx !== i) : r.sets } : r));
  const removeRow = (id) => setSessionDraft((d) => d.filter((r) => r.id !== id));
  const addRow = () => setSessionDraft((d) => [...d, { id: uid(), name: "", type: "strength", notes: "", sets: [blankSet()] }]);
  const saveSession = () => {
    const cleaned = sessionDraft.map((e) => ({ ...e, name: (e.name || "").trim(), sets: cleanSets(e.sets).length ? cleanSets(e.sets) : [blankSet()] })).filter((e) => e.name !== "");
    onReplaceDay(date, cleaned); setSessionEdit(false); setSessionDraft(null);
  };

  const allSets = exercises.reduce((a, e) => a + (e.sets ? e.sets.length : 0), 0);
  const rpes = exercises.flatMap((e) => (e.sets || []).map((s) => parseFloat(s.rpe))).filter((n) => !isNaN(n));
  const avgRpe = rpes.length ? (rpes.reduce((a, b) => a + b, 0) / rpes.length).toFixed(1) : "—";
  const volume = exercises.reduce((a, e) => a + exVolume(e), 0);

  if (sessionEdit && sessionDraft) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-emerald-300 overflow-hidden">
        <div className="px-4 py-3 bg-slate-800 text-white flex items-center justify-between gap-3">
          <span className="font-semibold text-sm">{fmtDate(date)} · editing</span>
          <div className="flex items-center gap-1.5">
            <button onClick={() => { setSessionEdit(false); setSessionDraft(null); }} className="text-xs px-2 py-1 rounded-md bg-slate-700 text-slate-200 hover:bg-slate-600 transition">Cancel</button>
            <button onClick={saveSession} className="text-xs px-2 py-1 rounded-md bg-emerald-500 text-white hover:bg-emerald-600 transition flex items-center gap-1"><Check size={13} /> Save session</button>
          </div>
        </div>
        <div className="p-3 space-y-2">
          {sessionDraft.map((e) => (
            <div key={e.id} className="bg-slate-50 rounded-lg p-2.5">
              <div className="flex items-center gap-2 mb-2">
                <span className={`shrink-0 w-1.5 h-6 rounded-full ${e.type === "cardio" ? "bg-sky-400" : "bg-emerald-400"}`} />
                <input value={e.name} onChange={(ev) => updRow(e.id, "name", ev.target.value)} placeholder="Exercise name"
                  className="flex-1 min-w-0 px-2 py-1.5 rounded-md border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
                <select value={e.type} onChange={(ev) => updRow(e.id, "type", ev.target.value)}
                  className="px-2 py-1.5 rounded-md border border-slate-200 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-emerald-400">
                  <option value="strength">Strength</option><option value="cardio">Cardio</option>
                </select>
                <button onClick={() => removeRow(e.id)} className="text-slate-300 hover:text-red-500 transition shrink-0"><Trash2 size={14} /></button>
              </div>
              <SetRows sets={e.sets} type={e.type} onUpdate={(i, f, v) => updRowSet(e.id, i, f, v)} onAdd={() => addRowSet(e.id)} onRemove={(i) => removeRowSet(e.id, i)} />
              <input value={e.notes || ""} onChange={(ev) => updRow(e.id, "notes", ev.target.value)} placeholder="Note (optional)"
                className="w-full mt-2 px-2 py-1.5 rounded-md border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400" />
            </div>
          ))}
          <button onClick={addRow} className="w-full text-sm text-emerald-700 bg-emerald-50 hover:bg-emerald-100 py-2 rounded-lg transition flex items-center justify-center gap-1"><Plus size={15} /> Add exercise</button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="px-4 py-3 bg-slate-800 text-white flex items-center justify-between gap-3">
        <span className="font-semibold text-sm">{fmtDate(date)}</span>
        <div className="flex items-center gap-3">
          {!confirmDay && (
            <div className="flex gap-3 text-xs text-slate-300">
              <span>{exercises.length} ex</span>
              <span>{allSets} sets</span>
              <span>avg RPE {avgRpe}</span>
              {volume > 0 && <span>vol {volume.toLocaleString()}</span>}
            </div>
          )}
          {confirmDay ? (
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-slate-400 hidden sm:inline">Delete whole session?</span>
              <button onClick={() => setConfirmDay(false)} className="text-xs px-2 py-1 rounded-md bg-slate-700 text-slate-200 hover:bg-slate-600 transition">Cancel</button>
              <button onClick={() => onRemoveDay(date)} className="text-xs px-2 py-1 rounded-md bg-red-500 text-white hover:bg-red-600 transition">Delete</button>
            </div>
          ) : (
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={startSessionEdit} className="text-[11px] text-slate-300 hover:text-white transition">Edit</button>
              <button onClick={() => setConfirmDay(true)} className="text-slate-400 hover:text-red-400 transition"><Trash2 size={15} /></button>
            </div>
          )}
        </div>
      </div>
      <div className="divide-y divide-slate-100">
        {exercises.map((e) => (
          <div key={e.id}>
            {editId === e.id ? (
              <div className="px-4 py-3 bg-slate-50">
                <div className="flex items-center gap-2 mb-2">
                  <span className={`shrink-0 w-1.5 h-6 rounded-full ${draft.type === "cardio" ? "bg-sky-400" : "bg-emerald-400"}`} />
                  <input value={draft.name} onChange={(ev) => setDraft({ ...draft, name: ev.target.value })}
                    className="flex-1 min-w-0 px-2 py-1.5 rounded-md border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
                  <select value={draft.type} onChange={(ev) => setDraft({ ...draft, type: ev.target.value })}
                    className="px-2 py-1.5 rounded-md border border-slate-200 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-emerald-400">
                    <option value="strength">Strength</option><option value="cardio">Cardio</option>
                  </select>
                </div>
                <SetRows sets={draft.sets} type={draft.type} onUpdate={updDraftSet} onAdd={addDraftSet} onRemove={removeDraftSet} />
                <input value={draft.notes || ""} onChange={(ev) => setDraft({ ...draft, notes: ev.target.value })} placeholder="Note (optional)"
                  className="w-full mt-2 px-2 py-1.5 rounded-md border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                <div className="flex gap-2 mt-2 justify-end">
                  <button onClick={() => { setEditId(null); setDraft(null); }} className="text-xs px-3 py-1.5 rounded-md bg-slate-100 text-slate-600 hover:bg-slate-200 transition">Cancel</button>
                  <button onClick={saveEdit} className="text-xs px-3 py-1.5 rounded-md bg-emerald-500 text-white hover:bg-emerald-600 transition flex items-center gap-1"><Check size={13} /> Save</button>
                </div>
              </div>
            ) : (
              <div className="px-4 py-3 flex items-start gap-3">
                <span className={`shrink-0 w-1.5 h-8 rounded-full mt-0.5 ${e.type === "cardio" ? "bg-sky-400" : "bg-emerald-400"}`} />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm text-slate-800 flex items-center gap-2">
                    {e.name}
                    <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${e.type === "cardio" ? "bg-sky-100 text-sky-600" : "bg-emerald-100 text-emerald-600"}`}>{e.type}</span>
                  </div>
                  <div className="mt-1 space-y-0.5">
                    {(e.sets || []).map((s, i) => (
                      <div key={i} className="text-xs text-slate-500 flex gap-2">
                        <span className="text-slate-400 w-9 shrink-0">Set {i + 1}</span>
                        <span>{[s.reps && `${s.reps} reps`, s.weight && (e.type === "cardio" ? s.weight : `@ ${s.weight}`), s.rpe && `RPE ${s.rpe}`].filter(Boolean).join(" · ") || "—"}</span>
                      </div>
                    ))}
                  </div>
                  {e.type === "strength" && exVolume(e) > 0 && (
                    <div className="text-[11px] text-slate-400 mt-1">Volume: <span className="font-semibold text-slate-600">{exVolume(e).toLocaleString()}</span></div>
                  )}
                  {(e.notes || "").trim() && (
                    <div className="mt-1.5 text-xs text-slate-600 bg-amber-50 border border-amber-100 rounded-md px-2 py-1 flex items-start gap-1.5">
                      <StickyNote size={12} className="text-amber-500 mt-0.5 shrink-0" />
                      <span className="whitespace-pre-wrap">{e.notes}</span>
                    </div>
                  )}
                </div>
                {confirmId === e.id ? (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-[11px] text-slate-400 hidden sm:inline">Delete?</span>
                    <button onClick={() => setConfirmId(null)} className="text-xs px-2 py-1 rounded-md bg-slate-100 text-slate-600 hover:bg-slate-200 transition">Cancel</button>
                    <button onClick={() => { onRemove(date, e.id); setConfirmId(null); }} className="text-xs px-2 py-1 rounded-md bg-red-500 text-white hover:bg-red-600 transition">Delete</button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => startEdit(e)} className="text-[11px] text-slate-400 hover:text-emerald-600 transition">Edit</button>
                    <button onClick={() => setConfirmId(e.id)} className="text-slate-300 hover:text-red-500 transition"><Trash2 size={16} /></button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// =================== GOALS ===================
function GoalsTab({ goals, update }) {
  return (
    <div className="grid sm:grid-cols-2 gap-4">
      <GoalColumn title="Short-term" accent="green" term="short" goals={goals} update={update} />
      <GoalColumn title="Long-term" accent="yellow" term="long" goals={goals} update={update} />
    </div>
  );
}

function GoalColumn({ title, accent, term, goals, update }) {
  const [text, setText] = useState("");
  const [target, setTarget] = useState("");
  const list = goals[term] || [];
  const accents = {
    green: { bar: "bg-green-400", btn: "bg-green-500 hover:bg-green-600", ring: "focus:ring-green-400", chip: "text-green-600" },
    yellow: { bar: "bg-yellow-400", btn: "bg-yellow-500 hover:bg-yellow-600", ring: "focus:ring-yellow-400", chip: "text-yellow-600" },
  }[accent];
  const add = () => { if (!text.trim()) return; update({ ...goals, [term]: [...list, { id: uid(), text: text.trim(), target, done: false }] }); setText(""); setTarget(""); };
  const toggle = (id) => update({ ...goals, [term]: list.map((g) => g.id === id ? { ...g, done: !g.done } : g) });
  const remove = (id) => update({ ...goals, [term]: list.filter((g) => g.id !== id) });
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      <div className={`h-1.5 ${accents.bar}`} />
      <div className="p-4">
        <h3 className="font-semibold text-slate-800 flex items-center gap-2 mb-3"><Flag size={16} className={accents.chip} /> {title}</h3>
        <div className="space-y-2 mb-3">
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="What's the goal?"
            className={`w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 ${accents.ring}`} />
          <div className="flex gap-2">
            <input type="date" value={target} onChange={(e) => setTarget(e.target.value)}
              className={`flex-1 px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-500 focus:outline-none focus:ring-2 ${accents.ring}`} />
            <button onClick={add} className={`${accents.btn} text-white px-4 rounded-lg transition`}><Plus size={16} /></button>
          </div>
        </div>
        <div className="space-y-2">
          {list.length === 0 && <p className="text-xs text-slate-400 py-2">No goals yet.</p>}
          {list.map((g) => (
            <div key={g.id} className="flex items-start gap-2 group">
              <button onClick={() => toggle(g.id)}
                className={`mt-0.5 shrink-0 w-5 h-5 rounded-md border flex items-center justify-center transition ${g.done ? "bg-emerald-500 border-emerald-500 text-white" : "border-slate-300 hover:border-emerald-400"}`}>
                {g.done && <Check size={13} />}
              </button>
              <div className="flex-1 min-w-0">
                <p className={`text-sm ${g.done ? "line-through text-slate-400" : "text-slate-700"}`}>{g.text}</p>
                {g.target && <p className="text-[11px] text-slate-400 flex items-center gap-1"><Calendar size={10} /> {fmtDate(g.target)}</p>}
              </div>
              <button onClick={() => remove(g.id)} className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition"><X size={15} /></button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// =================== CALENDAR ===================
function CalendarTab({ plan, updatePlan, workouts, updateWorkouts, goToWorkouts, planHistory, updateHistory }) {
  const dpwDefault = (id) => sessionsPerWeek(PROGRAMS.find((p) => p.id === id) || PROGRAMS[0]);
  const [progId, setProgId] = useState((plan && plan.programId) || PROGRAMS[0].id);
  const [weeks, setWeeks] = useState((plan && plan.weeks) || 8);
  const [daysPerWeek, setDaysPerWeek] = useState((plan && plan.daysPerWeek) || dpwDefault((plan && plan.programId) || PROGRAMS[0].id));
  const [startDate, setStartDate] = useState(todayStr());
  const [showNew, setShowNew] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const summarize = (pl) => {
    const allS = pl.weeksArr.flatMap((w) => w.sessions);
    const done = allS.filter((s) => s.done).length;
    const dates = allS.map((s) => s.scheduledDate).sort();
    const firstSched = dates[0] || pl.startDate;
    const lastSched = dates[dates.length - 1] || pl.startDate;
    const winStart = (pl.startDate && pl.startDate < firstSched) ? pl.startDate : firstSched;
    const winEnd = addDays(lastSched, 6); // count sessions completed up to a few days late
    let vol = 0;
    Object.entries(workouts).forEach(([d, list]) => { if (d >= winStart && d <= winEnd) (list || []).forEach((e) => { vol += exVolume(e); }); });
    return { id: pl.id, programName: pl.programName, model: pl.model, weeks: pl.weeks, startDate: winStart, endDate: lastSched, sessionsDone: done, sessionsTotal: allS.length, volume: Math.round(vol), archivedAt: Date.now() };
  };
  const finishPlan = () => { updateHistory([summarize(plan), ...planHistory]); updatePlan(null); };

  const generate = () => {
    const program = PROGRAMS.find((p) => p.id === progId);
    if (!program) return;
    if (plan) updateHistory([summarize(plan), ...planHistory]); // archive the current plan, don't lose it
    updatePlan(buildPlan(program, weeks, startDate, daysPerWeek));
    setShowNew(false);
  };
  const setDone = (weekNum, sid, val) => {
    updatePlan({ ...plan, weeksArr: plan.weeksArr.map((wk) => wk.weekNum !== weekNum ? wk : { ...wk, sessions: wk.sessions.map((s) => s.id === sid ? { ...s, done: val } : s) }) });
  };
  const toggle = (weekNum, sid) => {
    const s = plan.weeksArr.find((w) => w.weekNum === weekNum).sessions.find((x) => x.id === sid);
    setDone(weekNum, sid, !s.done);
  };
  const logSession = (week, session) => {
    if (session.done) { goToWorkouts(); return; } // already logged — open it instead of duplicating
    let exs;
    if (plan.model === "runwalk") {
      exs = [{ id: uid(), name: "Run / Walk", type: "cardio", sets: [{ reps: "", weight: "", rpe: "" }], notes: session.directive || week.directive }];
    } else {
      exs = session.exercises.map((e) => {
        const targetReps = parseInt(e.reps); // low end of a range, or the plain number
        let reps = Number.isFinite(targetReps) ? String(targetReps) : "";
        let weight = "";
        const last = e.type !== "cardio" ? lastEntryFor(workouts, e.name) : null;
        if (last) {
          const sug = suggestProgression(last, Number.isFinite(targetReps) ? targetReps : null);
          if (sug) { if (sug.weight !== undefined) weight = sug.weight; if (sug.reps) reps = sug.reps; }
        }
        const bits = [`${week.phase}${week.deload ? " · deload" : ""}`];
        if (e.reps && /[–-]/.test(String(e.reps))) bits.push(`target ${e.reps} reps`);
        if (e.rpe) bits.push(`RPE ${e.rpe}`);
        return {
          id: uid(), name: e.name, type: e.type,
          sets: Array.from({ length: Math.max(1, e.sets) }, () => ({ reps, weight, rpe: "" })),
          notes: bits.join(" · "),
        };
      });
    }
    const date = session.scheduledDate;
    const day = workouts[date] ? [...workouts[date], ...exs] : exs;
    updateWorkouts({ ...workouts, [date]: day });
    setDone(week.weekNum, session.id, true);
    goToWorkouts();
  };

  const builder = (
    <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200 space-y-3">
      <div className="flex items-center gap-2 text-slate-700 font-semibold text-sm"><Calendar size={16} className="text-emerald-500" /> {plan ? "Start a different plan" : "Build a periodized plan"}</div>
      <div>
        <label className="text-xs text-slate-500">Program</label>
        <select value={progId} onChange={(e) => { setProgId(e.target.value); setDaysPerWeek(dpwDefault(e.target.value)); }} className="w-full mt-1 px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-400">
          {PROGRAMS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <p className="text-[11px] text-slate-400 mt-1">{MODEL_LABEL[PROGRAM_MODELS[progId] || "linear"]}</p>
      </div>
      <div>
        <label className="text-xs text-slate-500">Commitment</label>
        <div className="flex gap-1 mt-1 bg-slate-100 rounded-lg p-1">
          {[4, 8, 12].map((w) => (
            <button key={w} onClick={() => setWeeks(w)} className={`flex-1 py-1.5 rounded-md text-xs font-medium transition ${weeks === w ? "bg-white shadow text-slate-800" : "text-slate-500"}`}>{w} wk</button>
          ))}
        </div>
      </div>
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <label className="text-xs text-slate-500">Days / week</label>
          <select value={daysPerWeek} onChange={(e) => setDaysPerWeek(parseInt(e.target.value))} className="w-full mt-1 px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-400">
            {[2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n} days</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-slate-500 flex items-center gap-1"><Calendar size={12} /> Start</label>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="mt-1 px-2 py-2 rounded-lg border border-slate-200 text-sm text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-400" />
        </div>
      </div>
      <button onClick={generate} className="w-full bg-emerald-500 hover:bg-emerald-600 text-white font-medium py-2.5 rounded-lg transition flex items-center justify-center gap-1"><Zap size={16} /> Generate {weeks}-week plan</button>
    </div>
  );

  const pastPlansBlock = planHistory.length > 0 ? (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2"><Award size={15} className="text-amber-500" /><span className="text-sm font-semibold text-slate-700">Past plans</span><span className="text-[11px] text-slate-400">{planHistory.length}</span></div>
      <div className="divide-y divide-slate-100">
        {planHistory.map((h) => (
          <div key={h.id} className="px-4 py-3 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2"><span className="text-sm font-medium text-slate-800 truncate">{h.programName}</span><span className="text-[10px] uppercase tracking-wide bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded shrink-0">{h.weeks} wk</span></div>
              <p className="text-[11px] text-slate-400 mt-0.5">{fmtDate(h.startDate)} – {fmtDate(h.endDate)} · {h.sessionsDone}/{h.sessionsTotal} sessions{h.volume > 0 ? ` · ${h.volume.toLocaleString()} vol` : ""}</p>
            </div>
            <button onClick={() => updateHistory(planHistory.filter((x) => x.id !== h.id))} className="text-slate-300 hover:text-red-500 transition shrink-0"><Trash2 size={15} /></button>
          </div>
        ))}
      </div>
    </div>
  ) : null;

  if (!plan) {
    return (
      <div className="space-y-4">
        {builder}
        <p className="text-xs text-slate-400 text-center px-4">Your plan lays the program across the weeks with a progressive-overload RPE ramp and a deload every 4th week, then schedules sessions you can check off and log.</p>
        {pastPlansBlock}
      </div>
    );
  }

  const allSessions = plan.weeksArr.flatMap((w) => w.sessions);
  const doneCount = allSessions.filter((s) => s.done).length;
  const pct = allSessions.length ? Math.round((doneCount / allSessions.length) * 100) : 0;
  const today = todayStr();
  const current = plan.weeksArr.find((w) => w.sessions.some((s) => s.scheduledDate >= today)) || plan.weeksArr[plan.weeksArr.length - 1];

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2"><Zap size={16} className="text-emerald-500 shrink-0" /><span className="font-bold text-slate-800 truncate">{plan.programName}</span></div>
            <p className="text-[11px] text-slate-500 mt-0.5">{plan.weeks}-week plan · {MODEL_LABEL[plan.model]}</p>
          </div>
          {confirmClear ? (
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-[11px] text-slate-400 hidden sm:inline">Discard schedule?</span>
              <button onClick={() => setConfirmClear(false)} className="text-[11px] px-2 py-1 rounded bg-slate-100 text-slate-600 hover:bg-slate-200 transition">Cancel</button>
              <button onClick={() => { updatePlan(null); setConfirmClear(false); }} className="text-[11px] px-2 py-1 rounded bg-red-500 text-white hover:bg-red-600 transition">Discard</button>
            </div>
          ) : (
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={finishPlan} className="text-[11px] px-2 py-1 rounded bg-emerald-500 text-white hover:bg-emerald-600 transition">Finish &amp; archive</button>
              <button onClick={() => setConfirmClear(true)} className="text-[11px] text-slate-400 hover:text-red-500">Discard</button>
            </div>
          )}
        </div>
        <div className="mt-3">
          <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1"><span>{doneCount} / {allSessions.length} sessions done</span><span>{pct}%</span></div>
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${pct}%` }} /></div>
        </div>
      </div>

      {pct === 100 && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0"><Award size={18} className="text-emerald-500 shrink-0" /><span className="text-sm font-semibold text-emerald-800">Plan complete — every session logged.</span></div>
          <button onClick={finishPlan} className="text-xs bg-emerald-500 hover:bg-emerald-600 text-white font-medium px-3 py-1.5 rounded-lg transition shrink-0">Finish &amp; archive</button>
        </div>
      )}

      {plan.weeksArr.map((wk) => (
        <WeekCard key={wk.weekNum} week={wk} model={plan.model} isCurrent={current && wk.weekNum === current.weekNum} onToggle={toggle} onLog={logSession} />
      ))}

      {!showNew ? (
        <button onClick={() => setShowNew(true)} className="w-full bg-white rounded-xl p-3 shadow-sm border border-dashed border-slate-300 text-sm text-slate-500 hover:border-emerald-300 hover:text-emerald-600 transition flex items-center justify-center gap-2"><Plus size={15} /> Swap to a different plan</button>
      ) : builder}
      {pastPlansBlock}
    </div>
  );
}

function WeekCard({ week, model, isCurrent, onToggle, onLog }) {
  return (
    <div className={`bg-white rounded-xl shadow-sm border overflow-hidden ${isCurrent ? "border-emerald-400 ring-1 ring-emerald-300" : "border-slate-200"}`}>
      <div className="px-4 py-3 flex items-center gap-2 border-b border-slate-100 flex-wrap">
        <span className="text-sm font-bold text-slate-800">Week {week.weekNum}</span>
        <span className="text-[11px] text-slate-500 truncate">{week.phase}</span>
        {week.deload && <span className="text-[10px] uppercase tracking-wide bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full shrink-0">Deload</span>}
        {isCurrent && <span className="text-[10px] uppercase tracking-wide bg-emerald-500 text-white px-1.5 py-0.5 rounded-full shrink-0">This week</span>}
      </div>
      <div className="px-4 py-2 text-xs text-slate-600 bg-slate-50 border-b border-slate-100">{week.directive}</div>
      <div className="divide-y divide-slate-100">
        {week.sessions.map((s) => (
          <div key={s.id} className="px-4 py-3 flex items-start gap-3">
            <button onClick={() => onToggle(week.weekNum, s.id)}
              className={`mt-0.5 shrink-0 w-5 h-5 rounded-md border flex items-center justify-center transition ${s.done ? "bg-emerald-500 border-emerald-500 text-white" : "border-slate-300 hover:border-emerald-400"}`}>
              {s.done && <Check size={13} />}
            </button>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className={`text-sm font-medium ${s.done ? "text-slate-400 line-through" : "text-slate-800"}`}>{s.dayName}</span>
                <span className="text-[11px] text-slate-400 shrink-0">{fmtDate(s.scheduledDate)}</span>
              </div>
              {model !== "runwalk" ? (
                <div className="mt-1 space-y-0.5">
                  {s.exercises.map((e, i) => (
                    <div key={i} className="text-xs text-slate-500">{e.name} — {e.sets}×{e.reps || "—"}{e.rpe ? ` @ RPE ${e.rpe}` : ""}</div>
                  ))}
                </div>
              ) : (s.directive && <div className="mt-1 text-xs text-slate-500">{s.directive}</div>)}
              <button onClick={() => onLog(week, s)} className={`mt-2 text-[11px] px-2.5 py-1 rounded-md transition inline-flex items-center gap-1 ${s.done ? "text-slate-500 bg-slate-100 hover:bg-slate-200" : "text-emerald-700 bg-emerald-50 hover:bg-emerald-100"}`}>{s.done ? "Logged · open" : "Log this session"} <ChevronRight size={12} /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// =================== NOTES ===================
function NotesTab({ workouts, update, goToWorkouts }) {
  const [editing, setEditing] = useState(null); // `${date}|${id}`
  const [draft, setDraft] = useState("");

  // every logged exercise that carries a note, newest date first
  const rows = [];
  Object.keys(workouts).sort((a, b) => b.localeCompare(a)).forEach((date) => {
    (workouts[date] || []).forEach((e) => {
      if ((e.notes || "").trim()) rows.push({ date, id: e.id, name: e.name, type: e.type, notes: e.notes });
    });
  });

  const patchNote = (date, id, value) => {
    const day = (workouts[date] || []).map((e) => e.id === id ? { ...e, notes: value } : e);
    update({ ...workouts, [date]: day });
    setEditing(null); setDraft("");
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200">
        <div className="flex items-center gap-2 text-slate-700 font-semibold text-sm"><StickyNote size={16} className="text-amber-500" /> Training Notes</div>
        <p className="text-xs text-slate-500 mt-1">Every note you attach to a logged exercise lands here, newest first. Add notes as you log in the Workouts tab, or edit them inline below.</p>
      </div>

      {rows.length === 0 ? (
        <div className="text-center text-slate-400 py-10 text-sm">
          No notes yet.
          <button onClick={goToWorkouts} className="ml-1 text-emerald-600 hover:underline">Log an exercise</button> with a note and it'll collect here.
        </div>
      ) : (
        rows.map((r) => {
          const key = `${r.date}|${r.id}`;
          const isEditing = editing === key;
          return (
            <div key={key} className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="min-w-0 flex items-center gap-2">
                  <span className="text-sm font-semibold text-slate-800 truncate">{r.name}</span>
                  <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded shrink-0 ${r.type === "cardio" ? "bg-sky-100 text-sky-600" : "bg-emerald-100 text-emerald-600"}`}>{r.type}</span>
                </div>
                <span className="text-[11px] text-slate-400 shrink-0 flex items-center gap-1"><Calendar size={11} /> {fmtDate(r.date)}</span>
              </div>
              {isEditing ? (
                <div>
                  <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} autoFocus
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 resize-y" />
                  <div className="flex justify-end gap-2 mt-2">
                    <button onClick={() => patchNote(r.date, r.id, "")} className="text-[11px] px-2 py-1 rounded bg-slate-100 text-slate-500 hover:text-red-500 hover:bg-slate-200 transition">Clear note</button>
                    <button onClick={() => { setEditing(null); setDraft(""); }} className="text-[11px] px-2 py-1 rounded bg-slate-100 text-slate-600 hover:bg-slate-200 transition">Cancel</button>
                    <button onClick={() => patchNote(r.date, r.id, draft.trim())} className="text-[11px] px-2 py-1 rounded bg-emerald-500 text-white hover:bg-emerald-600 transition flex items-center gap-1"><Check size={12} /> Save</button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm text-slate-600 whitespace-pre-wrap flex-1">{r.notes}</p>
                  <button onClick={() => { setEditing(key); setDraft(r.notes); }} className="text-slate-300 hover:text-emerald-600 transition shrink-0"><Pencil size={13} /></button>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

// =================== MILESTONES ===================
function DateRange({ from, to, setFrom, setTo }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-slate-500 mt-2 flex-wrap">
      <Calendar size={12} className="text-slate-400" />
      <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="px-2 py-1 rounded border border-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-400" />
      <span>to</span>
      <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="px-2 py-1 rounded border border-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-400" />
      {(from || to) && <button onClick={() => { setFrom(""); setTo(""); }} className="text-slate-400 hover:text-red-500 underline">clear</button>}
    </div>
  );
}

function StrengthProgressCard({ workouts }) {
  const names = strengthNames(workouts);
  const [sel, setSel] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const selected = names.includes(sel) ? sel : (names[0] || "");
  const data = selected ? strengthSeries(workouts, selected, from, to) : [];
  const pr = selected ? strengthPR(workouts, selected) : null;
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="h-1.5 bg-emerald-400" />
      <div className="p-4">
        <h3 className="font-semibold text-slate-800 flex items-center gap-2"><Dumbbell size={16} className="text-emerald-500" /> Strength Progress</h3>
        {names.length === 0 ? (
          <p className="text-sm text-slate-400 mt-3">Log strength exercises with a weight and your PRs will chart here.</p>
        ) : (
          <>
            <select value={selected} onChange={(e) => setSel(e.target.value)} className="w-full mt-3 px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-400">
              {names.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-xs text-slate-400 uppercase tracking-wide">Est. 1RM</span>
              <span className="text-2xl font-bold text-slate-900">{pr ? pr.value : "—"}</span>
              {pr && pr.unit && <span className="text-sm text-slate-400">{pr.unit}</span>}
            </div>
            <div className="h-40 mt-2 -mx-1">
              {data.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data} margin={{ top: 5, right: 8, left: 8, bottom: 0 }}>
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                    <YAxis hide /><Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }} />
                    <Bar dataKey="value" fill="#10b981" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <div className="flex items-center justify-center h-full text-xs text-slate-300">No sessions in this date range</div>}
            </div>
            <p className="text-[11px] text-slate-400 mt-1">Estimated 1RM (Epley) from your best set each day — so a heavy triple and a lighter set of ten compare on one line.</p>
            <DateRange from={from} to={to} setFrom={setFrom} setTo={setTo} />
          </>
        )}
      </div>
    </div>
  );
}

function CardioProgressCard({ workouts }) {
  const names = cardioNames(workouts);
  const [sel, setSel] = useState("");
  const [metric, setMetric] = useState("time");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const selected = names.includes(sel) ? sel : (names[0] || "");
  const data = selected ? cardioSeries(workouts, selected, from, to, metric) : [];
  const unit = data.length ? data[data.length - 1].unit : (metric === "time" ? "min" : "");
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="h-1.5 bg-sky-400" />
      <div className="p-4">
        <h3 className="font-semibold text-slate-800 flex items-center gap-2"><HeartPulse size={16} className="text-sky-500" /> Cardio Progress</h3>
        {names.length === 0 ? (
          <p className="text-sm text-slate-400 mt-3">Log cardio with durations (e.g. "20 min") or distances (e.g. "2 mi") and they'll chart here.</p>
        ) : (
          <>
            <div className="flex gap-2 mt-3">
              <select value={selected} onChange={(e) => setSel(e.target.value)} className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sky-400">
                {names.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
                {["time", "distance"].map((m) => (
                  <button key={m} onClick={() => setMetric(m)} className={`px-3 py-1 rounded-md text-xs font-medium capitalize transition ${metric === m ? "bg-white shadow text-slate-800" : "text-slate-500"}`}>{m}</button>
                ))}
              </div>
            </div>
            <div className="h-40 mt-3 -mx-1">
              {data.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data} margin={{ top: 5, right: 8, left: 8, bottom: 0 }}>
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                    <YAxis hide /><Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }} formatter={(v) => [`${v} ${unit}`, metric]} />
                    <Bar dataKey="value" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-xs text-slate-300 text-center px-4">
                  No {metric} data for this selection. Try logging a {metric === "time" ? "duration like '20 min'" : "distance like '2 mi'"}.
                </div>
              )}
            </div>
            <DateRange from={from} to={to} setFrom={setFrom} setTo={setTo} />
          </>
        )}
      </div>
    </div>
  );
}

function BodyweightCard({ bodyweight, update }) {
  const [value, setValue] = useState("");
  const [date, setDate] = useState(todayStr());
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [open, setOpen] = useState(false);
  const add = () => { if (value === "" || isNaN(parseFloat(value))) return; update([...bodyweight, { date, value: parseFloat(value) }].sort((a, b) => a.date.localeCompare(b.date))); setValue(""); };
  const removeEntry = (idx) => update(bodyweight.filter((_, i) => i !== idx));
  const sorted = [...bodyweight].sort((a, b) => a.date.localeCompare(b.date));
  const filtered = sorted.filter((e) => (!from || e.date >= from) && (!to || e.date <= to));
  const data = filtered.map((e) => ({ date: e.date.slice(5), full: e.date, value: e.value }));
  const net = filtered.length > 1 ? filtered[filtered.length - 1].value - filtered[0].value : 0;
  const latest = sorted.length ? sorted[sorted.length - 1].value : null;
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="h-1.5 bg-violet-400" />
      <div className="p-4">
        <h3 className="font-semibold text-slate-800 flex items-center gap-2"><Scale size={16} className="text-violet-500" /> Bodyweight</h3>
        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-2xl font-bold text-slate-900">{latest != null ? latest : "—"}</span>
          <span className="text-sm text-slate-400">lb</span>
          {filtered.length > 1 && (
            <span className={`text-xs font-medium ${net > 0 ? "text-amber-600" : net < 0 ? "text-emerald-600" : "text-slate-400"}`}>{net > 0 ? "+" : ""}{net.toFixed(1)} lb in range</span>
          )}
        </div>
        <div className="h-40 mt-2 -mx-1">
          {data.length > 1 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 5, right: 8, left: 8, bottom: 0 }}>
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                <YAxis hide domain={["dataMin - 2", "dataMax + 2"]} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }} formatter={(v) => [`${v} lb`, "weight"]} />
                <Line type="monotone" dataKey="value" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 3, fill: "#8b5cf6" }} />
              </LineChart>
            </ResponsiveContainer>
          ) : <div className="flex items-center justify-center h-full text-xs text-slate-300">Log at least two weigh-ins to see your trend</div>}
        </div>
        <DateRange from={from} to={to} setFrom={setFrom} setTo={setTo} />
        <div className="flex gap-2 mt-3">
          <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" placeholder="Weigh-in (lb)"
            className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400" />
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
            className="px-2 py-2 rounded-lg border border-slate-200 text-sm text-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-400" />
          <button onClick={add} className="bg-violet-500 hover:bg-violet-600 text-white px-3 rounded-lg transition"><Plus size={16} /></button>
        </div>
        {sorted.length > 0 && (
          <button onClick={() => setOpen(!open)} className="mt-3 text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1">
            {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />} {sorted.length} weigh-in{sorted.length !== 1 ? "s" : ""}
          </button>
        )}
        {open && (
          <div className="mt-2 space-y-1">
            {[...sorted].reverse().map((e) => {
              const realIdx = bodyweight.findIndex((b) => b.date === e.date && b.value === e.value);
              return (
                <div key={`${e.date}-${e.value}`} className="flex items-center justify-between text-sm py-1 px-2 rounded hover:bg-slate-50 group">
                  <span className="text-slate-500">{fmtDate(e.date)}</span>
                  <div className="flex items-center gap-3">
                    <span className="font-medium text-slate-700">{e.value} lb</span>
                    <button onClick={() => removeEntry(realIdx)} className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition"><X size={14} /></button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function MilestonesTab({ milestones, update, workouts, bodyweight, updateBodyweight, planHistory }) {
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("");
  const addMetric = () => { if (!name.trim()) return; update([...milestones, { id: uid(), name: name.trim(), unit: unit.trim(), entries: [] }]); setName(""); setUnit(""); };
  const removeMetric = (id) => update(milestones.filter((m) => m.id !== id));
  const addEntry = (id, value, date) => update(milestones.map((m) => m.id === id ? { ...m, entries: [...m.entries, { date, value: parseFloat(value) }].sort((a, b) => a.date.localeCompare(b.date)) } : m));
  const removeEntry = (id, idx) => update(milestones.map((m) => m.id === id ? { ...m, entries: m.entries.filter((_, i) => i !== idx) } : m));

  const weekBucket = (d) => { const [y, m, dd] = d.split("-").map(Number); const x = new Date(y, m - 1, dd); x.setDate(x.getDate() - x.getDay()); return `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`; };
  const totalSessions = Object.keys(workouts).length;
  const weeksTrained = new Set(Object.keys(workouts).map(weekBucket)).size;
  let lifetimeVol = 0;
  Object.values(workouts).forEach((list) => (list || []).forEach((e) => { lifetimeVol += exVolume(e); }));
  const plansRun = (planHistory || []).length;
  const lifetimeStats = [["Sessions", totalSessions], ["Weeks trained", weeksTrained], ["Plans run", plansRun], ["Total volume", Math.round(lifetimeVol).toLocaleString()]];

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="h-1.5 bg-emerald-400" />
        <div className="p-4">
          <h3 className="font-semibold text-slate-800 flex items-center gap-2 mb-3"><TrendingUp size={16} className="text-emerald-500" /> Lifetime</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {lifetimeStats.map(([l, v]) => (
              <div key={l} className="bg-slate-50 rounded-lg px-3 py-2 border border-slate-100">
                <div className="text-lg font-bold text-slate-900 leading-tight">{v}</div>
                <div className="text-[10px] uppercase tracking-wide text-slate-400 mt-0.5">{l}</div>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-slate-400 mt-2">Every session you log counts here, no matter which program it came from — so your progress carries across plans.</p>
        </div>
      </div>
      <StrengthProgressCard workouts={workouts} />
      <CardioProgressCard workouts={workouts} />
      <BodyweightCard bodyweight={bodyweight} update={updateBodyweight} />
      <h3 className="text-sm font-semibold text-slate-600 px-1 pt-2">Custom milestones</h3>
      <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200">
        <div className="flex items-center gap-2 mb-3 text-slate-700 font-semibold text-sm"><Award size={16} /> Track a new milestone</div>
        <div className="flex flex-col sm:flex-row gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Mile time, Squat 1RM, Vertical jump…"
            className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
          <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="Unit (min, lb, in…)"
            className="sm:w-40 px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
          <button onClick={addMetric} className="bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-lg transition flex items-center justify-center gap-1"><Plus size={16} /> Add</button>
        </div>
      </div>
      {milestones.map((m) => <MilestoneCard key={m.id} m={m} onAddEntry={addEntry} onRemoveEntry={removeEntry} onRemove={removeMetric} />)}
    </div>
  );
}

function MilestoneCard({ m, onAddEntry, onRemoveEntry, onRemove }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [date, setDate] = useState(todayStr());
  const entries = m.entries || [];
  const latest = entries.length ? entries[entries.length - 1] : null;
  const first = entries.length ? entries[0] : null;
  const change = latest && first ? latest.value - first.value : 0;
  const chartData = entries.map((e) => ({ date: e.date.slice(5), value: e.value }));
  const submit = () => { if (value === "" || isNaN(parseFloat(value))) return; onAddEntry(m.id, value, date); setValue(""); };
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-semibold text-slate-800">{m.name}</h3>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-bold text-slate-900">{latest ? latest.value : "—"}</span>
              {m.unit && <span className="text-sm text-slate-400">{m.unit}</span>}
              {entries.length > 1 && (
                <span className={`text-xs font-medium ${change > 0 ? "text-emerald-600" : change < 0 ? "text-sky-600" : "text-slate-400"}`}>{change > 0 ? "+" : ""}{change.toFixed(1)} overall</span>
              )}
            </div>
          </div>
          <button onClick={() => onRemove(m.id)} className="text-slate-300 hover:text-red-500 transition"><Trash2 size={16} /></button>
        </div>
        {chartData.length > 1 && (
          <div className="h-28 mt-3 -mx-1">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 5, right: 8, left: 8, bottom: 0 }}>
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                <YAxis hide domain={["dataMin - 1", "dataMax + 1"]} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }} />
                <Line type="monotone" dataKey="value" stroke="#10b981" strokeWidth={2} dot={{ r: 3, fill: "#10b981" }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
        <div className="flex gap-2 mt-3">
          <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" placeholder="New value"
            className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
            className="px-2 py-2 rounded-lg border border-slate-200 text-sm text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-400" />
          <button onClick={submit} className="bg-slate-800 hover:bg-slate-900 text-white px-3 rounded-lg transition"><Plus size={16} /></button>
        </div>
        {entries.length > 0 && (
          <button onClick={() => setOpen(!open)} className="mt-3 text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1">
            {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />} {entries.length} log{entries.length !== 1 ? "s" : ""}
          </button>
        )}
        {open && (
          <div className="mt-2 space-y-1">
            {[...entries].reverse().map((e, i) => {
              const realIdx = entries.length - 1 - i;
              return (
                <div key={realIdx} className="flex items-center justify-between text-sm py-1 px-2 rounded hover:bg-slate-50 group">
                  <span className="text-slate-500">{fmtDate(e.date)}</span>
                  <div className="flex items-center gap-3">
                    <span className="font-medium text-slate-700">{e.value} {m.unit}</span>
                    <button onClick={() => onRemoveEntry(m.id, realIdx)} className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition"><X size={14} /></button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
