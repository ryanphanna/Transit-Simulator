(function (g) {
  const TS = g.TS = g.TS || {};
  const { useState, useEffect } = React;
  TS.useBanners = function () {
    const [queue, setQueue] = useState([]);
    useEffect(() => {
      if (!queue.length) return;
      const t = setTimeout(() => setQueue([]), 10000);
      return () => clearTimeout(t);
    }, [queue]);
    const show = b => {
      const target = b?.target || 'hud';
      setQueue([{ ...b, target }]);
    };
    const dismiss = () => setQueue([]);
    const hudQueue = queue.filter(b => b.target !== 'map');
    const mapQueue = queue.filter(b => b.target === 'map');
    const hudView = hudQueue.length === 0 ? null : (
      <div className="fixed top-4 right-4 z-50 space-y-2">
        {hudQueue.map((b, i) => (
          <div
            key={i}
            className={`w-80 rounded-xl border p-3 shadow-sm animate-[fadein_150ms_ease-out] ${
              b.type === 'celebrate'
                ? 'bg-violet-50 border-violet-300 text-violet-900'
                : b.type === 'success'
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                  : b.type === 'warn'
                    ? 'bg-amber-50 border-amber-300 text-amber-900'
                    : 'bg-sky-50 border-sky-300 text-sky-900'
            }`}
          >
            <div className="flex items-start gap-2">
              <div className="flex-1 text-sm leading-snug">{b.text}</div>
              <button
                onClick={dismiss}
                className="text-xs px-2 py-0.5 rounded border border-slate-300/70 hover:bg-white/40"
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>
    );
    return { show, dismiss, hudView, mapQueue };
  };

  TS.InfoTip = function InfoTip({ text }) {
    return (
      <span className="ml-1 inline-flex items-center justify-center align-middle">
        <span
          className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-slate-200 text-[10px] font-semibold text-slate-600"
          title={text}
        >
          ?
        </span>
      </span>
    );
  };

  TS.NumberStepper = function NumberStepper({ value, onChange, min, max, step = 1, format = (v) => String(v) }) {
    const lower = typeof min === 'number' ? min : -Infinity;
    const upper = typeof max === 'number' ? max : Infinity;
    const normalize = (next) => {
      const numeric = Number.isFinite(next) ? next : lower;
      const clamped = Math.min(upper, Math.max(lower, numeric));
      onChange(Number.isFinite(clamped) ? Number(clamped.toFixed(2)) : lower);
    };
    return (
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => normalize((parseFloat(value) || 0) - step)}
          className="px-2 py-1 rounded border border-slate-300 bg-white text-lg leading-none"
        >
          −
        </button>
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => normalize(parseFloat(e.target.value))}
          className="w-20 border rounded px-2 py-1 text-right text-sm"
        />
        <button
          type="button"
          onClick={() => normalize((parseFloat(value) || 0) + step)}
          className="px-2 py-1 rounded border border-slate-300 bg-white text-lg leading-none"
        >
          +
        </button>
        <span className="ml-2 text-sm text-slate-700">{format(value)}</span>
      </div>
    );
  };

  TS.MapToast = function MapToast({ toasts, onDismiss }) {
    if (!toasts || !toasts.length) return null;
    return (
      <div className="pointer-events-none absolute left-1/2 top-4 z-40 flex -translate-x-1/2 flex-col items-center gap-2">
        {toasts.map((b, i) => (
          <div
            key={i}
            className={`pointer-events-auto w-72 rounded-xl border p-3 text-center shadow-sm animate-[fadein_150ms_ease-out] ${
              b.type === 'celebrate'
                ? 'bg-violet-50 border-violet-300 text-violet-900'
                : b.type === 'success'
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                  : b.type === 'warn'
                    ? 'bg-amber-50 border-amber-300 text-amber-900'
                    : 'bg-sky-50 border-sky-300 text-sky-900'
            }`}
          >
            <div className="flex items-start gap-2">
              <div className="flex-1 text-sm leading-snug text-left">{b.text}</div>
              <button
                onClick={onDismiss}
                className="text-xs px-2 py-0.5 rounded border border-slate-300/70 bg-white/30 hover:bg-white/60"
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>
    );
  };
})(window);
