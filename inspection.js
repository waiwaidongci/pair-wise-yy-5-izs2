"use strict";

/*
 * 经纱张力巡查判定（纯业务，不操作 DOM）
 * - 按经区登记：张力读数、环境湿度、巡查人、处理说明
 * - 同一经区重复提交：只保留本次实测为现行值，先前读数全部留在履历
 * - 读数偏离该区基准 8%，或与相邻区相差超过 3 档：该区转待复检
 * - 待复检区必须换人，调整张力并重测合格后才解除
 * - 机数 / 经区划分 / 基准变动后按新参数复算
 */
const Inspection = (() => {
  const DEVIATION_LIMIT = 0.08;    // 偏离基准达到 8% 即不合格
  const ADJACENT_GRADE_LIMIT = 3;  // 相邻区档差“超过 3 档”（即 >=4 档）
  const GRADE_STEP_CN = 5;         // 每 5 cN 为一档

  function create() {
    return { seq: 0, records: [], currentByZone: {} };
  }

  function gradeOf(reading) {
    return Math.round(Number(reading) / GRADE_STEP_CN);
  }

  function recordById(insp, id) {
    return insp.records.find(r => r.id === id) || null;
  }

  function current(insp, zone) {
    const id = insp.currentByZone[zone];
    return id === undefined ? null : recordById(insp, id);
  }

  // 组装待判定读数表；override 可放入尚未登记的候选读数
  function readingsOf(insp, params, override) {
    const map = {};
    params.zones.forEach((_, i) => {
      const rec = current(insp, i);
      if (rec) map[i] = { reading: rec.reading };
    });
    if (override) Object.assign(map, override);
    return map;
  }

  /*
   * 对一组读数做整幅判定，返回每区：
   * status: pass（合格）/ fail（待复检）/ none（尚未实测）
   */
  function evaluate(readingsMap, params) {
    const zones = params.zones;
    const grades = zones.map((_, i) =>
      readingsMap[i] ? gradeOf(readingsMap[i].reading) : null
    );
    return zones.map((z, i) => {
      const r = readingsMap[i];
      if (!r) {
        return { zone: i, status: "none", reading: null, deviation: null,
                 grade: null, neighborGap: null, reasons: [] };
      }
      const reasons = [];
      const deviation = Math.abs(r.reading - z.baseline) / z.baseline;
      if (deviation >= DEVIATION_LIMIT) {
        reasons.push("偏离基准 " + (deviation * 100).toFixed(1) + "%（≥8%）");
      }
      let neighborGap = 0;
      [i - 1, i + 1].forEach(j => {
        if (j >= 0 && j < zones.length && grades[j] !== null) {
          const gap = Math.abs(grades[i] - grades[j]);
          if (gap > neighborGap) neighborGap = gap;
          if (gap > ADJACENT_GRADE_LIMIT) {
            reasons.push("与相邻经区" + (j + 1) + "相差 " + gap + " 档（>3 档）");
          }
        }
      });
      return { zone: i, status: reasons.length ? "fail" : "pass",
               reading: r.reading, deviation, grade: grades[i],
               neighborGap, reasons };
    });
  }

  function evaluateCurrent(insp, params) {
    return evaluate(readingsOf(insp, params), params);
  }

  /*
   * 登记一次巡查 / 复检。
   * entry: { zone, reading, humidity, inspector, note }
   * 返回 { ok, error? , kind?, record?, evaluation? }
   */
  function submit(insp, params, entry) {
    const zone = Math.floor(Number(entry.zone));
    const reading = Number(entry.reading);
    const humidity = String(entry.humidity == null ? "" : entry.humidity).trim();
    const inspector = String(entry.inspector == null ? "" : entry.inspector).trim();
    const note = String(entry.note == null ? "" : entry.note).trim();

    if (!Number.isInteger(zone) || zone < 0 || zone >= params.zones.length) {
      return { ok: false, error: "请选择有效的经区。" };
    }
    if (!Number.isFinite(reading) || reading <= 0) {
      return { ok: false, error: "请输入有效的张力读数（大于 0 cN）。" };
    }
    const h = Number(humidity);
    if (humidity === "" || !Number.isFinite(h) || h < 0 || h > 100) {
      return { ok: false, error: "请登记 0–100 之间的环境湿度（%RH）。" };
    }
    if (!inspector) {
      return { ok: false, error: "请填写巡查人。" };
    }

    const before = evaluate(readingsOf(insp, params), params)[zone];
    const prev = current(insp, zone);
    const candidate = evaluate(
      readingsOf(insp, params, { [zone]: { reading } }), params
    )[zone];

    let kind = "inspect";
    if (before.status === "fail") {
      kind = "recheck";
      if (prev && inspector === prev.inspector) {
        return { ok: false, error: "复核须换人：该经区上一次巡查人为「" + prev.inspector +
          "」，请由其他人员调整张力后重测。" };
      }
      if (candidate.status !== "pass") {
        return { ok: false, error: "复检读数仍不合格（" + candidate.reasons.join("；") +
          "），请调整张力后重新实测，合格后才能放行。" };
      }
    }

    const z = params.zones[zone];
    const rec = {
      id: ++insp.seq,
      zone,
      zoneLabel: "经区" + (zone + 1) + "（列" + (z.start + 1) + "–" + (z.end + 1) + "）",
      reading,
      humidity: h,
      inspector,
      note,
      time: new Date().toISOString(),
      kind, // inspect=巡查，recheck=换人复检
    };
    insp.records.push(rec);
    insp.currentByZone[zone] = rec.id; // 先前读数仍在 records 履历中
    return { ok: true, kind, record: rec,
             evaluation: evaluate(readingsOf(insp, params), params) };
  }

  // 经区划分变更：现行读数作废、须按新划分重新巡查；履历保留不动
  function resetDivision(insp) {
    insp.currentByZone = {};
  }

  return {
    DEVIATION_LIMIT, ADJACENT_GRADE_LIMIT, GRADE_STEP_CN,
    create, gradeOf, current, recordById,
    evaluate, evaluateCurrent, submit, resetDivision,
  };
})();
