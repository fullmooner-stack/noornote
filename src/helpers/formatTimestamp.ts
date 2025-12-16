/**
 * Format timestamp to human readable format with .date-time CSS class
 *
 * Rules:
 * 1. Within last hour: "12m" or "34s"
 * 2. Older than 1 hour but same calendar day: "20:43"
 * 3. Older than today but current calendar year: "30. Oct, 20:43"
 * 4. Older than current calendar year: "30. Oct. 2024, 20:43"
 *
 * @param timestamp - Unix timestamp in seconds
 * @returns HTML string with formatted time wrapped in span.date-time
 */
export function formatTimestamp(timestamp: number): string {
  if (!timestamp) return '';

  const now = new Date();
  const date = new Date(timestamp * 1000);
  const diffSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  let formatted: string;

  // Rule 1: Within last hour
  if (diffSeconds < 3600) {
    if (diffSeconds < 60) {
      formatted = `${Math.max(1, diffSeconds)}s`;
    } else {
      formatted = `${Math.floor(diffSeconds / 60)}m`;
    }
  } else {
    const time = formatTime(date);

    // Rule 2: Same calendar day
    if (isSameDay(date, now)) {
      formatted = time;
    } else {
      const day = date.getDate();
      const month = getMonthShort(date);

      // Rule 3: Current calendar year
      if (date.getFullYear() === now.getFullYear()) {
        formatted = `${day}. ${month}, ${time}`;
      } else {
        // Rule 4: Previous years
        formatted = `${day}. ${month}. ${date.getFullYear()}, ${time}`;
      }
    }
  }

  return `<span class="date-time">${formatted}</span>`;
}

/**
 * Format time as HH:MM with fallback for Intl.DateTimeFormat errors
 */
function formatTime(date: Date): string {
  try {
    return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  } catch {
    // Fallback: Manual formatting if Intl is unavailable
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  }
}

/**
 * Get short month name with fallback for Intl.DateTimeFormat errors
 */
function getMonthShort(date: Date): string {
  try {
    return date.toLocaleString('en-US', { month: 'short' });
  } catch {
    // Fallback: Manual month names if Intl is unavailable
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return months[date.getMonth()];
  }
}

/**
 * Check if two dates are the same calendar day
 */
function isSameDay(date1: Date, date2: Date): boolean {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  );
}
