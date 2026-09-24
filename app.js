"use strict";

/*
 * 页面动作：画布编辑、用色统计、撤销重做、保存、导出，
 * 以及张力巡查登记 / 复检与上机放行的界面交互。
 * 判定规则全部走 Inspection，放行档案全部走 Release。
 */
const colors = ["#f7e7c4","#a6322d","#1f5f78","#d6a437","#355b38","#713d7b","#1e1b18","#e98c52"];
const STORAGE_KEY = "zfl31Pattern";

const state = {
  cols: 18, rows: 14, cells: [],
  active: 1, block: "dot", dragging: false,
  undo: [], redo: [],
  looms: 1, zoneCount: 4, baselines: [],
  inspection: Inspection.create(),
  release: Release.create(),
  selectedZone: 0,
};

const $ = sel => document.querySelector(sel);
const grid = $("#grid"), palette = $("#palette"), stats = $("#stats"),
      preview = $("#preview"), risk = $("#risk");
const zoneSelect = $("#zoneSelect"), baselineEditor = $("#baselineEditor"),
      zoneHistory = $("#zoneHistory"), verdictBanner = $("#verdictBanner"),
      zoneRows = $("#zoneRows"), permitGateBtn = $("#permitGateBtn"),
      permitPanel = $("#permitPanel"), flashBox = $("#flashMsg");

/* ---------- 参数与经区 ---------- */

function clamp(v, min, max, dft) {
  v = Math.floor(Number(v));
  if (!Number.isFinite(v)) return dft;
  return Math.min(max, Math.max(min, v));
}

function ensureBaselines() {
  while (state.baselines.length < state.zoneCount) state.baselines.push(100);
}

// 按列数与经区数做连续均分（每区覆盖一段经列）
function buildZones() {
  ensureBaselines();
  const zones = [];
  for (let i = 0; i < state.zoneCount; i++) {
    const start = Math.floor(i * state.cols / state.zoneCount);
    const end = Math.floor((i + 1) * state.cols / state.zoneCount) - 1;
    zones.push({ start, end, baseline: Number(state.baselines[i]) || 100 });
  }
  return zones;
}

function params() {
  return { looms: state.looms, cols: state.cols, rows: state.rows, zones: buildZones() };
}

function syncParamInputs() {
  $("#cols").value = state.cols;
  $("#rows").value = state.rows;
  $("#looms").value = state.looms;
  $("#zoneCount").value = state.zoneCount;
}

/* ---------- 画布 ---------- */

function init() {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  if (saved && Array.isArray(saved.cells) && saved.cells.length === saved.cols * saved.rows) {
    state.cols = saved.cols; state.rows = saved.rows; state.cells = saved.cells;
    if (Number(saved.looms) > 0) state.looms = Number(saved.looms);
    if (Number(saved.zoneCount) > 0) state.zoneCount = clamp(saved.zoneCount, 1, 36, 4);
    if (Array.isArray(saved.baselines)) state.baselines = saved.baselines.map(Number);
    if (saved.inspection && Array.isArray(saved.inspection.records)) state.inspection = saved.inspection;
    if (saved.release && Array.isArray(saved.release.list)) state.release = saved.release;
    ensureBaselines();
  } else {
    state.cells = Array(state.cols * state.rows).fill(0);
    ensureBaselines();
  }
  if (state.selectedZone >= state.zoneCount) state.selectedZone = 0;
  syncParamInputs();
  renderAll();
}

function renderAll() {
  renderPalette();
  renderGrid();
  renderTension();
}

function renderPalette() {
  palette.innerHTML = colors.map((c, i) =>
    '<button type="button" class="swatch ' + (i === state.active ? "active" : "") +
    '" data-color="' + i + '" style="background:' + c + '" title="色线' + i + '"></button>'
  ).join("");
  palette.querySelectorAll("[data-color]").forEach(el => {
    el.onclick = () => { state.active = Number(el.dataset.color); renderPalette(); };
  });
}

function renderGrid() {
  grid.style.gridTemplateColumns = "repeat(" + state.cols + ", 1fr)";
  grid.innerHTML = state.cells.map((v, i) =>
    '<div class="cell" data-i="' + i + '" style="background:' + colors[v] + '"></div>'
  ).join("");
  grid.querySelectorAll(".cell").forEach(el => {
    el.onpointerdown = () => { state.dragging = true; paint(Number(el.dataset.i)); };
    el.onpointerenter = () => { if (state.dragging) paint(Number(el.dataset.i)); };
  });
  window.onpointerup = () => state.dragging = false;
  renderStats();
}

