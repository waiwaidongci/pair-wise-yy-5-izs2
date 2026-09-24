/* 页面动作：画布编辑、统计、撤销重做、保存导出，以及张力巡查界面接线 */
(function () {
  // ===== 纹样画布 =====
  const colors = ["#f7e7c4", "#a6322d", "#1f5f78", "#d6a437", "#355b38", "#713d7b", "#1e1b18", "#e98c52"];
  const grid = document.querySelector("#grid");
  const palette = document.querySelector("#palette");
  const stats = document.querySelector("#stats");
  const preview = document.querySelector("#preview");
  const risk = document.querySelector("#risk");
  let cols = 18, rows = 14, active = 1, block = "dot", dragging = false;
  let cells = [];
  let undo = [], redo = [];

  function init(loadSaved = true) {
    const saved = loadSaved && JSON.parse(localStorage.getItem("zfl31Pattern") || "null");
    if (saved) { cols = saved.cols; rows = saved.rows; cells = saved.cells; }
    else { cols = Number(document.querySelector("#cols").value); rows = Number(document.querySelector("#rows").value); cells = Array(cols * rows).fill(0); }
    document.querySelector("#cols").value = cols; document.querySelector("#rows").value = rows;
    render();
  }

  function render() {
    palette.innerHTML = colors.map((c, i) => '<button class="swatch ' + (i === active ? 'active' : '') + '" data-color="' + i + '" style="background:' + c + '"></button>').join("");
    palette.querySelectorAll("[data-color]").forEach(el => el.onclick = () => { active = Number(el.dataset.color); render(); });
    grid.style.gridTemplateColumns = "repeat(" + cols + ", 1fr)";
    grid.innerHTML = cells.map((v, i) => '<div class="cell" data-i="' + i + '" style="background:' + colors[v] + '"></div>').join("");
    grid.querySelectorAll(".cell").forEach(el => {
      el.onpointerdown = () => { dragging = true; paint(Number(el.dataset.i)); };
      el.onpointerenter = () => { if (dragging) paint(Number(el.dataset.i)); };
    });
    window.onpointerup = () => dragging = false;
    renderStats();
  }

  function snapshot() { undo.push([...cells]); redo = []; if (undo.length > 50) undo.shift(); }

  function paint(i) {
    snapshot();
    pattern(i).forEach(t => { if (t >= 0 && t < cells.length) cells[t] = active; });
    render();
  }

  function pattern(i) {
    const x = i % cols, y = Math.floor(i / cols);
    if (block === "cross") return [i, idx(x - 1, y), idx(x + 1, y), idx(x, y - 1), idx(x, y + 1)].filter(v => v !== null);
    if (block === "diamond") return [idx(x, y - 1), idx(x - 1, y), i, idx(x + 1, y), idx(x, y + 1)].filter(v => v !== null);
    return [i];
  }

  function idx(x, y) { return x < 0 || x >= cols || y < 0 || y >= rows ? null : y * cols + x; }

  function renderStats() {
    const counts = colors.map((_, i) => cells.filter(v => v === i).length);
    stats.innerHTML = counts.map((n, i) => '<div class="stat"><span><span style="display:inline-block;width:14px;height:14px;background:' + colors[i] + '"></span> 色线' + i + '</span><b>' + n + '</b></div>').join("");
    preview.innerHTML = Array.from({ length: 36 }, (_, i) => '<div class="mini" style="background:' + colors[cells[(i % 6) + Math.floor(i / 6) * cols] || colors[0]] + '"></div>').join("");
    const riskRows = [];
    for (let y = 0; y < rows; y++) {
      let switches = 0;
      for (let x = 1; x < cols; x++) if (cells[y * cols + x] !== cells[y * cols + x - 1]) switches++;
      if (switches > cols * .62) riskRows.push(y + 1);
    }
    risk.innerHTML = riskRows.length ? '<p class="warning">第' + riskRows.join("、") + '行换色过密，可能断线。</p>' : '<p>暂无明显断线风险。</p>';
  }

  document.querySelectorAll("[data-block]").forEach(btn => btn.onclick = () => block = btn.dataset.block);
  document.querySelector("#newBtn").onclick = () => { undo = []; redo = []; init(false); };
  document.querySelector("#undoBtn").onclick = () => { if (!undo.length) return; redo.push([...cells]); cells = undo.pop(); render(); };
  document.querySelector("#redoBtn").onclick = () => { if (!redo.length) return; undo.push([...cells]); cells = redo.pop(); render(); };
  document.querySelector("#saveBtn").onclick = () => localStorage.setItem("zfl31Pattern", JSON.stringify({ cols, rows, cells }));
  document.querySelector("#exportBtn").onclick = () => {
    const data = { cols, rows, cells, usage: colors.map((color, i) => ({ color, count: cells.filter(v => v === i).length })) };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "brocade-pattern.json"; a.click(); URL.revokeObjectURL(a.href);
  };

  // ===== 张力巡查与上机放行 =====
  const TKEY = "zfl31Tension";
  const TI = TensionInspection;
  const machinesEl = document.querySelector("#machines");
  const zoneCountEl = document.querySelector("#zoneCount");
  const baselinesEl = document.querySelector("#baselines");
  const zoneSel = document.querySelector("#zoneSel");
  const inspMsg = document.querySelector("#inspMsg");
  const permitMsg = document.querySelector("#permitMsg");

  let tstate = loadTension();

  function loadTension() {
    const saved = JSON.parse(localStorage.getItem(TKEY) || "null");
    if (saved && saved.config && saved.config.zones) return saved;
    const s = TI.createState();
    s.config = TI.buildConfig(2, 4, []);
    return s;
  }

  function persist() { localStorage.setItem(TKEY, JSON.stringify(tstate)); }

  function fmtTime(iso) { return new Date(iso).toLocaleString("zh-CN", { hour12: false }); }
  function pct(v) { return (v * 100).toFixed(1) + "%"; }

  function setMsg(el, text, ok) {
    el.textContent = text;
    el.className = ok ? "msg-ok" : "msg-err";
  }

  // 改动机数、经区划分或基准：许可失效并按新参数复算
  function applyConfig() {
    const machines = Math.max(1, Number(machinesEl.value) || 1);
    const zoneCount = Math.min(12, Math.max(2, Number(zoneCountEl.value) || 2));
    const prev = tstate.config.zones;
    const zones = TI.buildConfig(machines, zoneCount, prev).zones;
    zones.forEach((z, i) => {
      const input = document.querySelector("#baseline-" + i);
      if (input) z.baseline = Math.max(1, Number(input.value) || z.baseline);
    });
    tstate.config = { machines, zones };
    TI.dropStaleZones(tstate);
    persist();
    renderTension();
  }

  function renderTension() {
    const cfg = tstate.config;
    machinesEl.value = cfg.machines;
    zoneCountEl.value = cfg.zones.length;
    baselinesEl.innerHTML = cfg.zones.map((z, i) =>
      '<label>' + z.name + ' 基准张力 (cN)</label><input id="baseline-' + i + '" data-zone="' + z.id + '" type="number" min="1" step="0.5" value="' + z.baseline + '">'
    ).join("");
    baselinesEl.querySelectorAll("input").forEach(el => el.onchange = applyConfig);
    zoneSel.innerHTML = cfg.zones.map(z => '<option value="' + z.id + '">' + z.name + '</option>').join("");

    const evaluation = TI.evaluate(tstate);
    const tag = { ok: '<span class="tag ok">正常</span>', recheck: '<span class="tag recheck">待复检</span>', unmeasured: '<span class="tag unmeasured">未测</span>' };
    document.querySelector("#zoneStatus").innerHTML =
      '<table><tr><th>经区</th><th>基准</th><th>实测</th><th>偏差</th><th>邻差</th><th>状态</th><th>登记人</th></tr>' +
      evaluation.map(e =>
        "<tr><td>" + e.name + "</td><td>" + e.baseline + "</td>" +
        "<td>" + (e.reading ? e.reading.tension : "—") + "</td>" +
        "<td>" + (e.deviation === null ? "—" : pct(e.deviation)) + "</td>" +
        "<td>" + (e.neighborGap === null ? "—" : e.neighborGap.toFixed(1) + "档") + "</td>" +
        "<td>" + tag[e.status] + (e.reading && e.reasons.length ? '<div class="hint">' + e.reasons.join("；") + "</div>" : "") + "</td>" +
        "<td>" + (e.reading ? e.reading.inspector : "—") + "</td></tr>"
      ).join("") + "</table>";

    const valid = ReleaseArchive.latestValid(tstate, evaluation);
    permitMsg.textContent = valid
      ? "当前有效许可：" + valid.id + "（" + fmtTime(valid.time) + "）"
      : "当前无有效上机许可。";
    permitMsg.className = valid ? "msg-ok" : "msg-err";

    const archive = ReleaseArchive.load();
    document.querySelector("#archive").innerHTML = archive.permits.length
      ? archive.permits.slice().reverse().map(p =>
          '<div class="archive-item"><b>' + p.id + "</b> " + fmtTime(p.time) +
          "｜机数" + p.machines + "｜" + p.zoneCount + "区｜" +
          (ReleaseArchive.isValid(p, tstate, evaluation) ? '<span class="tag ok">有效</span>' : '<span class="tag recheck">已失效</span>') +
          "</div>"
        ).join("")
      : '<p class="hint">暂无放行记录。</p>';

    document.querySelector("#history").innerHTML = tstate.history.length
      ? tstate.history.slice(-8).reverse().map(h =>
          '<div class="archive-item">' + (cfg.zones.find(z => z.id === h.zoneId) || { name: h.zoneId }).name +
          " " + h.tension + "cN｜湿度" + h.humidity + "%｜" + h.inspector +
          (h.kind === "recheck" ? "（复核）" : "") + "｜" + fmtTime(h.time) + "</div>"
        ).join("")
      : '<p class="hint">暂无履历。</p>';
  }

  function readForm(kind) {
    return {
      zoneId: zoneSel.value,
      tension: Number(document.querySelector("#tension").value),
      humidity: Number(document.querySelector("#humidity").value),
      inspector: document.querySelector("#inspector").value.trim(),
      note: document.querySelector("#note").value.trim(),
      kind,
    };
  }

  function validForm(r) {
    if (!r.zoneId) return "请选择经区。";
    if (!(r.tension > 0)) return "请填写张力读数。";
    if (!(r.humidity >= 0 && r.humidity <= 100)) return "请填写环境湿度（0-100）。";
    if (!r.inspector) return "请填写巡查人。";
    return null;
  }

  document.querySelector("#patrolBtn").onclick = () => {
    const r = readForm("patrol");
    const err = validForm(r);
    if (err) return setMsg(inspMsg, err, false);
    TI.submitReading(tstate, r);
    persist();
    renderTension();
    setMsg(inspMsg, "已登记，先前值已留履历。", true);
  };

  document.querySelector("#recheckBtn").onclick = () => {
    const r = readForm("recheck");
    const err = validForm(r);
    if (err) return setMsg(inspMsg, err, false);
    const chk = TI.checkRechecker(tstate, r.zoneId, r.inspector);
    if (!chk.ok) return setMsg(inspMsg, chk.msg, false);
    TI.submitReading(tstate, r);
    persist();
    renderTension();
    const st = TI.evaluate(tstate).find(e => e.zoneId === r.zoneId);
    setMsg(inspMsg, st.status === "ok" ? "复核合格，该区恢复正常。" : "复核仍不合格：" + st.reasons.join("；"), st.status === "ok");
  };

  document.querySelector("#permitBtn").onclick = () => {
    const res = ReleaseArchive.issue(tstate, TI.evaluate(tstate));
    renderTension();
    setMsg(permitMsg, res.msg, res.ok);
  };

  machinesEl.onchange = applyConfig;
  zoneCountEl.onchange = applyConfig;

  init();
  renderTension();
})();
