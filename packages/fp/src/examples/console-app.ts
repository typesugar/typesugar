/**
 * Console App Example
 *
 * A complete interactive console application demonstrating IO monad usage
 * with the full @ttfx/fp system.
 *
 * Features:
 * - Interactive menu system
 * - State management with Ref
 * - Error handling
 * - Resource management
 * - Pure functional style
 */

import { IO, runIO } from "../io/io";
import { IOApp, ExitSuccess, ExitFailure, ExitCode } from "../io/io-app";
import { Console } from "../io/console";
import { Ref } from "../io/ref";
import { Resource } from "../io/resource";
import { Option, Some, None } from "../data/option";
import { Either, Left, Right } from "../data/either";
import { List } from "../data/list";
import { pipe } from "../syntax/pipe";

// ============================================================================
// Domain Types
// ============================================================================

/**
 * A todo item
 */
interface TodoItem {
  readonly id: number;
  readonly title: string;
  readonly completed: boolean;
  readonly createdAt: Date;
}

/**
 * Application state
 */
interface AppState {
  readonly todos: List<TodoItem>;
  readonly nextId: number;
}

/**
 * Initial state
 */
const initialState: AppState = {
  todos: List.nil(),
  nextId: 1,
};

// ============================================================================
// State Operations (Pure Functions)
// ============================================================================

/**
 * Add a todo to the state
 */
function addTodo(state: AppState, title: string): AppState {
  const newTodo: TodoItem = {
    id: state.nextId,
    title,
    completed: false,
    createdAt: new Date(),
  };
  return {
    todos: List.cons(newTodo, state.todos),
    nextId: state.nextId + 1,
  };
}

/**
 * Toggle a todo's completion status
 */
function toggleTodo(state: AppState, id: number): AppState {
  return {
    ...state,
    todos: List.map(state.todos, (todo) =>
      todo.id === id ? { ...todo, completed: !todo.completed } : todo,
    ),
  };
}

/**
 * Remove a todo
 */
function removeTodo(state: AppState, id: number): AppState {
  return {
    ...state,
    todos: List.filter(state.todos, (todo) => todo.id !== id),
  };
}

/**
 * Clear completed todos
 */
function clearCompleted(state: AppState): AppState {
  return {
    ...state,
    todos: List.filter(state.todos, (todo) => !todo.completed),
  };
}

/**
 * Find a todo by ID
 */
function findTodo(state: AppState, id: number): Option<TodoItem> {
  return List.find(state.todos, (todo) => todo.id === id);
}

// ============================================================================
// IO Actions
// ============================================================================

/**
 * Display the main menu
 */
function displayMenu(): IO<void> {
  return IO.sequence([
    Console.newLine(),
    Console.header("Todo App"),
    Console.putStrLn(""),
    Console.numberedList([
      "List all todos",
      "Add new todo",
      "Toggle todo completion",
      "Remove todo",
      "Clear completed",
      "Exit",
    ]),
    Console.putStrLn(""),
  ]).void_();
}

/**
 * Display a single todo
 */
function displayTodo(todo: TodoItem): IO<void> {
  const status = todo.completed ? "[✓]" : "[ ]";
  const style = todo.completed ? Console.color.dim : (s: string) => s;
  return Console.putStrLn(`  ${status} #${todo.id}: ${style(todo.title)}`);
}

/**
 * Display all todos
 */
function displayTodos(stateRef: Ref<AppState>): IO<void> {
  return IO.flatMap(stateRef.get(), (state) => {
    const todoArray = List.toArray(state.todos);

    if (todoArray.length === 0) {
      return Console.info("No todos yet. Add some!");
    }

    const completed = todoArray.filter((t) => t.completed).length;
    const pending = todoArray.length - completed;

    return IO.sequence([
      Console.putStrLn(""),
      Console.putStrLn(
        `📋 Your Todos (${pending} pending, ${completed} completed):`,
      ),
      Console.putStrLn("-".repeat(40)),
      ...todoArray.map(displayTodo),
      Console.putStrLn("-".repeat(40)),
    ]).void_();
  });
}

/**
 * Add a new todo
 */
function addNewTodo(stateRef: Ref<AppState>): IO<void> {
  return IO.flatMap(Console.prompt("Enter todo title: "), (title) => {
    if (title.trim().length === 0) {
      return Console.warning("Title cannot be empty");
    }
    return IO.flatMap(
      stateRef.update((state) => addTodo(state, title.trim())),
      () => Console.success(`Added: "${title.trim()}"`),
    );
  });
}

/**
 * Toggle a todo's completion
 */
function toggleTodoById(stateRef: Ref<AppState>): IO<void> {
  return IO.flatMap(displayTodos(stateRef), () =>
    IO.flatMap(Console.readRequiredInt("Enter todo ID to toggle: "), (id) =>
      IO.flatMap(stateRef.get(), (state) => {
        const todo = findTodo(state, id);
        if (todo._tag === "None") {
          return Console.error(`Todo #${id} not found`);
        }
        return IO.flatMap(
          stateRef.update((s) => toggleTodo(s, id)),
          () =>
            Console.success(
              `${todo.value.completed ? "Marked incomplete" : "Completed"}: "${todo.value.title}"`,
            ),
        );
      }),
    ),
  );
}

/**
 * Remove a todo
 */
