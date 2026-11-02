import { codec } from "@typesugar/codec";

@codec(1)
export class User {
  name!: string;
}