function snapshot() {
  state.undo.push([...state.cells]);
  state.redo = [];
  if (state.undo.length > 50) state.undo.shift();
}

function paint(i) {
  snapshot();
  patternTargets(i).forEach(t => { if (t >= 0 && t < state.cells.length) state.cells[t] = state.active; });
  renderGrid();
}

function patternTargets(i) {
  const x = i % state.cols, y = Math.floor(i / state.cols);
  if (state.block === "cross") return [i, idx(x - 1, y), idx(x + 1, y), idx(x, y - 1), idx(x, y + 1)].filter(v => v !== null);
  if (state.block === "diamond") return [idx(x, y - 1), idx(x - 1, y), i, idx(x + 1, y), idx(x, y + 1)].filter(v => v !== null);
  return [i];
}

function idx(x, y) {
  return x < 0 || x >= state.cols || y < 0 || y >= state.rows ? null : y * state.cols + x;
}

function renderStats() {
  const counts = colors.map((_, i) => state.cells.filter(v => v === i).length);
  stats.innerHTML = counts.map((n, i) =>
    '<div class="stat"><span><span style="display:inline-block;width:14px;height:14px;background:' +
    colors[i] + '"></span> 色线' + i + '</span><b>' + n + '</b></div>'
  ).join("");
  preview.innerHTML = Array.from({ length: 36 }, (_, i) =>
    '<div class="mini" style="background:' + colors[state.cells[(i % 6) + Math.floor(i / 6) * state.cols] || colors[0]] + '"></div>'
  ).join("");
  const riskRows = [];
  for (let y = 0; y < state.rows; y++) {
    let switches = 0;
    for (let x = 1; x < state.cols; x++) {
      if (state.cells[y * state.cols + x] !== state.cells[y * state.cols + x - 1]) switches++;
    }
    if (switches > state.cols * .62) riskRows.push(y + 1);
  }
  risk.innerHTML = riskRows.length
    ? '<p class="warning">第' + riskRows.join("、") + '行换色过密，可能断线。</p>'
    : '<p>暂无明显断线风险。</p>';
}

/* ---------- 张力巡查界面 ---------- */

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, ch =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function fmtTime(iso) {
  return new Date(iso).toLocaleString("zh-CN", { hour12: false });
}

function currentEvaluation() {
  return Inspection.evaluateCurrent(state.inspection, params());
}

function renderTension() {
  const p = params();
  zoneSelect.innerHTML = p.zones.map((z, i) =>
    '<option value="' + i + '"' + (i === state.selectedZone ? " selected" : "") + '>' +
    "经区" + (i + 1) + "（列" + (z.start + 1) + "–" + (z.end + 1) + "）</option>"
  ).join("");

  baselineEditor.innerHTML = p.zones.map((z, i) =>
    '<div class="baseRow"><span>经区' + (i + 1) +
    ' <small>列' + (z.start + 1) + "–" + (z.end + 1) + '</small></span>' +
    '<input type="number" min="1" step="1" data-baseline="' + i + '" value="' + z.baseline +
    '" title="基准张力 cN"> <em>cN</em></div>'
  ).join("");
  baselineEditor.querySelectorAll("[data-baseline]").forEach(inp => {
    inp.onchange = () => {
      const i = Number(inp.dataset.baseline);
      const v = Number(inp.value);
      if (!Number.isFinite(v) || v <= 0) { flash("基准须为大于 0 的数值。", "err"); inp.value = state.baselines[i]; return; }
      if (Number(state.baselines[i]) !== v) {
        state.baselines[i] = v;
        flash("经区" + (i + 1) + "基准已变更：既有许可将失效，并按新基准复算判定。", "warn");
      }
      renderJudgment(currentEvaluation());
      renderRelease();
    };
  });

  renderZoneHistory();
  renderJudgment(currentEvaluation());
  renderRelease();
}

