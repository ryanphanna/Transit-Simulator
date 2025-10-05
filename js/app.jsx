(function (g) {
  const TS = g.TS = g.TS || {};
  const {
    GRID, CELL_SIZE: INITIAL_CELL_SIZE,
    START_POP, POP_GROWTH_PER_YEAR, MODE_SHARE_TARGET, MODE_SHARE_STREAK_DAYS,
    DEFAULT_SERVICE_START_HOUR, DEFAULT_SERVICE_END_HOUR,
    STARTING_CASH, STOP_CAPEX, DRIVER_WAGE_PER_HOUR, OVERHEAD_PER_VEH_HOUR,
    VEHICLE_CAPACITY, VEHICLE_SPEED_BASE,
    INITIAL_FLEET, DEPOT_BASE_CAPACITY, DEPOT_EXPANSION_STEP, DEPOT_EXPANSION_COST,
    BASE_MAINT_PER_BUS_YEAR, SHIFT_HOURS, OVERTIME_MULT,
    FUELS, SIM_MINUTES_PER_TICK, TICK_MS,
    SUBSIDY_PER_BOARDING, RESIDUAL_GAP_SHARE
  } = TS;

  const { clamp, polylineLengthKm } = TS;
  const { generateLandUse } = TS;
  const { generatePOIs, poiIcon, poiJobsBoost } = TS;
  const {
    spacingEfficiency, avgWaitMin, priceFactor, waitFactor,
    effSpeedFromLoad, roundTripMinutes, estimateRouteDemand, financesMinute,
    cycleTimeHours, actualVehPerHour, capacityPerHour, demandPerHour
  } = TS;
  const { useBanners, InfoTip, NumberStepper, MapToast } = TS;

  const { useEffect, useMemo, useState, useRef, useCallback } = React;

  const ROUTE_COLORS = ['#ef4444','#3b82f6','#10b981','#f97316','#8b5cf6','#06b6d4'];

  function App(){
    TS.routeSeq = TS.routeSeq || 1;
    const initialRouteId = `r${TS.routeSeq}`;

    // World
    const [seed,setSeed]=useState(42);
    const [population,setPopulation]=useState(START_POP);
    const land=useMemo(()=> generateLandUse(seed),[seed]);
    const [poiMap,setPoiMap]=useState(()=> generatePOIs(seed, START_POP));
    useEffect(()=> setPoiMap(generatePOIs(seed, population)), [seed, population]);

    const [routes,setRoutes]=useState(()=>[
      { id: initialRouteId, name: `Route ${TS.routeSeq}`, stops: [], color: ROUTE_COLORS[0] }
    ]);
    const [activeRouteId,setActiveRouteId]=useState(initialRouteId);

    const [globalFare,setGlobalFare]=useState(2.0);
    const [globalTargetVPH,setGlobalTargetVPH]=useState(6);

    // Route & time
    const [running,setRunning]=useState(false);
    const [autoStarted,setAutoStarted]=useState(false);
    const defaultStartMinutes = DEFAULT_SERVICE_START_HOUR * 60;
    const [dayMinutes,setDayMinutes]=useState(defaultStartMinutes);
    const [totalMinutes,setTotalMinutes]=useState(0);
    const [serviceStartHour,setServiceStartHour]=useState(DEFAULT_SERVICE_START_HOUR);
    const [serviceEndHour,setServiceEndHour]=useState(DEFAULT_SERVICE_END_HOUR);
    const [speed,setSpeed]=useState(1);

    // Ops
    const [fleet,setFleet]=useState(INITIAL_FLEET);
    const [avgBusAge,setAvgBusAge]=useState(3);
    const [depotCap,setDepotCap]=useState(DEPOT_BASE_CAPACITY);
    const [fuel,setFuel]=useState('Diesel');
    const [drivers,setDrivers]=useState(20);
    const [dayVehHours,setDayVehHours]=useState(0);
    const [autoSkipIdle,setAutoSkipIdle]=useState(false);

    const [cellSize,setCellSize]=useState(INITIAL_CELL_SIZE);
    const canvasSize = cellSize * GRID;
    const mapContainerRef = useRef(null);
    const [settingsOpen,setSettingsOpen]=useState(false);
    const recomputeCellSize = useCallback(() => {
      const node = mapContainerRef.current;
      if (!node) return;
      const { clientWidth, clientHeight } = node;
      if (!clientWidth || !clientHeight) return;
      const dimension = Math.min(clientWidth, clientHeight);
      const next = clamp(Math.floor(dimension / GRID), 12, 64);
      setCellSize(prev => (prev === next ? prev : next));
    }, []);

    useEffect(() => {
      const node = mapContainerRef.current;
      if (!node) return;
      if (typeof ResizeObserver === 'function') {
        const observer = new ResizeObserver(() => {
          recomputeCellSize();
        });
        observer.observe(node);
        recomputeCellSize();
        return () => observer.disconnect();
      }
      recomputeCellSize();
      const handle = () => recomputeCellSize();
      window.addEventListener('resize', handle);
      return () => window.removeEventListener('resize', handle);
    }, [recomputeCellSize]);

    useEffect(() => {
      TS.CELL_SIZE = cellSize;
      TS.CANVAS_SIZE = cellSize * GRID;
    }, [cellSize]);

    // Finance / outputs
    const [cash,setCash]=useState(STARTING_CASH);
    const [ridershipHour,setRidershipHour]=useState(0);
    const [modeShare,setModeShare]=useState(0);
    const [streakDays,setStreakDays]=useState(0);
    const [graduated,setGraduated]=useState(false);
    const [loadFactor,setLoadFactor]=useState(0);
    const [effSpeed,setEffSpeed]=useState(VEHICLE_SPEED_BASE);
    const [lastDayFinance,setLastDayFinance]=useState({ income:0, costs:0, net:0 });

    const banners = useBanners();
    const financeAccumulatorRef = useRef({ income:0, costs:0 });
    const destHeavyShownRef = useRef(false);

    const activeRoute = useMemo(() => routes.find(r => r.id === activeRouteId) || routes[0], [routes, activeRouteId]);
    const stops = activeRoute ? activeRoute.stops : [];

    const updateActiveRoute = useCallback((mutator) => {
      setRoutes(prev => prev.map(route => {
        if(route.id !== activeRouteId) return route;
        const next = mutator(route) || route;
        return next;
      }));
    }, [activeRouteId]);

    // Geometry/capacity
    const cycH = useMemo(()=> cycleTimeHours(stops, effSpeed), [stops, effSpeed]);
    const maxBuses = Math.floor(Math.min(fleet, depotCap));
    const maxThrough = maxBuses>0 && cycH>0 ? (maxBuses / cycH) : 0;
    const actualVPH = actualVehPerHour(globalTargetVPH, maxThrough);
    const capPH = capacityPerHour(actualVPH);
    const avgWait = avgWaitMin(actualVPH);

    // Service window
    const withinService = dayMinutes >= (serviceStartHour*60) && dayMinutes < (serviceEndHour*60);
    const serviceHoursToday = Math.max(0, serviceEndHour - serviceStartHour);

    // Demand potential
    const demandPH = useMemo(()=> demandPerHour({ stops, land, population, poiMap, poiJobsBoost }), [stops, land, population, poiMap]);
    const routeEstimateMap = useMemo(()=>{
      const map = new Map();
      routes.forEach(route => {
        if(!route){
          return;
        }
        if(route.stops.length < 2){
          map.set(route.id, null);
          return;
        }
        map.set(route.id, estimateRouteDemand({
          stops: route.stops,
          land,
          population,
          poiMap,
          fare: globalFare,
          targetVPH: globalTargetVPH,
          serviceHours: serviceHoursToday
        }));
      });
      return map;
    }, [routes, land, population, poiMap, serviceHoursToday, globalFare, globalTargetVPH]);
    const routeDemandEstimate = activeRoute ? (routeEstimateMap.get(activeRoute.id) || null) : null;

    const polylineFor = useCallback((points) => {
      if(!points || points.length < 2) return '';
      return points.map(p => `${p.x*cellSize + cellSize/2},${p.y*cellSize + cellSize/2}`).join(' ');
    }, [cellSize]);

    const routeSummaries = useMemo(() => {
      return routes.map((route, index) => {
        const estimate = routeEstimateMap.get(route.id) || null;
        const color = route.color || ROUTE_COLORS[index % ROUTE_COLORS.length];
        return {
          id: route.id,
          name: route.name,
          color,
          stops: route.stops,
          estimate,
          ridersPerDay: estimate ? Math.round(estimate.perDay) : null,
          grade: estimate?.grade || null,
          poiTypes: estimate?.poiTypesCovered || [],
          polyline: polylineFor(route.stops)
        };
      });
    }, [routes, routeEstimateMap, polylineFor]);

    const activeRouteSummary = useMemo(() => routeSummaries.find(r => r.id === activeRouteId) || null, [routeSummaries, activeRouteId]);
    const gradeOrder = ['F','D','C','B','A'];
    const networkGrade = useMemo(() => {
      const values = routeSummaries
        .map(summary => summary.grade)
        .filter(Boolean)
        .map(letter => gradeOrder.indexOf(letter))
        .filter(index => index >= 0);
      if(!values.length) return null;
      const sorted = [...values].sort((a,b) => a-b);
      const median = sorted[Math.floor(sorted.length / 2)];
      return gradeOrder[median] || null;
    }, [routeSummaries]);

    useEffect(() => {
      const estimate = activeRoute ? routeEstimateMap.get(activeRoute.id) : null;
      const heavy = !!estimate?.destHeavy;
      if(heavy && !destHeavyShownRef.current){
        banners.show({ target:'map', type:'warn', text:'Mostly destinations; connect homes to grow ridership.'});
      }
      destHeavyShownRef.current = heavy;
    }, [activeRoute, routeEstimateMap, banners]);

    // Build actions
    function handleCellClick(event,x,y){
      if(!activeRoute) return;
      if(running){ banners.show({ target:'map', type:'info', text:'Pause to edit route — click Pause to add stops.'}); return; }
      if(event.shiftKey){
        updateActiveRoute(route => {
          if(!route.stops.some(p => p.x === x && p.y === y)) return route;
          return { ...route, stops: route.stops.filter(p => !(p.x === x && p.y === y)) };
        });
        return;
      }
      let addedPoint = null;
      updateActiveRoute(route => {
        const prevStops = route.stops;
        if(prevStops.some(p => p.x === x && p.y === y)) return route;
        let nextX = x;
        let nextY = y;
        if(prevStops.length){
          const last = prevStops[prevStops.length - 1];
          const dx = nextX - last.x;
          const dy = nextY - last.y;
          if(dx !== 0 && dy !== 0){
            if(Math.abs(dx) >= Math.abs(dy)){
              nextY = last.y;
            } else {
              nextX = last.x;
            }
          }
        }
        if(prevStops.some(p => p.x === nextX && p.y === nextY)) return route;
        addedPoint = { x: nextX, y: nextY };
        return { ...route, stops: [...prevStops, addedPoint] };
      });
      if(addedPoint){
        setCash(c=> c-STOP_CAPEX);
      }
    }
    function buyBuses(n){
      const unit=FUELS[fuel].busCost; const disc=n>=10?0.10:n>=5?0.05:0; const total=Math.round(unit*n*(1-disc));
      if(running || cash<total) return; setCash(c=>c-total); setFleet(f=>f+n); setAvgBusAge(a=> (a*fleet)/(fleet+n));
    }
    function expandDepot(){ if(running || cash<DEPOT_EXPANSION_COST) return; setCash(c=>c-DEPOT_EXPANSION_COST); setDepotCap(c=>c+DEPOT_EXPANSION_STEP); }
    function hireDrivers(n){ if(running) return; setDrivers(d=> Math.max(0,d+n)); }
    function handleAddRoute(){
      const nextId = `r${++TS.routeSeq}`;
      setRoutes(prev => {
        const color = ROUTE_COLORS[prev.length % ROUTE_COLORS.length];
        return [...prev, { id: nextId, name: `Route ${TS.routeSeq}`, stops: [], color }];
      });
      setActiveRouteId(nextId);
      setRunning(false);
      setAutoStarted(false);
      destHeavyShownRef.current = false;
    }

    // Auto-start when a route exists (≥3 stops)
    useEffect(()=>{
      if(!autoStarted && !running && stops.length>=3){
        setAutoStarted(true);
        setRunning(true);
        banners.show({ target:'map', type:'success', text:'🚌 Service started — simulation running.'});
      }
    }, [stops.length, autoStarted, running]);

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
      const years = Math.floor(nextTotalMinutes/525600);
      setPopulation(START_POP + years*POP_GROWTH_PER_YEAR);
    }, [serviceHoursToday, population, graduated, banners]);

    // Tick
    useEffect(()=>{
      if(!running) return;
      const id=setInterval(()=>{
        let localDayMinutes = dayMinutes;
        let localTotalMinutes = totalMinutes;
        let localDayVehHours = dayVehHours;
        let localCash = cash;
        let localEffSpeed = effSpeed;
        let localRidership = ridershipHour;
        let localLoad = loadFactor;
        let finance = financeAccumulatorRef.current;

        for(let step=0; step<speed; step++){
          const serviceStartMin = serviceStartHour * 60;
          const serviceEndMin = serviceEndHour * 60;
          const currentWithinService = localDayMinutes >= serviceStartMin && localDayMinutes < serviceEndMin;
          let minutesAdvance = SIM_MINUTES_PER_TICK;
          if(autoSkipIdle && !currentWithinService){
            if(serviceStartMin !== serviceEndMin){
              if(localDayMinutes < serviceStartMin){
                minutesAdvance = serviceStartMin - localDayMinutes;
              } else {
                minutesAdvance = (1440 - localDayMinutes) + serviceStartMin;
              }
            }
          }

          const demand = (currentWithinService ? demandPH : 0) * priceFactor(globalFare) * waitFactor(avgWait);
          const servedPH = Math.min(demand, capPH);
          const load = capPH>0 ? servedPH/capPH : 0;
          const nextSpeed = effSpeedFromLoad(load);

          const driversDailyCap = drivers * SHIFT_HOURS;
          const addVehHours = currentWithinService ? (actualVPH / 60) * minutesAdvance : 0;
          const newDayVehHrs = localDayVehHours + addVehHours;
          const overtime = newDayVehHrs > driversDailyCap;
          const wage = DRIVER_WAGE_PER_HOUR * (overtime? OVERTIME_MULT:1);
          const costPerKm = FUELS[fuel].costPerKm * (avgBusAge<=5?1:(1+0.05*(avgBusAge-5)));
          const hourlyMaint = (fleet * (BASE_MAINT_PER_BUS_YEAR * (avgBusAge<=5?1:(1+0.05*(avgBusAge-5))))) / (365*24);

          const delta = financesMinute({
            withinService: currentWithinService, servedPerHour: servedPH, fare: globalFare,
            actualVehPerHour: actualVPH, wageRate: wage, overheadPerVehHour: OVERHEAD_PER_VEH_HOUR,
            speedKmH: nextSpeed, costPerKm, hourlyMaint, staffingPerMinute: 0
          });

          const revenuePerMinute = currentWithinService ? (servedPH * globalFare) / 60 : 0;
          const opCostPerHour = (currentWithinService ? (actualVPH * (wage + OVERHEAD_PER_VEH_HOUR) + actualVPH * (nextSpeed * costPerKm)) : 0) + hourlyMaint;
          const opCostPerMinute = opCostPerHour / 60;
          const subsidyBoardingPerMinute = currentWithinService ? (servedPH * SUBSIDY_PER_BOARDING) / 60 : 0;
          const gapPerMinute = Math.max(0, opCostPerMinute - revenuePerMinute - subsidyBoardingPerMinute);
          const subsidyResidualPerMinute = gapPerMinute * RESIDUAL_GAP_SHARE;
          const incomePerMinute = revenuePerMinute + subsidyBoardingPerMinute + subsidyResidualPerMinute;
          const costsPerMinute = opCostPerMinute;

          finance.income += incomePerMinute * minutesAdvance;
          finance.costs += costsPerMinute * minutesAdvance;

          localCash += delta * minutesAdvance;
          localRidership = currentWithinService ? servedPH : 0;
          localLoad = load;
          localEffSpeed = nextSpeed;

          const nm = localDayMinutes + minutesAdvance;
          const tm = localTotalMinutes + minutesAdvance;
          const rollover = nm >= 1440;
          const nextDayMinutes = rollover ? (nm % 1440) : nm;
          localDayMinutes = nextDayMinutes;
          localTotalMinutes = tm;
          localDayVehHours = rollover ? addVehHours : newDayVehHrs;

          if(rollover){
            const net = finance.income - finance.costs;
            setLastDayFinance({ income: finance.income, costs: finance.costs, net });
            financeAccumulatorRef.current = { income:0, costs:0 };
            finance = financeAccumulatorRef.current;
            handleDayRollover(servedPH, tm);
          }
        }

        setCash(localCash);
        setRidershipHour(localRidership);
        setLoadFactor(localLoad);
        setEffSpeed(localEffSpeed);
        setDayMinutes(localDayMinutes);
        setTotalMinutes(localTotalMinutes);
        setDayVehHours(localDayVehHours);
      }, TICK_MS);
      return ()=> clearInterval(id);
    }, [running, speed, autoSkipIdle, globalFare, avgWait, capPH, demandPH, actualVPH, fuel, avgBusAge, drivers, dayVehHours, dayMinutes, totalMinutes, serviceStartHour, serviceEndHour, handleDayRollover, fleet, cash, ridershipHour, loadFactor, effSpeed]);

    // Milestones / advisories
    const lastMilestoneRef = useRef(0);
    useEffect(()=>{ [1,2,3,5].forEach(m=>{ if(modeShare>=m && lastMilestoneRef.current<m){ lastMilestoneRef.current=m; banners.show({ type:m===5?'celebrate':'success', text:`Ridership milestone: ${m}%`} ); } }); }, [modeShare]);
    useEffect(()=>{ if(cash < 250000) banners.show({ type:'warn', text:'Agency funds are low.'}); }, [cash]);
    useEffect(()=>{ if(loadFactor>0.9) banners.show({ type:'info', text:'Buses are overcrowded — add service.'}); }, [loadFactor]);

    // UI helpers
    const fmtMoney = v => v.toLocaleString(undefined,{style:'currency',currency:'USD', maximumFractionDigits:0});
    const dayNumber = Math.floor(totalMinutes / 1440) + 1;
    const hours = Math.floor(dayMinutes/60).toString().padStart(2,'0');
    const minutes = (dayMinutes%60).toString().padStart(2,'0');
    const serviceLabel = withinService ? 'In service' : 'Outside service';
    const showJumpControl = !withinService && serviceHoursToday > 0;
    const estimatedRidersPerDay = routeDemandEstimate ? Math.round(routeDemandEstimate.perDay) : null;
    const dailyIncome = lastDayFinance.income;
    const dailyCosts = lastDayFinance.costs;
    const dailyNet = lastDayFinance.net;
    const dailyNetClass = dailyNet >= 0 ? 'text-emerald-600' : 'text-rose-600';
    const speedOptions = [1,4,10];
    const speedLabels = { 1: '▶ 1×', 4: '⏩ 4×', 10: '⏩⏩ 10×' };

    const handleToggleRunning = () => {
      if(!running){
        setAutoStarted(true);
      }
      setRunning(r=>!r);
    };

    const resetGame = (nextSeed) => {
      setRunning(false);
      setAutoStarted(false);
      TS.routeSeq = 1;
      const baseRouteId = `r${TS.routeSeq}`;
      const baseRoute = { id: baseRouteId, name: `Route ${TS.routeSeq}`, stops: [], color: ROUTE_COLORS[0] };
      setRoutes([baseRoute]);
      setActiveRouteId(baseRouteId);
      destHeavyShownRef.current = false;
      setGlobalFare(2.0);
      setGlobalTargetVPH(6);
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
      setSpeed(1);
      setPopulation(START_POP);
      setModeShare(0);
      setStreakDays(0);
      setGraduated(false);
      setServiceStartHour(DEFAULT_SERVICE_START_HOUR);
      setServiceEndHour(DEFAULT_SERVICE_END_HOUR);
      financeAccumulatorRef.current = { income:0, costs:0 };
      setLastDayFinance({ income:0, costs:0, net:0 });
      const updatedSeed = typeof nextSeed === 'number' ? nextSeed : seed;
      setPoiMap(generatePOIs(updatedSeed, START_POP));
      if(typeof nextSeed === 'number'){
        setSeed(updatedSeed);
      }
    };

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
            const finance = financeAccumulatorRef.current;
            const net = finance.income - finance.costs;
            setLastDayFinance({ income: finance.income, costs: finance.costs, net });
            financeAccumulatorRef.current = { income:0, costs:0 };
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
        banners.show({ target:'map', type:'info', text:'Service window opened — riders now boarding.'});
      }
      prevServiceRef.current = withinService;
    }, [withinService, banners]);


  // Render
  return (
    <React.Fragment>
      <div className="relative min-h-screen w-full bg-slate-50 text-slate-900">
        {banners.hudView}
        <div className="absolute top-4 right-4 z-40 flex items-center gap-2 rounded-xl border bg-white/90 px-3 py-2 shadow">
          <button
            onClick={handleToggleRunning}
            className={`rounded-lg border px-3 py-1.5 text-sm font-semibold ${running ? 'border-amber-400 bg-amber-100 text-amber-700' : 'border-sky-500 bg-sky-500 text-white hover:bg-sky-600'}`}
          >
            {running ? '⏸ Pause' : '▶ Play'}
          </button>
          {speedOptions.map(opt => (
            <button
              key={opt}
              onClick={()=> setSpeed(opt)}
              className={`rounded-lg border px-3 py-1.5 text-sm font-semibold ${speed===opt ? 'border-sky-400 bg-sky-100 text-sky-700' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'}`}
            >
              {speedLabels[opt]}
            </button>
          ))}
          <button
            onClick={()=> setSettingsOpen(true)}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-lg leading-none text-slate-600 hover:bg-slate-100"
            aria-label="Open settings"
          >
            ⚙️
          </button>
        </div>

        <div className="mx-auto max-w-screen-2xl px-6 py-6">
          <div className="flex flex-col items-center text-center">
            <h1 className="text-2xl font-semibold tracking-tight">Transit Simulator</h1>
            <p className="text-sm text-slate-600">Tutorial City · Population {population.toLocaleString()} · Goal: {MODE_SHARE_TARGET}% for {MODE_SHARE_STREAK_DAYS} days</p>
            <p className="mt-1 text-sm text-slate-700">
              Network Grade: <span className="font-semibold text-slate-900">{networkGrade ?? '—'}</span>
            </p>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-3 text-sm text-slate-700 md:justify-start">
            <span>Day {dayNumber} · {hours}:{minutes} — {serviceLabel}</span>
            {showJumpControl && (
              <button onClick={handleJumpToService} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium hover:bg-slate-100">Jump to next service start</button>
            )}
          </div>
        </div>

        <div className="grid h-[calc(100vh-6rem)] grid-cols-1 items-start gap-4 px-6 pb-10 sm:px-8 lg:grid-cols-[1fr_auto_1fr]">
          <div className="order-2 flex h-full flex-col gap-4 overflow-y-auto rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm lg:order-1">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xs uppercase text-slate-500">Cash</div>
                <div className={`text-2xl font-semibold ${cash<0?'text-rose-600':'text-emerald-600'}`}>{fmtMoney(cash)}</div>
              </div>
              <div className="text-right">
                <div className="text-xs uppercase text-slate-500">Riders / hr</div>
                <div className="text-xl font-semibold">{Math.round(ridershipHour).toLocaleString()}</div>
                <div className="text-xs text-slate-500">Load factor {(loadFactor*100).toFixed(0)}%</div>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 text-xs text-slate-600 sm:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="text-sm font-semibold text-slate-900">Operations</div>
                <div className="mt-1 flex items-center justify-between"><span>Fleet</span><span className="font-semibold text-slate-900">{fleet}</span></div>
                <div className="mt-1 flex items-center justify-between"><span>Depot cap</span><span className="font-semibold text-slate-900">{depotCap}</span></div>
                <div className="mt-1 flex items-center justify-between"><span>Drivers</span><span className="font-semibold text-slate-900">{drivers}</span></div>
                <div className="mt-2 text-xs text-slate-500">Service {serviceStartHour}:00–{serviceEndHour}:00 ({serviceHoursToday} hrs)</div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="text-sm font-semibold text-slate-900">Performance</div>
                <div className="mt-1 flex items-center justify-between"><span>Mode share</span><span className="font-semibold text-slate-900">{modeShare.toFixed(1)}%</span></div>
                <div className="mt-1 flex items-center justify-between"><span>Speed</span><span className="font-semibold text-slate-900">{effSpeed.toFixed(1)} km/h</span></div>
                <div className="mt-1 flex items-center justify-between"><span>Actual VPH</span><span className="font-semibold text-slate-900">{actualVPH.toFixed(1)}</span></div>
                <div className="mt-1 flex items-center justify-between"><span>Capacity / hr</span><span className="font-semibold text-slate-900">{Math.round(capPH).toLocaleString()}</span></div>
              </div>
            </div>
            <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
              <div className="flex items-center justify-between"><span>Estimated riders/day</span><span className="font-semibold text-slate-900">{estimatedRidersPerDay ? estimatedRidersPerDay.toLocaleString() : '—'}</span></div>
              <div className="mt-2 flex flex-col gap-1">
                <span className="font-medium text-slate-600">Daily money:</span>
                <span>{fmtMoney(dailyIncome)} – {fmtMoney(dailyCosts)} = <span className={dailyNetClass}>{fmtMoney(dailyNet)}</span></span>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <div className="flex flex-col">
                  <span>Target</span>
                  <span className="font-semibold text-slate-700">{Math.round(globalTargetVPH)} veh/hr</span>
                </div>
                <div className="flex flex-col">
                  <span>Actual</span>
                  <span className="font-semibold text-slate-700">{Math.floor(actualVPH)} veh/hr</span>
                </div>
                <div className="flex flex-col items-end text-right">
                  <span className="flex items-center justify-end gap-1">Round-trip<InfoTip text="Out + back + layover" /></span>
                  <span className="font-semibold text-slate-700">{(cycH*60).toFixed(0)} min</span>
                </div>
              </div>
              <div className="mt-3">
                <div className="flex justify-between"><span>Transit mode share</span><span>{modeShare.toFixed(2)}% / {MODE_SHARE_TARGET}%</span></div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-200">
                  <div className="h-full bg-sky-500" style={{ width: `${Math.min(100, (modeShare/MODE_SHARE_TARGET)*100)}%` }} />
                </div>
              </div>
            </div>
            <div className="mt-auto flex flex-wrap gap-2">
              <button onClick={()=> resetGame()} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-100">Reset</button>
              <button onClick={()=> resetGame(seed + 1)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-100">New Map</button>
            </div>
          </div>

          <div className="order-1 flex h-full min-h-[420px] flex-col gap-4 lg:order-2">
            <div className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <span className="inline-flex h-3 w-3 rounded-full" style={{ backgroundColor: activeRouteSummary?.color || '#0ea5e9' }} />
                  <span>{activeRoute?.name || 'Route'}</span>
                </div>
                <div className="text-xs text-slate-600">
                  {estimatedRidersPerDay ? `${estimatedRidersPerDay.toLocaleString()} riders/day` : 'Add stops to estimate'}
                </div>
              </div>
              <div ref={mapContainerRef} className="relative mt-3 flex-1 overflow-hidden rounded-2xl bg-slate-100">
                <MapToast toasts={banners.mapQueue} onDismiss={banners.dismiss} />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="relative" style={{ width: canvasSize, height: canvasSize }}>
                    <div className="absolute inset-0">
                      {Array.from({ length: GRID }).map((_, y) => (
                        <div key={y} className="flex">
                          {Array.from({ length: GRID }).map((__, x) => {
                            const p = land.pop[y][x], jb = land.jobs[y][x], poi = poiMap.get(`${x},${y}`);
                            const bg = p===0? '#EFF6FF' : p===1? '#DBEAFE' : p===2? '#BFDBFE' : '#93C5FD';
                            const outline = jb>0 ? '1px solid rgba(234,179,8,0.25)' : '1px solid rgba(2,6,23,0.06)';
                            return (
                              <div
                                key={`${x}-${y}`}
                                onClick={(e)=> handleCellClick(e,x,y)}
                                style={{ width: cellSize, height: cellSize, backgroundColor:bg, outline, cursor:'crosshair', position:'relative' }}
                              >
                                {poi && <div style={{position:'absolute', inset:'0', display:'grid', placeItems:'center', fontSize:'12px'}}>{poiIcon(poi)}</div>}
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                    <svg
                      className="absolute inset-0 h-full w-full"
                      width={canvasSize}
                      height={canvasSize}
                      viewBox={`0 0 ${canvasSize} ${canvasSize}`}
                      preserveAspectRatio="none"
                      style={{ pointerEvents:'none' }}
                    >
                      {routeSummaries.map(summary => (
                        summary.polyline && (
                          <polyline
                            key={summary.id}
                            points={summary.polyline}
                            fill="none"
                            stroke={summary.color}
                            strokeWidth={summary.id === activeRouteId ? 4 : 2}
                            strokeLinejoin="round"
                            strokeLinecap="round"
                            strokeOpacity={summary.id === activeRouteId ? 1 : 0.4}
                          />
                        )
                      ))}
                    </svg>
                    {routeSummaries.map(summary => (
                      summary.stops.map((point, idx) => (
                        <div
                          key={`${summary.id}-${idx}`}
                          className="absolute -translate-x-1/2 -translate-y-1/2"
                          style={{ left: point.x * cellSize + cellSize/2, top: point.y * cellSize + cellSize/2 }}
                        >
                          <div
                            className={`rounded-full border-2 ${summary.id === activeRouteId ? 'h-3.5 w-3.5' : 'h-2.5 w-2.5 opacity-80'}`}
                            style={{ borderColor: summary.color, backgroundColor: summary.id === activeRouteId ? summary.color : '#fff' }}
                          />
                        </div>
                      ))
                    ))}
                  </div>
                </div>
                <p className="pointer-events-none mt-3 text-center text-xs text-slate-500">Click to add stops · Shift-click to remove · Each route can be edited when paused.</p>
              </div>
              <div className="mt-4 rounded-2xl border border-slate-200 bg-white/80 p-3 text-xs text-slate-600">
                <div className="text-sm font-semibold text-slate-900">Route Legend</div>
                <div className="mt-2 space-y-2">
                  {routeSummaries.map(summary => (
                    <div key={summary.id} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex h-2.5 w-2.5 rounded-full" style={{ backgroundColor: summary.color }} />
                        <span className="text-sm font-medium text-slate-900">{summary.name}</span>
                      </div>
                      <div className="flex items-center gap-3 text-xs font-semibold text-slate-900">
                        <span>{summary.ridersPerDay !== null ? `${summary.ridersPerDay.toLocaleString()} / day` : '—'}</span>
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-white text-[11px] font-bold text-slate-700">{summary.grade ?? '–'}</span>
                      </div>
                    </div>
                  ))}
                  {!routeSummaries.length && <div className="text-center text-xs text-slate-500">No routes yet — add one to begin planning.</div>}
                </div>
              </div>
            </div>
          </div>

          <div className="order-3 flex h-full flex-col gap-4 overflow-y-auto rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm">
            <div>
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium text-slate-900">Routes</div>
                <button onClick={handleAddRoute} className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-medium hover:bg-slate-100">New Route</button>
              </div>
              <div className="mt-3 space-y-2">
                {routeSummaries.map(summary => {
                  const isActive = summary.id === activeRouteId;
                  return (
                    <button
                      key={summary.id}
                      onClick={()=> { destHeavyShownRef.current = false; setActiveRouteId(summary.id); }}
                      className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-sm ${isActive ? 'border-sky-300 bg-sky-100 text-slate-900' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}
                    >
                      <span className="flex items-center gap-2">
                        <span className="inline-flex h-2.5 w-2.5 rounded-full" style={{ backgroundColor: summary.color }} />
                        <span className="font-medium">{summary.name}</span>
                      </span>
                      <span className="flex items-center gap-2 text-xs font-semibold text-slate-900">
                        <span>{summary.ridersPerDay !== null ? `${summary.ridersPerDay.toLocaleString()} / day` : '—'}</span>
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-white text-[11px] font-bold text-slate-700">{summary.grade ?? '–'}</span>
                      </span>
                    </button>
                  );
                })}
                {!routeSummaries.length && (
                  <div className="rounded-xl border border-dashed border-slate-300 bg-white px-3 py-4 text-center text-xs text-slate-500">Create a route to begin service.</div>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium text-slate-900">Global Target Frequency</span>
                <NumberStepper
                  value={globalTargetVPH}
                  min={2}
                  max={20}
                  step={1}
                  onChange={(next)=> setGlobalTargetVPH(Math.round(next))}
                  format={(v)=> `${Math.round(v)} veh/hr`}
                />
              </div>
              <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                <div className="mb-1 text-sm font-medium text-slate-900">Service Hours</div>
                <div className="grid grid-cols-2 gap-3">
                  <label>Start: <input type="number" min="0" max="23" value={serviceStartHour} onChange={e=> setServiceStartHour(clamp(parseInt(e.target.value)||0,0,23))} className="ml-1 w-16 rounded border border-slate-300 px-1" />:00</label>
                  <label>End: <input type="number" min="1" max="24" value={serviceEndHour} onChange={e=> setServiceEndHour(clamp(parseInt(e.target.value)||0,1,24))} className="ml-1 w-16 rounded border border-slate-300 px-1" />:00</label>
                </div>
                <div className="mt-1 text-slate-600">Current span: {Math.max(0, serviceEndHour - serviceStartHour)} hours/day</div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 text-xs text-slate-700 shadow-sm">
              <div className="mb-2 text-sm font-medium text-slate-900">Fleet & Depot</div>
              <div className="text-sm">Buses: <span className="font-semibold">{fleet}</span> · Depot cap: <span className="font-semibold">{depotCap}</span></div>
              <div className="mt-1 flex items-center gap-1">
                <span>Max buses/hour</span>
                <InfoTip text="Theoretical ceiling given fleet, depot, and round-trip time if all buses ran this line" />
                <span className="ml-auto font-semibold text-slate-700">{Math.floor(maxThrough)} veh/hr</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button onClick={()=> buyBuses(1)} className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs hover:bg-slate-100">Buy 1 ({FUELS[fuel].busCost.toLocaleString()})</button>
                <button onClick={()=> buyBuses(5)} className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs hover:bg-slate-100">Buy 5 (−5%)</button>
                <button onClick={()=> buyBuses(10)} className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs hover:bg-slate-100">Buy 10 (−10%)</button>
                <button onClick={expandDepot} className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs hover:bg-slate-100">Expand Depot +{DEPOT_EXPANSION_STEP} ({DEPOT_EXPANSION_COST.toLocaleString()})</button>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 text-xs text-slate-700 shadow-sm">
              <div className="mb-2 text-sm font-medium text-slate-900">Fuel & Drivers</div>
              <div className="flex flex-wrap gap-2">
                {Object.keys(FUELS).map(k=>(
                  <button key={k} onClick={()=> setFuel(k)} className={`rounded-lg border px-2 py-1 text-xs ${fuel===k?'border-sky-300 bg-sky-100':'border-slate-300 bg-white hover:bg-slate-100'}`}>{k}</button>
                ))}
              </div>
              <div className="mt-2 text-sm">$ / km: <span className="font-semibold">{FUELS[fuel].costPerKm.toFixed(2)}</span></div>
              <div className="mt-1 text-sm">
                Drivers: <span className="font-semibold">{drivers}</span> (cap {drivers*SHIFT_HOURS} drv-hrs/day)
                <button onClick={()=> hireDrivers(+10)} className="ml-2 rounded border border-slate-300 bg-white px-2 py-0.5 text-xs hover:bg-slate-100">+10</button>
                <button onClick={()=> hireDrivers(-10)} className="ml-1 rounded border border-slate-300 bg-white px-2 py-0.5 text-xs hover:bg-slate-100">−10</button>
              </div>
            </div>
          </div>
        </div>

        {settingsOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
            <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-slate-900">Settings</h2>
                <button onClick={()=> setSettingsOpen(false)} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm text-slate-600 hover:bg-slate-100">✕</button>
              </div>
              <div className="mt-4 space-y-5 text-sm text-slate-700">
                <label className="flex items-center justify-between gap-3">
                  <span className="font-medium text-slate-800">Auto-skip idle minutes</span>
                  <input type="checkbox" checked={autoSkipIdle} onChange={e=> setAutoSkipIdle(e.target.checked)} className="h-4 w-4 rounded border border-slate-300" />
                </label>
                <div>
                  <div className="font-medium text-slate-800">Global Fare</div>
                  <div className="mt-2">
                    <NumberStepper
                      value={globalFare}
                      min={1.5}
                      max={3.0}
                      step={0.05}
                      onChange={setGlobalFare}
                      format={(v)=> `$${Number(v).toFixed(2)}`}
                    />
                  </div>
                </div>
              </div>
              <div className="mt-6 flex justify-end">
                <button onClick={()=> setSettingsOpen(false)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-100">Close</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </React.Fragment>
  );
  }
  TS.App = App;

  ReactDOM.createRoot(document.getElementById('root')).render(<App />);
})(window);
