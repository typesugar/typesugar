import DefaultTheme from "vitepress/theme";
import type { Theme } from "vitepress";
import { h } from "vue";
import "./custom.css";

import MonacoEditor from "../components/MonacoEditor.vue";
import Playground from "../components/Playground.vue";

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component("MonacoEditor", MonacoEditor);
    app.component("Playground", Playground);
  },
} satisfies Theme;
