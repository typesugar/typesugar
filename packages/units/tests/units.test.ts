import { describe, it, expect } from "vitest";
import {
  Unit,
  meters,
  kilometers,
  centimeters,
  millimeters,
  feet,
  inches,
  miles,
  kilograms,
  grams,
  milligrams,
  pounds,
  seconds,
  minutes,
  hours,
  days,
  milliseconds,
  metersPerSecond,
  kilometersPerHour,
  milesPerHour,
  metersPerSecondSquared,
  newtons,
  joules,
  kilojoules,
  calories,
  kilocalories,
  watts,
  kilowatts,
  kelvin,
  celsius,
  fahrenheit,
  hertz,
  kilohertz,
  megahertz,
  gigahertz,
  volts,
  millivolts,
  kilovolts,
  ohms,
  kilohms,
  megohms,
  pascals,
  kilopascals,
  atmospheres,
  units,
} from "../src/index.js";

// ==========================================================================
// 1. Unit Constructors
// ==========================================================================

describe("Unit Constructors", () => {
  describe("Length", () => {
    it("meters stores value directly (SI base)", () => {
      const u = meters(5);
      expect(u.value).toBe(5);
      expect(u.symbol).toBe("m");
    });

    it("kilometers stores value * 1000", () => {
      const u = kilometers(3);
      expect(u.value).toBe(3000);
      expect(u.symbol).toBe("km");
    });

    it("centimeters stores value / 100", () => {
      const u = centimeters(250);
      expect(u.value).toBe(2.5);
      expect(u.symbol).toBe("cm");
    });

    it("millimeters stores value / 1000", () => {
      const u = millimeters(5000);
      expect(u.value).toBe(5);
      expect(u.symbol).toBe("mm");
    });

    it("feet stores value * 0.3048", () => {
      const u = feet(10);
      expect(u.value).toBeCloseTo(3.048, 6);
      expect(u.symbol).toBe("ft");
    });

    it("inches stores value * 0.0254", () => {
      const u = inches(12);
      expect(u.value).toBeCloseTo(0.3048, 6);
      expect(u.symbol).toBe("in");
    });

    it("miles stores value * 1609.344", () => {
      const u = miles(1);
      expect(u.value).toBeCloseTo(1609.344, 6);
      expect(u.symbol).toBe("mi");
    });
  });

  describe("Mass", () => {
    it("kilograms stores value directly (SI base)", () => {
      const u = kilograms(10);
      expect(u.value).toBe(10);
      expect(u.symbol).toBe("kg");
    });

    it("grams stores value / 1000", () => {
      const u = grams(500);
      expect(u.value).toBe(0.5);
      expect(u.symbol).toBe("g");
    });

    it("milligrams stores value / 1e6", () => {
      const u = milligrams(1e6);
      expect(u.value).toBe(1);
      expect(u.symbol).toBe("mg");
    });

    it("pounds stores value * 0.453592", () => {
      const u = pounds(1);
      expect(u.value).toBeCloseTo(0.453592, 6);
      expect(u.symbol).toBe("lb");
    });
  });

  describe("Time", () => {
    it("seconds stores value directly (SI base)", () => {
      const u = seconds(60);
      expect(u.value).toBe(60);
      expect(u.symbol).toBe("s");
    });

    it("minutes stores value * 60", () => {
      const u = minutes(2);
      expect(u.value).toBe(120);
      expect(u.symbol).toBe("min");
    });

    it("hours stores value * 3600", () => {
      const u = hours(1);
      expect(u.value).toBe(3600);
      expect(u.symbol).toBe("h");
    });

    it("days stores value * 86400", () => {
      const u = days(1);
      expect(u.value).toBe(86400);
      expect(u.symbol).toBe("d");
    });

    it("milliseconds stores value / 1000", () => {
      const u = milliseconds(500);
      expect(u.value).toBe(0.5);
      expect(u.symbol).toBe("ms");
    });
  });

  describe("Velocity", () => {
    it("metersPerSecond stores value directly", () => {
      const u = metersPerSecond(10);
      expect(u.value).toBe(10);
      expect(u.symbol).toBe("m/s");
    });

    it("kilometersPerHour stores value / 3.6", () => {
      const u = kilometersPerHour(36);
      expect(u.value).toBeCloseTo(10, 6);
      expect(u.symbol).toBe("km/h");
    });

    it("milesPerHour stores value * 0.44704", () => {
      const u = milesPerHour(60);
      expect(u.value).toBeCloseTo(26.8224, 4);
      expect(u.symbol).toBe("mph");
    });
  });

  describe("Energy", () => {
    it("joules stores value directly (SI base)", () => {
      expect(joules(100).value).toBe(100);
    });

    it("kilojoules stores value * 1000", () => {
      expect(kilojoules(5).value).toBe(5000);
    });

    it("calories stores value * 4.184", () => {
      expect(calories(1).value).toBeCloseTo(4.184, 6);
    });

    it("kilocalories stores value * 4184", () => {
      expect(kilocalories(1).value).toBe(4184);
    });
  });

  describe("Power", () => {
    it("watts stores value directly (SI base)", () => {
      expect(watts(100).value).toBe(100);
    });

    it("kilowatts stores value * 1000", () => {
      expect(kilowatts(2).value).toBe(2000);
    });
  });

  describe("Pressure", () => {
    it("pascals stores value directly (SI base)", () => {
      expect(pascals(100).value).toBe(100);
    });

    it("kilopascals stores value * 1000", () => {
      expect(kilopascals(5).value).toBe(5000);
    });

    it("atmospheres stores value * 101325", () => {
      expect(atmospheres(1).value).toBe(101325);
    });
  });

  describe("Temperature", () => {
    it("kelvin stores value directly", () => {
      expect(kelvin(273.15).value).toBe(273.15);
    });

    it("celsius stores value internally as kelvin", () => {
      expect(celsius(0).value).toBeCloseTo(273.15, 6);
      expect(celsius(100).value).toBeCloseTo(373.15, 6);
    });

    it("fahrenheit stores value internally as kelvin", () => {
      expect(fahrenheit(32).value).toBeCloseTo(273.15, 6);
      expect(fahrenheit(212).value).toBeCloseTo(373.15, 6);
    });
  });

  describe("Frequency", () => {
    it("hertz stores value directly (SI base)", () => {
      expect(hertz(440).value).toBe(440);
      expect(hertz(440).symbol).toBe("Hz");
    });

    it("kilohertz stores value * 1e3", () => {
      expect(kilohertz(1).value).toBe(1000);
      expect(kilohertz(1).symbol).toBe("kHz");
    });

    it("megahertz stores value * 1e6", () => {
      expect(megahertz(1).value).toBe(1e6);
      expect(megahertz(1).symbol).toBe("MHz");
    });

    it("gigahertz stores value * 1e9", () => {
      expect(gigahertz(1).value).toBe(1e9);
      expect(gigahertz(1).symbol).toBe("GHz");
    });
  });

  describe("Voltage", () => {
    it("volts stores value directly (SI base)", () => {
      expect(volts(5).value).toBe(5);
      expect(volts(5).symbol).toBe("V");
    });

    it("millivolts stores value / 1000", () => {
      expect(millivolts(500).value).toBe(0.5);
      expect(millivolts(500).symbol).toBe("mV");
    });

    it("kilovolts stores value * 1000", () => {
      expect(kilovolts(1).value).toBe(1000);
      expect(kilovolts(1).symbol).toBe("kV");
    });
  });

  describe("Resistance", () => {
    it("ohms stores value directly (SI base)", () => {
      expect(ohms(100).value).toBe(100);
      expect(ohms(100).symbol).toBe("Ω");
    });

    it("kilohms stores value * 1000", () => {
      expect(kilohms(4.7).value).toBe(4700);
      expect(kilohms(4.7).symbol).toBe("kΩ");
    });

    it("megohms stores value * 1e6", () => {
      expect(megohms(1).value).toBe(1e6);
      expect(megohms(1).symbol).toBe("MΩ");
    });
  });
});

