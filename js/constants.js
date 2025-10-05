(function (g) {
  const TS = g.TS = g.TS || {};
  TS.GRID = 20;
  TS.CELL_SIZE = 24;
  TS.CANVAS_SIZE = TS.GRID * TS.CELL_SIZE;
  TS.START_POP = 100000;
  TS.POP_GROWTH_PER_YEAR = 5000;
  TS.MODE_SHARE_TARGET = 5;
  TS.MODE_SHARE_STREAK_DAYS = 30;
  TS.DEFAULT_SERVICE_START_HOUR = 6;
  TS.DEFAULT_SERVICE_END_HOUR = 22;
  TS.STARTING_CASH = 5000000;
  TS.STOP_CAPEX = 15000;
  TS.DRIVER_WAGE_PER_HOUR = 60;
  TS.OVERHEAD_PER_VEH_HOUR = 60;
  TS.VEHICLE_SPEED_BASE = 25;
  TS.SEATED_CAP = 40; TS.STANDING_CAP = 25; TS.CRUSH_EXTRA = 10;
  TS.VEHICLE_CAPACITY = TS.SEATED_CAP + TS.STANDING_CAP + TS.CRUSH_EXTRA;
  TS.INITIAL_FLEET = 10;
  TS.DEPOT_BASE_CAPACITY = 25;
  TS.DEPOT_EXPANSION_STEP = 50;
  TS.DEPOT_EXPANSION_COST = 8000000;
  TS.TURNAROUND_MIN = 6;
  TS.FUELS = {
    Diesel: { busCost: 550000, costPerKm: 1.10, emissions: 1.0 },
    CNG:    { busCost: 600000, costPerKm: 0.90, emissions: 0.7 },
    BEV:    { busCost: 900000, costPerKm: 0.50, emissions: 0.2 },
  };
  TS.BASE_MAINT_PER_BUS_YEAR = 35000;
  TS.INITIAL_DRIVERS = 20;
  TS.SHIFT_HOURS = 8;
  TS.OVERTIME_MULT = 1.5;
  TS.BASE_DEMAND_PER_CELL_PER_HOUR = 11.5;
  TS.JOB_ATTRACTION_PER_CELL = 10;
  TS.COVERAGE_RADIUS = 3;
  TS.WALK_DECAY = 0.35;
  TS.TARGET_STOP_SPACING_CELLS = 3;
  TS.FARE_REF = 2.0;
  TS.FARE_ELASTICITY = -0.25;
  TS.WAIT_TIME_SENSITIVITY = 0.06;
  TS.SUBSIDY_PER_BOARDING = 1.00;
  TS.RESIDUAL_GAP_SHARE = 0.2;
  TS.SIM_MINUTES_PER_TICK = 1;
  TS.TICK_MS = 600;
  TS.AIRPORT_POP_THRESHOLD = 150000;
  TS.POI_TYPES = [
    { key:'retail',     label:'Retail',     icon:'🛍️', jobsBoost: 1.0 },
    { key:'school',     label:'School',     icon:'🏫', jobsBoost: 0.8 },
    { key:'tourism',    label:'Tourism',    icon:'🎡', jobsBoost: 1.2 },
    { key:'healthcare', label:'Healthcare', icon:'🏥', jobsBoost: 1.3, minPopulation: 120000 },
    { key:'zoo',        label:'Zoo',        icon:'🦒', jobsBoost: 1.1, minPopulation: 140000 },
    { key:'airport',    label:'Airport',    icon:'✈️', jobsBoost: 2.0 },
  ];
})(window);
