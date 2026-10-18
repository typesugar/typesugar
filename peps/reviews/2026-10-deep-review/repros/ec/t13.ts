import { codec, since } from "@typesugar/codec";

@codec(2)
export class User {
  name!: string;
  @since(2) age?: number;
}