// ==========================================================================
// 2. Arithmetic Operations
// ==========================================================================

describe("Arithmetic", () => {
  describe("add", () => {
    it("adds two units with the same dimensions", () => {
      const result = meters(3).add(meters(7));
      expect(result.value).toBe(10);
    });

    it("adds units created with different constructors (SI internally)", () => {
      const result = meters(500).add(kilometers(1));
      expect(result.value).toBeCloseTo(1500, 6);
    });
  });

  describe("sub", () => {
    it("subtracts two units with the same dimensions", () => {
      const result = meters(10).sub(meters(3));
      expect(result.value).toBe(7);
    });

    it("handles negative results", () => {
      const result = meters(3).sub(meters(10));
      expect(result.value).toBe(-7);
    });
  });

  describe("mul", () => {
    it("multiplies two units (dimensions add)", () => {
      const area = meters(3).mul(meters(4));
      expect(area.value).toBe(12);
    });

    it("creates velocity from length / time", () => {
      const v = meters(100).div(seconds(10));
      expect(v.value).toBe(10);
    });
  });

  describe("div", () => {
    it("divides two units (dimensions subtract)", () => {
      const v = meters(100).div(seconds(5));
      expect(v.value).toBe(20);
    });

    it("returns dimensionless when dividing same dimensions", () => {
      const ratio = meters(10).div(meters(5));
      expect(ratio.value).toBe(2);
    });
  });
});

