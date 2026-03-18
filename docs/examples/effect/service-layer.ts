//! Effect — Services & Layers
//! @service, @layer, and compile-time layer resolution

import { comptime, staticAssert, derive, Eq } from "typesugar";

// @typesugar/effect adds @service, @layer, and resolveLayer() macros.
// These are compile-time macros — the transformer generates the Effect
// boilerplate (Context.Tag, Layer.succeed, etc.) so you never write it.

// Since Effect TS is not bundled in the playground, this example
// demonstrates the typesugar *compile-time* side: @derive + comptime
// applied to a service architecture pattern.

@derive(Eq)
class ServiceConfig {
  constructor(
    public host: string,
    public port: number,
    public secure: boolean,
  ) {}
}

const config = new ServiceConfig("api.example.com", 443, true);
const same = new ServiceConfig("api.example.com", 443, true);
const other = new ServiceConfig("localhost", 8080, false);

// 👀 Check JS Output — === becomes field-by-field comparison
console.log("config === same?", config === same);    // true
console.log("config === other?", config === other);  // false

// comptime() builds the service registry at compile time
const SERVICES = comptime(() => ["AuthService", "UserRepo", "HttpClient"]);
staticAssert(SERVICES.length === 3, "must register 3 services");
staticAssert(SERVICES.includes("AuthService"), "auth required");

console.log("registered services:", SERVICES);
console.log("endpoint:", `https://${config.host}:${config.port}`);

// Try: add a new service to the SERVICES array and update the staticAssert
