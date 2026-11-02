import { codec, since, defaultValue } from "@typesugar/codec";

@codec(2)
export class User {
  name!: string;
  @since(2) @defaultValue(Date.now()) createdAt!: number;
  @since(2) nick?: string;
}
