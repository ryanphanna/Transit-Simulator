(function (g) {
  const TS = g.TS = g.TS || {};
  const { useState, useEffect } = React;
  TS.useBanners = function () {
    const [queue, setQueue] = useState([]);
    useEffect(() => {
      if (!queue.length) return;
      const t = setTimeout(() => setQueue([]), 10000); return () => clearTimeout(t);
    }, [queue]);
    const show = b => setQueue([b]);
    const dismiss = () => setQueue([]);
    const view = (
      <div className="fixed top-4 right-4 z-50 space-y-2">
        {queue.map((b, i) =>
          <div key={i} className={`w-80 rounded-xl border p-3 shadow-sm animate-[fadein_150ms_ease-out] ${
            b.type === 'celebrate' ? 'bg-violet-50 border-violet-300 text-violet-900'
              : b.type === 'success' ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                : b.type === 'warn' ? 'bg-amber-50 border-amber-300 text-amber-900'
                  : 'bg-sky-50 border-sky-300 text-sky-900'
          }`}>
            <div className="flex items-start gap-2">
              <div className="text-sm leading-snug flex-1">{b.text}</div>
              <button onClick={dismiss} className="text-xs px-2 py-0.5 rounded border border-slate-300/70 hover:bg-white/40">✕</button>
            </div>
          </div>
        )}
      </div>
    );
    return { show, view };
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
})(window);
