// Language service plugin for typesugar
// Delegates to @typesugar/transformer's language service implementation
// TypeScript expects the factory function directly, not wrapped in { default }
const plugin = require("@typesugar/transformer/language-service");
module.exports = plugin.default || plugin;