// ==========================================================================
// 3. The .to() Method — Unit Conversion
// ==========================================================================

describe(".to() conversion", () => {
  describe("Length conversions", () => {
    it("meters to kilometers", () => {
      const result = meters(1000).to(kilometers);
      expect(result.value).toBeCloseTo(1, 6);
      expect(result.symbol).toBe("km");
    });

    it("kilometers to meters", () => {
      const result = kilometers(2.5).to(meters);
      expect(result.value).toBeCloseTo(2500, 6);
      expect(result.symbol).toBe("m");
    });

    it("meters to centimeters", () => {
      const result = meters(1).to(centimeters);
      expect(result.value).toBeCloseTo(100, 6);
      expect(result.symbol).toBe("cm");
    });

    it("meters to millimeters", () => {
      const result = meters(1).to(millimeters);
      expect(result.value).toBeCloseTo(1000, 6);
      expect(result.symbol).toBe("mm");
    });

    it("meters to feet", () => {
      const result = meters(1).to(feet);
      expect(result.value).toBeCloseTo(3.28084, 4);
      expect(result.symbol).toBe("ft");
    });

    it("meters to inches", () => {
      const result = meters(1).to(inches);
      expect(result.value).toBeCloseTo(39.3701, 3);
      expect(result.symbol).toBe("in");
    });

    it("miles to kilometers", () => {
      const result = miles(1).to(kilometers);
      expect(result.value).toBeCloseTo(1.609344, 6);
      expect(result.symbol).toBe("km");
    });

    it("kilometers to miles", () => {
      const result = kilometers(10).to(miles);
      expect(result.value).toBeCloseTo(6.21371, 4);
      expect(result.symbol).toBe("mi");
    });

    it("feet to inches", () => {
      const result = feet(1).to(inches);
      expect(result.value).toBeCloseTo(12, 6);
      expect(result.symbol).toBe("in");
    });

    it("inches to centimeters", () => {
      const result = inches(1).to(centimeters);
      expect(result.value).toBeCloseTo(2.54, 6);
      expect(result.symbol).toBe("cm");
    });
  });

  describe("Mass conversions", () => {
    it("kilograms to grams", () => {
      const result = kilograms(1).to(grams);
      expect(result.value).toBeCloseTo(1000, 6);
      expect(result.symbol).toBe("g");
    });

    it("grams to kilograms", () => {
      const result = grams(500).to(kilograms);
      expect(result.value).toBeCloseTo(0.5, 6);
      expect(result.symbol).toBe("kg");
    });

    it("kilograms to milligrams", () => {
      const result = kilograms(1).to(milligrams);
      expect(result.value).toBeCloseTo(1e6, 0);
      expect(result.symbol).toBe("mg");
    });

    it("kilograms to pounds", () => {
      const result = kilograms(1).to(pounds);
      expect(result.value).toBeCloseTo(2.20462, 4);
      expect(result.symbol).toBe("lb");
    });

    it("pounds to kilograms", () => {
      const result = pounds(10).to(kilograms);
      expect(result.value).toBeCloseTo(4.53592, 4);
      expect(result.symbol).toBe("kg");
    });

    it("pounds to grams", () => {
      const result = pounds(1).to(grams);
      expect(result.value).toBeCloseTo(453.592, 3);
      expect(result.symbol).toBe("g");
    });
  });

  describe("Time conversions", () => {
    it("hours to minutes", () => {
      const result = hours(2).to(minutes);
      expect(result.value).toBeCloseTo(120, 6);
      expect(result.symbol).toBe("min");
    });

    it("minutes to seconds", () => {
      const result = minutes(5).to(seconds);
      expect(result.value).toBeCloseTo(300, 6);
      expect(result.symbol).toBe("s");
    });

    it("hours to seconds", () => {
      const result = hours(1).to(seconds);
      expect(result.value).toBeCloseTo(3600, 6);
      expect(result.symbol).toBe("s");
    });

    it("days to hours", () => {
      const result = days(1).to(hours);
      expect(result.value).toBeCloseTo(24, 6);
      expect(result.symbol).toBe("h");
    });

    it("seconds to milliseconds", () => {
      const result = seconds(1).to(milliseconds);
      expect(result.value).toBeCloseTo(1000, 6);
      expect(result.symbol).toBe("ms");
    });

    it("milliseconds to seconds", () => {
      const result = milliseconds(2500).to(seconds);
      expect(result.value).toBeCloseTo(2.5, 6);
      expect(result.symbol).toBe("s");
    });

    it("days to minutes", () => {
      const result = days(1).to(minutes);
      expect(result.value).toBeCloseTo(1440, 6);
      expect(result.symbol).toBe("min");
    });
  });

  describe("Velocity conversions", () => {
    it("metersPerSecond to kilometersPerHour", () => {
      const result = metersPerSecond(10).to(kilometersPerHour);
      expect(result.value).toBeCloseTo(36, 6);
      expect(result.symbol).toBe("km/h");
    });

    it("kilometersPerHour to metersPerSecond", () => {
      const result = kilometersPerHour(108).to(metersPerSecond);
      expect(result.value).toBeCloseTo(30, 6);
      expect(result.symbol).toBe("m/s");
    });

    it("milesPerHour to kilometersPerHour", () => {
      const result = milesPerHour(60).to(kilometersPerHour);
      expect(result.value).toBeCloseTo(96.5606, 3);
      expect(result.symbol).toBe("km/h");
    });

    it("kilometersPerHour to milesPerHour", () => {
      const result = kilometersPerHour(100).to(milesPerHour);
      expect(result.value).toBeCloseTo(62.1371, 3);
      expect(result.symbol).toBe("mph");
    });

    it("metersPerSecond to milesPerHour", () => {
      const result = metersPerSecond(1).to(milesPerHour);
      expect(result.value).toBeCloseTo(2.23694, 4);
      expect(result.symbol).toBe("mph");
    });
  });

  describe("Energy conversions", () => {
    it("joules to kilojoules", () => {
      const result = joules(5000).to(kilojoules);
      expect(result.value).toBeCloseTo(5, 6);
      expect(result.symbol).toBe("kJ");
    });

    it("kilojoules to joules", () => {
      const result = kilojoules(3).to(joules);
      expect(result.value).toBeCloseTo(3000, 6);
      expect(result.symbol).toBe("J");
    });

    it("joules to calories", () => {
      const result = joules(4.184).to(calories);
      expect(result.value).toBeCloseTo(1, 6);
      expect(result.symbol).toBe("cal");
    });

    it("calories to joules", () => {
      const result = calories(100).to(joules);
      expect(result.value).toBeCloseTo(418.4, 6);
      expect(result.symbol).toBe("J");
    });

    it("kilocalories to joules", () => {
      const result = kilocalories(1).to(joules);
      expect(result.value).toBeCloseTo(4184, 6);
      expect(result.symbol).toBe("J");
    });

    it("kilocalories to calories", () => {
      const result = kilocalories(1).to(calories);
      expect(result.value).toBeCloseTo(1000, 6);
      expect(result.symbol).toBe("cal");
    });
  });

  describe("Power conversions", () => {
    it("watts to kilowatts", () => {
      const result = watts(5000).to(kilowatts);
      expect(result.value).toBeCloseTo(5, 6);
      expect(result.symbol).toBe("kW");
    });

    it("kilowatts to watts", () => {
      const result = kilowatts(2.5).to(watts);
      expect(result.value).toBeCloseTo(2500, 6);
      expect(result.symbol).toBe("W");
    });
  });

  describe("Pressure conversions", () => {
    it("pascals to kilopascals", () => {
      const result = pascals(101325).to(kilopascals);
      expect(result.value).toBeCloseTo(101.325, 6);
      expect(result.symbol).toBe("kPa");
    });

    it("atmospheres to pascals", () => {
      const result = atmospheres(1).to(pascals);
      expect(result.value).toBeCloseTo(101325, 6);
      expect(result.symbol).toBe("Pa");
    });

    it("atmospheres to kilopascals", () => {
      const result = atmospheres(1).to(kilopascals);
      expect(result.value).toBeCloseTo(101.325, 6);
      expect(result.symbol).toBe("kPa");
    });

    it("kilopascals to atmospheres", () => {
      const result = kilopascals(101.325).to(atmospheres);
      expect(result.value).toBeCloseTo(1, 6);
      expect(result.symbol).toBe("atm");
    });
  });

  describe("Temperature conversions (offset-based)", () => {
    it("celsius to kelvin", () => {
      const result = celsius(0).to(kelvin);
      expect(result.value).toBeCloseTo(273.15, 6);
      expect(result.symbol).toBe("K");
    });

    it("kelvin to celsius", () => {
      const result = kelvin(373.15).to(celsius);
      expect(result.value).toBeCloseTo(100, 6);
      expect(result.symbol).toBe("°C");
    });

    it("celsius to fahrenheit", () => {
      const result = celsius(100).to(fahrenheit);
      expect(result.value).toBeCloseTo(212, 4);
      expect(result.symbol).toBe("°F");
    });

    it("fahrenheit to celsius", () => {
      const result = fahrenheit(32).to(celsius);
      expect(result.value).toBeCloseTo(0, 6);
      expect(result.symbol).toBe("°C");
    });

    it("kelvin to fahrenheit", () => {
      const result = kelvin(273.15).to(fahrenheit);
      expect(result.value).toBeCloseTo(32, 4);
      expect(result.symbol).toBe("°F");
    });

    it("fahrenheit to kelvin", () => {
      const result = fahrenheit(212).to(kelvin);
      expect(result.value).toBeCloseTo(373.15, 4);
      expect(result.symbol).toBe("K");
    });

    it("body temperature roundtrip", () => {
      const bodyF = fahrenheit(98.6);
      const bodyC = bodyF.to(celsius);
      expect(bodyC.value).toBeCloseTo(37, 4);
      const backToF = celsius(bodyC.value).to(fahrenheit);
      expect(backToF.value).toBeCloseTo(98.6, 4);
    });
  });

  describe("Frequency conversions", () => {
    it("hertz to kilohertz", () => {
      const result = hertz(1000).to(kilohertz);
      expect(result.value).toBeCloseTo(1, 6);
      expect(result.symbol).toBe("kHz");
    });

    it("megahertz to hertz", () => {
      const result = megahertz(1).to(hertz);
      expect(result.value).toBeCloseTo(1e6, 0);
      expect(result.symbol).toBe("Hz");
    });

    it("gigahertz to megahertz", () => {
      const result = gigahertz(2.4).to(megahertz);
      expect(result.value).toBeCloseTo(2400, 6);
      expect(result.symbol).toBe("MHz");
    });
  });

  describe("Voltage conversions", () => {
    it("volts to millivolts", () => {
      const result = volts(1).to(millivolts);
      expect(result.value).toBeCloseTo(1000, 6);
      expect(result.symbol).toBe("mV");
    });

    it("kilovolts to volts", () => {
      const result = kilovolts(1).to(volts);
      expect(result.value).toBeCloseTo(1000, 6);
      expect(result.symbol).toBe("V");
    });
  });

  describe("Resistance conversions", () => {
    it("ohms to kilohms", () => {
      const result = ohms(4700).to(kilohms);
      expect(result.value).toBeCloseTo(4.7, 6);
      expect(result.symbol).toBe("kΩ");
    });

    it("megohms to ohms", () => {
      const result = megohms(1).to(ohms);
      expect(result.value).toBeCloseTo(1e6, 0);
      expect(result.symbol).toBe("Ω");
    });

    it("kilohms to megohms", () => {
      const result = kilohms(1000).to(megohms);
      expect(result.value).toBeCloseTo(1, 6);
      expect(result.symbol).toBe("MΩ");
    });
  });

  describe("Roundtrip conversions", () => {
    it("converting back and forth preserves the value", () => {
      const original = kilometers(42);
      const inMiles = original.to(miles);
      const backToKm = miles(inMiles.value).to(kilometers);
      expect(backToKm.value).toBeCloseTo(42, 6);
    });

    it("chain of conversions is consistent", () => {
      const start = meters(1000);
      const inKm = start.to(kilometers);
      const inMiles = kilometers(inKm.value).to(miles);
      const backToMeters = miles(inMiles.value).to(meters);
      expect(backToMeters.value).toBeCloseTo(1000, 6);
    });
  });
});

