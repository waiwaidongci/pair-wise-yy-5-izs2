/* 巡查判定：张力读数登记、履历保留与合格判定 */
window.TensionInspection = (() => {
  const GRADE_STEP = 2;    // 每档 2 cN
  const DEV_LIMIT = 0.08;  // 偏离基准 8% 转待复检
  const GRADE_LIMIT = 3;   // 相邻区相差超过三档转待复检

  function createState() {
    return {
      config: { machines: 2, zones: [] }, // zones: [{ id, name, baseline }]
      current: {}, // zoneId -> 本次实测
      history: [], // 履历：被覆盖的旧值与失效读数
    };
  }

  function buildConfig(machines, zoneCount, prevZones) {
    const zones = [];
    for (let i = 0; i < zoneCount; i++) {
      const prev = prevZones && prevZones[i];
      zones.push({
        id: "Z" + (i + 1),
        name: "经区" + (i + 1),
        baseline: prev ? prev.baseline : 24,
      });
    }
    return { machines, zones };
  }

  // 机数、经区划分或基准的参数签名，用于许可失效判定
  function configSignature(config) {
    return JSON.stringify({
      machines: config.machines,
      zones: config.zones.map(z => [z.name, z.baseline]),
    });
  }

  function gradeOf(tension) { return tension / GRADE_STEP; }

  // 登记读数：同一经区只保留这次实测，先前值留在履历
  function submitReading(state, { zoneId, tension, humidity, inspector, note, kind }) {
    const record = {
      zoneId,
      tension,
      humidity,
      inspector,
      note: note || "",
      kind: kind || "patrol", // patrol=巡查 recheck=复核
      time: new Date().toISOString(),
    };
    const prev = state.current[zoneId];
    if (prev) state.history.push({ ...prev, replacedBy: record.time });
    state.current[zoneId] = record;
    return record;
  }

  // 复核须换人：不能由该区当前读数的登记人复核
  function checkRechecker(state, zoneId, inspector) {
    const cur = state.current[zoneId];
    if (!cur) return { ok: false, msg: "该区尚无读数，请先巡查登记。" };
    if (!inspector) return { ok: false, msg: "请填写复核人。" };
    if (cur.inspector === inspector) return { ok: false, msg: "复核须换人，不能由初查人「" + inspector + "」复核。" };
    return { ok: true };
  }

  // 经区划分变化后，已不存在的经区读数转入履历
  function dropStaleZones(state) {
    const ids = new Set(state.config.zones.map(z => z.id));
    Object.keys(state.current).forEach(id => {
      if (!ids.has(id)) {
        state.history.push({ ...state.current[id], note: (state.current[id].note || "") + "（经区调整失效）" });
        delete state.current[id];
      }
    });
  }

  // 判定每区状态：ok 正常 / recheck 待复检 / unmeasured 未测
  function evaluate(state) {
    const result = state.config.zones.map(z => {
      const cur = state.current[z.id] || null;
      const st = {
        zoneId: z.id, name: z.name, baseline: z.baseline, reading: cur,
        deviation: null, neighborGap: null, status: "unmeasured", reasons: [],
      };
      if (!cur) { st.reasons.push("未测"); return st; }
      st.deviation = z.baseline > 0 ? (cur.tension - z.baseline) / z.baseline : 0;
      if (Math.abs(st.deviation) > DEV_LIMIT) st.reasons.push("偏离基准超过8%");
      return st;
    });
    for (let i = 0; i < result.length - 1; i++) {
      const a = result[i], b = result[i + 1];
      if (!a.reading || !b.reading) continue;
      const gap = Math.abs(gradeOf(a.reading.tension) - gradeOf(b.reading.tension));
      a.neighborGap = Math.max(a.neighborGap || 0, gap);
      b.neighborGap = Math.max(b.neighborGap || 0, gap);
      if (gap > GRADE_LIMIT) {
        a.reasons.push("与" + b.name + "相差超过三档");
        b.reasons.push("与" + a.name + "相差超过三档");
      }
    }
    result.forEach(st => { if (st.reading) st.status = st.reasons.length ? "recheck" : "ok"; });
    return result;
  }

  return { GRADE_STEP, DEV_LIMIT, GRADE_LIMIT, createState, buildConfig, configSignature, submitReading, checkRechecker, dropStaleZones, evaluate };
})();