function renderZoneHistory() {
  const z = state.selectedZone;
  const list = state.inspection.records
    .filter(r => r.zone === z)
    .slice()
    .reverse();
  if (!list.length) {
    zoneHistory.innerHTML = '<p class="muted">该经区尚无巡查记录。换班口头交接不作为依据，请先实测登记。</p>';
    return;
  }
  zoneHistory.innerHTML = list.map((r, idx) => {
    const current = Inspection.current(state.inspection, z);
    const tag = r.kind === "recheck"
      ? '<span class="tag tag-recheck">复检</span>'
      : '<span class="tag">巡查</span>';
    const cur = current && r.id === current.id ? '<span class="tag tag-current">现行</span>' : '<span class="tag tag-old">履历</span>';
    return '<div class="hist' + (idx === 0 ? " hist-current" : "") + '">' +
      '<div>' + tag + cur + '<b>' + esc(fmtTime(r.time)) + '</b></div>' +
      '<div>读数 <b>' + esc(r.reading) + '</b> cN（' + Inspection.gradeOf(r.reading) + ' 档）　湿度 ' +
      esc(r.humidity) + '%RH　巡查人 ' + esc(r.inspector) + '</div>' +
      (r.note ? '<div class="note">处理说明：' + esc(r.note) + '</div>' : '') +
      '</div>';
  }).join("");
}

function statusBadge(st) {
  if (st === "pass") return '<span class="badge pass">合格</span>';
  if (st === "fail") return '<span class="badge fail">待复检</span>';
  return '<span class="badge none">未实测</span>';
}

function renderJudgment(ev) {
  const p = params();
  const failN = ev.filter(e => e.status === "fail").length;
  const noneN = ev.filter(e => e.status === "none").length;

  if (failN) {
    verdictBanner.className = "verdict fail";
    verdictBanner.innerHTML = "⚠ 经区 " + ev.filter(e => e.status === "fail").map(e => e.zone + 1).join("、") +
      " 待复检（偏离基准≥8% 或相邻区相差超过3档）：整幅图案不能生成上机许可。须由非原巡查人调整张力后重测。";
  } else if (noneN) {
    verdictBanner.className = "verdict pending";
    verdictBanner.innerHTML = "◷ 尚有 " + noneN + " 个经区未实测，整幅判定不完整，暂不能放行。";
  } else {
    verdictBanner.className = "verdict ok";
    verdictBanner.innerHTML = "✓ 全部 " + p.zones.length + " 个经区实测合格，整幅可生成上机许可。";
  }

  zoneRows.innerHTML = ev.map((e, i) => {
    const rec = Inspection.current(state.inspection, i);
    const dev = e.deviation == null ? "—" : (e.deviation * 100).toFixed(1) + "%";
    const devCls = e.deviation != null && e.deviation >= Inspection.DEVIATION_LIMIT ? " class='warning'" : "";
    const gap = e.neighborGap ? e.neighborGap + " 档" : "—";
    const gapCls = e.neighborGap > Inspection.ADJACENT_GRADE_LIMIT ? " class='warning'" : "";
    return '<tr data-zone="' + i + '"' + (i === state.selectedZone ? ' class="sel"' : "") + '>' +
      '<td>经区' + (i + 1) + '<br><small>列' + (p.zones[i].start + 1) + "–" + (p.zones[i].end + 1) + '</small></td>' +
      '<td>' + p.zones[i].baseline + '</td>' +
      '<td>' + (e.reading == null ? "—" : e.reading) + '</td>' +
      '<td' + devCls + '>' + dev + '</td>' +
      '<td>' + (e.grade == null ? "—" : e.grade) + '</td>' +
      '<td' + gapCls + '>' + gap + '</td>' +
      '<td>' + (rec ? esc(rec.inspector) : "—") + '</td>' +
      '<td>' + statusBadge(e.status) +
        (e.reasons.length ? '<div class="cellReason">' + esc(e.reasons.join("；")) + '</div>' : '') + '</td>' +
      '</tr>';
  }).join("");
  zoneRows.querySelectorAll("tr[data-zone]").forEach(tr => {
    tr.onclick = () => {
      state.selectedZone = Number(tr.dataset.zone);
      zoneSelect.value = state.selectedZone;
      renderZoneHistory();
      renderJudgment(currentEvaluation());
    };
  });

  permitGateBtn.disabled = !(failN === 0 && noneN === 0);
  updateFormHint(ev[state.selectedZone]);
}