// ==========================================================================
// 4. Scale and Neg
// ==========================================================================

describe("scale and neg", () => {
  it("scale multiplies value by factor", () => {
    const u = meters(5).scale(3);
    expect(u.value).toBe(15);
    expect(u.symbol).toBe("m");
  });

  it("scale by zero gives zero", () => {
    const u = kilometers(100).scale(0);
    expect(u.value).toBe(0);
  });

  it("scale by negative factor", () => {
    const u = meters(10).scale(-2);
    expect(u.value).toBe(-20);
  });

  it("neg negates the value", () => {
    const u = meters(5).neg();
    expect(u.value).toBe(-5);
    expect(u.symbol).toBe("m");
  });

  it("double neg returns original value", () => {
    const u = meters(7).neg().neg();
    expect(u.value).toBe(7);
  });

  it("neg of zero is negative zero", () => {
    const u = meters(0).neg();
    expect(u.value).toBe(-0);
  });
});

// ==========================================================================
// 5. Equality
// ==========================================================================

describe("equals", () => {
  it("equal values return true", () => {
    expect(meters(10).equals(meters(10))).toBe(true);
  });

  it("different values return false", () => {
    expect(meters(10).equals(meters(11))).toBe(false);
  });

  it("equivalent units in different constructors are equal (SI comparison)", () => {
    expect(meters(1000).equals(kilometers(1))).toBe(true);
  });

  it("respects default tolerance (1e-10)", () => {
    const a = meters(1);
    const b = new Unit(1 + 1e-11, "m") as typeof a;
    expect(a.equals(b)).toBe(true);
  });

  it("values beyond default tolerance are not equal", () => {
    const a = meters(1);
    const b = new Unit(1 + 1e-9, "m") as typeof a;
    expect(a.equals(b)).toBe(false);
  });

  it("custom tolerance", () => {
    expect(meters(10).equals(meters(10.05), 0.1)).toBe(true);
    expect(meters(10).equals(meters(10.2), 0.1)).toBe(false);
  });
});

