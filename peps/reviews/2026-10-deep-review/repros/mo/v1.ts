import { validator } from "typesugar";
interface U {
  "first-name": string;
  kind: "admin" | "user";
  active?: boolean;
  nick: string | null;
  greet(): string;
  role: Role;
}
enum Role { A = "a", B = "b" }
export const v = validator<U>();
