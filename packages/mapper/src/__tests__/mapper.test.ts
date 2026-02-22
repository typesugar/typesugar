import { expect, test } from "vitest";
import { transformInto } from "../index.js";

interface User {
  first_name: string;
  last_name: string;
  age: number;
}

interface UserDTO {
  firstName: string;
  lastName: string;
  age: number;
  role: string;
  fullName: string;
}

// Skipped: transformInto is a compile-time macro; requires transformer to expand it (tracked for future work)
test.skip("transformInto maps correctly with zero-cost overhead", () => {
  const user: User = { first_name: "John", last_name: "Doe", age: 30 };

  const dto = transformInto<User, UserDTO>(user, {
    rename: {
      firstName: "first_name",
      lastName: "last_name",
    },
    const: {
      role: "user",
    },
    compute: {
      fullName: (src) => `${src.first_name} ${src.last_name}`,
    },
  });

  expect(dto).toEqual({
    firstName: "John",
    lastName: "Doe",
    age: 30,
    role: "user",
    fullName: "John Doe",
  });
});

// Skipped: transformInto is a compile-time macro; requires transformer to expand it (tracked for future work)
test.skip("transformInto works with complex source expressions", () => {
  function getUser(): User {
    return { first_name: "Jane", last_name: "Smith", age: 25 };
  }

  const dto = transformInto<User, UserDTO>(getUser(), {
    rename: {
      firstName: "first_name",
      lastName: "last_name",
    },
    const: {
      role: "admin",
    },
    compute: {
      fullName: (src) => `${src.first_name} ${src.last_name}`,
    },
  });

  expect(dto).toEqual({
    firstName: "Jane",
    lastName: "Smith",
    age: 25,
    role: "admin",
    fullName: "Jane Smith",
  });
});