// ==========================================================================
// 6. toString
// ==========================================================================

describe("toString", () => {
  it("formats value with symbol", () => {
    expect(meters(5).toString()).toBe("5 m");
  });

  it("formats without symbol when none provided", () => {
    const u = new Unit(42);
    expect(u.toString()).toBe("42");
  });

  it("formats decimal values", () => {
    expect(kilometers(2.5).toString()).toBe("2500 km");
  });

  it("formats negative values", () => {
    expect(meters(-3).toString()).toBe("-3 m");
  });

  it(".to() result formats with the target symbol", () => {
    expect(meters(1000).to(kilometers).toString()).toBe("1 km");
  });
});

// ==========================================================================
// 7. units Tagged Template (Runtime Fallback)
// ==========================================================================

describe("units tagged template", () => {
  it("parses integer value with unit", () => {
    const u = units`100 meters`;
    expect(u.value).toBe(100);
  });

  it("parses decimal value with unit", () => {
    const u = units`3.5 km`;
    expect(u.value).toBe(3500);
  });

  it("parses negative value", () => {
    const u = units`-5 m`;
    expect(u.value).toBe(-5);
  });

  it("parses scientific notation", () => {
    const u = units`1e3 m`;
    expect(u.value).toBe(1000);
  });

  it("parses velocity units", () => {
    const u = units`60 km/h`;
    expect(u.value).toBeCloseTo(60 / 3.6, 6);
  });

  it("parses short unit names", () => {
    expect(units`1 kg`.value).toBe(1);
    expect(units`1 lb`.value).toBeCloseTo(0.453592, 6);
    expect(units`1 ft`.value).toBeCloseTo(0.3048, 6);
  });

  it("parses long unit names", () => {
    expect(units`5 kilometers`.value).toBe(5000);
    expect(units`2 hours`.value).toBe(7200);
    expect(units`10 pounds`.value).toBeCloseTo(4.53592, 4);
  });

  it("throws on invalid format", () => {
    expect(() => units`not a unit`).toThrow("Invalid unit literal");
  });

  it("throws on unknown unit", () => {
    expect(() => units`5 lightyears`).toThrow("Unknown unit");
  });

  it("parses dimensionless value", () => {
    const u = units`42`;
    expect(u.value).toBe(42);
  });
});

