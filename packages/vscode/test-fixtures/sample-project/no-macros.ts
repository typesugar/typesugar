interface User {
  name: string;
  age: number;
  email: string;
}

function createUser(name: string, age: number, email: string): User {
  return { name, age, email };
}

const users: User[] = [
  createUser("Alice", 30, "alice@example.com"),
  createUser("Bob", 25, "bob@example.com"),
];

export { User, createUser, users };
