---
layout: page
title: Playground
description: Try typesugar in your browser - no installation required
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

/* Hide the default VitePress content padding for playground */
.VPContent.has-sidebar {
  padding-left: 0 !important;
}

/* Ensure full height */
main {
  min-height: calc(100vh - 64px);
}
</style>
