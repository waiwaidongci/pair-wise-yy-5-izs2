"use strict";

/*
 * 上机放行档案（纯业务，不操作 DOM）
 * - 整幅所有经区均实测合格，才允许生成上机许可
 * - 许可绑定机数、经区划分、基准、网格参数的指纹
 * - 改动机数、经区划分或基准（或网格列数）：许可立即失效，并按新参数复算
 * - 每次签发留档；档案不可删改
 */
const Release = (() => {

  function create() {
    return { list: [] };
  }

  // 参数指纹：机数、网格列数、经区划分（起止列）、各区基准
  function signature(params) {
    return JSON.stringify({
      looms: params.looms,
      cols: params.cols,
      zones: params.zones.map(z => ({ start: z.start, end: z.end, baseline: z.baseline })),
    });
  }

  function snapshotZones(params, evaluation) {
    return params.zones.map((z, i) => ({
      zone: i,
      start: z.start + 1,
      end: z.end + 1,
      baseline: z.baseline,
      status: evaluation[i].status,
      reading: evaluation[i].reading,
      grade: evaluation[i].grade,
      deviation: evaluation[i].deviation,
    }));
  }

  function permitId(now) {
    const p = n => String(n).padStart(2, "0");
    return "SJ-" + now.getFullYear() + p(now.getMonth() + 1) + p(now.getDate()) +
      "-" + p(now.getHours()) + p(now.getMinutes()) + p(now.getSeconds());
  }

  /*
   * 签发上机许可。
   * inspection: 巡查状态；evaluation: Inspection.evaluateCurrent 的整幅判定；
   * issuer: 放行人。
   * 返回 { ok, error?, permit? }
   */
  function issue(archive, params, evaluation, issuer, insp) {
    issuer = String(issuer == null ? "" : issuer).trim();
    if (!issuer) return { ok: false, error: "请填写放行人。" };

    const pending = evaluation
      .filter(e => e.status === "fail")
      .map(e => "经区" + (e.zone + 1));
    if (pending.length) {
      return { ok: false, error: "存在待复检经区（" + pending.join("、") +
        "），整幅图案不能生成上机许可。" };
    }
    const untested = evaluation
      .filter(e => e.status === "none")
      .map(e => "经区" + (e.zone + 1));
    if (untested.length) {
      return { ok: false, error: "尚有经区未实测（" + untested.join("、") +
        "），整幅图案不能生成上机许可。" };
    }

    const now = new Date();
    const permit = {
      id: permitId(now),
      issuedAt: now.toISOString(),
      issuer,
      signature: signature(params),
      params: {
        looms: params.looms,
        cols: params.cols,
        rows: params.rows,
        zones: params.zones.map(z => ({
          start: z.start + 1, end: z.end + 1, baseline: z.baseline,
        })),
      },
      zones: snapshotZones(params, evaluation),
      records: evaluation.map(e => {
        const rec = Inspection.current(insp, e.zone);
        return {
          zone: e.zone,
          reading: rec ? rec.reading : null,
          humidity: rec ? rec.humidity : null,
          inspector: rec ? rec.inspector : null,
          time: rec ? rec.time : null,
        };
      }),
    };
    archive.list.push(permit);
    return { ok: true, permit };
  }

  // 最新一份许可；active 表示对当前参数仍然有效
  function latest(archive) {
    return archive.list.length ? archive.list[archive.list.length - 1] : null;
  }

  function isActive(archive, params) {
    const p = latest(archive);
    return !!p && p.signature === signature(params);
  }

  // 指纹不一致时，列出变更项，供页面提示
  function changedParts(archive, params) {
    const p = latest(archive);
    if (!p) return [];
    const cur = JSON.parse(signature(params));
    const old = JSON.parse(p.signature);
    const parts = [];
    if (cur.looms !== old.looms) parts.push("机数");
    if (cur.cols !== old.cols) parts.push("网格列数");
    const sameDivision = cur.zones.length === old.zones.length &&
      cur.zones.every((z, i) => z.start === old.zones[i].start && z.end === old.zones[i].end);
    if (!sameDivision) parts.push("经区划分");
    if (cur.zones.some((z, i) => z.baseline !== (old.zones[i] && old.zones[i].baseline))) {
      parts.push("基准张力");
    }
    return parts;
  }

  return { create, signature, issue, latest, isActive, changedParts };
})();