// ==========================================================================
// 8. Edge Cases
// ==========================================================================

describe("Edge cases", () => {
  it("zero value conversions", () => {
    const result = meters(0).to(kilometers);
    expect(result.value).toBe(0);
    expect(result.symbol).toBe("km");
  });

  it("very large values", () => {
    const result = meters(1e12).to(kilometers);
    expect(result.value).toBeCloseTo(1e9, 0);
  });

  it("very small values", () => {
    const result = meters(1e-9).to(millimeters);
    expect(result.value).toBeCloseTo(1e-6, 12);
  });

  it("converting to the same unit returns equivalent value", () => {
    const result = meters(42).to(meters);
    expect(result.value).toBeCloseTo(42, 6);
    expect(result.symbol).toBe("m");
  });

  it("arithmetic result can be converted", () => {
    const sum = meters(500).add(kilometers(1));
    const inKm = sum.to(kilometers);
    expect(inKm.value).toBeCloseTo(1.5, 6);
  });

  it("negative values convert correctly", () => {
    const result = meters(-1000).to(kilometers);
    expect(result.value).toBeCloseTo(-1, 6);
  });

  it("conversion preserves precision for simple ratios", () => {
    expect(kilograms(1).to(grams).value).toBe(1000);
    expect(hours(1).to(minutes).value).toBe(60);
    expect(days(1).to(hours).value).toBe(24);
    expect(kilowatts(1).to(watts).value).toBe(1000);
    expect(kilojoules(1).to(joules).value).toBe(1000);
    expect(kilopascals(1).to(pascals).value).toBe(1000);
  });

  it("mul then div by same unit returns original dimensions", () => {
    const distance = meters(100);
    const time = seconds(10);
    const velocity = distance.div(time);
    const backToDistance = velocity.mul(time);
    expect(backToDistance.value).toBeCloseTo(100, 6);
  });
});