function updateFormHint(e) {
  const hint = $("#recheckHint");
  if (!e) return;
  if (e.status === "fail") {
    const rec = Inspection.current(state.inspection, state.selectedZone);
    hint.className = "recheck-hint show-warn";
    hint.innerHTML = "⚠ 待复检：复核须换人（上一巡查人为「" + esc(rec ? rec.inspector : "") +
      "」），调整张力并重测合格后才放行。原因：" + esc(e.reasons.join("；"));
    $("#submitReadingBtn").textContent = "提交复检（换人重测）";
  } else if (e.status === "pass") {
    hint.className = "recheck-hint show-ok";
    hint.textContent = "该经区现行读数合格；可再次实测登记，先前读数自动转入履历。";
    $("#submitReadingBtn").textContent = "登记巡查读数";
  } else {
    hint.className = "recheck-hint";
    hint.textContent = "请按经区登记张力读数、环境湿度、巡查人与处理说明。";
    $("#submitReadingBtn").textContent = "登记巡查读数";
  }
}

function flash(msg, kind) {
  flashBox.textContent = msg;
  flashBox.className = "flash show " + (kind === "err" ? "err" : kind === "warn" ? "warn" : "ok");
  clearTimeout(flash._t);
  flash._t = setTimeout(() => flashBox.className = "flash", 4200);
}

/* ---------- 上机放行档案界面 ---------- */

function renderRelease() {
  const p = params();
  const latest = Release.latest(state.release);
  if (!latest) {
    permitPanel.innerHTML = '<p class="muted">尚无上机许可。所有经区实测合格后，由放行人签发。</p>';
    return;
  }
  const active = Release.isActive(state.release, p);
  const changed = Release.changedParts(state.release, p);
  const statusLine = active
    ? '<div class="permitStatus valid">✓ 许可有效（' + esc(latest.id) + '，' + esc(fmtTime(latest.issuedAt)) + '）</div>'
    : '<div class="permitStatus invalid">✕ 许可已失效（' + esc(latest.id) + '）：' + esc(changed.join("、")) +
      ' 已变更，已按新参数复算，请重新巡查合格后再签发。</div>';
  const older = state.release.list.slice(0, -1).reverse().map(permit =>
    '<details><summary>' + esc(permit.id) + " · " + esc(fmtTime(permit.issuedAt)) +
    " · 放行人 " + esc(permit.issuer) + '</summary>' +
    '<pre class="permitPre">' + esc(JSON.stringify(permit, null, 2)) + '</pre></details>'
  ).join("");
  permitPanel.innerHTML =
    statusLine +
    '<div class="permitCard"><b>' + esc(latest.id) + '</b>' +
    '<div>放行人：' + esc(latest.issuer) + '　机数：' + esc(latest.params.looms) +
    ' 台　网格：' + esc(latest.params.cols) + "×" + esc(latest.params.rows) + '</div>' +
    '<div>经区：' + latest.params.zones.map((z, i) =>
      "区" + (i + 1) + " 列" + z.start + "–" + z.end + " 基准" + z.baseline + "cN").join("；") + '</div>' +
    '<div>各区实测：' + latest.zones.map(z =>
      "区" + (z.zone + 1) + " " + z.reading + "cN（" + (z.deviation * 100).toFixed(1) + "%）").join("；") + '</div></div>' +
    (older ? '<h3>历史许可</h3>' + older : "");
}

/* ---------- 事件绑定 ---------- */

document.querySelectorAll("[data-block]").forEach(btn => {
  btn.onclick = () => { state.block = btn.dataset.block; };
});

$("#newBtn").onclick = () => {
  const newCols = clamp($("#cols").value, 6, 36, 18);
  const newRows = clamp($("#rows").value, 6, 32, 14);
  const divisionChanged = newCols !== state.cols;
  state.cols = newCols; state.rows = newRows;
  state.cells = Array(state.cols * state.rows).fill(0);
  state.undo = []; state.redo = [];
  if (divisionChanged) {
    // 列数变化导致经区跨列改变：现行读数须重测，许可因指纹变化自动失效
    Inspection.resetDivision(state.inspection);
  }
  ensureBaselines();
  syncParamInputs();
  renderAll();
  flash(divisionChanged ? "网格列数已变更：经区跨列随之改变，原巡查现行读数作废重测，许可失效。" : "已新建网格。",
    divisionChanged ? "warn" : "ok");
};

