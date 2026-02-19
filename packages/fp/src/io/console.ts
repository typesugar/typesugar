/**
 * Console - IO-based console operations
 *
 * Provides effectful console input/output operations.
 *
 * Inspired by Scala's Cats Effect Console
 */

import { IO } from "./io";
import { Option, Some, None } from "../data/option";
import { Either, Left, Right } from "../data/either";

// ============================================================================
// Console Output
// ============================================================================

export const Console = {
  /**
   * Print a line to stdout with newline
   */
  putStrLn(message: string): IO<void> {
    return IO.delay(() => console.log(message));
  },

  /**
   * Print to stdout without newline
   */
  putStr(message: string): IO<void> {
    return IO.delay(() => {
      process.stdout.write(message);
    });
  },

  /**
   * Print a line to stderr
   */
  putErrLn(message: string): IO<void> {
    return IO.delay(() => console.error(message));
  },

  /**
   * Print to stderr without newline
   */
  putErr(message: string): IO<void> {
    return IO.delay(() => {
      process.stderr.write(message);
    });
  },

  /**
   * Print with formatting (like printf)
   */
  printf(format: string, ...args: unknown[]): IO<void> {
    return IO.delay(() => console.log(format, ...args));
  },

  /**
   * Print an object (with inspection)
   */
  inspect(obj: unknown): IO<void> {
    return IO.delay(() => console.dir(obj, { depth: null }));
  },

  /**
   * Print with a label
   */
  print(label: string, value: unknown): IO<void> {
    return IO.delay(() => console.log(`${label}:`, value));
  },

  /**
   * Clear the console
   */
  clear(): IO<void> {
    return IO.delay(() => console.clear());
  },

  /**
   * Print a newline
   */
  newLine(): IO<void> {
    return Console.putStrLn("");
  },

  /**
   * Print multiple lines
   */
  putStrLns(lines: string[]): IO<void> {
    return IO.void_(IO.traverse(lines, Console.putStrLn));
  },

  // ============================================================================
  // Console Input
  // ============================================================================

  /**
   * Read a line from stdin
   */
  readLine(): IO<string> {
    return IO.async<string>((cb) => {
      // Only works in Node.js environment
      if (typeof process === "undefined" || !process.stdin) {
        cb(Left(new Error("stdin not available")));
        return;
      }

      const readline = require("readline");
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      rl.question("", (answer: string) => {
        rl.close();
        cb(Right(answer));
      });
    });
  },

  /**
   * Read a line with a prompt
   */
  prompt(message: string): IO<string> {
    return IO.flatMap(Console.putStr(message), () => Console.readLine());
  },

  /**
   * Read a line and parse it
   */
  readAs<A>(parse: (s: string) => Option<A>): IO<Option<A>> {
    return IO.map(Console.readLine(), parse);
  },

  /**
   * Read a number
   */
  readNumber(): IO<Option<number>> {
    return Console.readAs((s) => {
      const n = parseFloat(s);
      return isNaN(n) ? None : Some(n);
    });
  },

  /**
   * Read an integer
   */
  readInt(): IO<Option<number>> {
    return Console.readAs((s) => {
      const n = parseInt(s, 10);
      return isNaN(n) ? None : Some(n);
    });
  },

  /**
   * Read a boolean (yes/no, true/false, y/n)
   */
  readBoolean(): IO<Option<boolean>> {
    return Console.readAs((s) => {
      const lower = s.toLowerCase().trim();
      if (["yes", "true", "y", "1"].includes(lower)) {
        return Some(true);
      }
      if (["no", "false", "n", "0"].includes(lower)) {
        return Some(false);
      }
      return None;
    });
  },

  /**
   * Read with validation and retry
   */
  readValidated<A>(
    promptMsg: string,
    parse: (s: string) => Either<string, A>,
  ): IO<A> {
    const attempt: IO<A> = IO.flatMap(Console.prompt(promptMsg), (input) => {
      const result = parse(input);
      if (result._tag === "Left") {
        return IO.flatMap(
          Console.putErrLn(`Invalid input: ${result.left}`),
          () => attempt,
        );
      }
      return IO.pure(result.right);
    });
    return attempt;
  },

  /**
   * Read a required number with validation
   */
  readRequiredNumber(promptMsg: string): IO<number> {
    return Console.readValidated(promptMsg, (s) => {
      const n = parseFloat(s);
      if (isNaN(n)) {
        return Left("Please enter a valid number");
      }
      return Right(n);
    });
  },

  /**
   * Read a required integer
   */
  readRequiredInt(promptMsg: string): IO<number> {
    return Console.readValidated(promptMsg, (s) => {
      const n = parseInt(s, 10);
      if (isNaN(n)) {
        return Left("Please enter a valid integer");
      }
      return Right(n);
    });
  },

  // ============================================================================
  // Interactive Menus
  // ============================================================================

  /**
   * Display a menu and get a choice
   */
  menu<A>(title: string, options: Array<[string, A]>): IO<A> {
    const displayMenu = IO.flatMap(Console.putStrLn(`\n${title}`), () =>
      IO.flatMap(Console.putStrLn("-".repeat(title.length)), () =>
        IO.traverse(
          options.map(([label], i) => `${i + 1}. ${label}`),
          Console.putStrLn,
        ),
      ),
    );

    const getChoice: IO<A> = IO.flatMap(
      Console.prompt("\nEnter your choice: "),
      (input) => {
        const choice = parseInt(input, 10);
        if (isNaN(choice) || choice < 1 || choice > options.length) {
          return IO.flatMap(
            Console.putErrLn(
              `Invalid choice. Please enter 1-${options.length}`,
            ),
            () => getChoice,
          );
        }
        return IO.pure(options[choice - 1][1]);
      },
    );

    return IO.flatMap(displayMenu, () => getChoice);
  },

  /**
   * Yes/No confirmation
   */
  confirm(message: string): IO<boolean> {
    return Console.readValidated(`${message} (y/n): `, (s) => {
      const lower = s.toLowerCase().trim();
      if (["y", "yes"].includes(lower)) return Right(true);
      if (["n", "no"].includes(lower)) return Right(false);
      return Left("Please enter y or n");
    });
  },

  // ============================================================================
  // Formatting Helpers
  // ============================================================================

  /**
   * Print a horizontal rule
   */
  hr(char: string = "-", length: number = 40): IO<void> {
    return Console.putStrLn(char.repeat(length));
  },

  /**
   * Print a header
   */
  header(title: string): IO<void> {
    return IO.flatMap(Console.newLine(), () =>
      IO.flatMap(Console.hr("=", title.length + 4), () =>
        IO.flatMap(Console.putStrLn(`= ${title} =`), () =>
          Console.hr("=", title.length + 4),
        ),
      ),
    );
  },

  /**
   * Print a bullet list
   */
  bulletList(items: string[]): IO<void> {
    return Console.putStrLns(items.map((item) => `  • ${item}`));
  },

  /**
   * Print a numbered list
   */
  numberedList(items: string[]): IO<void> {
    return Console.putStrLns(items.map((item, i) => `  ${i + 1}. ${item}`));
  },

  /**
   * Print a table (simple)
   */
  table(headers: string[], rows: string[][]): IO<void> {
    const colWidths = headers.map((h, i) =>
      Math.max(h.length, ...rows.map((r) => (r[i] || "").length)),
    );

    const formatRow = (cells: string[]): string =>
      cells.map((cell, i) => cell.padEnd(colWidths[i])).join(" | ");

    const separator = colWidths.map((w) => "-".repeat(w)).join("-+-");

    return IO.flatMap(Console.putStrLn(formatRow(headers)), () =>
      IO.flatMap(Console.putStrLn(separator), () =>
        IO.void_(IO.traverse(rows, (row) => Console.putStrLn(formatRow(row)))),
      ),
    );
  },

  /**
   * Print JSON
   */
  json(obj: unknown, indent: number = 2): IO<void> {
    return Console.putStrLn(JSON.stringify(obj, null, indent));
  },

  // ============================================================================
  // Progress and Status
  // ============================================================================

  /**
   * Print a progress indicator (simple)
   */
  progress(current: number, total: number, width: number = 40): IO<void> {
    const percent = Math.round((current / total) * 100);
    const filled = Math.round((current / total) * width);
    const empty = width - filled;
    const bar = "[" + "█".repeat(filled) + "░".repeat(empty) + "]";
    return Console.putStr(`\r${bar} ${percent}%`);
  },

  /**
   * Print a spinner frame
   */
  spinner(frame: number): IO<void> {
    const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    return Console.putStr(`\r${frames[frame % frames.length]} `);
  },

  /**
   * Print with color (ANSI codes)
   */
  color: {
    red: (text: string) => `\x1b[31m${text}\x1b[0m`,
    green: (text: string) => `\x1b[32m${text}\x1b[0m`,
    yellow: (text: string) => `\x1b[33m${text}\x1b[0m`,
    blue: (text: string) => `\x1b[34m${text}\x1b[0m`,
    magenta: (text: string) => `\x1b[35m${text}\x1b[0m`,
    cyan: (text: string) => `\x1b[36m${text}\x1b[0m`,
    white: (text: string) => `\x1b[37m${text}\x1b[0m`,
    bold: (text: string) => `\x1b[1m${text}\x1b[0m`,
    dim: (text: string) => `\x1b[2m${text}\x1b[0m`,
    underline: (text: string) => `\x1b[4m${text}\x1b[0m`,
  },

  /**
   * Print success message
   */
  success(message: string): IO<void> {
    return Console.putStrLn(Console.color.green(`✓ ${message}`));
  },

  /**
   * Print error message
   */
  error(message: string): IO<void> {
    return Console.putErrLn(Console.color.red(`✗ ${message}`));
  },

  /**
   * Print warning message
   */
  warning(message: string): IO<void> {
    return Console.putStrLn(Console.color.yellow(`⚠ ${message}`));
  },

  /**
   * Print info message
   */
  info(message: string): IO<void> {
    return Console.putStrLn(Console.color.blue(`ℹ ${message}`));
  },
};

// ============================================================================
// Console Do-syntax helpers
// ============================================================================

/**
 * Console operations for do-notation
 */
export const ConsoleDo = {
  /**
   * Read a line into a binding
   */
  readLine: Console.readLine(),

  /**
   * Read with prompt
   */
  prompt: (msg: string) => Console.prompt(msg),

  /**
   * Print line
   */
  putStrLn: (msg: string) => Console.putStrLn(msg),
};
