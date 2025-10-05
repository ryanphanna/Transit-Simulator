const TS = window.TS || (window.TS = {});
const {
  GRID, CELL_SIZE, CANVAS_SIZE,
  START_POP, POP_GROWTH_PER_YEAR, MODE_SHARE_TARGET, MODE_SHARE_STREAK_DAYS,
  DEFAULT_SERVICE_START_HOUR, DEFAULT_SERVICE_END_HOUR,
  STARTING_CASH, STOP_CAPEX, DRIVER_WAGE_PER_HOUR, OVERHEAD_PER_VEH_HOUR,
  VEHICLE_CAPACITY, VEHICLE_SPEED_BASE,
  INITIAL_FLEET, DEPOT_BASE_CAPACITY, DEPOT_EXPANSION_STEP, DEPOT_EXPANSION_COST,
  BASE_MAINT_PER_BUS_YEAR, SHIFT_HOURS, OVERTIME_MULT,
  FUELS, SIM_MINUTES_PER_TICK, TICK_MS
} = TS;

const { clamp, polylineLengthKm } = TS;
const { generateLandUse } = TS;
const { generatePOIs, poiIcon, poiJobsBoost } = TS;
const {
  cycleTimeHours, actualVehPerHour, capacityPerHour, avgWaitMin,
  demandPerHour, priceFactor, waitFactor, effSpeedFromLoad, financesMinute
} = TS;
const { useBanners, InfoTip } = TS;

const { useEffect, useMemo, useState, useRef, useCallback } = React;