$("#applyZonesBtn").onclick = () => {
  const n = clamp($("#zoneCount").value, 1, 36, 4);
  if (n === state.zoneCount) return;
  state.zoneCount = n;
  if (state.selectedZone >= n) state.selectedZone = 0;
  ensureBaselines();
  Inspection.resetDivision(state.inspection); // 新划分：原读数仅留履历，须重新巡查
  syncParamInputs();
  renderTension();
  flash("经区划分已改为 " + n + " 区：许可失效，已按新划分复算；各区须重新实测。", "warn");
};

$("#looms").onchange = () => {
  const v = clamp($("#looms").value, 1, 999, 1);
  if (v !== state.looms) {
    state.looms = v;
    flash("机数已改为 " + v + " 台：上机许可失效，按新参数复算。", "warn");
  }
  $("#looms").value = state.looms;
  renderRelease();
};

zoneSelect.onchange = () => {
  state.selectedZone = Number(zoneSelect.value);
  renderZoneHistory();
  renderJudgment(currentEvaluation());
};

$("#submitReadingBtn").onclick = () => {
  const res = Inspection.submit(state.inspection, params(), {
    zone: state.selectedZone,
    reading: $("#reading").value,
    humidity: $("#humidity").value,
    inspector: $("#inspector").value,
    note: $("#note").value,
  });
  if (!res.ok) { flash(res.error, "err"); return; }
  $("#reading").value = "";
  $("#note").value = "";
  const z = params().zones[state.selectedZone];
  flash((res.kind === "recheck" ? "复检合格（换人重测）：" : "已登记：") +
    "经区" + (state.selectedZone + 1) + " 实测 " + res.record.reading + "cN；" +
    "同区先前读数已转入履历。", "ok");
  renderZoneHistory();
  renderJudgment(Inspection.evaluateCurrent(state.inspection, params()));
  renderRelease();
};

permitGateBtn.onclick = () => {
  const res = Release.issue(state.release, params(), currentEvaluation(),
    $("#issuer").value, state.inspection);
  if (!res.ok) { flash(res.error, "err"); return; }
  flash("上机许可已签发并归档：" + res.permit.id +
    "（机数 " + res.permit.params.looms + " 台，" + res.permit.zones.length + " 区全部合格）。", "ok");
  renderRelease();
};

$("#undoBtn").onclick = () => {
  if (!state.undo.length) return;
  state.redo.push([...state.cells]);
  state.cells = state.undo.pop();
  renderGrid();
};
$("#redoBtn").onclick = () => {
  if (!state.redo.length) return;
  state.undo.push([...state.cells]);
  state.cells = state.redo.pop();
  renderGrid();
};

$("#saveBtn").onclick = () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    cols: state.cols, rows: state.rows, cells: state.cells,
    looms: state.looms, zoneCount: state.zoneCount, baselines: state.baselines,
    inspection: state.inspection, release: state.release,
  }));
  flash("方案、巡查履历与放行档案已保存到本机。", "ok");
};

$("#exportBtn").onclick = () => {
  const evaluation = currentEvaluation();
  const data = {
    cols: state.cols, rows: state.rows, cells: state.cells,
    usage: colors.map((color, i) => ({ color, count: state.cells.filter(v => v === i).length })),
    tension: {
      looms: state.looms,
      zones: params().zones.map((z, i) => ({
        zone: i + 1, startColumn: z.start + 1, endColumn: z.end + 1,
        baseline: z.baseline,
        current: (() => {
          const rec = Inspection.current(state.inspection, i);
          return rec ? {
            reading: rec.reading, humidity: rec.humidity, inspector: rec.inspector,
            note: rec.note, time: rec.time, kind: rec.kind,
          } : null;
        })(),
        judgment: evaluation[i],
      })),
      history: state.inspection.records,
      permit: {
        latest: Release.latest(state.release),
        active: Release.isActive(state.release, params()),
        changedParts: Release.changedParts(state.release, params()),
      },
    },
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "brocade-pattern.json";
  a.click();
  URL.revokeObjectURL(a.href);
  flash("已导出含张力巡查与放行状态的 JSON。", "ok");
};

init();
