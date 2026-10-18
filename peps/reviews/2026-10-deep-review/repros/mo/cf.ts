import { cfg, cfgAttr } from "typesugar";
class A {
  @cfgAttr("debug")
  dbg() { return 1; }
  @cfgAttr("debug")
  x = 1;
  y = 2;
}
export const v = cfg("debug", "DEBUG-ON", "DEBUG-OFF");
