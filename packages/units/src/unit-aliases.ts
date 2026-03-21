/**
 * Shared unit alias map.
 *
 * Maps every recognised unit string (symbol, singular, plural) to the
 * canonical constructor function name exported from types.ts.
 *
 * This single source of truth is consumed by:
 *   - index.ts  (runtime fallback `units` tagged-template function)
 *   - macro.ts  (compile-time macro expansion)
 */
export const UNIT_ALIASES: Record<string, string> = {
  // Length
  m: "meters",
  meter: "meters",
  meters: "meters",
  km: "kilometers",
  kilometer: "kilometers",
  kilometers: "kilometers",
  cm: "centimeters",
  centimeter: "centimeters",
  centimeters: "centimeters",
  mm: "millimeters",
  millimeter: "millimeters",
  millimeters: "millimeters",
  ft: "feet",
  foot: "feet",
  feet: "feet",
  in: "inches",
  inch: "inches",
  inches: "inches",
  mi: "miles",
  mile: "miles",
  miles: "miles",

  // Mass
  kg: "kilograms",
  kilogram: "kilograms",
  kilograms: "kilograms",
  g: "grams",
  gram: "grams",
  grams: "grams",
  mg: "milligrams",
  milligram: "milligrams",
  milligrams: "milligrams",
  lb: "pounds",
  lbs: "pounds",
  pound: "pounds",
  pounds: "pounds",

  // Time
  s: "seconds",
  sec: "seconds",
  second: "seconds",
  seconds: "seconds",
  min: "minutes",
  minute: "minutes",
  minutes: "minutes",
  h: "hours",
  hr: "hours",
  hour: "hours",
  hours: "hours",
  d: "days",
  day: "days",
  days: "days",
  ms: "milliseconds",
  millisecond: "milliseconds",
  milliseconds: "milliseconds",

  // Velocity
  "m/s": "metersPerSecond",
  "km/h": "kilometersPerHour",
  kph: "kilometersPerHour",
  mph: "milesPerHour",

  // Acceleration
  "m/s²": "metersPerSecondSquared",
  "m/s^2": "metersPerSecondSquared",

  // Force
  N: "newtons",
  newton: "newtons",
  newtons: "newtons",

  // Energy
  J: "joules",
  joule: "joules",
  joules: "joules",
  kJ: "kilojoules",
  kilojoule: "kilojoules",
  kilojoules: "kilojoules",
  cal: "calories",
  calorie: "calories",
  calories: "calories",
  kcal: "kilocalories",
  kilocalorie: "kilocalories",
  kilocalories: "kilocalories",

  // Power
  W: "watts",
  watt: "watts",
  watts: "watts",
  kW: "kilowatts",
  kilowatt: "kilowatts",
  kilowatts: "kilowatts",

  // Temperature
  K: "kelvin",
  kelvin: "kelvin",
  "°C": "celsius",
  C: "celsius",
  celsius: "celsius",
  "°F": "fahrenheit",
  F: "fahrenheit",
  fahrenheit: "fahrenheit",

  // Frequency
  Hz: "hertz",
  hertz: "hertz",
  kHz: "kilohertz",
  kilohertz: "kilohertz",
  MHz: "megahertz",
  megahertz: "megahertz",
  GHz: "gigahertz",
  gigahertz: "gigahertz",

  // Voltage
  V: "volts",
  volt: "volts",
  volts: "volts",
  mV: "millivolts",
  millivolt: "millivolts",
  millivolts: "millivolts",
  kV: "kilovolts",
  kilovolt: "kilovolts",
  kilovolts: "kilovolts",

  // Resistance
  Ω: "ohms",
  ohm: "ohms",
  ohms: "ohms",
  kΩ: "kilohms",
  kilohm: "kilohms",
  kilohms: "kilohms",
  MΩ: "megohms",
  megohm: "megohms",
  megohms: "megohms",

  // Pressure
  Pa: "pascals",
  pascal: "pascals",
  pascals: "pascals",
  kPa: "kilopascals",
  kilopascal: "kilopascals",
  kilopascals: "kilopascals",
  atm: "atmospheres",
  atmosphere: "atmospheres",
  atmospheres: "atmospheres",
};
