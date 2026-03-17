---
layout: page
title: Playground
description: Try typesugar in your browser - no installation required
sidebar: false
aside: false
---

<script setup>
import { onMounted, ref } from 'vue'

const showPlayground = ref(false)

onMounted(() => {
  showPlayground.value = true
})
</script>

<ClientOnly>
  <Playground v-if="showPlayground" />
</ClientOnly>

<style>
/* Hide sidebar completely on playground page */
.VPSidebar {
  display: none !important;
}

.VPDoc {
  padding: 0 !important;
}

.VPDoc .container {
  max-width: 100% !important;
}

.VPDoc .content {
  padding: 0 !important;
  max-width: 100% !important;
}

.VPDoc .content-container {
  max-width: 100% !important;
}

/* Remove sidebar spacing */
.VPContent.has-sidebar {
  padding-left: 0 !important;
  margin-left: 0 !important;
}

.VPContent {
  padding-left: 0 !important;
}

/* Ensure full width and height */
main {
  min-height: calc(100vh - 64px);
  width: 100% !important;
}
</style>