function App(){
  // World
  const [seed,setSeed]=useState(42);
  const [population,setPopulation]=useState(START_POP);
  const land=useMemo(()=> generateLandUse(seed),[seed]);
  const [poiMap,setPoiMap]=useState(()=> generatePOIs(seed, START_POP));
  useEffect(()=> setPoiMap(generatePOIs(seed, population)), [seed, population]);

  // Route & time
  const [stops,setStops]=useState([]);
  const [running,setRunning]=useState(false);
  const [autoStarted,setAutoStarted]=useState(false);
  const defaultStartMinutes = DEFAULT_SERVICE_START_HOUR * 60;
  const [dayMinutes,setDayMinutes]=useState(defaultStartMinutes);
  const [totalMinutes,setTotalMinutes]=useState(0);
  const [serviceStartHour,setServiceStartHour]=useState(DEFAULT_SERVICE_START_HOUR);
  const [serviceEndHour,setServiceEndHour]=useState(DEFAULT_SERVICE_END_HOUR);

  // Ops
  const [fare,setFare]=useState(2.0);
  const [targetVPH,setTargetVPH]=useState(6);
  const [fleet,setFleet]=useState(INITIAL_FLEET);
  const [avgBusAge,setAvgBusAge]=useState(3);
  const [depotCap,setDepotCap]=useState(DEPOT_BASE_CAPACITY);
  const [fuel,setFuel]=useState('Diesel');
  const [drivers,setDrivers]=useState(20);
  const [dayVehHours,setDayVehHours]=useState(0);
  const [autoSkipIdle,setAutoSkipIdle]=useState(false);

  // Finance / outputs
  const [cash,setCash]=useState(STARTING_CASH);
  const [ridershipHour,setRidershipHour]=useState(0);
  const [modeShare,setModeShare]=useState(0);
  const [streakDays,setStreakDays]=useState(0);
  const [graduated,setGraduated]=useState(false);
  const [loadFactor,setLoadFactor]=useState(0);
  const [effSpeed,setEffSpeed]=useState(VEHICLE_SPEED_BASE);

  const banners = useBanners();

  // Geometry/capacity
  const cycH = useMemo(()=> cycleTimeHours(stops, effSpeed), [stops, effSpeed]);
  const maxBuses = Math.floor(Math.min(fleet, depotCap));
  const maxThrough = maxBuses>0 ? (maxBuses / cycH) : 0;
  const actualVPH = actualVehPerHour(targetVPH, maxThrough);
  const capPH = capacityPerHour(actualVPH);
  const avgWait = avgWaitMin(actualVPH);

  // Service window
  const withinService = dayMinutes >= (serviceStartHour*60) && dayMinutes < (serviceEndHour*60);
  const serviceHoursToday = Math.max(0, serviceEndHour - serviceStartHour);

  // Demand potential
  const demandPH = useMemo(()=> demandPerHour({ stops, land, population, poiMap, poiJobsBoost }), [stops, land, population, poiMap]);
  const routeDemandEstimate = useMemo(()=>{
    if(stops.length < 2) return null;
    return TS.estimateRouteDemand({ stops, land, population, poiMap, fare, targetVPH, serviceHours: serviceHoursToday });
  }, [stops, land, population, poiMap, fare, targetVPH, serviceHoursToday]);
  const destHeavyHint = routeDemandEstimate && routeDemandEstimate.destWeight > 0 && routeDemandEstimate.resWeight < routeDemandEstimate.destWeight * 0.25;

  // Build actions
  function handleCellClick(event,x,y){
    if(running){ banners.show({ type:'info', text:'Pause to edit route — click Pause to add stops.'}); return; }
    if(event.shiftKey){
      setStops(prev => prev.filter(p => !(p.x===x && p.y===y)));
      return;
    }
    setStops(prev => {
      if(prev.some(p=>p.x===x&&p.y===y)) return prev;
      setCash(c=> c-STOP_CAPEX);
      return [...prev, {x,y}];
    });
  }
  function buyBuses(n){
    const unit=FUELS[fuel].busCost; const disc=n>=10?0.10:n>=5?0.05:0; const total=Math.round(unit*n*(1-disc));
    if(running || cash<total) return; setCash(c=>c-total); setFleet(f=>f+n); setAvgBusAge(a=> (a*fleet)/(fleet+n));
  }
  function expandDepot(){ if(running || cash<DEPOT_EXPANSION_COST) return; setCash(c=>c-DEPOT_EXPANSION_COST); setDepotCap(c=>c+DEPOT_EXPANSION_STEP); }
  function hireDrivers(n){ if(running) return; setDrivers(d=> Math.max(0,d+n)); }

  // Auto-start when a route exists (≥3 stops)
  useEffect(()=>{
    if(!autoStarted && !running && stops.length>=3){
      setAutoStarted(true);
      setRunning(true);
      banners.show({ type:'success', text:'🚌 Service started — simulation running.'});
    }
  }, [stops.length, autoStarted, running]);

  // Tick
  useEffect(()=>{
    if(!running) return;
    const id=setInterval(()=>{
      const serviceStartMin = serviceStartHour * 60;
      const serviceEndMin = serviceEndHour * 60;
      const currentWithinService = dayMinutes >= serviceStartMin && dayMinutes < serviceEndMin;
      let minutesAdvance = SIM_MINUTES_PER_TICK;
      if(autoSkipIdle && !currentWithinService){
        if(serviceStartMin !== serviceEndMin){
          if(dayMinutes < serviceStartMin){
            minutesAdvance = serviceStartMin - dayMinutes;
          } else {
            minutesAdvance = (1440 - dayMinutes) + serviceStartMin;
          }
        }
      }

      const demand = (currentWithinService ? demandPH : 0) * priceFactor(fare) * waitFactor(avgWait);
      const servedPH = Math.min(demand, capPH);
      const load = capPH>0 ? servedPH/capPH : 0;
      const nextSpeed = effSpeedFromLoad(load);

      // costs
      const driversDailyCap = drivers * SHIFT_HOURS;
      const addVehHours = (currentWithinService ? (actualVPH / 60) * minutesAdvance : 0);
      const newDayVehHrs = dayVehHours + addVehHours;
      const overtime = newDayVehHrs > driversDailyCap;
      const wage = DRIVER_WAGE_PER_HOUR * (overtime? OVERTIME_MULT:1);
      const costPerKm = FUELS[fuel].costPerKm * (avgBusAge<=5?1:(1+0.05*(avgBusAge-5)));
      const hourlyMaint = (fleet * (BASE_MAINT_PER_BUS_YEAR * (avgBusAge<=5?1:(1+0.05*(avgBusAge-5))))) / (365*24);

      const delta = financesMinute({
        withinService: currentWithinService, servedPerHour: servedPH, fare,
        actualVehPerHour: actualVPH, wageRate: wage, overheadPerVehHour: OVERHEAD_PER_VEH_HOUR,
        speedKmH: nextSpeed, costPerKm, hourlyMaint, staffingPerMinute: 0
      });

      setCash(c=> c + delta * minutesAdvance);
      setRidershipHour(currentWithinService ? servedPH : 0);
      setLoadFactor(load);
      setEffSpeed(nextSpeed);

      const nm = dayMinutes + minutesAdvance;
      const tm = totalMinutes + minutesAdvance;
      const rollover = nm >= 1440;
      const nextDayMinutes = rollover ? (nm % 1440) : nm;
      setDayMinutes(nextDayMinutes);
      setTotalMinutes(tm);
      setDayVehHours(rollover ? addVehHours : newDayVehHrs);

      if(rollover){
        handleDayRollover(servedPH, tm);
      }
    }, TICK_MS);
    return ()=> clearInterval(id);
  }, [running, autoSkipIdle, fare, avgWait, capPH, demandPH, actualVPH, fuel, avgBusAge, drivers, dayVehHours, dayMinutes, totalMinutes, serviceStartHour, serviceEndHour, handleDayRollover, fleet]);

  // Milestones / advisories
  const lastMilestoneRef = useRef(0);
  useEffect(()=>{ [1,2,3,5].forEach(m=>{ if(modeShare>=m && lastMilestoneRef.current<m){ lastMilestoneRef.current=m; banners.show({ type:m===5?'celebrate':'success', text:`Ridership milestone: ${m}%`} ); } }); }, [modeShare]);
  useEffect(()=>{ if(cash < 250_000) banners.show({ type:'warn', text:'Agency funds are low.'}); }, [cash]);
  useEffect(()=>{ if(loadFactor>0.9) banners.show({ type:'info', text:'Buses are overcrowded — add service.'}); }, [loadFactor]);

  // UI helpers
  const polyline = useMemo(()=> stops.length<2? "" : stops.map(p=> `${p.x*CELL_SIZE + CELL_SIZE/2},${p.y*CELL_SIZE + CELL_SIZE/2}`).join(" "), [stops]);
  const fmtMoney = v => v.toLocaleString(undefined,{style:'currency',currency:'USD', maximumFractionDigits:0});
  const dayNumber = Math.floor(totalMinutes / 1440) + 1;
  const hours = Math.floor(dayMinutes/60).toString().padStart(2,'0');
  const minutes = (dayMinutes%60).toString().padStart(2,'0');
  const serviceLabel = withinService ? 'In service' : 'Outside service';
  const showJumpControl = !withinService && serviceHoursToday > 0;

  const handleToggleRunning = () => {
    if(!running){
      setAutoStarted(true);
    }
    setRunning(r=>!r);
  };

  const resetGame = (nextSeed) => {
    setRunning(false);
    setAutoStarted(false);
    setStops([]);
    setCash(STARTING_CASH);
    setFleet(INITIAL_FLEET);
    setDepotCap(DEPOT_BASE_CAPACITY);
    setAvgBusAge(3);
    setDrivers(20);
    setDayMinutes(defaultStartMinutes);
    setTotalMinutes(0);
    setDayVehHours(0);
    setEffSpeed(VEHICLE_SPEED_BASE);
    setAutoSkipIdle(false);
    setPopulation(START_POP);
    setModeShare(0);
    setStreakDays(0);
    setGraduated(false);
    setServiceStartHour(DEFAULT_SERVICE_START_HOUR);
    setServiceEndHour(DEFAULT_SERVICE_END_HOUR);
    const updatedSeed = typeof nextSeed === 'number' ? nextSeed : seed;
    setPoiMap(generatePOIs(updatedSeed, START_POP));
    if(typeof nextSeed === 'number'){
      setSeed(updatedSeed);
    }
  };

  const handleDayRollover = useCallback((servedPerHourSnapshot, nextTotalMinutes) => {
    const dailyRiders = servedPerHourSnapshot * serviceHoursToday;
    const ms = population>0 ? (dailyRiders/population)*100 : 0;
    setModeShare(ms);
    const meets = ms >= MODE_SHARE_TARGET;
    setStreakDays(prev => {
      const next = meets ? prev + 1 : 0;
      if(meets && next >= MODE_SHARE_STREAK_DAYS && !graduated){
        setGraduated(true);
        banners.show({ type:'celebrate', text:`🎓 You graduated Tutorial City!`});
      }
      return next;
    });
    const years = Math.floor(nextTotalMinutes/525_600);
    setPopulation(START_POP + years*POP_GROWTH_PER_YEAR);
  }, [serviceHoursToday, population, graduated, banners]);

  const handleJumpToService = () => {
    const startMin = serviceStartHour * 60;
    const endMin = serviceEndHour * 60;
    if(serviceHoursToday <= 0) return;
    setDayMinutes(dm => {
      if(dm < startMin){
        const advance = startMin - dm;
        setTotalMinutes(tm => tm + advance);
        return startMin;
      }
      if(dm >= endMin){
        const advance = (1440 - dm) + startMin;
        setTotalMinutes(tm => {
          const nextTotal = tm + advance;
          handleDayRollover(0, nextTotal);
          return nextTotal;
        });
        setDayVehHours(0);
        return startMin;
      }
      return startMin;
    });
  };

  const prevServiceRef = useRef(withinService);
  useEffect(()=>{
    if(withinService && prevServiceRef.current === false){
      banners.show({ type:'info', text:'Service window opened — riders now boarding.'});
    }
    prevServiceRef.current = withinService;
  }, [withinService, banners]);

  // Render
  return (
    <div className="min-h-screen w-full text-slate-900 flex flex-col items-center py-6">
      {banners.view}
      <h1 className="text-2xl font-semibold tracking-tight">Transit Simulator</h1>
      <p className="text-sm text-slate-600">Tutorial City · Population {population.toLocaleString()} · Goal: {MODE_SHARE_TARGET}% for {MODE_SHARE_STREAK_DAYS} days</p>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-slate-700">
        <span>Day {dayNumber} · {hours}:{minutes} — {serviceLabel}</span>
        {showJumpControl && (
          <button onClick={handleJumpToService} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium hover:bg-slate-100">Jump to next service start</button>
        )}
        <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
          <input type="checkbox" checked={autoSkipIdle} onChange={e=> setAutoSkipIdle(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
          Auto-skip idle minutes
        </label>
      </div>

      <div className="mt-4 grid gap-4 grid-cols-1 lg:grid-cols-[auto_520px] xl:grid-cols-[minmax(320px,1fr)_520px_minmax(320px,1fr)] xl:items-stretch">
        {/* Map */}
        <div className="order-1 xl:order-2 flex flex-col items-center xl:self-stretch xl:h-full">
          <div
            className="relative aspect-square w-full h-full rounded-2xl overflow-hidden border border-slate-200 bg-white shadow-sm"
            style={{ maxWidth: CANVAS_SIZE, maxHeight: CANVAS_SIZE }}
          >
            <div className="absolute inset-0">
              {Array.from({length:GRID}).map((_,y)=>(
                <div key={y} className="flex">
                  {Array.from({length:GRID}).map((__,x)=>{
                    const p = land.pop[y][x], jb = land.jobs[y][x], poi = poiMap.get(`${x},${y}`);
                    const bg = p===0? '#EFF6FF' : p===1? '#DBEAFE' : p===2? '#BFDBFE' : '#93C5FD';
                    const outline = jb>0 ? '1px solid rgba(234,179,8,0.25)' : '1px solid rgba(2,6,23,0.06)';
                    return (
                      <div key={`${x}-${y}`} onClick={(e)=> handleCellClick(e,x,y)}
                           style={{ width: CELL_SIZE, height: CELL_SIZE, backgroundColor:bg, outline, cursor:'crosshair', position:'relative' }}>
                        {poi && <div style={{position:'absolute', inset:'0', display:'grid', placeItems:'center', fontSize:'12px'}}>{poiIcon(poi)}</div>}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
            <svg
              className="absolute inset-0 h-full w-full"
              width={CANVAS_SIZE}
              height={CANVAS_SIZE}
              viewBox={`0 0 ${CANVAS_SIZE} ${CANVAS_SIZE}`}
              preserveAspectRatio="none"
              style={{ pointerEvents:'none' }}
            >
              {stops.length>=2 && <polyline points={polyline} fill="none" stroke="#0ea5e9" strokeWidth={4} strokeLinejoin="round" strokeLinecap="round" />}
            </svg>
            {stops.map((p,i)=>(
              <div key={i} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left:p.x*CELL_SIZE + CELL_SIZE/2, top:p.y*CELL_SIZE + CELL_SIZE/2 }}>
                <div className="w-3.5 h-3.5 rounded-full border border-sky-400 bg-sky-500" />
              </div>
            ))}
          </div>
          <div className="mt-2 text-center text-xs text-slate-500">Click to add stop • Shift-click to remove • New Route to add another</div>
          <div className="mt-2 text-center text-sm font-medium text-slate-700">
            Estimated riders: {routeDemandEstimate ? Math.round(routeDemandEstimate.perDay).toLocaleString() : '—'} / day
          </div>
          {destHeavyHint && (
            <div className="mt-1 max-w-sm text-center text-xs text-amber-600">
              This route mainly serves destinations; connect residential areas to grow ridership.
            </div>
          )}
        </div>

        {/* HUD */}
        <div className="order-2 xl:order-1 flex flex-col gap-4 xl:h-full">
          <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs uppercase text-slate-500">Cash</div>
                <div className={`text-xl font-semibold ${cash<0?'text-rose-600':'text-emerald-600'}`}>{fmtMoney(cash)}</div>
              </div>
              <div className="text-right">
                <div className="text-xs uppercase text-slate-500">Riders</div>
                <div className="text-xl font-semibold">{Math.round(ridershipHour).toLocaleString()} / hr</div>
              </div>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-slate-600">
              <div className="flex flex-col">
                <span>Target</span>
                <span className="font-semibold text-slate-700">{targetVPH} veh/hr</span>
              </div>
              <div className="flex flex-col">
                <span>Actual</span>
                <span className="font-semibold text-slate-700">{Math.floor(actualVPH)} veh/hr</span>
              </div>
              <div className="flex flex-col items-end text-right">
                <span className="flex items-center justify-end gap-1">Round-trip time<InfoTip text="One full loop incl. turn-around" /></span>
                <span className="font-semibold text-slate-700">{(cycH*60).toFixed(0)} min</span>
              </div>
            </div>
            <div className="mt-3">
              <div className="flex justify-between text-xs text-slate-600">
                <span>Transit mode share</span>
                <span>{modeShare.toFixed(2)}% / {MODE_SHARE_TARGET}%</span>
              </div>
              <div className="h-2 rounded-full bg-slate-200 overflow-hidden mt-1">
                <div className="h-full bg-sky-500" style={{ width: `${Math.min(100, (modeShare/MODE_SHARE_TARGET)*100)}%` }} />
              </div>
            </div>
          </div>
        </div>

        {/* Controls */}
        <div className="order-3 flex flex-col gap-4 xl:h-full">
          <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium text-slate-900">Routes</div>
              <div className="text-xs text-slate-500">Estimated riders</div>
            </div>
            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 flex items-center justify-between">
              <span>Route 1</span>
              <span className="font-semibold text-slate-900">{routeDemandEstimate ? `${Math.round(routeDemandEstimate.perDay).toLocaleString()} / day` : '—'}</span>
            </div>
          </div>

          <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-sm flex flex-col gap-4">
            <label className="text-sm">
              <span className="block text-slate-700 mb-1">{`Fare: $${fare.toFixed(2)} ($1.50–$3.00)`}</span>
              <input type="range" min={1.5} max={3.0} step={0.05} value={fare} onChange={e=> setFare(parseFloat(e.target.value))} className="w-full" />
            </label>
            <label className="text-sm">
              <span className="block text-slate-700 mb-1">Target Frequency (2–20 veh/hr)</span>
              <input type="range" min={2} max={20} step={1} value={targetVPH} onChange={e=> setTargetVPH(parseInt(e.target.value))} className="w-full" />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
                <div className="text-sm font-medium text-slate-900">Fleet & Depot</div>
                <div className="text-xs text-slate-600 mt-1">Buses: <span className="font-semibold">{fleet}</span> | Depot cap:<span className="font-semibold">{depotCap}</span></div>
                <div className="text-xs text-slate-600 flex items-center gap-1">
                  <span>Max buses/hour possible</span>
                  <InfoTip text="Theoretical ceiling with current fleet+depot and route’s round-trip time" />
                  <span className="ml-auto font-semibold text-slate-700">{Math.floor(maxThrough)} veh/hr</span>
                </div>
                <div className="mt-2 flex gap-2 flex-wrap">
                  <button onClick={()=> buyBuses(1)}  className="px-2 py-1 rounded-lg text-xs bg-white border border-slate-300 hover:bg-slate-100">Buy 1 ({FUELS[fuel].busCost.toLocaleString()})</button>
                  <button onClick={()=> buyBuses(5)}  className="px-2 py-1 rounded-lg text-xs bg-white border border-slate-300 hover:bg-slate-100">Buy 5 (−5%)</button>
                  <button onClick={()=> buyBuses(10)} className="px-2 py-1 rounded-lg text-xs bg-white border border-slate-300 hover:bg-slate-100">Buy 10 (−10%)</button>
                  <button onClick={expandDepot} className="px-2 py-1 rounded-lg text-xs bg-white border border-slate-300 hover:bg-slate-100">Expand Depot +{DEPOT_EXPANSION_STEP} ({DEPOT_EXPANSION_COST.toLocaleString()})</button>
                </div>
              </div>

              <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
                <div className="text-sm font-medium text-slate-900">Fuel & Drivers</div>
                <div className="flex gap-2 mt-2 text-xs">
                  {Object.keys(FUELS).map(k=>(
                    <button key={k} onClick={()=> setFuel(k)} className={`px-2 py-1 rounded-lg border ${fuel===k?'bg-sky-100 border-sky-300':'bg-white border-slate-300 hover:bg-slate-100'}`}>{k}</button>
                  ))}
                </div>
                <div className="text-xs text-slate-600 mt-2">$ / km: <span className="font-semibold">{FUELS[fuel].costPerKm.toFixed(2)}</span></div>
                <div className="text-xs text-slate-600">Drivers: <span className="font-semibold">{drivers}</span> (cap {drivers*SHIFT_HOURS} drv-hrs/day)
                  <button onClick={()=> hireDrivers(+10)} className="ml-2 px-2 py-0.5 rounded bg-white border border-slate-300 hover:bg-slate-100">+10</button>
                  <button onClick={()=> hireDrivers(-10)} className="ml-1 px-2 py-0.5 rounded bg-white border border-slate-300 hover:bg-slate-100">−10</button>
                </div>
              </div>
            </div>

            <div className="rounded-2xl bg-slate-50 border border-slate-200 p-3 text-xs text-slate-700">
              <div className="text-sm font-medium text-slate-900 mb-1">Service Hours</div>
              <div className="grid grid-cols-2 gap-3">
                <label>Start: <input type="number" min="0" max="23" value={serviceStartHour} onChange={e=> setServiceStartHour(clamp(parseInt(e.target.value)||0,0,23))} className="ml-1 w-16 border border-slate-300 rounded px-1" />:00</label>
                <label>End:   <input type="number" min="1" max="24" value={serviceEndHour}   onChange={e=> setServiceEndHour(clamp(parseInt(e.target.value)||0,1,24))} className="ml-1 w-16 border border-slate-300 rounded px-1" />:00</label>
              </div>
              <div className="mt-1 text-slate-600">Current span: {Math.max(0, serviceEndHour - serviceStartHour)} hours/day</div>
            </div>

            <div className="flex gap-2 flex-wrap mt-1">
              <button onClick={handleToggleRunning} className={`px-3 py-2 rounded-xl text-sm font-medium border ${running? 'bg-sky-100 border-sky-300':'bg-sky-500 text-white border-sky-600 hover:bg-sky-600'}`}>{running? 'Pause':'Play'}</button>
              <button onClick={()=> resetGame()} className="px-3 py-2 rounded-xl text-sm font-medium border bg-white border-slate-300 hover:bg-slate-100">Reset</button>
              <button onClick={()=> resetGame(seed + 1)} className="px-3 py-2 rounded-xl text-sm font-medium border bg-white border-slate-300 hover:bg-slate-100">New Map</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
