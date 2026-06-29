---
layout: page
title: Playground
description: Try typesugar in your browser - no installation required
sidebar: false
aside: false
---

<script setup>
import { onMounted, onUnmounted, ref } from 'vue'

const showPlayground = ref(false)

onMounted(() => {
  showPlayground.value = true
  // Scope the full-width layout overrides below to this page only.
  // VitePress bundles markdown <style> blocks into the GLOBAL stylesheet, so
  // these theme-level selectors would otherwise leak to every page (hiding the
  // sidebar and removing the content margin everywhere). Gate them on a body
  // class that exists only while the playground is mounted.
  document.body.classList.add('playground-page')
})

onUnmounted(() => {
  document.body.classList.remove('playground-page')
})
</script>

<ClientOnly>
  <Playground v-if="showPlayground" />
</ClientOnly>

<style>
/* These rules target VitePress theme-level elements and are bundled GLOBALLY,
   so every selector is gated on `body.playground-page` (added/removed by the
   script above) to keep them from leaking onto other pages. */

/* Hide sidebar completely on playground page */
body.playground-page .VPSidebar {
  display: none !important;
}

body.playground-page .VPDoc {
  padding: 0 !important;
}

body.playground-page .VPDoc .container {
  max-width: 100% !important;
}

body.playground-page .VPDoc .content {
  padding: 0 !important;
  max-width: 100% !important;
}

body.playground-page .VPDoc .content-container {
  max-width: 100% !important;
}

/* Remove sidebar spacing */
body.playground-page .VPContent.has-sidebar {
  padding-left: 0 !important;
  margin-left: 0 !important;
}

body.playground-page .VPContent {
  padding-left: 0 !important;
}

/* Ensure full width and height */
body.playground-page main {
  min-height: calc(100vh - 64px);
  width: 100% !important;
}
</style>
