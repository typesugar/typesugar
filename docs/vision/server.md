# Server Integration

> Type-safe server/client boundaries, RPC, form actions, and SSR.

## Compile-Time Server/Client Boundary

Using `cfg()` and `@cfgAttr`, the same source file can contain both server and client code. The compiler strips the irrelevant parts from each bundle.

```typescript
// This function exists ONLY in the server bundle
@cfgAttr("server")
async function getUser(id: string): Promise<User> {
  return db.query(sql`SELECT * FROM users WHERE id = ${id}`);
}

// The macro generates an RPC stub for the client bundle automatically
const user = resource(() => getUser(props.id));
// Server build: calls getUser directly
// Client build: calls fetch("/api/__rpc/getUser", { body: { id: props.id } })
```

---

## Type-Safe API Routes

Route handlers are `Fx` computations. The error types flow through to the client, so the `resource` that consumes the API knows every possible failure.

```typescript
// server/routes/users.ts
export const getUser = route("GET", "/users/:id", (params) =>
  fx(function* () {
    const user = yield* db.query(sql`SELECT * FROM users WHERE id = ${params.id}`);
    return match(user, {
      Some: (u) => Response.json(u),
      None: () => Response.error(404, "User not found"),
    });
  })
);

// client/pages/user.ts — errors are typed!
const user = resource(() => api.getUser({ id: props.id }));
// typeof user: Resource<User, HttpError | NotFoundError>
```

---

## Form Actions (Remix-Style, But Typed)

Forms work without JavaScript (progressive enhancement) and with full type safety:

```typescript
export const createPost = formAction(PostSchema, (data) =>
  fx(function* () {
    const post = yield* db.insert(sql`INSERT INTO posts ${values(data)}`);
    return redirect(`/posts/${post.id}`);
  })
);

// In the component — works without JS
const NewPost = component(() => {
  return html`
    <form action=${createPost}>
      <input name="title" required />
      <textarea name="body" />
      <button type="submit">Publish</button>
    </form>
  `;
});
```

---

## Server-Side Rendering

### SSR Compilation

Templates compile to string concatenation on the server for maximum performance:

```typescript
// On client, compiles to DOM operations:
const _div = document.createElement("div");
_div.textContent = name;

// On server, compiles to string concat:
const html = `<div>${escapeHtml(name)}</div>`;
```

### Streaming SSR with Effects

Effects that fetch data can stream as they resolve:

```typescript
const UserPage = component(($) => {
  $.props<{ userId: string }>();

  $.view = ({ userId }) => {
    const user = resource(() => fetchUser(userId));

    return html`
      <Suspense fallback=${html`<Skeleton />`}>
        ${match(user) {
          Ok: (u) => html`<UserCard user=${u} />`
        }}
      </Suspense>
    `;
  };
});
```

The server streams the fallback immediately, then streams the resolved content when the effect completes.

---

## Automatic RPC Generation

For `@cfgAttr("server")` functions called from client code:

1. Server build: function runs directly
2. Client build: function is replaced with RPC stub

```typescript
// Source
@cfgAttr("server")
export async function createUser(data: CreateUserInput): Promise<User> {
  return db.insert(users).values(data).returning();
}

// Client build receives:
export async function createUser(data: CreateUserInput): Promise<User> {
  return fetch("/api/__rpc/createUser", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  }).then(r => r.json());
}

// Server build also generates the route handler automatically
```

---

## Database Integration

The `ConnectionIO` typeclass from `@typesugar/sql` provides typed database operations:

```typescript
@typeclass
interface ConnectionIO {
  query<T>(sql: SqlFragment): Fx<T[], DatabaseError>;
  execute(sql: SqlFragment): Fx<void, DatabaseError>;
  transaction<T>(fx: Fx<T, E, R>): Fx<T, E | TransactionError, R>;
}

// Usage in route handler
const getUsers = route("GET", "/users", () =>
  fx(function* () {
    const users = yield* db.query<User>(
      sql`SELECT id, name, email FROM users ORDER BY name`
    );
    return Response.json(users);
  })
);
```

The `sql` tagged template compiles to parameterized queries (preventing SQL injection) and validates the query against your schema at compile time.

---

## Implementation Roadmap

1. **Code Splitting**: `@cfgAttr("server")` / `@cfgAttr("client")`
2. **RPC Stubs**: Auto-generated for server functions called from client
3. **Route Macros**: Type-safe API routes with `route()`
4. **Form Actions**: `formAction()` with validation and progressive enhancement
5. **SSR**: Template compilation to string concatenation
6. **Streaming**: Suspense boundaries with effect resolution

---

See also:

- [Fx](./fx.md) — the effect system powering server code
- [Components](./components.md) — building server-rendered components
