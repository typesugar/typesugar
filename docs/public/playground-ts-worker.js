/**
 * Web Worker running a TypeScript LanguageService on transformed code.
 * Plain JS — served as a static file from docs/public/.
 *
 * Lib files (console, Math, etc.) and ambient declarations are added
 * from the main thread via "addLib" messages after the worker is ready.
 */

// Load TypeScript from CDN
var TS_CDN = "https://cdn.jsdelivr.net/npm/typescript@5.8/lib";
importScripts(TS_CDN + "/typescript.js");

// ---------------------------------------------------------------------------
// Virtual file system
// ---------------------------------------------------------------------------

var files = new Map();
var INPUT_FILE = "input.ts";

function setFile(name, content) {
  var existing = files.get(name);
  if (existing) {
    existing.content = content;
    existing.version++;
  } else {
    files.set(name, { content: content, version: 1 });
  }
}

setFile(INPUT_FILE, "");

// ---------------------------------------------------------------------------
// Language Service Host
// ---------------------------------------------------------------------------

var compilerOptions = {
  target: ts.ScriptTarget.ES2020,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  esModuleInterop: true,
  strict: false,
  noImplicitAny: false,
  noEmit: true,
  allowJs: true,
  jsx: ts.JsxEmit.React,
  experimentalDecorators: true,
  skipLibCheck: true,
  skipDefaultLibCheck: true,
  types: [],
  typeRoots: [],
};

var lsHost = {
  getScriptFileNames: function () {
    return Array.from(files.keys());
  },
  getScriptVersion: function (fileName) {
    var file = files.get(fileName);
    return file ? String(file.version) : "0";
  },
  getScriptSnapshot: function (fileName) {
    var file = files.get(fileName);
    if (file) return ts.ScriptSnapshot.fromString(file.content);
    return undefined;
  },
  getCurrentDirectory: function () {
    return "/";
  },
  getCompilationSettings: function () {
    return compilerOptions;
  },
  getDefaultLibFileName: function () {
    return "";
  },
  fileExists: function (fileName) {
    return files.has(fileName);
  },
  readFile: function (fileName) {
    var f = files.get(fileName);
    return f ? f.content : undefined;
  },
};

var documentRegistry = ts.createDocumentRegistry();
var lsvc = ts.createLanguageService(lsHost, documentRegistry);

// ---------------------------------------------------------------------------
// Message handling
// ---------------------------------------------------------------------------

function serializeDiagnostic(d) {
  var msg = typeof d.messageText === "string" ? d.messageText : d.messageText.messageText;
  return {
    start: d.start || 0,
    length: d.length || 0,
    messageText: msg,
    category: d.category,
    code: d.code,
  };
}

function handleMessage(msg) {
  var method = msg.method;
  var params = msg.params;

  switch (method) {
    case "updateFile":
      setFile(params[0], params[1]);
      return { ok: true };

    case "addLib":
      setFile(params[0], params[1]);
      return { ok: true };

    case "getDiagnostics": {
      var syn = lsvc.getSyntacticDiagnostics(params[0]);
      var sem = lsvc.getSemanticDiagnostics(params[0]);
      return syn.concat(sem).map(serializeDiagnostic);
    }

    case "getCompletions": {
      var result = lsvc.getCompletionsAtPosition(params[0], params[1], {
        includeCompletionsForModuleExports: false,
        includeCompletionsWithInsertText: true,
      });
      if (!result) return null;
      return {
        isGlobalCompletion: result.isGlobalCompletion,
        isMemberCompletion: result.isMemberCompletion,
        entries: result.entries.map(function (e) {
          return {
            name: e.name,
            kind: e.kind,
            sortText: e.sortText,
            insertText: e.insertText,
            isRecommended: e.isRecommended,
          };
        }),
      };
    }

    case "getQuickInfo": {
      var info = lsvc.getQuickInfoAtPosition(params[0], params[1]);
      if (!info) return null;
      return {
        kind: info.kind,
        textSpan: info.textSpan,
        displayParts: (info.displayParts || [])
          .map(function (p) {
            return p.text;
          })
          .join(""),
        documentation: (info.documentation || [])
          .map(function (p) {
            return p.text;
          })
          .join(""),
      };
    }

    case "getDefinition": {
      var defs = lsvc.getDefinitionAtPosition(params[0], params[1]);
      if (!defs) return null;
      return defs
        .filter(function (d) {
          return d.fileName === params[0];
        })
        .map(function (d) {
          return { textSpan: d.textSpan, fileName: d.fileName };
        });
    }

    case "getSignatureHelp": {
      var help = lsvc.getSignatureHelpItems(params[0], params[1], {});
      if (!help) return null;
      return {
        selectedItemIndex: help.selectedItemIndex,
        argumentIndex: help.argumentIndex,
        items: help.items.map(function (item) {
          return {
            label: (item.prefixDisplayParts || [])
              .concat(item.suffixDisplayParts || [])
              .map(function (p) {
                return p.text;
              })
              .join(""),
            parameters: item.parameters.map(function (p) {
              return {
                label: p.displayParts
                  .map(function (dp) {
                    return dp.text;
                  })
                  .join(""),
                documentation: (p.documentation || [])
                  .map(function (dp) {
                    return dp.text;
                  })
                  .join(""),
              };
            }),
            documentation: (item.documentation || [])
              .map(function (p) {
                return p.text;
              })
              .join(""),
          };
        }),
      };
    }

    default:
      throw new Error("Unknown method: " + method);
  }
}

self.onmessage = function (e) {
  var msg = e.data;
  try {
    var result = handleMessage(msg);
    self.postMessage({ id: msg.id, result: result });
  } catch (err) {
    self.postMessage({ id: msg.id, error: err.message || String(err) });
  }
};

// Signal ready
self.postMessage({ id: -1, result: "ready" });
