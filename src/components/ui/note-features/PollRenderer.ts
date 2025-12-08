/**
 * PollRenderer - Renders poll options for kind:6969 poll events
 * Fetches vote counts via PollOrchestrator and displays results
 * Extracts from: OriginalNoteRenderer.renderPollOptions()
 */

import type { NostrEvent } from '@nostr-dev-kit/ndk';
import { PollOrchestrator } from '../../../services/orchestration/PollOrchestrator';

export class PollRenderer {
  /**
   * Render poll options for kind 6969 poll events
   * Fetches vote counts via PollOrchestrator and displays results
   */
  static render(noteElement: HTMLElement, event: NostrEvent): void {
    // Extract poll options from tags
    const pollOptions = event.tags
      .filter(tag => tag[0] === 'poll_option')
      .map(tag => ({ index: tag[1], text: tag[2], voteCount: 0, zapAmount: 0 }))
      .sort((a, b) => parseInt(a.index) - parseInt(b.index));

    if (pollOptions.length === 0) return;

    // Create poll container
    const pollContainer = document.createElement('div');
    pollContainer.className = 'poll-options';

    // Create option buttons (initially without votes)
    pollOptions.forEach(option => {
      const optionBtn = document.createElement('button');
      optionBtn.className = 'poll-option';
      optionBtn.disabled = true;
      optionBtn.dataset.optionIndex = option.index;
      optionBtn.innerHTML = `
        <span class="poll-option-text">${option.text}</span>
        <span class="poll-option-stats">
          <span class="poll-option-count">Loading...</span>
        </span>
      `;
      pollContainer.appendChild(optionBtn);
    });

    // Insert poll container after content, before ISL
    const isl = noteElement.querySelector('.isl');
    if (isl) {
      isl.before(pollContainer);
    } else {
      noteElement.appendChild(pollContainer);
    }

    // Fetch poll results asynchronously
    const pollOrchestrator = PollOrchestrator.getInstance();
    pollOrchestrator.fetchPollResults(event.id, pollOptions).then(results => {
        // Update UI with vote counts
        results.options.forEach(option => {
          const optionBtn = pollContainer.querySelector(`[data-option-index="${option.index}"]`);
          if (!optionBtn) return;

          const countSpan = optionBtn.querySelector('.poll-option-count');
          if (!countSpan) return;

          // Calculate percentage
          const percentage = results.totalVotes > 0
            ? Math.round((option.voteCount / results.totalVotes) * 100)
            : 0;

          // Update text
          countSpan.textContent = `${percentage}% (${option.voteCount} ${option.voteCount === 1 ? 'vote' : 'votes'})`;

          // Add progress bar background
          optionBtn.style.setProperty('--vote-percentage', `${percentage}%`);
          optionBtn.classList.add('has-votes');
        });
    }).catch(error => {
        console.warn('Failed to fetch poll results:', error);
        // Show error state
        pollOptions.forEach(option => {
          const optionBtn = pollContainer.querySelector(`[data-option-index="${option.index}"]`);
          if (!optionBtn) return;

          const countSpan = optionBtn.querySelector('.poll-option-count');
          if (countSpan) {
            countSpan.textContent = 'Failed to load votes';
          }
        });
    });
  }
}
