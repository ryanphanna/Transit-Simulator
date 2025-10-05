// City & grid
export const GRID = 20;
export const CELL_SIZE = 24;
export const CANVAS_SIZE = GRID * CELL_SIZE;

export const START_POP = 100_000;
export const POP_GROWTH_PER_YEAR = 5_000;
export const MODE_SHARE_TARGET = 5;       // %
export const MODE_SHARE_STREAK_DAYS = 30; // days

// Service
export const DEFAULT_SERVICE_START_HOUR = 6;
export const DEFAULT_SERVICE_END_HOUR   = 22;

// Economics
export const STARTING_CASH = 5_000_000;
export const STOP_CAPEX = 15_000;
export const DRIVER_WAGE_PER_HOUR = 60;
export const OVERHEAD_PER_VEH_HOUR = 60;

// Vehicles
export const VEHICLE_SPEED_BASE = 25; // km/h
export const SEATED_CAP = 40, STANDING_CAP = 25, CRUSH_EXTRA = 10;
export const VEHICLE_CAPACITY = SEATED_CAP + STANDING_CAP + CRUSH_EXTRA; // 75
export const INITIAL_FLEET = 10;

export const DEPOT_BASE_CAPACITY = 25;
export const DEPOT_EXPANSION_STEP = 50;
export const DEPOT_EXPANSION_COST = 8_000_000;
export const TURNAROUND_MIN = 6;

// Fuels
export const FUELS = {
  Diesel: { busCost: 550_000, costPerKm: 1.10, emissions: 1.0 },
  CNG:    { busCost: 600_000, costPerKm: 0.90, emissions: 0.7 },
  BEV:    { busCost: 900_000, costPerKm: 0.50, emissions: 0.2 },
};

// Maintenance
export const BASE_MAINT_PER_BUS_YEAR = 35_000;

// Drivers
export const INITIAL_DRIVERS = 20;
export const SHIFT_HOURS = 8;
export const OVERTIME_MULT = 1.5;

// Demand
export const BASE_DEMAND_PER_CELL_PER_HOUR = 11.5;
export const JOB_ATTRACTION_PER_CELL = 10;
export const COVERAGE_RADIUS = 3;
export const WALK_DECAY = 0.35;
export const TARGET_STOP_SPACING_CELLS = 3;
export const FARE_REF = 2.0;
export const FARE_ELASTICITY = -0.25;
export const WAIT_TIME_SENSITIVITY = 0.06;

// Subsidy
export const SUBSIDY_PER_BOARDING = 1.00;
export const RESIDUAL_GAP_SHARE = 0.2;

// Time
export const SIM_MINUTES_PER_TICK = 1;
export const TICK_MS = 600;

// POIs
export const AIRPORT_POP_THRESHOLD = 150_000;
export const POI_TYPES = [
  { key:'retail',  label:'Retail',  icon:'🛍️', jobsBoost: 1.0 },
  { key:'school',  label:'School',  icon:'🏫', jobsBoost: 0.8 },
  { key:'tourism', label:'Tourism', icon:'🎡', jobsBoost: 1.2 },
  { key:'airport', label:'Airport', icon:'✈️', jobsBoost: 2.0 },
];
