# Fx: Typed Effects That Compile Away

> Where typesugar fundamentally diverges from every existing web framework.

## The Problem

Every web app is a mess of interleaved concerns:

- **State** — local component state, shared stores, URL state
- **Network** — API calls, WebSockets, SSE
- **Storage** — localStorage, IndexedDB, cookies
- **Navigation** — routing, history, deep links
- **Auth** — tokens, sessions, permissions
- **Analytics** — tracking, logging
- **Concurrency** — cancellation, debouncing, race conditions

In React, these are tangled together in `useEffect` with no type-level tracking. In Effect-TS, they're beautifully typed but carry ~100KB of runtime overhead.

## The Solution: `Fx<Value, Error, Requirements>`

A type that describes an effectful computation, what it can fail with, and what services it needs:

```typescript
type Fx<A, E = never, R = never>
```

At the type level, this tracks everything. At runtime after macro expansion, it's just `Promise<A>` — or even synchronous code if the macro can prove it.

---

## Defining Services

Services are typeclasses. They describe capabilities without prescribing implementation.

```typescript
@typeclass
interface HttpClient {
  fetch<T>(url: string, opts?: RequestInit): Fx<T, HttpError>;
}

@typeclass
interface AuthService {
  getToken(): Fx<string, AuthError>;
  refresh(): Fx<string, AuthError>;
}

@typeclass
interface Analytics {
  track(event: string, data?: Record<string, unknown>): Fx<void>;
}
```

## Composing Effects with Do-Notation

Every `yield*` binding chains effects, and the type system accumulates error and requirement types automatically.

```typescript
// TS-compatible (generators):
// Type: Fx<User, HttpError | AuthError, HttpClient & AuthService>
const fetchUser = (id: string) => fx(function*() {
  const token = yield* auth.getToken();
  const user = yield* http.fetch<User>(`/api/users/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  yield* analytics.track("user.viewed", { id });
  return user;
});

