/* 放行档案：上机许可签发、失效判定与档案持久化 */
window.ReleaseArchive = (() => {
  const KEY = "zfl31Release";

  function load() {
    return JSON.parse(localStorage.getItem(KEY) || "null") || { permits: [] };
  }

  function save(archive) {
    localStorage.setItem(KEY, JSON.stringify(archive));
  }

  // 任一区未测或待复检时，整幅图案不能生成上机许可
  function issue(state, evaluation) {
    const blocked = evaluation.filter(e => e.status !== "ok");
    if (blocked.length) {
      const names = blocked.map(e => e.name + (e.status === "unmeasured" ? "(未测)" : "(待复检)"));
      return { ok: false, msg: "不能生成上机许可：" + names.join("、") + "。" };
    }
    const archive = load();
    const permit = {
      id: "PM" + Date.now(),
      time: new Date().toISOString(),
      signature: window.TensionInspection.configSignature(state.config),
      machines: state.config.machines,
      zoneCount: state.config.zones.length,
      readings: evaluation.map(e => ({
        zone: e.name,
        tension: e.reading.tension,
        humidity: e.reading.humidity,
        inspector: e.reading.inspector,
      })),
    };
    archive.permits.push(permit);
    save(archive);
    return { ok: true, msg: "上机许可 " + permit.id + " 已签发。", permit };
  }

  // 许可有效条件：参数签名一致（机数/经区划分/基准未变）且当前判定全部合格
  function isValid(permit, state, evaluation) {
    if (permit.signature !== window.TensionInspection.configSignature(state.config)) return false;
    return evaluation.every(e => e.status === "ok");
  }

  function latestValid(state, evaluation) {
    const archive = load();
    for (let i = archive.permits.length - 1; i >= 0; i--) {
      if (isValid(archive.permits[i], state, evaluation)) return archive.permits[i];
    }
    return null;
  }

  return { load, issue, isValid, latestValid };
})();
