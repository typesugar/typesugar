<script setup lang="ts">
import { ref, onErrorCaptured, provide } from "vue";

const props = withDefaults(
  defineProps<{
    fallbackMessage?: string;
  }>(),
  {
    fallbackMessage: "Something went wrong. Please try refreshing the page.",
  }
);

const emit = defineEmits<{
  (e: "error", error: Error, info: string): void;
}>();

const hasError = ref(false);
const errorMessage = ref<string | null>(null);
const errorStack = ref<string | null>(null);

function reset() {
  hasError.value = false;
  errorMessage.value = null;
  errorStack.value = null;
}

function captureError(error: Error, info?: string) {
  hasError.value = true;
  errorMessage.value = error.message;
  errorStack.value = error.stack ?? null;
  emit("error", error, info ?? "unknown");
  console.error("Error boundary caught:", error, info);
}

onErrorCaptured((error, instance, info) => {
  captureError(error as Error, info);
  return false;
});

provide("errorBoundary", { captureError, reset });

defineExpose({ reset, captureError, hasError });
</script>

<template>
  <div v-if="hasError" class="error-boundary" role="alert" aria-live="assertive">
    <div class="error-boundary-content">
      <div class="error-icon" aria-hidden="true">⚠️</div>
      <h3 class="error-title">Playground Error</h3>
      <p class="error-message">{{ fallbackMessage }}</p>
      <details v-if="errorMessage" class="error-details">
        <summary>Technical Details</summary>
        <code class="error-code">{{ errorMessage }}</code>
        <pre v-if="errorStack" class="error-stack">{{ errorStack }}</pre>
      </details>
      <div class="error-actions">
        <button class="reset-btn" @click="reset" aria-label="Try again to recover from error">
          Try Again
        </button>
        <button
          class="reload-btn"
          @click="() => window.location.reload()"
          aria-label="Reload the page"
        >
          Reload Page
        </button>
      </div>
    </div>
  </div>
  <slot v-else />
</template>

<style scoped>
.error-boundary {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 300px;
  padding: 24px;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
}

.error-boundary-content {
  text-align: center;
  max-width: 500px;
}

.error-icon {
  font-size: 48px;
  margin-bottom: 16px;
}

.error-title {
  font-size: 20px;
  font-weight: 600;
  color: var(--vp-c-text-1);
  margin: 0 0 8px;
}

.error-message {
  font-size: 14px;
  color: var(--vp-c-text-2);
  margin: 0 0 16px;
  line-height: 1.5;
}

.error-details {
  text-align: left;
  margin-bottom: 16px;
  background: var(--vp-c-bg-soft);
  border-radius: 6px;
  padding: 12px;
}

.error-details summary {
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  color: var(--vp-c-text-2);
  margin-bottom: 8px;
}

.error-code {
  display: block;
  font-size: 12px;
  font-family: var(--vp-font-family-mono);
  color: var(--vp-c-red-1);
  word-break: break-word;
  margin-bottom: 8px;
}

.error-stack {
  font-size: 11px;
  font-family: var(--vp-font-family-mono);
  color: var(--vp-c-text-3);
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 150px;
  margin: 0;
}

.error-actions {
  display: flex;
  justify-content: center;
  gap: 12px;
}

.reset-btn,
.reload-btn {
  padding: 10px 20px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.reset-btn {
  background: var(--vp-c-brand-1);
  border: 1px solid var(--vp-c-brand-1);
  color: white;
}

.reset-btn:hover {
  background: var(--vp-c-brand-2);
}

.reset-btn:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 2px;
}

.reload-btn {
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  color: var(--vp-c-text-1);
}

.reload-btn:hover {
  background: var(--vp-c-bg-mute);
}

.reload-btn:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 2px;
}
</style>