// Extended syntax (opt-in preprocessor):
const fetchUser = (id: string) => fx {
  token <- auth.getToken()
  user  <- http.fetch<User>(`/api/users/${id}`, {
               headers: { Authorization: `Bearer ${token}` }
           })
  _     <- analytics.track("user.viewed", { id })
  return user
}
```

**What the macro compiles this to:**

```typescript
const fetchUser = async (id: string) => {
  const token = await getToken();
  const user = await fetch(`/api/users/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => {
    if (!r.ok) throw new HttpError(r);
    return r.json();
  });
  track("user.viewed", { id });
  return user;
};
```

The `fx` block:

1. Resolves `auth`, `http`, `analytics` via `summon<>()` at compile time
2. Inlines the typeclass instance methods via `specialize()`
3. Flattens the monadic chain into sequential async/await
4. Eliminates the `Fx` wrapper entirely — it was only a type-level construct

---

## Providing Services

At the application boundary, you provide concrete implementations. This is compile-time dependency injection — like Effect's Layers, but resolved during the build, not at startup.

```typescript
// Production implementations
@instance const prodHttp: HttpClient = {
  fetch: (url, opts) => Fx.fromPromise(
    globalThis.fetch(url, opts).then(r => r.json())
  )
};

@instance const prodAuth: AuthService = {
  getToken: () => Fx.pure(localStorage.getItem("token") ?? ""),
  refresh:  () => Fx.fromPromise(refreshTokenFromServer())
};

// Test implementations — swap at compile time via cfg()
@instance @cfgAttr("test")
const testHttp: HttpClient = {
  fetch: (url) => Fx.pure(mockResponses[url])
};
```

---

## Error Handling

Errors are tracked in the type system. You must handle them — or explicitly propagate them — before the `Fx` can be run.

```typescript
// Type-safe error recovery
const safeUser = fetchUser(id)
  .recover(HttpError, () => cachedUser)
  .recover(AuthError, () => redirectToLogin());

// Exhaustive error matching (compile error if you miss a case)
const handled = fetchUser(id).match({
  Ok: (user) => html`<UserCard user=${user} />`,
  HttpError: (e) => html`<Alert>Network error: ${e.status}</Alert>`,
  AuthError: () => html`<LoginPrompt />`,
});
```

---

## Resource Management

The `use` block compiles to try/finally, ensuring cleanup even on errors or cancellation.

```typescript
const processFile = fx(function* () {
  const handle = yield* use(openFile(path), (file) => file.close());
  const data = yield* handle.readAll();
  return parse(data);
});
```

**Compiles to:**

```typescript
const processFile = async (path) => {
  const handle = await openFile(path);
  try {
    const data = await handle.readAll();
    return parse(data);
  } finally {
    handle.close();
  }
};
```

---

## Structured Concurrency

Race conditions are the #1 source of bugs in async UI code. The effect system provides structured concurrency primitives that compile to well-behaved Promise patterns.

```typescript
const searchResults = fx(function* () {
  const query = yield* watch(searchInput);

  const results = yield* Fx.all(
    http.fetch<Results>(`/search?q=${query}`),
    http.fetch<Suggestions>(`/suggest?q=${query}`)
  );

  const fresh = yield* Fx.race(
    results,
    Fx.delay(3000).map(() => cachedResults)
  );

  return fresh;
});
```

**Compiles to:**

```typescript
const searchResults = async (query) => {
  const controller = new AbortController();
  try {
    const results = await Promise.all([
      fetch(`/search?q=${query}`, { signal: controller.signal }).then((r) => r.json()),
      fetch(`/suggest?q=${query}`, { signal: controller.signal }).then((r) => r.json()),
    ]);
    return await Promise.race([
      Promise.resolve(results),
      new Promise((r) => setTimeout(() => r(cachedResults), 3000)),
    ]);
  } catch (e) {
    controller.abort();
    throw e;
  }
};
```

---

## Connecting Effects to the UI

### Pattern 1: Read (Fetch + Display)

The `resource()` bridge fetches data and exposes loading/error/success states as reactive signals.

```typescript
const UserProfile = component(($) => {
  $.props<{ userId: string }>();

  $.view = ({ userId }) => {
    const user = resource(() => fetchUser(userId));

    return match(user) {
      Loading: ()  => html`<Skeleton lines={5} />`,
      Err:     (e) => html`<Alert level="error">${e.message}</Alert>`,
      Ok:      (u) => html`<ProfileCard user=${u} />`
    };
  };
});
```

### Pattern 2: Write (Mutate + Show Status)

The `action()` primitive tracks mutation states reactively.

```typescript
const UpdateButton = component(($) => {
  $.props<{ user: User }>();

  $.view = ({ user }) => {
    const update = action(updateUser);

    return html`
      <button onClick=${() => update.run(user)} disabled=${update.pending}>
        ${update.pending ? "Saving..." : "Save"}
      </button>
      ${update.error ? html`<span class="error">${update.error}</span>` : null}
    `;
  };
});
```

### Pattern 3: Optimistic Update

```typescript
const LikeButton = component(($) => {
  $.props<{ postId: string; initialCount: number }>();

  $.view = ({ postId, initialCount }) => {
    const likes = ref(initialCount);
    const like = action(() => api.likePost(postId), {
      optimistic: () => likes.value++,
    });

    return html`
      <button onClick=${() => like.run()}>${like.pending ? "..." : `${likes} likes`}</button>
    `;
  };
});
```

### Why Separate Effects from Signals?

| Concern          | Tool                                 | Why                                      |
| ---------------- | ------------------------------------ | ---------------------------------------- |
| Sync state       | Signals (`ref`, `computed`)          | Instant updates, fine-grained reactivity |
| Async operations | Effects (`Fx`, `resource`, `action`) | Typed requirements/errors, lifecycle     |
| Derived async    | `resource()`                         | Bridges effects into reactive land       |
| Mutations        | `action()`                           | Tracks pending/error, handles races      |

Signals are for what's **already known**. Effects are for **getting to know**.

---

## Stores (Shared Reactive State)

Stores combine signals with effect-based persistence:

```typescript
const userStore = store({
  initial: { theme: "light", notifications: true },
  persist: "localStorage:settings",

  actions: {
    setTheme: (state, theme: Theme) =>
      fx(function* () {
        yield* api.savePreferences({ theme });
        return { ...state, theme };
      }),

    toggleNotifications: (state) => ({
      ...state,
      notifications: !state.notifications,
    }),
  },
});

// Usage in component
const Settings = component(() => {
  const { state, setTheme, toggleNotifications } = userStore;

  return html`
    <select onChange=${(e) => setTheme(e.target.value)}>
      <option value="light" selected=${state.theme === "light"}>Light</option>
      <option value="dark" selected=${state.theme === "dark"}>Dark</option>
    </select>
    <input type="checkbox" checked=${state.notifications} onChange=${toggleNotifications} />
  `;
});
```

---

See also:

- [Reactivity](./reactivity.md) — signals and state
- [Components](./components.md) — using effects in components
- [Server](./server.md) — server-side effects and RPC
- [Effect Integration](./effect-integration.md) — deep Effect-TS integration
