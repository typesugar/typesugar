/**
 * Keyed List Reconciler
 *
 * Efficiently reconciles lists by key, only updating DOM nodes that changed.
 * Used by the each() macro in fine-grained mode.
 *
 * This is a simplified implementation based on:
 * - Solid.js's keyed reconciler
 * - Svelte's keyed each block
 * - React's key-based reconciliation (but more direct)
 */

import React, { useRef, useEffect, useState } from "react";
import type { Signal } from "./signals.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Render function for list items
 */
export type ListRenderFn<T> = (item: T, index: number) => React.ReactNode;

/**
 * Key extraction function
 */
export type KeyFn<T, K> = (item: T) => K;

/**
 * Internal item state
 */
interface ItemState<T, K> {
  key: K;
  item: T;
  index: number;
}

// ============================================================================
// Reconciliation Logic
// ============================================================================

/**
 * Reconcile old and new items, computing the minimal set of operations
 */
function reconcileItems<T, K>(
  oldItems: ItemState<T, K>[],
  newItems: T[],
  keyFn: KeyFn<T, K>,
): {
  keep: Map<K, { oldIndex: number; newIndex: number }>;
  add: Array<{ key: K; item: T; index: number }>;
  remove: Set<K>;
  reorder: boolean;
} {
  const oldByKey = new Map<K, number>();
  for (let i = 0; i < oldItems.length; i++) {
    oldByKey.set(oldItems[i].key, i);
  }

  const keep = new Map<K, { oldIndex: number; newIndex: number }>();
  const add: Array<{ key: K; item: T; index: number }> = [];
  const remove = new Set<K>(oldByKey.keys());
  let reorder = false;
  let lastKeptOldIndex = -1;

  for (let newIndex = 0; newIndex < newItems.length; newIndex++) {
    const item = newItems[newIndex];
    const key = keyFn(item);
    const oldIndex = oldByKey.get(key);

    if (oldIndex !== undefined) {
      // Item exists in old list
      keep.set(key, { oldIndex, newIndex });
      remove.delete(key);

      // Check if we need to reorder
      if (oldIndex < lastKeptOldIndex) {
        reorder = true;
      }
      lastKeptOldIndex = Math.max(lastKeptOldIndex, oldIndex);
    } else {
      // New item
      add.push({ key, item, index: newIndex });
    }
  }

  return { keep, add, remove, reorder };
}

// ============================================================================
// React Component
// ============================================================================

/**
 * Keyed list component for fine-grained updates
 *
 * Usage:
 * ```tsx
 * <KeyedList
 *   items={items}
 *   keyFn={item => item.id}
 *   render={(item, index) => <ItemComponent item={item} />}
 * />
 * ```
 */
export function KeyedList<T, K>({
  items,
  keyFn,
  render,
}: {
  items: readonly T[];
  keyFn: KeyFn<T, K>;
  render: ListRenderFn<T>;
}): React.ReactElement {
  // Track item states for reconciliation
  const statesRef = useRef<ItemState<T, K>[]>([]);

  // Compute new states and reconcile
  const newStates: ItemState<T, K>[] = items.map((item, index) => ({
    key: keyFn(item),
    item,
    index,
  }));

  // For now, we just render the list with keys
  // In a full implementation, we'd do proper DOM reconciliation
  statesRef.current = newStates;

  return React.createElement(
    React.Fragment,
    null,
    newStates.map(({ key, item, index }) =>
      React.createElement(
        React.Fragment,
        { key: String(key) },
        render(item, index),
      ),
    ),
  );
}

// ============================================================================
// Imperative Reconciler (for non-React fine-grained mode)
// ============================================================================

/**
 * Imperative reconciler for direct DOM manipulation
 * Used when not using React's VDOM
 */
export class ImperativeReconciler<T, K> {
  private container: HTMLElement;
  private keyFn: KeyFn<T, K>;
  private renderFn: (item: T, index: number) => HTMLElement;
  private itemStates: ItemState<T, K>[] = [];
  private nodesByKey: Map<K, HTMLElement> = new Map();

  constructor(
    container: HTMLElement,
    keyFn: KeyFn<T, K>,
    renderFn: (item: T, index: number) => HTMLElement,
  ) {
    this.container = container;
    this.keyFn = keyFn;
    this.renderFn = renderFn;
  }

  /**
   * Update the list with new items
   */
  update(items: readonly T[]): void {
    const { keep, add, remove, reorder } = reconcileItems(
      this.itemStates,
      [...items],
      this.keyFn,
    );

    // Remove old nodes
    for (const key of remove) {
      const node = this.nodesByKey.get(key);
      if (node) {
        node.remove();
        this.nodesByKey.delete(key);
      }
    }

    // Create new nodes
    for (const { key, item, index } of add) {
      const node = this.renderFn(item, index);
      this.nodesByKey.set(key, node);
    }

    // Build new item states
    const newStates: ItemState<T, K>[] = items.map((item, index) => ({
      key: this.keyFn(item),
      item,
      index,
    }));

    // If we need to reorder, clear and re-append all nodes in order
    if (reorder || add.length > 0 || remove.size > 0) {
      // Remove all children
      while (this.container.firstChild) {
        this.container.removeChild(this.container.firstChild);
      }

      // Append in new order
      for (const { key, item, index } of newStates) {
        let node = this.nodesByKey.get(key);
        if (!node) {
          // Shouldn't happen, but create if missing
          node = this.renderFn(item, index);
          this.nodesByKey.set(key, node);
        }
        this.container.appendChild(node);
      }
    }

    this.itemStates = newStates;
  }

  /**
   * Clean up and remove all nodes
   */
  dispose(): void {
    while (this.container.firstChild) {
      this.container.removeChild(this.container.firstChild);
    }
    this.nodesByKey.clear();
    this.itemStates = [];
  }
}

// ============================================================================
// Helper function for macro expansion
// ============================================================================

/**
 * keyedList() - Used by the each() macro in fine-grained mode
 *
 * Usage (macro-generated):
 * ```tsx
 * {keyedList(items, item => <Component item={item} />, item => item.id)}
 * ```
 */
export function keyedList<T, K>(
  items: readonly T[],
  render: ListRenderFn<T>,
  keyFn: KeyFn<T, K>,
): React.ReactElement {
  return React.createElement(KeyedList, { items, keyFn, render });
}

/**
 * Factory function to create a keyed list (alias for keyedList)
 *
 * This is the preferred API for programmatic creation.
 */
export const createKeyedList = keyedList;

// ============================================================================
// Signal-Aware List
// ============================================================================

/**
 * A list component that accepts a Signal<T[]> and automatically
 * re-renders when the signal changes
 */
export function SignalList<T, K>({
  items,
  keyFn,
  render,
}: {
  items: Signal<readonly T[]>;
  keyFn: KeyFn<T, K>;
  render: ListRenderFn<T>;
}): React.ReactElement {
  const [currentItems, setCurrentItems] = useState(items.get());

  useEffect(() => {
    return items.subscribe(setCurrentItems);
  }, [items]);

  return React.createElement(KeyedList, {
    items: currentItems,
    keyFn,
    render,
  });
}