function removeTodoById(stateRef: Ref<AppState>): IO<void> {
  return IO.flatMap(displayTodos(stateRef), () =>
    IO.flatMap(Console.readRequiredInt("Enter todo ID to remove: "), (id) =>
      IO.flatMap(stateRef.get(), (state) => {
        const todo = findTodo(state, id);
        if (todo._tag === "None") {
          return Console.error(`Todo #${id} not found`);
        }
        return IO.flatMap(
          Console.confirm(`Remove "${todo.value.title}"?`),
          (confirmed) => {
            if (!confirmed) {
              return Console.info("Cancelled");
            }
            return IO.flatMap(
              stateRef.update((s) => removeTodo(s, id)),
              () => Console.success(`Removed: "${todo.value.title}"`),
            );
          },
        );
      }),
    ),
  );
}

/**
 * Clear all completed todos
 */
function clearCompletedTodos(stateRef: Ref<AppState>): IO<void> {
  return IO.flatMap(stateRef.get(), (state) => {
    const completed = List.filter(state.todos, (t) => t.completed);
    const count = List.length(completed);

    if (count === 0) {
      return Console.info("No completed todos to clear");
    }

    return IO.flatMap(
      Console.confirm(
        `Clear ${count} completed todo${count === 1 ? "" : "s"}?`,
      ),
      (confirmed) => {
        if (!confirmed) {
          return Console.info("Cancelled");
        }
        return IO.flatMap(stateRef.update(clearCompleted), () =>
          Console.success(
            `Cleared ${count} completed todo${count === 1 ? "" : "s"}`,
          ),
        );
      },
    );
  });
}

/**
 * Handle a menu choice
 */
function handleChoice(stateRef: Ref<AppState>, choice: number): IO<boolean> {
  switch (choice) {
    case 1:
      return IO.as(displayTodos(stateRef), true);
    case 2:
      return IO.as(addNewTodo(stateRef), true);
    case 3:
      return IO.as(toggleTodoById(stateRef), true);
    case 4:
      return IO.as(removeTodoById(stateRef), true);
    case 5:
      return IO.as(clearCompletedTodos(stateRef), true);
    case 6:
      return IO.as(Console.putStrLn("\nGoodbye! 👋"), false);
    default:
      return IO.as(Console.warning("Invalid choice. Please enter 1-6."), true);
  }
}

/**
 * Main application loop
 */
function mainLoop(stateRef: Ref<AppState>): IO<void> {
  return IO.flatMap(displayMenu(), () =>
    IO.flatMap(Console.readRequiredInt("Enter your choice: "), (choice) =>
      IO.flatMap(handleChoice(stateRef, choice), (continue_) => {
        if (continue_) {
          return mainLoop(stateRef);
        }
        return IO.unit;
      }),
    ),
  );
}

// ============================================================================
// Application Entry Point
// ============================================================================

/**
 * The main program
 */
export function todoApp(): IO<ExitCode> {
  return IO.flatMap(
    // Initialize state
    Ref.make(initialState),
    (stateRef) =>
      IO.flatMap(
        // Show welcome message
        IO.sequence([
          Console.clear(),
          Console.putStrLn(""),
          Console.putStrLn(
            Console.color.cyan("╔═══════════════════════════════════╗"),
          ),
          Console.putStrLn(
            Console.color.cyan("║     Welcome to Todo App! 📝       ║"),
          ),
          Console.putStrLn(
            Console.color.cyan("╚═══════════════════════════════════╝"),
          ),
        ]).void_(),
        () =>
          // Run main loop with error handling
          IO.handleError(IO.as(mainLoop(stateRef), ExitSuccess), (error) =>
            IO.flatMap(
              Console.error(`An error occurred: ${error.message}`),
              () => IO.pure(ExitFailure),
            ),
          ),
      ),
  );
}

/**
 * Run the todo app
 */
export function runTodoApp(): void {
  runIO(todoApp())
    .then((code) => {
      if (typeof process !== "undefined") {
        process.exit(code);
      }
    })
    .catch(console.error);
}

// ============================================================================
// Alternative: Using IOApp class
// ============================================================================

/**
 * TodoApp class extending IOApp
 */
export class TodoAppClass extends IOApp {
  run(_args: string[]): IO<ExitCode> {
    return todoApp();
  }
}

// ============================================================================
// Simple Demo (doesn't require interactive input)
// ============================================================================

/**
 * A non-interactive demo that shows the app structure
 */
export function todoAppDemo(): IO<void> {
  return IO.flatMap(Ref.make(initialState), (stateRef) =>
    IO.sequence([
      Console.putStrLn("=== Todo App Demo ==="),
      Console.putStrLn(""),

      // Add some todos
      stateRef.update((s) => addTodo(s, "Learn functional programming")),
      Console.success("Added todo 1"),
      stateRef.update((s) => addTodo(s, "Build a todo app")),
      Console.success("Added todo 2"),
      stateRef.update((s) => addTodo(s, "Write documentation")),
      Console.success("Added todo 3"),

      // Display
      displayTodos(stateRef),

      // Complete one
      stateRef.update((s) => toggleTodo(s, 2)),
      Console.success("Completed todo 2"),

      // Display again
      displayTodos(stateRef),

      // Clear completed
      stateRef.update(clearCompleted),
      Console.success("Cleared completed todos"),

      // Final display
      displayTodos(stateRef),

      Console.putStrLn("\n=== Demo Complete ==="),
    ]).void_(),
  );
}

/**
 * Run the demo
 */
export function runDemo(): void {
  runIO(todoAppDemo()).catch(console.error);
}
