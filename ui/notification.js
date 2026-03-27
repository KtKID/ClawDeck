// ui/notification.js — Toast notification system

export class NotificationManager {
  constructor(container) {
    this.el = document.createElement('div');
    this.el.className = 'notification-container';
    container.appendChild(this.el);
  }

  show(message, duration = 3000) {
    const note = document.createElement('div');
    note.className = 'notification';
    note.textContent = message;
    this.el.appendChild(note);

    setTimeout(() => {
      note.classList.add('fade-out');
      note.addEventListener('animationend', () => note.remove());
    }, duration);
  }
}
