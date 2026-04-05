// ui/score-bar.js — Top score/status bar
import { t } from '../i18n/index.js';

export class ScoreBar {
  constructor(container) {
    this.el = document.createElement('div');
    this.el.className = 'score-bar';
    container.appendChild(this.el);

    this.scores = {
      agents: 0,
      tasks: 0,
      completed: 0,
      score: 0,
    };

    this._render();
  }

  update(scores) {
    Object.assign(this.scores, scores);
    this._render();
  }

  _render() {
    this.el.innerHTML = `
      <div class="score-item">
        <span class="score-label">${t('score.agents')}</span>
        <span class="score-value">${this.scores.agents}</span>
      </div>
      <div class="score-item">
        <span class="score-label">${t('score.active_tasks')}</span>
        <span class="score-value">${this.scores.tasks}</span>
      </div>
      <div class="score-item">
        <span class="score-label">${t('score.completed')}</span>
        <span class="score-value">${this.scores.completed}</span>
      </div>
      <div class="score-item">
        <span class="score-label">${t('score.score')}</span>
        <span class="score-value">${this.scores.score}</span>
      </div>
    `;
  }
}
