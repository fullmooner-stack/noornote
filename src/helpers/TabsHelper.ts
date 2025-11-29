/**
 * TabsHelper - Unified tab management utilities
 *
 * Usage:
 * - HTML: <div class="tabs"><button class="tab tab--active" data-tab="foo">...</button></div>
 * - Content: <div class="tab-content tab-content--active" data-tab-content="foo">...</div>
 */

export type TabChangeCallback = (tabId: string) => void;

/**
 * Setup click handlers for all tabs within a container
 * @param container - Parent element containing .tabs
 * @param onTabChange - Callback when tab is clicked (receives data-tab value)
 * @param selector - Optional custom selector (default: '.tab')
 */
export function setupTabClickHandlers(
  container: HTMLElement,
  onTabChange: TabChangeCallback,
  selector = '.tab'
): void {
  const tabs = container.querySelectorAll(selector);
  tabs.forEach(tab => {
    tab.addEventListener('click', (e) => {
      const tabEl = e.currentTarget as HTMLElement;
      const tabId = tabEl.dataset.tab;
      if (tabId) {
        onTabChange(tabId);
      }
    });
  });
}

/**
 * Switch to a tab by its data-tab value (tabs only, no content)
 * @param container - Parent element containing tabs
 * @param tabId - The data-tab value to activate
 * @param selector - Optional custom selector (default: '.tab')
 */
export function switchTab(
  container: HTMLElement,
  tabId: string,
  selector = '.tab'
): void {
  const tabs = container.querySelectorAll(selector);
  tabs.forEach(tab => {
    const el = tab as HTMLElement;
    if (el.dataset.tab === tabId) {
      el.classList.add('tab--active');
    } else {
      el.classList.remove('tab--active');
    }
  });
}

/**
 * Switch to a tab and its corresponding content
 * @param container - Parent element containing tabs and content
 * @param tabId - The data-tab / data-tab-content value to activate
 */
export function switchTabWithContent(
  container: HTMLElement,
  tabId: string
): void {
  // Update tabs
  container.querySelectorAll('.tab').forEach(tab => {
    const el = tab as HTMLElement;
    if (el.dataset.tab === tabId) {
      el.classList.add('tab--active');
    } else {
      el.classList.remove('tab--active');
    }
  });

  // Update content
  container.querySelectorAll('.tab-content').forEach(content => {
    const el = content as HTMLElement;
    if (el.dataset.tabContent === tabId) {
      el.classList.add('tab-content--active');
    } else {
      el.classList.remove('tab-content--active');
    }
  });
}

/**
 * Deactivate all tabs and content within a container
 * @param container - Parent element containing tabs
 */
export function deactivateAllTabs(container: HTMLElement): void {
  container.querySelectorAll('.tab').forEach(t => t.classList.remove('tab--active'));
  container.querySelectorAll('.tab-content').forEach(c => c.classList.remove('tab-content--active'));
}

/**
 * Activate a specific tab element directly
 * @param tabElement - The tab button element to activate
 */
export function activateTabElement(tabElement: HTMLElement): void {
  tabElement.classList.add('tab--active');
}

/**
 * Get the currently active tab's data-tab value
 * @param container - Parent element containing tabs
 * @returns The data-tab value of the active tab, or null if none
 */
export function getActiveTabId(container: HTMLElement): string | null {
  const activeTab = container.querySelector('.tab--active') as HTMLElement | null;
  return activeTab?.dataset.tab ?? null;
}
